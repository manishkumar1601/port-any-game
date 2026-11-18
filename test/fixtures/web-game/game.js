// web-extract fixture game (our own code, MIT). Like RPG Maker MV/MZ and Twine it needs an inline script (index.html sets
// FIXTURE_STEP) and eval/new Function; a strict CSP stops it before the first frame (R61).
if (typeof window.FIXTURE_STEP !== 'number') throw new Error('inline script did not run');
const damage = new Function('a', 'b', 'return a * b'); // RPG Maker MV evaluates damage formulas like this
const W = 640;
const H = 480;
const S = damage(window.FIXTURE_STEP, eval('1'));
const STEP = { ArrowLeft: [-S, 0], ArrowRight: [S, 0], ArrowUp: [0, -S], ArrowDown: [0, S] };
const canvas = document.getElementById('c');
const g = canvas.getContext('2d');
let x = 100;
let y = 190;
let score = Number(localStorage.getItem('score') || 0);
let tone = null;

// Mixed-case reference: the file on disk is img/title.png (served through caseFallback).
const title = new Image();
title.src = 'Img/Title.PNG';

function bump() { score++; localStorage.setItem('score', String(score)); }

addEventListener('keydown', (e) => {
  const d = STEP[e.code];
  if (!d) return;
  x += d[0];
  y = Math.min(H - 100, Math.max(0, y + d[1]));
  bump();
});

addEventListener('pointerdown', () => {
  bump();
  if (tone) return;
  const ac = new AudioContext();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.frequency.value = 440;
  gain.gain.value = 0.1;
  osc.connect(gain).connect(ac.destination);
  osc.start();
  tone = ac;
});

function frame(t) {
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, `hsl(${(t / 20) % 360} 70% 45%)`);
  grad.addColorStop(1, `hsl(${(t / 20 + 180) % 360} 70% 30%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffcc00';
  g.fillRect(((x + t / 8) % (W + 100)) - 100, y, 100, 100);
  if (title.complete && title.naturalWidth) g.drawImage(title, 8, 8, 32, 32);
  g.fillStyle = '#fff';
  g.fillText(`score ${score}`, 8, H - 8);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
