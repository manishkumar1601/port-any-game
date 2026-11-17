// Input accounting for window.__shell.stats.inputEvents. While running, game keys do not scroll the page,
// move focus or open browser UI. Gamepads are polled once per animation frame (standard mapping).
// ponytail: no pointer lock, keyboard lock or touch overlay yet; add them with the first lane that needs mouse 'relative' or touch.
const GAME_KEYS = /^(Arrow(Up|Down|Left|Right)|Space|Tab|F([1-9]|1[0-2]))$/;

// shell: {stats, state} (state read live).
export function installInput(shell) {
  const count = () => { shell.stats.inputEvents++; };
  addEventListener('keydown', (e) => {
    count();
    if (shell.state === 'running' && GAME_KEYS.test(e.code)) e.preventDefault();
  }, { capture: true });
  for (const t of ['keyup', 'pointerdown', 'pointerup', 'wheel', 'touchstart']) addEventListener(t, count, { capture: true, passive: true });

  let last = '';
  return {
    // Counts one input event per gamepad state change (buttons pressed, axes moved).
    poll() {
      let pads = [];
      try { pads = navigator.getGamepads?.() ?? []; } catch { /* blocked by Permissions-Policy or an insecure context */ }
      let sig = '';
      for (const p of pads) {
        if (p) sig += `${p.index}:${p.buttons.map((b) => (b.pressed ? 1 : 0)).join('')}:${p.axes.map((a) => Math.round(a * 4)).join(',')};`;
      }
      if (sig !== last) { count(); last = sig; }
    },
  };
}
