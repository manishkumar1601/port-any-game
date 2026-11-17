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
  links (`dist/LICENSES/`). js-dos is GPL-2.0, Ruffle MIT or Apache-2.0. Private play triggers nothing. The GPL never
  covers or permits sharing the game's own files.

## Recording acknowledgements
`node <skill-dir>/scripts/pag.mjs ack <ID> "<port>" [--note "<the user's own words>"]`
- Run it only after the user answered yes. It appends `{id, at, note?}` to `port.json` `acks` (the timestamp is
  added for you). A repeat says "already recorded" and changes nothing. An unknown ID exits 2.
- Never edit `port.json` yourself, never answer for the user, and never record a "maybe".

## Which lanes need which (note 04 §B.9)

| Lane kind | Verdict cap | Acknowledgements |
|---|---|---|
| already-web extract (`web-extract`; `known-port` uses the same) | GO | `ACK_PRIVATE_USE_ONLY` |
| engine runtime (Ruffle now; ScummVM, EasyRPG, AGS, LÖVE, ONScripter, Ren'Py later) | GO | `ACK_PRIVATE_USE_ONLY`, `ACK_RUNTIME_LICENSE` |
| DOS emulation (`dos-jsdos`) | GO | same as engine runtime; no OS images except FreeDOS or the MIT-licensed MS-DOS |
| source port | GO | same as engine runtime; the user supplies the data |
| engine re-export (Godot / GDRE) | GO/HARD | + `ACK_GREY_ASSET_EXTRACT` |
| static recompilation | GO/HARD | + `ACK_GREY_DECOMPILE`; generated code counts as game data |
| Boxedwine / v86 | HARD | + `ACK_RUNTIME_LICENSE`; no Windows images |
| streaming fallback | GO | own devices only; no public relay |

The survey can also ask for `ACK_UPX_PACKED` (a UPX-compressed program) or `ACK_PROTECTION_WARN` (a warn-level
protection such as a Steam API library on its own).

## The questions to ask
One question at a time, in plain words. Fill in the parts in angle brackets from the survey.

| ID | Ask | Record when |
|---|---|---|
| `ACK_PRIVATE_USE_ONLY` | "This copy is for your own private play. It stays on your own devices and won't be posted online. Is that OK?" | the user says yes |
| `ACK_RUNTIME_LICENSE` | "The build includes a free, open-source player (<Ruffle or js-dos>) with its own licence. Its licence file stays with the build; that only matters if you ever give the build to someone. Is that OK?" | the user says yes |
| `ACK_UPX_PACKED` | "The game's program is compressed with UPX, a common packer that can be undone. I won't unpack or change it. Shall I continue?" | the user says yes |
| `ACK_PROTECTION_WARN` | "The survey found <name>. It is a warning, not a block: I won't remove or change it, and parts of the game that need it may not work in the browser. Shall I continue?" | the user says yes |
| `ACK_GREY_ASSET_EXTRACT` | (later lanes) "This method copies the game's pictures and sounds out of its files to rebuild it. That is a legal grey area: it is for your private use only and is never shared. Shall I continue?" | the user says yes |
| `ACK_GREY_DECOMPILE` | (later lanes) "This method turns the game's program into new code. Whether that is allowed depends on your country; it is for your private use only. Shall I continue?" | the user says yes |
| `ACK_RIGHTS_HOLDER` | Only when the user wants to share game files publicly: explain that this needs a game that is free to share or the rights to it (for example, they made it), and ask openly whether either applies, in their own words. Never suggest an answer. | the user states it themselves; pass their words unchanged in `--note` (required) |

Owning or buying a copy is not holding the rights: say so kindly if the user mixes them up. Recording
`ACK_RIGHTS_HOLDER` publishes nothing; public hosting is not in this version.

Warnings with no ID in this version (store copy, networking switched off, proprietary middleware such as video or
sound libraries, lightly encrypted archives): tell the user in plain words and note their answer, dated, in
`PORTING_LOG.md`.

## Keep out of git and public hosting
`game/`, `work/`, `build/`, `analysis/`, `verify/` (screenshots), and `dist/` and `package/` when they hold game
data. The port's `.gitignore` and git hooks enforce this; never bypass them. `survey.json` holds only relative paths,
but its hashes identify the game, so keep the port's repository private.
