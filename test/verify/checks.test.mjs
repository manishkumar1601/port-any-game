import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameStats, meanAbsDiff, judge, isCrossOrigin } from '../../skills/port-any-game/scripts/verify/checks.mjs';

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
  assert.equal(status(judge({ frames: [dark, dark, ...Array(8).fill(live)] }), 'blank'), 'warn');
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

test('isCrossOrigin ignores data: and blob: of the same origin', () => {
  const o = 'http://127.0.0.1:5000';
  assert.equal(isCrossOrigin('http://127.0.0.1:5000/game/a.bin', o), false);
  assert.equal(isCrossOrigin('https://example.com/x', o), true);
  assert.equal(isCrossOrigin('http://localhost:5000/x', o), true);
  assert.equal(isCrossOrigin('data:image/png;base64,AA==', o), false);
  assert.equal(isCrossOrigin('blob:http://127.0.0.1:5000/1234', o), false);
});
