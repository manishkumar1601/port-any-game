// Rung 0: the game already is a web app in a native wrapper (or HTML5 engine export).
const ENGINES = ['nwjs', 'electron', 'rpgmaker-mv', 'rpgmaker-mz', 'construct', 'gdevelop', 'twine'];

export default {
  id: 'web-extract', rung: 0, available: true, milestone: 'M1', dataModes: ['byo', 'bundled'],
  acks: ['ACK_PRIVATE_USE_ONLY'], odds: '85-95%',
  checklist: ['Extract package.nw / app.asar / www into the port folder', 'Shim Node and Steamworks APIs', 'Fix path case and separators', 'Serve and verify the first frame'],
  detect(s) {
    const hit = (s.engines ?? []).find((e) => ENGINES.includes(e.id));
    return hit ? { verdict: 'GO', why: `already web content (${hit.id})` } : { verdict: 'NO', why: 'no web wrapper or HTML5 engine found' };
  },
};
