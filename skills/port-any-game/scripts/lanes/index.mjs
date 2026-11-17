// Lane registry. Tasks 16-19 add build/shell to the M1 modules; stubs stay descriptors.
import webExtract from './web-extract.mjs';
import knownPort from './known-port.mjs';
import rtRuffle from './rt-ruffle.mjs';
import dosJsdos from './dos-jsdos.mjs';
import stubs from './stubs.mjs';

export const LANES = Object.fromEntries([webExtract, knownPort, rtRuffle, dosJsdos, ...stubs].map((l) => [l.id, l]));

const VRANK = { GO: 0, HARD: 1, NO: 2 };

// Lanes that apply (non-NO), in ladder order: rung, then GO before HARD, then known-port first.
// Under a STOP protection every in-browser lane that would apply is reported as NO (sorted last);
// remote-play keeps its verdict.
export function rankLanes(survey) {
  const stop = (survey.protection ?? []).find((p) => p.severity === 'STOP');
  const out = [];
  for (const l of Object.values(LANES)) {
    let { verdict, why } = l.detect(survey);
    if (verdict === 'NO') continue;
    if (stop && l.id !== 'remote-play') ({ verdict, why } = { verdict: 'NO', why: `blocked by ${stop.id}` });
    out.push({ lane: l.id, verdict, why, available: l.available, milestone: l.milestone, odds: l.odds, rung: l.rung });
  }
  return out.sort((a, b) => VRANK[a.verdict] === 2 || VRANK[b.verdict] === 2 ? VRANK[a.verdict] - VRANK[b.verdict]
    : a.rung - b.rung || VRANK[a.verdict] - VRANK[b.verdict] || (b.lane === 'known-port') - (a.lane === 'known-port'));
}
