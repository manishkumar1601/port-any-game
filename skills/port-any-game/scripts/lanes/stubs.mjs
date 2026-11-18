// Every spec §6 lane not built yet. Descriptors only: available:false + milestone.
// trig: engines = survey engine ids that trigger the lane; pe32 = main exe is 32-bit PE; always = any game; hard = HARD not GO.
const L = (id, rung, milestone, dataModes, acks, odds, trig = {}) => ({
  id, rung, available: false, milestone, dataModes, acks, odds, checklist: [`Not available until ${milestone}`],
  detect(s) {
    const main = (s.executables ?? []).find((e) => e.role === 'main');
    if (trig.always) return { verdict: 'GO', why: 'works for any game you own, on your own devices' };
    const hit = (s.engines ?? []).find((e) => trig.engines?.includes(e.id));
    if (hit) return { verdict: trig.hard ? 'HARD' : 'GO', why: `engine ${hit.id}` };
    if (trig.pe32 && main?.format === 'PE32' && main.machine === 'i386') return { verdict: 'HARD', why: 'main exe is 32-bit Windows' };
    return { verdict: 'NO', why: 'trigger not present' };
  },
});
const RT = ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE'];
const GREY = ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE', 'ACK_GREY_DECOMPILE'];
const OS = ['ACK_RUNTIME_LICENSE', 'ACK_OS_LICENSE'];

export default [
  L('rt-scummvm', 1, 'M2', ['byo'], RT, '80-95%', { engines: ['scummvm-candidate'] }),
  L('rt-idtech', 1, 'M2', ['byo'], RT, '70-90%', { engines: ['idtech-doom', 'idtech-quake', 'goldsrc', 'build'] }),
  L('rt-mkxpz', 2, 'M4', ['byo'], RT, '55-75%', { engines: ['rpgmaker-xp-vx'] }),
  L('rt-ags', 2, 'M4', ['byo'], RT, '60-80%', { engines: ['ags'] }),
  L('rt-dirplayer', 2, 'M4', ['byo'], RT, '30-60%', { engines: ['director'] }),
  L('rt-butterscotch', 2, 'M4', ['byo'], RT, '40-70%', { engines: ['gamemaker'], hard: true }),
  L('rt-cheerpj', 3, 'M4', ['byo'], ['ACK_PRIVATE_USE_ONLY', 'ACK_CHEERPJ_TERMS'], '40-85%', { engines: ['java'], hard: true }),
  L('rebuild-godot', 3, 'M4', ['bundled'], ['ACK_PRIVATE_USE_ONLY', 'ACK_GREY_ASSET_EXTRACT'], '50-80%', { engines: ['godot'], hard: true }),
  L('win-bottleship', 4, 'M3', ['byo'], ['ACK_RUNTIME_LICENSE'], 'unknown', { pe32: true }),
  L('win-boxedwine', 4, 'M3', ['byo'], ['ACK_RUNTIME_LICENSE'], '30-50%', { pe32: true }),
  L('win-dosboxx', 4, 'M3', ['bundled'], OS, '40-85%'),
  L('win-v86', 4, 'M3', ['bundled'], OS, '40-60%', { pe32: true }),
  L('src-port', 5, 'M4', ['byo', 'bundled'], RT, '30-80%'),
  L('src-engine-export', 5, 'M4', ['bundled'], RT, '60-95%'),
  L('rewrite-html5', 6, 'M4', ['bundled'], ['ACK_PRIVATE_USE_ONLY', 'ACK_GREY_DECOMPILE', 'ACK_GREY_ASSET_EXTRACT'], '30-60%', { engines: ['popcap-sexyapp'], hard: true }),
  L('decomp-rebuild', 6, 'M4', ['bundled'], GREY, '5-50%', { engines: ['unity-mono', 'xna-fna-monogame'], hard: true }),
  L('recomp-x86', 7, 'M5', ['bundled'], GREY, 'GO 40-60%, HARD 10-25%', { pe32: true }),
  L('remote-play', 8, 'M2', ['none'], ['ACK_OWN_DEVICES_ONLY'], '~90%', { always: true }),
];
