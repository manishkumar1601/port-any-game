import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameStats, meanAbsDiff, judge, isCrossOrigin, longestStall, heapGrowth } from '../../skills/port-any-game/scripts/verify/checks.mjs';
import { waitFirstFrame } from '../../skills/port-any-game/scripts/verify/verify.mjs';

const W = 64;
const H = 48;
const frame = (rgb) => {
  const a = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) a.set([...rgb(i % W, Math.floor(i / W)), 255], i * 4);
  return a;
};
const black = frame(() => [0, 0, 0]);
const gradient = frame((x, y) => [Math.round((x / (W - 1)) * 255), Math.round((y / (H - 1)) * 200), 90]);
const status = (r, name) => r.checks.find((c) => c.name === name)?.status;
const live = frameStats(gradient, W, H);
const dark = frameStats(black, W, H);

test('frameStats black frame is blank', () => {
  assert.deepEqual(dark, { meanLuma: 0, stdLuma: 0, nearBlackRatio: 1, coloredRatio: 0 });
});

test('frameStats gradient not blank', () => {
  assert.ok(live.stdLuma >= 2, `std ${live.stdLuma}`);
  assert.ok(live.nearBlackRatio < 0.98);
  assert.ok(live.meanLuma > 50 && live.meanLuma < 200);
  assert.ok(Math.abs(live.coloredRatio + live.nearBlackRatio - 1) < 1e-9);
  // A flat mid-grey frame is blank too (luma std < 2): a loading screen with nothing on it.
  assert.ok(frameStats(frame(() => [128, 128, 128]), W, H).stdLuma < 2);
});

test('meanAbsDiff identical is 0', () => {
  assert.equal(meanAbsDiff(gradient, gradient.slice()), 0);
  assert.ok(meanAbsDiff(black, gradient) > 50);
  const one = black.slice();
  for (let i = 0; i < one.length; i += 4) one[i] = 3; // red +3 everywhere: 3/3 channels averaged = 1
  assert.equal(meanAbsDiff(black, one), 1);
});

test('judge fails all-blank', () => {
  const r = judge({ frames: Array(10).fill(dark) });
  assert.equal(status(r, 'blank'), 'fail');
  assert.equal(r.status, 'fail');
  // note 05 §7c: 1-3 of 10 blank samples (a fade, a loading screen) warn; more fail. The same share for 20 samples.
  const some = (blank, of) => status(judge({ frames: [...Array(blank).fill(dark), ...Array(of - blank).fill(live)] }), 'blank');
  assert.equal(some(1, 10), 'warn');
  assert.equal(some(3, 10), 'warn');
  assert.equal(some(4, 10), 'fail');
  assert.equal(some(6, 20), 'warn');
  assert.equal(some(7, 20), 'fail');
  assert.equal(status(judge({ frames: Array(10).fill(live) }), 'blank'), 'pass');
});

test('judge warns static-until-input', () => {
  const r = judge({ diffs: Array(9).fill(0), input: { events: 2, diff: 12 } });
  assert.equal(status(r, 'frozen'), 'warn');
  assert.equal(status(r, 'input'), 'pass');
  assert.equal(r.status, 'warn');
  assert.equal(status(judge({ diffs: [0, 0, 3] }), 'frozen'), 'pass');
  assert.equal(status(judge({ diffs: Array(9).fill(0.2), input: { events: 2, diff: 0.1 } }), 'frozen'), 'fail');
  assert.equal(status(judge({ diffs: Array(9).fill(0) }), 'frozen'), 'fail', 'no inputs declared: nothing can rescue a static picture');
  assert.equal(status(judge({ input: { events: 0, diff: 9 } }), 'input'), 'fail');
  assert.equal(status(judge({ input: { events: 4, diff: 0 } }), 'input'), 'warn');
});

test('judge fps pass/warn/fail at 0.9/0.5', () => {
  const fps = (f, software = false) => status(judge({ fps: { frames: f * 10, seconds: 10, target: 60, software } }), 'fps');
  assert.equal(fps(54), 'pass');
  assert.equal(fps(53.9), 'warn');
  assert.equal(fps(30), 'warn');
  assert.equal(fps(29.9), 'fail');
  assert.equal(fps(10, true), 'warn', 'software rendering: frame rate is only a warning');
  assert.equal(fps(0), 'fail', 'gameFrames stalled');
});

test('judge audio, privacy, viewports and errors', () => {
  const audio = (a) => status(judge({ audio: { contexts: 1, running: true, rms: 0, expected: true, ...a } }), 'audio');
  assert.equal(audio({ rms: 0.002 }), 'pass');
  assert.equal(audio({}), 'warn');
  assert.equal(audio({ expected: false }), 'pass');
  assert.equal(audio({ running: false }), 'fail');
  assert.equal(status(judge({ privacy: { withBody: ['POST /'], crossOrigin: [] } }), 'privacy'), 'fail');
  assert.equal(status(judge({ privacy: { withBody: [], crossOrigin: [] } }), 'privacy'), 'pass');
  assert.equal(status(judge({ privacy: { withBody: [], crossOrigin: [], popups: ['about:blank'] } }), 'privacy'), 'fail');
  const vp = (sw) => status(judge({ viewports: [{ name: 'mobile', w: 390, h: 844, scrollWidth: sw, innerWidth: 390 }] }), 'viewports');
  assert.equal(vp(390), 'pass');
  assert.equal(vp(1000), 'fail');
  const err = (e) => status(judge({ errors: { pageErrors: [], consoleErrors: [], ...e } }), 'errors');
  assert.equal(err({}), 'pass');
  assert.equal(err({ consoleErrors: ['404 favicon'] }), 'warn');
  assert.equal(err({ consoleErrors: ['Aborted(OOM)'] }), 'fail');
  assert.equal(err({ pageErrors: ['TypeError: x'] }), 'fail');
  assert.equal(judge({ checks: [{ name: 'environment', status: 'unsupported' }] }).status, 'pass', 'unsupported is decided by verify, not judge');
});

// R64: the save check runs the lane's own saveNow when it has one, and says so when it has none.
test('judge save: token round trip plus the lane save path', () => {
  const save = (s) => judge({ save: { ok: true, persisted: true, ...s } }).checks.find((c) => c.name === 'save');
  assert.deepEqual([save({ lane: 'ran' }).status, save({ lane: 'ran' }).detail], ['pass', 'token survived a reload; lane saveNow ran']);
  assert.match(save({ lane: 'none' }).detail, /lane save path not exercised/);
  assert.equal(save({ lane: 'none' }).status, 'pass');
  const bad = save({ ok: false, lane: 'ran', error: 'lane saveNow failed: quota' });
  assert.deepEqual([bad.status, bad.detail], ['fail', 'lane saveNow failed: quota']);
});

test('isCrossOrigin ignores data: and blob: of the same origin', () => {
  const o = 'http://127.0.0.1:5000';
  assert.equal(isCrossOrigin('http://127.0.0.1:5000/game/a.bin', o), false);
  assert.equal(isCrossOrigin('https://example.com/x', o), true);
  assert.equal(isCrossOrigin('http://localhost:5000/x', o), true);
  assert.equal(isCrossOrigin('data:image/png;base64,AA==', o), false);
  assert.equal(isCrossOrigin('blob:http://127.0.0.1:5000/1234', o), false);
});

test('judge loop: a gameFrames stall over 2 s fails, in the sample window or the soak', () => {
  const series = (frames, step = 0.5) => frames.map((f, i) => ({ t: i * step, frames: f }));
  assert.equal(longestStall(series([1, 2, 3, 4])), 0);
  assert.equal(longestStall(series([1, 2, 2, 2, 2, 2, 3])), 2);
  assert.equal(longestStall(series([1, 2, 2, 2, 2, 2, 2])), 2.5, 'a stall still running at the end counts');
  const loop = (l) => status(judge({ loop: l }), 'loop');
  assert.equal(loop({ window: series([1, 2, 2, 2, 2, 2, 3]) }), 'pass', '2 s is allowed');
  assert.equal(loop({ window: series([1, 2, 2, 2, 2, 2, 2, 3]) }), 'fail', '2.5 s is not');
  assert.equal(loop({ window: series([1, 2, 3]), soak: series([5, 6, 6, 6, 6, 7], 1) }), 'fail', 'the soak is checked too (3 s at 1 s spacing)');
  assert.equal(loop({ window: series([1, 2, 3]), soak: series([5, 6, 6, 6, 7, 8], 0.5) }), 'pass');
  assert.match(judge({ loop: { window: series([1, 2]), soak: series([5, 5, 5, 5], 1) } }).checks[0].detail, /soak/);
});

test('waitFirstFrame (R46): sampling starts at the first game frame, never hangs', async () => {
  const polls = (list) => { let i = 0; return () => list[Math.min(i++, list.length - 1)]; };
  const run = (s) => ({ state: 'running', gameFrames: s });
  let r = await waitFirstFrame(polls([run(0), run(0), run(3)]), { capMs: 5000, everyMs: 1 });
  assert.equal(r.framed, true);
  assert.ok(r.secs < 1);
  // A lane that never paints: returns at the cap (not hung), and the caller samples as before.
  const t0 = Date.now();
  r = await waitFirstFrame(() => run(0), { capMs: 150, everyMs: 10 });
  assert.equal(r.framed, false);
  assert.ok(Date.now() - t0 >= 150 && Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
  // A busy page (the poll throws or yields null) is "not yet"; leaving 'running' (an error) ends the wait at once.
  r = await waitFirstFrame(() => { throw new Error('busy'); }, { capMs: 100, everyMs: 5 });
  assert.equal(r.framed, false);
  assert.equal((await waitFirstFrame(polls([null, null, run(1)]), { capMs: 5000, everyMs: 1 })).framed, true);
  let n = 0;
  r = await waitFirstFrame(() => { if (n++ < 2) throw new Error('busy'); return run(2); }, { capMs: 5000, everyMs: 1 });
  assert.equal(r.framed, true);
  r = await waitFirstFrame(() => ({ state: 'error', gameFrames: 0 }), { capMs: 5000, everyMs: 1 });
  assert.equal(r.framed, false);
  assert.ok(r.secs < 1, 'an error state ends the wait');
});

test('judge ready (R46): the first game frame counts against the ready budget', () => {
  const ready = (o) => judge({ ready: { firstS: 1, cachedS: 1, budget: 10, ...o } }).checks.find((c) => c.name === 'ready');
  assert.equal(ready({ firstFrameS: 2.5 }).status, 'pass');
  assert.match(ready({ firstFrameS: 2.5 }).detail, /first game frame 2\.50 s after Play/);
  assert.equal(ready({ firstFrameS: 12 }).status, 'warn');
  // No frame within the cap: noted, but the frame checks (blank, fps) judge the run, not ready.
  const none = ready({ firstFrameS: null, noFirstFrameS: 10 });
  assert.equal(none.status, 'pass');
  assert.match(none.detail, /no game frame within 10 s of Play/);
});

test('judge memory: < 5 %/min pass, 5-10 warn, > 10 fail, unmeasurable is skip', () => {
  const mem = (g) => status(judge({ memory: { seconds: 60, growthPctPerMin: g } }), 'memory');
  assert.equal(mem(0), 'pass');
  assert.equal(mem(4.99), 'pass');
  assert.equal(mem(5), 'warn');
  assert.equal(mem(10), 'warn');
  assert.equal(mem(10.01), 'fail');
  assert.equal(mem(null), 'skip');
  assert.match(judge({ memory: { seconds: 60, growthPctPerMin: null } }).checks[0].detail, /heap not measurable/);
  assert.equal(judge({ memory: { seconds: 60, growthPctPerMin: null } }).status, 'pass', 'skip is neither warn nor fail');
});

test('judge memory: soaks under 30 s are skipped, 30 s is judged (R37)', () => {
  const at = (seconds) => judge({ memory: { seconds, growthPctPerMin: 50 } }).checks.find((c) => c.name === 'memory');
  assert.equal(at(29).status, 'skip');
  assert.match(at(29).detail, /soak too short to judge memory/);
  assert.equal(at(30).status, 'fail');
});

test('heapGrowth compares post-GC floors and ignores growth under 1 MiB', () => {
  const MiB = 1024 * 1024;
  assert.equal(heapGrowth([10 * MiB, 10.5 * MiB, 10.9 * MiB], 60), 0, 'under the 1 MiB noise floor');
  assert.equal(heapGrowth([10 * MiB, 11 * MiB, 12 * MiB], 60), 20, '2 MiB on 10 MiB in a minute');
  // Saw-tooth: the minimum of the first and the last third, not the endpoints.
  assert.equal(heapGrowth([10 * MiB, 30 * MiB, 10 * MiB, 30 * MiB, 10 * MiB, 30 * MiB], 60), 0);
  assert.equal(heapGrowth([10 * MiB, null], 60), null, 'no heap numbers (not Chromium)');
  assert.equal(heapGrowth([10 * MiB], 60), null);
});
