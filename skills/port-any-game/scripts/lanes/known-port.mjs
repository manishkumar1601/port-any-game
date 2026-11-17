// Rung 0: the catalog knows an open engine or port for this game.
export default {
  id: 'known-port', rung: 0, available: true, milestone: 'M1', dataModes: ['byo'],
  acks: ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE'], odds: '70-95%',
  checklist: ['Confirm the catalog match with the user', 'Pick a port and read its licence', 'Self-host the port build in the shared shell or point to the public BYO site', "Import the user's own game files and verify"],
  detect(s) {
    const m = s.catalog_matches ?? [];
    const strong = m.find((x) => x.tier !== 'title');
    if (strong) return { verdict: 'GO', why: `catalog match ${strong.game_id} (${strong.tier})` };
    if (m.length) return { verdict: 'HARD', why: `title-only catalog match ${m[0].game_id}; confirm with the user` };
    return { verdict: 'NO', why: 'no catalog match' };
  },
};
