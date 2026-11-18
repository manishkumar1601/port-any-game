// node:test reporter: one GitHub Actions ::error annotation per failed test, so a red run names the test and the
// message without the job log. Use next to the spec reporter (the annotations are extra lines, not a replacement).
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
export const annotation = ({ name, file, line, message }) =>
  `::error ${file ? `file=${escProp(file)},line=${line ?? 1},` : ''}title=${escProp(name)}::${esc(message)}\n`;

const rel = (f) => { try { return path.relative(process.cwd(), f.startsWith('file:') ? fileURLToPath(f) : f).split(path.sep).join('/'); } catch { return f; } };

export default async function* githubReporter(source) {
  for await (const ev of source) {
    if (ev.type !== 'test:fail') continue;
    const { name, file, line, details } = ev.data;
    const err = details?.error?.cause ?? details?.error;
    const msg = String(err?.message ?? err ?? 'failed').split('\n').slice(0, 3).join(' ').slice(0, 500);
    yield annotation({ name, file: file && rel(file), line, message: msg });
  }
}
