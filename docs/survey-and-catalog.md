# Survey and catalog

`pag survey <dir>` is a static, bounded, read-only scan of an installed game folder. It never executes or loads anything from that folder. It produces `survey.json`: facts about the game, a verdict, and a ranked list of lanes. The offline **catalog** adds "this game already has a known port". Both are data driven: knowledge lives in JSON files, not in code.

Related: [lanes.md](lanes.md) (what the ranked lanes are), [safety-and-policy.md](safety-and-policy.md) (acks, why STOP is final), [architecture.md](architecture.md), [cli.md](cli.md#survey) for flags. Agent-facing steps are in [SKILL.md](../skills/port-any-game/SKILL.md).

| Code | Role |
|---|---|
| [survey/survey.mjs](../skills/port-any-game/scripts/survey/survey.mjs) | Orchestrator and CLI (`run`) |
| [lib/fsx.mjs](../skills/port-any-game/scripts/lib/fsx.mjs) | `walk`, bounded reads, `sha256File`, `rootId` |
| [survey/pe.mjs](../skills/port-any-game/scripts/survey/pe.mjs) | PE/NE/LE/LX/ELF/Mach-O header parser |
| [survey/rulematch.mjs](../skills/port-any-game/scripts/survey/rulematch.mjs) | Shared rule loader and static matcher |
| [survey/engines.mjs](../skills/port-any-game/scripts/survey/engines.mjs) | Engine and graphics/audio/input API detection |
| [survey/protection.mjs](../skills/port-any-game/scripts/survey/protection.mjs) | DRM, protector, packer detection |
| [survey/identity.mjs](../skills/port-any-game/scripts/survey/identity.mjs) | Steam/GOG ids and title guess |
| [survey/verdict.mjs](../skills/port-any-game/scripts/survey/verdict.mjs) | `decide()`: verdict, reasons, acks, legal flags |
| [catalog.mjs](../skills/port-any-game/scripts/catalog.mjs), [catalog/games.json](../skills/port-any-game/catalog/games.json) | Catalog loader and matcher |
| [rules/](../skills/port-any-game/scripts/rules/) | `engines.json`, `protection.json`, `apis.json`, `NOTICE.md` |

## What survey does, in order

1. **File walk** (`walk`). Depth-first, entries sorted by name, so results are deterministic. Limits and behaviour:
   - at most `maxFiles` (default 200 000) non-directory entries; the first beyond that sets `truncated: true` and stops. Symlinks count toward the cap;
   - per-entry problems never throw: an unreadable directory, a failed `lstat`, or a file that cannot be opened becomes a `skipped` entry with a scrubbed reason (file-system messages embed absolute paths, so only the part before the first comma and quote is kept);
   - symlinks are recorded as `skipped` ("symlink not followed") and never followed;
   - a missing path or non-directory is a usage error (exit 2).
2. **PE parsing** (`parseExecutable`). Candidates are files ending `.exe`, `.com`, `.dll` that are non-empty, ordered executables first, then shallowest, then by path, capped at **200** parsed. Each parse is capped at **4 MiB of reads in total** (and section entropy at 2 MiB, 1 MiB per section) through an injectable `read`, so a hostile file cannot make survey slow. The result is `null` for non-executables. Malformed headers give partial info, never a throw. It reports:
   - `format` (`MZ`, `NE`, `LE`, `LX`, `PE32`, `PE32+`, `ELF`, `MachO`), `machine` (`i386`, `amd64`, `arm64`), `subsystem`, `clr` (managed .NET image), linker version, timestamp (trust always `low`);
   - section names with entropy, import and delay-import DLL names (max 256), DLL-name strings found in the data (dynamic loads), the `ProductName` from the version resource, and the overlay (bytes after the last section) with a detected `magic` (`zip`, `swf`, `ags-clib`, `godot-pck`, `clickteam`, `pyinstaller`).
3. **Executables list.** Of the parsed non-DLL files, the **main** executable is the largest one that is not an installer (name like `setup*`, `unins*`, `install*`, `redist*`, `vcredist*`, `dxsetup`, `dotnet*`, `crashhandler`, `crashpad*`); installers get `role: installer`, the rest `other`. At most 100 are emitted, each with a SHA-256 (files over 256 MiB hash only the first and last 1 MiB and carry `partial: true`).
4. **Engine detection** (`detectEngines`). Every rule in `rules/engines.json` is matched; see [rule files](#rule-files). Confidence is the rule's base plus 0.02 per extra piece of evidence, capped at 0.99. Results sort by confidence. A rule marked `fallback` (`native-win32`) is reported only when nothing else matched.
5. **API detection** (`detectApis`). DLL names (imports, delay imports, dynamic strings) are matched against `rules/apis.json` and grouped as `graphics`, `audio`, `input`, `video`, `network`, each with the strongest way it was found (`import` > `delay` > `dynamic`).
6. **Protection detection** (`detectProtection`). Rules in `rules/protection.json` plus one built-in heuristic, `packed-generic`. See [Protection verdicts](#protection-verdicts-stop-and-warn).
7. **Identity and store** (`detectIdentity`). Only bounded 64 KiB head reads. `steam_appid.txt` (shallowest) is accepted when it is 1 to 10 digits. `goggame-<id>.info` gives `gog_id` from its file name and `title_guess` from its JSON `name`. Otherwise the title guess is the main exe's `ProductName`. `store` also records `steam_api` (a `steam_api(64).dll` exists) and `epic` (a `.egstore/` folder).
8. **Catalog match** (`matchCatalog`), see [The catalog](#the-catalog).
9. **Verdict and lanes** (`decide`), see below.

`survey.json` holds only relative paths and a salted `root_id`, never the absolute game path. `features.size_class` is `ok` under 300 MiB, `streaming` under 2 GiB, else `hard`.

### Protection verdicts: STOP and WARN

Each protection hit has `id`, `class` (`DRM`, `PROTECTOR`, `ANTI_CHEAT`, `LAUNCHER`, `PIRATED`, `PACKER`), `severity` and `evidence`.

- **STOP.** Real copy protection, protectors, anti-cheat, an external launcher requirement, or a pirated-Steam-emulator marker (Steam stub `.bind`, SecuROM, SafeDisc, StarForce, Themida, VMProtect, Enigma, ASProtect, Denuvo, EasyAntiCheat, BattlEye, GameGuard, PunkBuster, Ubisoft launcher, GFWL, EA Origin, MS Store GDK, `steam_emu.ini`). The tool does not remove or bypass protection. A STOP verdict has `primary_lane: null`, the reasons tell the user to look for a DRM-free edition (for example on GOG), and `pag new` refuses every lane except `remote-play` (`STOP_VERDICT`). Exit code of `pag survey` is **4**.
- **WARN.** Weaker signals that need a user acknowledgement: UPX, ASPack, MPress, Petite, NSPack, PECompact, `msix-package`, `safedisc-marker` and `starforce-marker` (a generic-looking temp file, so a marker only), `ea-origin-installer`, `steam-api` (a Steamworks DLL is common in games that otherwise run). The generic `packed-generic` heuristic reports a PE with a high-entropy code section (over 7.3, at least 4096 raw bytes), at most 3 imports and no CLR header, but only when no PACKER rule already matched. Packed binaries are never unpacked automatically.

## Overall verdict and lane ranking

[`decide()`](../skills/port-any-game/scripts/survey/verdict.mjs) is pure.

1. `rankLanes` ranks lanes: GO before HARD, then lower rung, then `known-port` first ([lanes.md](lanes.md#ranking)). Under STOP, every lane except `remote-play` becomes `NO`.
2. **STOP:** reasons list each STOP rule (with up to two evidence items), then note that only remote-play stays possible (unavailable in M1, M2 planned). `required_acknowledgements` is empty.
3. **Otherwise:** `primary_lane` is the first usable lane that is `available`. `overall` is `GO` if its verdict is `GO`, else `HARD` (also when there is no primary lane, with the reason "No lane built in this milestone fits this game"). The first higher-ranked unavailable lane is named as "Best fit X ... available in Mx"; `remote-play` is only named when nothing else is usable.
4. **Ambiguous engines:** if the top two non-fallback engines are within 0.15 confidence, a reason says to run deep-mode oracles (`scummvm --detect`, `diec`).
5. **Catalog guesses:** every `needs_confirm`, engine-tier or title-tier match adds "Possible existing port ... confirm the game title".
6. **Warnings** each add a reason and require an ack.

`pag survey` exit codes: 0 for GO or HARD, 4 for STOP, 2 for a usage or read error. The human output is at most 8 lines (verdict, game, reasons, catalog, warnings, acknowledgements); on STOP the remote-play line is always kept.

### Required acknowledgements

`verdict.required_acknowledgements` is the union of:

- the primary lane's `acks` ([lanes.md](lanes.md#m1-lanes)): `ACK_PRIVATE_USE_ONLY` for web-extract and known-port, plus `ACK_RUNTIME_LICENSE` for rt-ruffle, dos-jsdos and rt-easyrpg (see [M2 lanes](lanes.md#m2-lanes));
- `ACK_UPX_PACKED` when the `upx` WARN rule hit;
- `ACK_PROTECTION_WARN` for any other WARN hit.

The user records each with `pag ack <ID>`; `ACK_RIGHTS_HOLDER` and the `ACK_WARN_*` ids are never emitted by survey (they come from other checks, see [safety-and-policy.md](safety-and-policy.md)). `legal_flags` is separate: `protection-warn:<id>` per WARN, and `known-port:legal_risk_high` when a matched port is marked high risk.

## The `survey.json` shape

Schema id `port-any-game/survey@1`. Top-level fields:

| Field | Content |
|---|---|
| `schema`, `tool`, `scanned_at` | schema id, `{name: 'pag', version, rulesets}`, ISO time |
| `target` | `root_id` (`sha256:` of a salted root), `label` (folder name), `total_bytes`, `file_count`, `largest` (top 5 `{path, bytes}`), `builds_present` (`windows`, `linux`, `macos`) |
| `executables[]` | `path`, `role` (`main`/`installer`/`other`), `format`, `machine`, `subsystem`, `bytes`, `sha256` (+`partial`), `clr`, `linker`, `timestamp {value, trust}`, `version_info`, `overlay`, `sections[] {name, entropy}`, `apis` |
| `engines[]` | `{id, family, version, confidence, evidence[]}`, best first |
| `store` | `steam_appid`, `gog_id`, `title_guess`, `steam_api`, `epic` |
| `protection[]` | `{id, class, severity, evidence[]}` |
| `encryption` | always `[]` in M1 |
| `features` | `bitness` (32/64/null), `apis {graphics, audio, input, video, network}`, `size_class` |
| `era` | main exe timestamp and linker, trust `low` |
| `catalog_matches[]` | `{game_id, tier, needs_confirm, redistributable, ports}` |
| `skipped[]`, `truncated` | `{path, reason}` entries and whether the file cap was hit |
| `legal_flags[]` | see above |
| `lanes[]` | ranked non-NO lanes: `{lane, verdict, why, available, milestone, odds}` |
| `verdict` | `{overall: GO\|HARD\|STOP, primary_lane, reasons[], required_acknowledgements[]}` |

`pag new` copies the survey into the port folder; lanes read it later (`known-port` reads `catalog_matches`, rt-ruffle and dos-jsdos read `executables`, web-extract reads overlays).

## Rule files

All three files in [scripts/rules/](../skills/port-any-game/scripts/rules/) are JSON arrays, loaded once and cached by `loadRules`. Regular expressions are compiled case-insensitive; paths are matched against the survey's `/`-separated relative paths.

**`engines.json` and `protection.json`** (matched by `matchStatic`, plus `magic` for engines). A rule matches when it yields at least one evidence item, unless an `absent` pattern matches any file, in which case it never matches. Fields:

| Field | Meaning |
|---|---|
| `id`, `family` (engines) / `class` (protection) | identifiers; protection `class` is `DRM`, `PROTECTOR`, `ANTI_CHEAT`, `LAUNCHER`, `PIRATED`, `PACKER` |
| `confidence` (engines) | base confidence 0-1 |
| `severity` (protection) | `STOP` or `WARN` |
| `files` | regexes on relative paths |
| `sections` | PE section names (exact, case-insensitive) |
| `imports` | DLL names in imports or delay imports |
| `overlay` | overlay magic, for example `zip`, `swf` |
| `formats` | executable formats (never matches a CLR image) |
| `magic` (engines) | `{file, offset: 'head'\|'tail'\|<n>, hex}`; reads 64 KiB head/tail of up to 16 matching files |
| `version` (engines) | `{file, regex}`; first capture group becomes `version` |
| `absent` | regexes that veto the rule |
| `fallback` (engines) | reported only if nothing else matched |
| `source` | origin: `steamdb`, `die`, `bos`, or `local` (see NOTICE below) |

Evidence is capped at 3 items per signal type.

**`apis.json`**: `{dll, category, id}` where `dll` is a regex over DLL names and `category` is one of `graphics`, `audio`, `input`, `video`, `network`.

### Adding a rule safely

1. **Be distinctive.** A rule must match files or sections that only the target product has. Use the product's own DLL, driver or section name, anchored (`(^|/)name\.dll$`). A rule that matches a generic name (`00000001.tmp`, a common DLL like `steam_api.dll`, `data.pak`) must be **WARN**, never STOP.
2. **STOP is a last resort.** A false STOP blocks a legitimate game for good (the tool refuses every lane). Give STOP rules two independent signals where possible, for example a section name and a driver file, and prefer a single unmistakable section or import over a file glob.
3. **Use `absent`** to veto when an innocent sibling file exists.
4. **Set `source`** to `local` for rules written here. If you take file or section names from one of the three MIT projects, use its tag, keep to facts (names, magics), copy no code, and add the commit to [NOTICE.md](../skills/port-any-game/scripts/rules/NOTICE.md) if it is a new project.
5. **Add a test** in [test/survey/rules.test.mjs](../test/survey/rules.test.mjs): a synthetic tree (see `test/fixtures/make-pe.mjs`) that matches, and one that must not. Run `node --test test/survey`.
6. If a new engine should route to a lane, wire `detect` there ([lanes.md](lanes.md#adding-a-lane)). A new protection id that needs its own ack must be added to `ACK_IDS` in [ack.mjs](../skills/port-any-game/scripts/ack.mjs) and handled in `verdict.mjs`.

### Provenance (`NOTICE.md`)

[scripts/rules/NOTICE.md](../skills/port-any-game/scripts/rules/NOTICE.md) records that the rules are hand-curated, and that many file, section, magic and import names were derived from the detection rules of three MIT-licensed projects: SteamDB FileDetectionRuleSets (`steamdb`), Detect It Easy's signature database (`die`) and SabreTools BinaryObjectScanner (`bos`). Each is pinned to a commit in NOTICE.md. No code or data files are vendored; each rule's `source` field says where it came from, and the MIT licence text is reproduced in NOTICE.md. Keep this file in sync when you borrow from a new project or a new commit.

## The catalog

The catalog is a hand-curated, offline list of games that already have a live, licensed community web port. It is not scraped and never makes a network call. [catalog/SOURCES.md](../skills/port-any-game/catalog/SOURCES.md) explains the method; research is in `docs/research/07-port-catalogs.md`. The shipped file has 26 entries.

### Entry format

[games.json](../skills/port-any-game/catalog/games.json) is `{schema: 'port-any-game/catalog@1', games: [...]}`. Each game:

| Field | Meaning |
|---|---|
| `id` | unique, lowercase |
| `title` | display title; also used for tier `title` |
| `ids` | `{steam: ["..."], gog: ["..."]}` store ids (strings) |
| `signatures` | `[{path: <regex>, size?: <bytes>}]` file-name regexes (a bad pattern is skipped, not fatal) |
| `engines` | optional survey engine ids that weakly suggest the game |
| `redistributable_data` | optional `true` when the game data is free to share (Freedoom) |
| `ports[]` | `{name, kind (byo-web, reimpl-web), url, license, data_files[], legal_risk (low, medium, high), verified_at, notes?}` |

No game-data URL appears anywhere in the catalog. Only live, licensed ports are listed; ports derived from taken-down code are kept but marked `legal_risk: "high"` and hidden by `pag build` unless `--include-high-risk` is passed.

### Match tiers

`matchCatalog` gives each game the **first** tier that hits, and sorts results store, signature, engine, title:

| Tier | Match | `needs_confirm` | Lane verdict |
|---|---|---|---|
| `store` | the survey's Steam or GOG id is in the entry's `ids` | no | GO |
| `signature` | a `signatures[].path` regex matches a relative file path, and the size when given | no | GO |
| `engine` | one of the entry's `engines` was detected | **yes** | HARD |
| `title` | token set of `identity.title_guess` equals the token set of `title` (case and punctuation ignored) | **yes** | HARD |

Signatures check file name and size only: `sha256` is not checked, because survey hashes executables only. An engine or title hit is a guess: any Build-engine `.grp` is not Duke Nikem 3D, and many games share a title. So `needs_confirm` is true, the known-port lane returns HARD, the survey reasons ask the user to confirm the title, and `build` prints "Please confirm this is your game" before listing ports. A title-only hit never outranks a lane that works.

### `redistributable_data` and `port.json`

Each match carries `redistributable: <entry.redistributable_data === true>`. When `pag new` creates a port, it sets `port.json` `data.redistributable: true` only if there is at least one confident match (`needs_confirm` false) and **every** confident match is redistributable. A folder that also holds a commercial game's files is not free, and an engine or title guess never counts. That flag is one of the two ways a `bundled-public` build is allowed (the other is a user-recorded `ACK_RIGHTS_HOLDER`); see `isPublicAllowed` in [policy.mjs](../skills/port-any-game/scripts/policy.mjs), the pre-commit hook and the verify static check ([safety-and-policy.md](safety-and-policy.md)).

### Adding a game

1. Find a live, licensed port. Confirm its licence and legal risk from its own page or repository; do not copy a game-data URL, and omit sites that host game data or have unclear licences.
2. Add the entry with `id`, `title`, `ids`, `signatures`, `ports[]`, and `verified_at` set to the date you checked. Record the source in [SOURCES.md](../skills/port-any-game/catalog/SOURCES.md).
3. **Signatures must be distinctive to that one game**: a file name that only it has (`c3.emp`, `DIABDAT.MPQ`), not a generic name or one shared by a sequel or sibling (`data.pak`, `game.exe`). A signature shared by two games gives both a confident GO for the wrong one. Use a `size` when a name could occur in a sibling.
4. Add `engines` only as a hint (it forces `needs_confirm`). Do not add `redistributable_data` unless the data licence really allows redistribution.
5. Steam ids must be real; leave GOG ids empty unless confirmed.
6. Add or extend a case in [test/catalog.test.mjs](../test/catalog.test.mjs) and run `node --test test/catalog.test.mjs test/survey`. The catalog test also checks unique ids and the 25-game floor.
