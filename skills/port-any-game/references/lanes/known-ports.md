# Lane: known-port (an open-source port already exists)

## When to use
The survey picked `known-port`: the offline catalog knows a free, open-source re-creation or web port of this game
that runs on the user's own game files (for example fheroes2 for Heroes of Might and Magic II, or Augustus for
Caesar III). Matches come by store ID, by file signature, by engine, or by title only. Odds 70–95%; minutes to a few
hours.
Nothing is built: you point the user to the existing port and tell them which of their own files it needs.

## Inputs
- `<port>` from `pag new` (it holds `survey.json` with the catalog matches), with `ACK_PRIVATE_USE_ONLY` recorded.
- The user's own game files. The catalog never contains game data or download links for game data.

## Steps
1. If the survey said "Possible existing port ... confirm the game title" (a title-only match), ask the user whether
   that is their game before anything else.
2. `node <skill-dir>/scripts/pag.mjs build "<port>"` prints a `message`, and the same list as JSON in `ports`:
   - each port's name, address, licence and legal risk;
   - which of the user's own files to pick ("Pick these of your own files: ...");
   - "Your game data stays in your browser; nothing is uploaded."

   It also appends the ports to `PORTING_LOG.md`.
3. Ports marked `legal_risk: high` (for example ones built from leaked or decompiled code) are hidden by default.
   Only if the user asks after you explain the risk:
   `node <skill-dir>/scripts/pag.mjs build "<port>" --include-high-risk`.
4. Pass the message on in plain words: open the address, choose the listed files from `<game>` when the page asks.
   Mention the port's licence. Tick the `PORTING_LOG.md` checklist items as the user confirms each step.

`pag pack` and `pag package` refuse this lane ("routes to an existing web port; there is nothing to pack"): that is
expected, not a failure.

## Known failures and fixes

| What you see | Cause | Fix |
|---|---|---|
| "Please confirm this is your game: the match is by title only." | the survey only matched the folder or game title | Ask the user. If it is not their game, pick another lane from the survey. |
| "No known web port was found for this game in the catalog." | the survey's match has no ports listed | Use the next lane the survey listed, or stop honestly. |
| "The survey guessed X, but the catalog has no entry for it." | catalog and survey disagree | Report it; use the next lane the survey listed. |
| "N high-risk port(s) hidden" | only high-risk ports exist | Explain the risk; show them only if the user asks (`--include-high-risk`). |
| the port's page rejects the files | wrong files or wrong game version | Re-read the port's own instructions (its address) and pick exactly the listed files. |

## Verify notes
- `pag verify` cannot check an external site. Instead, after the user tries it, ask them the 2-minute check:
  it starts, the controls work, sound plays, a save survives a page reload.
- Public BYO sites use https, so they also work on phones and tablets (keyboard games still need a keyboard).
