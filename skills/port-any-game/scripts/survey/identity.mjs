// Store ids and a title guess from marker files (bounded head reads only).
const depth = (f) => f.rel.split('/').length;
const shallow = (xs) => xs.slice().sort((a, b) => depth(a) - depth(b))[0];

export async function detectIdentity(files, readHeadTail, exes = []) {
  const out = { steam_appid: null, gog_id: null, title_guess: null };
  const head = async (f) => (await readHeadTail(f.abs, f.size)).head.toString('utf8');
  const ok = (f) => !f.isSymlink && !f.error && f.size > 0;

  const steam = files.filter((f) => ok(f) && /(^|\/)steam_appid\.txt$/i.test(f.rel));
  if (steam.length) {
    const t = (await head(shallow(steam))).trim();
    if (/^\d{1,10}$/.test(t)) out.steam_appid = t;
  }

  const gog = files.filter((f) => /(^|\/)goggame-\d+\.info$/i.test(f.rel));
  if (gog.length) {
    const f = shallow(gog);
    out.gog_id = /goggame-(\d+)\.info$/i.exec(f.rel)[1];
    if (ok(f)) {
      try {
        const name = JSON.parse(await head(f)).name;
        if (typeof name === 'string' && name.trim()) out.title_guess = name.trim();
      } catch { /* truncated or not JSON: no title from it */ }
    }
  }
  out.title_guess ??= exes.find((e) => e.productName)?.productName ?? null;
  return out;
}
