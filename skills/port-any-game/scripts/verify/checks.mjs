// Pure verify maths and the pass/warn/fail judge. Thresholds: global constraints table / research note 05 §7c.
export const THRESHOLDS = {
  nearBlackLuma: 8, // luma < 8/255 is near-black
  blankRatio: 0.98, // a frame is blank when >= 98% of it is near-black...
  blankStd: 2, // ...or its luma standard deviation is < 2
  blankWarnShare: 0.3, // up to 3 of 10 blank samples (a fade, a loading screen) warn; more fail
  frozenDiff: 0.5, // mean abs difference (0-255 scale) below this = no change
  stallS: 2, // gameFrames may stop increasing for at most 2 s
  inputWindowS: 3, // the picture must change within 3 s after input
  fpsPass: 0.9, // game fps >= 0.9 x target passes...
  fpsWarn: 0.5, // ...>= 0.5 x target warns, below fails
  audioRms: 0.001, // -60 dBFS
  memWarn: 5, // soak growth %/min: < 5 pass, 5-10 warn...
  memFail: 10, // ...> 10 fail
  memMinSoakS: 30, // R37: shorter soaks only see warm-up growth, so memory is not judged
  heapNoiseBytes: 1024 * 1024, // heap growth under 1 MiB over the soak is noise
  firstFrameCapS: 10, // R46: frame sampling waits at most this long after Play for the lane's first game frame
  readyFirstS: 120, // first load (BYO import or download) times out after this
  readyCachedS: 30, // a reload (files cached) times out after this
};
const FATAL = /Aborted\(|RuntimeError|unreachable|out of memory|device lost|CONTEXT_LOST_WEBGL|SharedArrayBuffer is not defined/;

// Rec. 709 luma per pixel of an RGBA buffer. coloredRatio is ATB's secondary "coloured" share (not near-black).
export function frameStats(rgba, w, h) {
  const n = w * h;
  let sum = 0;
  let sq = 0;
  let dark = 0;
  for (let o = 0; o < n * 4; o += 4) {
    const y = 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2];
    sum += y;
    sq += y * y;
    if (y < THRESHOLDS.nearBlackLuma) dark++;
  }
  const meanLuma = sum / n;
  return { meanLuma, stdLuma: Math.sqrt(Math.max(0, sq / n - meanLuma * meanLuma)), nearBlackRatio: dark / n, coloredRatio: 1 - dark / n };
}

// Mean absolute difference of the RGB channels (alpha ignored), 0-255. Different sizes count as fully different.
export function meanAbsDiff(a, b) {
  if (a.length !== b.length) return 255;
  let s = 0;
  for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return a.length ? s / ((a.length / 4) * 3) : 0;
}

// Network URLs only: data:, blob: (same origin) and about: never leave the page.
export function isCrossOrigin(url, origin) {
  try {
    const u = new URL(url);
    if (u.protocol === 'blob:') return new URL(u.pathname).origin !== origin;
    return /^(https?|wss?):$/.test(u.protocol) && u.origin !== origin;
  } catch { return false; }
}

// Longest time (s) gameFrames did not increase. series: [{t: seconds, frames}] in time order; a stall still running
// at the last sample counts.
export function longestStall(series) {
  let worst = 0;
  let last = series[0];
  for (const s of series) {
    if (s.frames > last.frames) last = s;
    else worst = Math.max(worst, s.t - last.t);
  }
  return worst;
}

// Soak heap growth in %/min. Post-GC heap is the floor of the saw-tooth, so this compares the minimum of the first and
// last thirds of the samples. null when the browser gives no heap numbers.
// ponytail: endpoint floors; a regression slope over 10 s samples if soaks need finer judging.
export function heapGrowth(heap, secs, noise = THRESHOLDS.heapNoiseBytes) {
  if (heap.length < 2 || heap.some((h) => h == null) || secs <= 0) return null;
  const k = Math.max(1, Math.floor(heap.length / 3));
  const lo = Math.min(...heap.slice(0, k));
  const hi = Math.min(...heap.slice(-k));
  return hi - lo < noise ? 0 : ((hi - lo) / lo) * 100 / (secs / 60);
}

const f2 = (x) => (x ?? 0).toFixed(2);
const list = (a) => `${a.slice(0, 3).join('; ')}${a.length > 3 ? ` (+${a.length - 3} more)` : ''}`;

// measures: every key is optional; a check is emitted only for what was measured. measures.checks (precomputed:
// static checks, serve probe, environment) come first. Status: fail > warn > pass ('unsupported' is verify's call).
export function judge(m, t = THRESHOLDS) {
  const checks = [...(m.checks ?? [])];
  const add = (name, status, detail) => checks.push({ name, status, detail });

  if (m.ready) {
    const { firstS, cachedS, budget, timedOut, mbps, firstFrameS, noFirstFrameS } = m.ready;
    // R46: the first game frame after Play counts against the budget; none within the cap is noted here and left to
    // the frame checks (blank, fps) to judge.
    const frame = firstFrameS != null ? `; first game frame ${f2(firstFrameS)} s after Play` : noFirstFrameS ? `; no game frame within ${noFirstFrameS} s of Play` : '';
    const d = `first load ${f2(firstS)} s${mbps ? ` (${mbps.toFixed(1)} MB/s)` : ''}${cachedS != null ? `, reload ${f2(cachedS)} s` : ''}${frame}; budget ${budget} s`;
    add('ready', timedOut ? 'fail' : cachedS > budget || firstFrameS > budget ? 'warn' : 'pass', timedOut ? `not ready after ${timedOut} s; ${d}` : d);
  }
  if (m.shell) {
    const { state, lastError, status, timedOut } = m.shell;
    add('shell', state === 'error' || state === 'needs-files' || !state || timedOut ? 'fail' : 'pass',
      state === 'error' ? `error: ${lastError}` : state === 'needs-files' ? `import incomplete: ${status}`
        : timedOut ? `stuck in state ${state} for ${timedOut} s: ${status}` : `state ${state}`);
  }
  if (m.frames) {
    const got = m.frames.filter(Boolean);
    const blank = got.filter((f) => f.nearBlackRatio >= t.blankRatio || f.stdLuma < t.blankStd).length;
    const mean = got.reduce((s, f) => s + f.meanLuma, 0) / (got.length || 1);
    if (!got.length) add('blank', 'warn', 'no visible canvas to sample; check the screenshots');
    else if (blank / got.length > t.blankWarnShare) add('blank', 'fail', `${blank} of ${got.length} samples are blank (near-black or flat)`);
    else if (blank) add('blank', 'warn', `${blank} of ${got.length} samples blank (a fade or loading screen?)`);
    else add('blank', 'pass', `${got.length} samples, mean luma ${mean.toFixed(1)}`);
  }
  if (m.diffs?.length) {
    const moved = Math.max(...m.diffs);
    const after = m.input?.diff ?? 0;
    if (moved >= t.frozenDiff) add('frozen', 'pass', `picture changes (max ${f2(moved)}/255 between samples)`);
    else if (after >= t.frozenDiff) add('frozen', 'warn', `static until input (changed ${f2(after)}/255 after input)`);
    else add('frozen', 'fail', `picture never changed (max ${f2(moved)}/255${m.input ? ', none after input' : '; no verify.inputs declared'})`);
  }
  if (m.fps) {
    const { frames, seconds, target, software } = m.fps;
    const fps = seconds > 0 ? frames / seconds : 0;
    const d = `${fps.toFixed(1)} game fps, target ${target}${software ? ' (software rendering)' : ''}`;
    if (frames <= 0) add('fps', 'fail', 'gameFrames did not increase: the main loop is not running');
    else if (fps >= t.fpsPass * target) add('fps', 'pass', d);
    else add('fps', fps >= t.fpsWarn * target || software ? 'warn' : 'fail', d);
  }
  if (m.input) {
    const { events, diff } = m.input;
    if (!events) add('input', 'fail', 'no input events reached the page');
    else if (diff < t.frozenDiff) add('input', 'warn', `${events} input events, no visible change within ${t.inputWindowS} s`);
    else add('input', 'pass', `${events} input events, picture changed ${f2(diff)}/255`);
  }
  if (m.audio) {
    const { contexts, running, rms, expected } = m.audio;
    if (!contexts) add('audio', 'fail', 'no AudioContext was created after Play');
    else if (!running) add('audio', 'fail', 'the AudioContext never reached "running"');
    else if ((rms ?? 0) >= t.audioRms) add('audio', 'pass', `running, peak RMS ${rms.toFixed(4)}`);
    else add('audio', expected ? 'warn' : 'pass', `running but silent (peak RMS ${(rms ?? 0).toFixed(4)})${expected ? '; verify.audio_on_title is true' : ', allowed on the title (audio_on_title: false)'}`);
  }
  if (m.save) {
    // R64: lane: 'ran' (its saveNow ran without error) | 'none' (the lane has no save path of its own).
    const lane = m.save.lane === 'ran' ? '; lane saveNow ran' : m.save.lane === 'none' ? '; lane save path not exercised' : '';
    add('save', m.save.ok ? 'pass' : 'fail', m.save.ok ? `token survived a reload${m.save.persisted ? '' : ' (storage not persisted by the browser)'}${lane}` : m.save.error ?? 'token lost across a reload');
  }
  if (m.viewports) {
    const over = m.viewports.filter((v) => v.scrollWidth > v.innerWidth);
    add('viewports', over.length ? 'fail' : 'pass', over.length
      ? over.map((v) => `${v.name} ${v.w}x${v.h}: page is ${v.scrollWidth}px wide, viewport ${v.innerWidth}px`).join('; ')
      : m.viewports.map((v) => `${v.name} ${v.w}x${v.h} ok`).join(', '));
  }
  if (m.loop) {
    const windows = Object.entries(m.loop).filter(([, s]) => s?.length).map(([name, s]) => ({ name, stall: longestStall(s), secs: s.at(-1).t - s[0].t }));
    const bad = windows.filter((w) => w.stall > t.stallS);
    const d = windows.map((w) => `${w.name}: longest stall ${w.stall.toFixed(1)} s in ${w.secs.toFixed(0)} s`).join('; ');
    if (windows.length) add('loop', bad.length ? 'fail' : 'pass', bad.length ? `gameFrames stopped for more than ${t.stallS} s (${d})` : d);
  }
  if (m.memory) {
    const { seconds, growthPctPerMin: g } = m.memory;
    if (seconds < t.memMinSoakS) add('memory', 'skip', `soak too short to judge memory (${seconds.toFixed(0)} s, needs ${t.memMinSoakS} s)`);
    else if (g == null) add('memory', 'skip', `heap not measurable in this browser (${seconds.toFixed(0)} s soak)`);
    else add('memory', g > t.memFail ? 'fail' : g >= t.memWarn ? 'warn' : 'pass', `heap growth ${g.toFixed(1)}%/min over a ${seconds.toFixed(0)} s soak`);
  }
  if (m.stages) {
    const bad = m.stages.filter((s) => s.state !== 'running' || !s.frame || s.frame.nearBlackRatio >= t.blankRatio || s.frame.stdLuma < t.blankStd);
    add('stages', bad.length ? 'fail' : 'pass', bad.length ? bad.map((s) => `${s.name}: ${s.state === 'running' ? 'blank' : `state ${s.state}`}`).join('; ') : m.stages.map((s) => s.name).join(', '));
  }
  if (m.errors) {
    const { pageErrors, consoleErrors } = m.errors;
    const fatal = [...pageErrors, ...consoleErrors.filter((e) => FATAL.test(e))];
    if (fatal.length) add('errors', 'fail', list(fatal));
    else if (consoleErrors.length) add('errors', 'warn', `${consoleErrors.length} console errors: ${list(consoleErrors)}`);
    else add('errors', 'pass', 'no page or console errors');
  }
  if (m.requests) {
    const bad = m.requests.filter((r) => r.status === 0 || r.status >= 400);
    add('requests', bad.length ? 'fail' : 'pass', bad.length ? list(bad.map((r) => `${r.status || r.error || 'failed'} ${r.url}`)) : `${m.requests.length} own-origin requests ok`);
  }
  if (m.privacy) {
    const { withBody, crossOrigin, popups = [] } = m.privacy;
    const bad = [...withBody.map((r) => `request with a body: ${r}`), ...crossOrigin.map((u) => `cross-origin: ${u}`),
      ...popups.map((u) => `popup window opened (${u || 'about:blank'}); its requests are not checked`)];
    add('privacy', bad.length ? 'fail' : 'pass', bad.length ? list(bad) : 'no request bodies, no cross-origin requests, no popups');
  }
  const status = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
  return { status, checks };
}
