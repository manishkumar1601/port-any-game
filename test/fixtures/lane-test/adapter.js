// lane-test: a fake lane for verify's own tests (our own code, MIT). Used only via pack({laneModule}), never in LANES.
// Mode from ?mode=:
//   ok      animated canvas, counts frames, arrow keys / pointer move the square, 440 Hz tone after Play
//   black   renders black frames
//   frozen  draws one frame, then the picture never changes (frames still reported)
//   throw   throws in the first frame (uncaught); with &throw=start it throws inside start() instead
//   silent  like ok, without audio
//   never   start() resolves with a canvas on screen, but nothing is ever painted or reported (R46)
// Extra flags, combinable with any mode:
//   &wide=1  adds a 1000 px wide strip: overflows a phone viewport, not a desktop one
//   &post=1  sends one same-origin POST with a body at start (a BYO privacy violation)
//   &popup=1 opens a popup window at start (its requests would escape the privacy check)
const W = 640;
const H = 480;
const STEP = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };

let frames = 0;
let running = false;
let audio = null;

function draw(g, t, x, y) {
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, `hsl(${(t / 20) % 360} 70% 45%)`);
  grad.addColorStop(1, `hsl(${(t / 20 + 180) % 360} 70% 30%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffcc00';
  g.fillRect(((x + t / 8) % (W + 100)) - 100, y, 100, 100);
}

export default {
  id: 'lane-test',
  async start(ctx) {
    const q = new URLSearchParams(location.search);
    const mode = q.get('mode') || 'ok';
    if (mode === 'throw' && q.get('throw') === 'start') throw new Error('lane-test: thrown in start()');
    if (q.get('wide') === '1') document.body.append(Object.assign(document.createElement('div'), { style: 'position:absolute;top:0;left:0;width:1000px;height:1px' }));
    if (q.get('popup') === '1') window.open('about:blank', '_blank');
    if (q.get('post') === '1') await fetch('./', { method: 'POST', body: 'lane-test' }).catch(() => {});
    const [first] = ctx.files.list();
    if (first) await ctx.files.read(first); // exercises the shell's data path (OPFS for byo, HTTP for bundled)
    const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
    ctx.host.append(canvas);
    const g = canvas.getContext('2d');
    let x = 100;
    let y = 190;
    addEventListener('keydown', (e) => { const d = STEP[e.code]; if (d) { x += d[0]; y = Math.min(H - 100, Math.max(0, y + d[1])); } });
    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect();
      y = Math.min(H - 100, Math.max(0, ((e.clientY - r.top) / r.height) * H - 50));
    });
    audio = ctx.audio.context;
    if (audio && mode !== 'silent') {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 440;
      gain.gain.value = 0.1;
      osc.connect(gain).connect(audio.destination);
      osc.start();
    }
    if (mode === 'never') return;
    running = true;
    const frame = (t) => {
      if (running) {
        frames++;
        if (mode === 'throw') throw new Error('lane-test: thrown in the first frame');
        if (mode === 'black') { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
        else if (mode !== 'frozen' || frames === 1) draw(g, t, x, y);
        ctx.reportFrame();
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  },
  pause() { running = false; audio?.suspend().catch(() => {}); },
  resume() { running = true; audio?.resume().catch(() => {}); },
  saveNow() { localStorage.setItem('lane-test-save', JSON.stringify({ frames })); },
  frameCounter: () => frames,
};
