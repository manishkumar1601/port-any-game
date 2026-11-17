// Authoring helper: node scripts/pin.mjs <url> -> prints {sha256, size} of the downloaded body.
import { createHash } from 'node:crypto';

const url = process.argv[2];
if (!url) { process.stderr.write('usage: node scripts/pin.mjs <url>\n'); process.exit(2); }
const res = await fetch(url, { redirect: 'follow' });
if (!res.ok) { process.stderr.write(`HTTP ${res.status} for ${url}\n`); process.exit(1); }
const buf = Buffer.from(await res.arrayBuffer());
console.log(JSON.stringify({ sha256: createHash('sha256').update(buf).digest('hex'), size: buf.length }));
