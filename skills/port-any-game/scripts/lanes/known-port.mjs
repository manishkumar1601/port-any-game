// Rung 0: the catalog knows an open engine or port for this game. Builds nothing: build() tells the user where to go.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadCatalog } from '../catalog.mjs';

export default {
  id: 'known-port', rung: 0, available: true, milestone: 'M1', dataModes: ['byo'],
  acks: ['ACK_PRIVATE_USE_ONLY'], external: true, odds: '70-95%',
  checklist: ['Confirm the catalog match with the user', 'Pick a port and read its licence', 'Self-host the port build in the shared shell or point to the public BYO site', "Import the user's own game files and verify"],
  detect(s) {
    const m = s.catalog_matches ?? [];
    const strong = m.find((x) => x.tier !== 'title');
    if (strong) return { verdict: 'GO', why: `catalog match ${strong.game_id} (${strong.tier})` };
    if (m.length) return { verdict: 'HARD', why: `title-only catalog match ${m[0].game_id}; confirm with the user` };
    return { verdict: 'NO', why: 'no catalog match' };
  },
  // opts.catalog overrides the shipped catalog (tests).
  build(portDir, { includeHighRisk = false, catalog = loadCatalog() } = {}) {
    let matches = [];
    try { matches = JSON.parse(readFileSync(path.join(portDir, 'survey.json'), 'utf8').replace(/^﻿/, '')).catalog_matches ?? []; } catch { /* no survey: treated as no match */ }
    const all = matches.flatMap((m) => catalog.games.find((g) => g.id === m.game_id)?.ports ?? []);
    const ports = all.filter((p) => includeHighRisk || p.legal_risk !== 'high');
    const hidden = all.length - ports.length;
    const data_files = [...new Set(ports.flatMap((p) => p.data_files))];
    const lines = [];
    if (matches.length && matches.every((m) => m.tier === 'title')) lines.push('Please confirm this is your game: the match is by title only.', '');
    if (!all.length) lines.push('No known web port was found for this game in the catalog.');
    for (const p of ports) {
      lines.push(`${p.name}: ${p.url}`, `  Licence: ${p.license}`, `  Pick these of your own files: ${p.data_files.join('; ')}`,
        `  Legal risk: ${p.legal_risk}`, '  Your game data stays in your browser; nothing is uploaded.');
    }
    if (hidden) lines.push(`${hidden} high-risk port${hidden > 1 ? 's' : ''} hidden. Run \`pag build --include-high-risk\` to show ${hidden > 1 ? 'them' : 'it'}.`);
    const message = lines.join('\n');
    if (ports.length) {
      const log = path.join(portDir, 'PORTING_LOG.md');
      const section = ['', `## known-port build (${new Date().toISOString().slice(0, 10)})`, '', ...ports.map((p) => `- ${p.name}: ${p.url} (${p.license}, risk ${p.legal_risk})`), ''].join('\n');
      if (existsSync(log)) appendFileSync(log, section); else writeFileSync(log, section.trimStart());
    }
    return { kind: 'external', ports, data_files, message };
  },
};
