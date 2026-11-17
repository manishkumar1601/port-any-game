# Port rules

This folder is one game port, made with port-any-game. It is its own git repository.

1. Read `PORTING_LOG.md` first. Resume at the first unchecked item and log what you do.
2. Run `pag status` to see the port state before you act.
3. `game/` is a read-only link to the user's own install. Never write into it.
4. Never commit or push `game/`, `work/`, `build/`, `dist/`, `analysis/` or any game bytes.
   The git hooks in `.githooks/` block game magic bytes, survey hashes and binaries over 5 MiB.
   Do not bypass them (no `--no-verify`, no editing `core.hooksPath`).
5. Never deploy or host a build without asking the user first. Bundled game data stays private.
6. Never edit `port.json` by hand. Acknowledgements are the user's own answers, recorded by `pag ack`.
7. Do not remove, bypass, patch or emulate DRM, activation, protectors or anti-cheat.
   Do not fetch game data from anywhere but the user's own install.
8. Only your own code goes in `lane/`. That is the tracked part of this repo.
9. Do not claim the user said or authorised anything they did not say.
