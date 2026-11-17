// Offline known-port catalog and matcher. No network; entries are hand-curated.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadCatalog() {
  const p = fileURLToPath(new URL('../catalog/games.json', import.meta.url));
  return JSON.parse(readFileSync(p, 'utf8'));
}

const tokens = (s) => new Set(String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
const sameSet = (a, b) => a.size > 0 && a.size === b.size && [...a].every((t) => b.has(t));
const RANK = { store: 0, signature: 1, engine: 2, title: 3 };

export function matchCatalog(catalog, { identity = {}, files = [], engines = [] }) {
  const engineIds = new Set(engines.map((e) => e.id));
  const want = tokens(identity.title_guess);
  const out = [];
  for (const g of catalog.games) {
    let tier = null;
    if ((identity.steam_appid && g.ids?.steam?.includes(identity.steam_appid)) ||
        (identity.gog_id && g.ids?.gog?.includes(identity.gog_id))) tier = 'store';
    else if (g.signatures?.some((s) => {
      const re = new RegExp(s.path, 'i');
      return files.some((f) => re.test(f.rel) && (s.size == null || f.size === s.size));
    })) tier = 'signature'; // ponytail: sha256 not checked (survey hashes only executables)
    else if (g.engines?.some((e) => engineIds.has(e))) tier = 'engine';
    else if (sameSet(want, tokens(g.title))) tier = 'title';
    if (tier) out.push({ game_id: g.id, tier, needs_confirm: tier === 'engine' || tier === 'title', ports: g.ports });
  }
  return out.sort((a, b) => RANK[a.tier] - RANK[b.tier]);
}
