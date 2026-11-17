// Rung 1: DOS programs run in js-dos.
const DOS_FORMATS = ['MZ', 'LE', 'LX'];

export default {
  id: 'dos-jsdos', rung: 1, available: true, milestone: 'M1', dataModes: ['byo'],
  acks: ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE'], odds: '85-95%',
  checklist: ['Find the real DOS executable (and the disc image if any)', 'Write dosbox.conf', 'Build the js-dos bundle', 'Verify boot and input'],
  detect(s) {
    const main = (s.executables ?? []).find((e) => e.role === 'main');
    if (main && DOS_FORMATS.includes(main.format)) return { verdict: 'GO', why: `main executable is ${main.format} (DOS)` };
    const hit = (s.engines ?? []).find((e) => e.id === 'dos' || e.id === 'dosbox-wrapper');
    return hit ? { verdict: 'GO', why: `DOS content (${hit.id})` } : { verdict: 'NO', why: 'no DOS executable found' };
  },
};
