// Rung 1: Flash content runs on Ruffle.
export default {
  id: 'rt-ruffle', rung: 1, available: true, milestone: 'M1', dataModes: ['byo'],
  acks: ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE'], odds: 'AVM1 85-95%, AVM2 55-80%',
  checklist: ['Locate the main SWF (unwrap the projector if needed)', 'Bundle Ruffle in the shell', "Load the SWF from the user's files", 'Verify first frame and input'],
  detect(s) {
    const hit = (s.engines ?? []).find((e) => e.id === 'flash-swf' || e.id === 'flash-projector');
    return hit ? { verdict: 'GO', why: `Flash content (${hit.id})` } : { verdict: 'NO', why: 'no Flash content found' };
  },
};
