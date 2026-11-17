# Catalog sources

`games.json` is hand-curated, not scraped. Each port entry is a fact with a link
(`url`) and a `verified_at` date; all current entries were verified on
2026-11-17 against the project's public page or repository (see
`docs/research/07-port-catalogs.md` section 4 for the method and per-project
evidence). Steam app ids were confirmed against the public Steam store API;
GOG ids are left empty because none could be confirmed.

Rules: only live, licensed community ports are listed; unlicensed or unknown-licence
builds and sites that host game data themselves are omitted. No game-data URL
appears anywhere in the catalog. Ports derived from DMCA'd code are kept but
marked `legal_risk: "high"`. `signatures` are file-name regexes only.

Licences are recorded as stated by each project. No CC0/CC-BY data is vendored
in this catalog; the facts (names, URLs, licence strings) are our own notes.
Freedoom is listed only as a freely redistributable data set (BSD-style licence).
