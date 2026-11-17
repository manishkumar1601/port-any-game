// Verdict: spec §7.2. Pure: takes the survey facts, returns lanes, legal flags and the verdict.
import { LANES, rankLanes } from '../lanes/index.mjs';

const AMBIGUOUS_WITHIN = 0.15;

export function decide(partial) {
  const protection = partial.protection ?? [];
  const stops = protection.filter((p) => p.severity === 'STOP');
  const warns = protection.filter((p) => p.severity === 'WARN');
  const ranked = rankLanes(partial);
  const lanes = ranked.map(({ rung, ...l }) => l); // eslint-disable-line no-unused-vars
  const reasons = [];
  const acks = new Set();

  const legal_flags = warns.map((p) => `protection-warn:${p.id}`);
  if ((partial.catalog_matches ?? []).some((m) => m.ports?.some((p) => p.legal_risk === 'high'))) legal_flags.push('known-port:legal_risk_high');

  if (stops.length) {
    for (const p of stops) {
      reasons.push(`STOP: ${p.id} (${p.class}) found (${p.evidence.slice(0, 2).join(', ')}). This tool will not remove or bypass it; look for an official DRM-free edition (for example on GOG).`);
    }
    reasons.push('Only remote-play stays possible (your own PC, original game): unavailable in M1, available in M2.');
    return { lanes, legal_flags, verdict: { overall: 'STOP', primary_lane: null, reasons, required_acknowledgements: [] } };
  }

  const usable = ranked.filter((l) => l.verdict !== 'NO');
  const primary = usable.find((l) => l.available) ?? null;
  // remote-play is the universal fallback: only worth naming when nothing else is available
  const firstBlocked = usable.find((l) => !l.available && (primary ? l.lane !== 'remote-play' && usable.indexOf(l) < usable.indexOf(primary) : true));
  if (primary) reasons.push(`${primary.lane}: ${primary.why}`);
  else reasons.push('No lane built in this milestone fits this game.');
  if (firstBlocked) reasons.push(`Best fit ${firstBlocked.lane} (${firstBlocked.why}) is available in ${firstBlocked.milestone}.`);

  const eng = (partial.engines ?? []).filter((e) => !e.fallback);
  if (eng.length > 1 && eng[0].confidence - eng[1].confidence < AMBIGUOUS_WITHIN) {
    reasons.push(`Ambiguous engine: ${eng[0].id} vs ${eng[1].id}; run the deep-mode oracles (scummvm --detect, diec) to decide.`);
  }

  for (const m of (partial.catalog_matches ?? []).filter((x) => x.tier === 'title')) {
    reasons.push(`Possible existing port: ${m.ports?.[0]?.name ?? m.game_id} — confirm the game title.`);
  }
  for (const p of warns) reasons.push(`Warning: ${p.id} (${p.class}) found; acknowledgement required. Packed binaries are never unpacked automatically.`);
  if (primary) for (const a of LANES[primary.lane].acks) acks.add(a);
  for (const p of warns) acks.add(p.id === 'upx' ? 'ACK_UPX_PACKED' : 'ACK_PROTECTION_WARN');

  return {
    lanes, legal_flags,
    verdict: { overall: primary?.verdict === 'GO' ? 'GO' : 'HARD', primary_lane: primary?.lane ?? null, reasons, required_acknowledgements: [...acks] },
  };
}
