# Legal guardrails and acknowledgements

**Not legal advice.** Laws differ by country and change over time. The tool cannot know where the user lives, so it
applies the strictest common rule everywhere: never get around copy protection, never distribute game files. When
the user is unsure about their own case, suggest they ask a lawyer where they live.

## Jurisdiction note
Based on US, EU, UK, Indian and Japanese law (research note 04, Part B):
- **Lower risk everywhere:** reading the user's own install (the survey); running an owned, unprotected game's
  original files in an open-source player (Ruffle, DOSBox/js-dos, ScummVM, EasyRPG) on the user's own device;
  serving an already-web game to yourself on this computer; streaming your own install to your own devices.
- **Not OK anywhere:** removing, bypassing or patching DRM, activation, anti-tamper or anti-cheat; downloading game
  data, disc images, BIOS files, keys or OS images from third parties (owning the original disc does not change
  this); publishing game files or anything built from them; private servers or modified clients against live
  services. pag refuses all of these.
- **Grey, private use only, with an acknowledgement:** decompiling or recompiling the program, extracting a game's
  pictures and sounds to rebuild it, loading lightly encrypted archives (only through a player that reads them the
  way the original does), and format-shifting in general. Roughly: the US decides case by case (fair use); the EU
  and UK allow only narrow program-specific acts, and the UK has no private-copying exception; India's s.52(1)(ad)
  allows personal, non-commercial adaptation of a program; Japan is the strictest about getting around protection.
- **Store purchases** are usually licences, not ownership, and their terms may forbid reverse engineering. Say so
  plainly when the survey finds a store copy.
- A game whose program is DRM-protected stays STOP even when its data files are not: the law is unsettled, so the
  tool takes the safe side and suggests a DRM-free edition.
- **Open-source players** carry duties only when a build is given to someone: keep the licence texts and source
  links (`dist/LICENSES/`). js-dos is GPL-2.0, EasyRPG Player GPL-3.0-or-later, Ruffle MIT or Apache-2.0. Private play triggers nothing. The GPL never
  covers or permits sharing the game's own files.

## Recording acknowledgements
`node <skill-dir>/scripts/pag.mjs ack <ID> "<port>"`, with `--note='<the user's own words>'` or `--note-env VAR`
- Run it only after the user answered yes. It appends `{id, at, note?}` to `port.json` `acks` (the timestamp is
  added for you). A repeat says "already recorded" and changes nothing, so a wrong note cannot be fixed later: get
  it right the first time. An unknown ID exits 2.
- A note must reach pag unchanged. Double quotes let the shell expand `$...` and backticks, so use single quotes:
  - sh/bash: `--note='<words>'`, writing each `'` in the words as `'\''`. The `--note=` form also works for words
    that start with `-`.
  - PowerShell: Windows PowerShell 5.1 drops `"` inside arguments even in single quotes, so pass the words through
    an environment variable: `$env:PAG_NOTE = '<words>'` (write each `'` as `''`), then `--note-env PAG_NOTE`.
- pag prints the stored note in JSON quotes ("note: ..."). Compare it with the user's words before moving on; if
  it differs, tell the user.
- Never edit `port.json` yourself, never answer for the user, and never record a "maybe".

## Which lanes need which (note 04 §B.9)

| Lane kind | Verdict cap | Acknowledgements |
|---|---|---|
| already-web extract (`web-extract`; `known-port` uses the same) | GO | `ACK_PRIVATE_USE_ONLY` |
| engine runtime (Ruffle and EasyRPG now; ScummVM, AGS, LÖVE, ONScripter, Ren'Py later) | GO | `ACK_PRIVATE_USE_ONLY`, `ACK_RUNTIME_LICENSE` |
| DOS emulation (`dos-jsdos`) | GO | same as engine runtime; no OS images except FreeDOS or the MIT-licensed MS-DOS |
| source port | GO | same as engine runtime; the user supplies the data |
| engine re-export (Godot / GDRE) | GO/HARD | + `ACK_GREY_ASSET_EXTRACT` |
| static recompilation | GO/HARD | + `ACK_GREY_DECOMPILE`; generated code counts as game data |
| Boxedwine / v86 | HARD | + `ACK_RUNTIME_LICENSE`; no Windows images |
| streaming fallback | GO | own devices only; no public relay |

The survey can also ask for `ACK_UPX_PACKED` (a UPX-compressed program) or `ACK_PROTECTION_WARN` (a warn-level
protection such as a Steam API library on its own).

## Spec §11 Warn items and their IDs
Each Warn item is acknowledged in `port.json` with `pag ack`. A `PORTING_LOG.md` entry may tell the story, but it
never replaces the acknowledgement.

| Warn item | ID | Ask when |
|---|---|---|
| store-licensed copies | `ACK_WARN_STORE_LICENSED` | `survey --json` shows a store (`store.steam_appid`, `store.gog_id`, `store.epic`), or the user bought it from a store |
| decompile, rewrite or recompile lanes | `ACK_GREY_DECOMPILE` | the lane needs it (later lanes; with the jurisdiction note above) |
| asset extraction | `ACK_GREY_ASSET_EXTRACT` | the lane needs it (later lanes) |
| lightly encrypted archives (runtime lanes only) | `ACK_WARN_LIGHTLY_ENCRYPTED` | the game keeps its data in lightly encrypted archives (for example RPG Maker `.rgssad`, `.rpgmvp`/`.rpgmvo`, `.wolf`, `.xp3`); only a player that reads them as the original does may load them, and nothing is decrypted to disk |
| UPX decompression | `ACK_UPX_PACKED` | the survey asks for it |
| networking disabled | `ACK_WARN_NETWORKING_DISABLED` | the game has online or multiplayer parts (the user says so, or `features.apis.network` lists winsock/directplay for the game's own program) |
| proprietary middleware | `ACK_WARN_PROPRIETARY_MIDDLEWARE` | `features.apis.audio` or `features.apis.video` lists fmod, miles, bass, wwise, bink or smacker |
| binding beyond 127.0.0.1 | `ACK_WARN_BEYOND_LOOPBACK` | before `serve --lan` ([shell](shell.md)) |
| runtime licence duties when sharing a BYO shell | `ACK_RUNTIME_LICENSE` | the lane ships a runtime (the survey asks for it) |

## The questions to ask
One question at a time, in plain words. Fill in the parts in angle brackets. Record the ID only after a yes.

| ID | Ask |
|---|---|
| `ACK_PRIVATE_USE_ONLY` | "This copy is for your own private play. It stays on your own devices and won't be posted online. Is that OK?" |
| `ACK_RUNTIME_LICENSE` | "The build includes a free, open-source player (<Ruffle or js-dos>) with its own licence. Its licence file stays with the build; that only matters if you ever give the build to someone. Is that OK?" |
| `ACK_UPX_PACKED` | "The game's program is compressed with UPX, a common packer that can be undone. I won't unpack or change it. Shall I continue?" |
| `ACK_PROTECTION_WARN` | "The survey found <name>. It is a warning, not a block: I won't remove or change it, and parts of the game that need it may not work in the browser. Shall I continue?" |
| `ACK_WARN_STORE_LICENSED` | "Games bought from a store like <Steam or GOG> are usually licensed to you rather than owned, and the store's terms may limit changing them. This port only reads your copy and plays it privately. Shall I continue?" |
| `ACK_WARN_LIGHTLY_ENCRYPTED` | "The game's files are lightly scrambled. The player reads them the way the original game does; nothing is unscrambled onto your disk. Some countries' laws are unclear about this. Shall I continue?" |
| `ACK_WARN_NETWORKING_DISABLED` | "The browser version has no online or multiplayer play: those parts are switched off, and nothing connects to game servers. Is that OK?" |
| `ACK_WARN_PROPRIETARY_MIDDLEWARE` | "The game uses <name>, a paid add-on from another company (for sound or video). It is used only inside your private copy and never shared. Is that OK?" |
| `ACK_WARN_BEYOND_LOOPBACK` | "To play on another device at home, this computer will serve the game to your home network, protected by a password you choose. Only your own devices should use it, and it must not be opened to the internet. Is that OK?" |
| `ACK_GREY_ASSET_EXTRACT` | (later lanes) "This method copies the game's pictures and sounds out of its files to rebuild it. That is a legal grey area: it is for your private use only and is never shared. Shall I continue?" |
| `ACK_GREY_DECOMPILE` | (later lanes) "This method turns the game's program into new code. Whether that is allowed depends on your country; it is for your private use only. Shall I continue?" |
| `ACK_RIGHTS_HOLDER` | Only when the user wants to share game files publicly: explain that this needs a game that is free to share or the rights to it (for example, they made it), and ask openly whether either applies, in their own words. Never suggest an answer. Record only their own statement, word for word, as the note (required). |

Owning or buying a copy is not holding the rights: say so kindly if the user mixes them up. Recording
`ACK_RIGHTS_HOLDER` publishes nothing; public hosting is not in this version. Once it is recorded (or `pag new` found
free-to-share data in the catalog), `pag pack "<port>" --mode bundled-public` builds with the game files for sharing
and keeps that mode in `port.json`.

## Keep out of git and public hosting
`game/`, `work/`, `build/`, `analysis/`, `verify/` (screenshots), and `dist/` and `package/` when they hold game
data. The port's `.gitignore` and git hooks enforce this; never bypass them. `survey.json` holds only relative paths,
but its hashes identify the game, so keep the port's repository private.
