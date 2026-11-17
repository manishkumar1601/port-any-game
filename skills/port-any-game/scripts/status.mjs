// `pag status [--host=<x>] [--json]`: where does this port stand? Runs at every agent session start, so it is cheap
// (no git/browser probing) and fails open: any error prints nothing on stdout and exits 0. Plain stdout for every host.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { nodeWarning } from './doctor.mjs';

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));

function findPort(cwd) {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    try {
      const p = readJson(path.join(dir, 'port.json'));
      if (String(p?.schema).startsWith('port-any-game/port@')) return { dir, port: p };
    } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e; }
    if (path.dirname(dir) === dir) return null;
  }
}

export function status(cwd = process.cwd(), { nodeVersion = process.versions.node } = {}) {
  const found = findPort(cwd);
  if (!found) return { port: null, nextItem: null, lastVerify: null, warnings: [] };
  const { dir, port } = found;
  let nextItem = null;
  try {
    const line = readFileSync(path.join(dir, 'PORTING_LOG.md'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('- [ ] '));
    nextItem = line ? line.slice(6).trim() : null;
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let lastVerify = null;
  const rf = path.join(dir, 'verify', 'report.json');
  if (existsSync(rf)) {
    try {
      const r = readJson(rf);
      lastVerify = { status: String(r.status ?? 'unknown'), at: r.at ?? statSync(rf).mtime.toISOString() };
    } catch { lastVerify = { status: 'unreadable', at: null }; }
  }
  const nw = nodeWarning(nodeVersion, { recommend: false });
  return { port, nextItem, lastVerify, warnings: nw ? [nw] : [] };
}

export async function run(argv, io = {}) {
  io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t), cwd: process.cwd(), ...io };
  try {
    const s = status(io.cwd);
    if (!s.port) return 0;
    if (argv.includes('--json')) { io.out(`${JSON.stringify(s)}\n`); return 0; }
    const v = s.lastVerify ? `${s.lastVerify.status}${s.lastVerify.at ? ` ${String(s.lastVerify.at).slice(0, 10)}` : ''}` : 'never';
    const lines = [
      `Port ${s.port.name ?? s.port.id} · lane ${s.port.lane ?? '?'} · next: ${s.nextItem ?? 'all checklist items done'} · last verify ${v}`,
      ...s.warnings.map((w) => `warning: ${w}`),
    ];
    io.out(`${lines.slice(0, 6).join('\n')}\n`);
  } catch (e) { io.err(`pag status: ${e.message}\n`); }
  return 0;
}
