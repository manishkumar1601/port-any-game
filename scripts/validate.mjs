import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANES } from '../skills/port-any-game/scripts/lanes/index.mjs';

// Lane id -> its family reference, references/lanes/<family>.md (spec §13). Unlisted ids use their own name.
const FAMILY = { 'known-port': 'known-ports', 'dos-jsdos': 'dos' };
const family = (id) => FAMILY[id] ?? (id.startsWith('rt-') ? 'runtimes' : id);
const ALLOWED_KEYS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

// Simple `key: value` lines between `---` fences (no YAML library). Returns null if no fence.
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

export function validateRepo(rootDir) {
  const errors = [];
  const rel = (p) => path.relative(rootDir, p).split(path.sep).join('/');

  // Versions must agree across manifests.
  const versions = {};
  for (const f of ['package.json', '.claude-plugin/plugin.json', 'plugin.json', '.codex-plugin/plugin.json', 'opencode/plugin/package.json']) {
    const p = path.join(rootDir, f);
    if (existsSync(p)) versions[f] = readJson(p).version;
  }
  if (new Set(Object.values(versions)).size > 1) errors.push(`version drift: ${JSON.stringify(versions)}`);

  const skillsDir = path.join(rootDir, 'skills');
  const skills = existsSync(skillsDir)
    ? readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
  if (!skills.length) errors.push('no skills found under skills/');

  for (const name of skills) {
    const dir = path.join(skillsDir, name);
    const skillFile = path.join(dir, 'SKILL.md');
    if (!existsSync(skillFile)) { errors.push(`${rel(dir)}: missing SKILL.md`); continue; }
    const text = readFileSync(skillFile, 'utf8');
    const fm = frontmatter(text);
    if (!fm) errors.push(`${rel(skillFile)}: missing frontmatter`);
    else {
      for (const k of Object.keys(fm)) if (!ALLOWED_KEYS.has(k)) errors.push(`${rel(skillFile)}: unsupported frontmatter key "${k}"`);
      if (fm.name !== name) errors.push(`${rel(skillFile)}: name "${fm.name}" does not match folder "${name}"`);
      if (!fm.description) errors.push(`${rel(skillFile)}: missing description`);
      else if (fm.description.length > 1024) errors.push(`${rel(skillFile)}: description is ${fm.description.length} chars (max 1024)`);
    }
    const lines = text.split(/\r?\n/).length;
    if (lines > 500) errors.push(`${rel(skillFile)}: ${lines} lines (max 500 lines)`);

    const yamlFile = path.join(dir, 'agents', 'openai.yaml');
    if (existsSync(yamlFile)) {
      const y = readFileSync(yamlFile, 'utf8');
      const val = (k) => new RegExp(`^\\s*${k}:\\s*(.*)$`, 'm').exec(y)?.[1].trim();
      for (const line of y.split(/\r?\n/)) {
        const kv = /^\s*[\w.]+:\s*(\S.*)$/.exec(line);
        if (kv && !/^(".*"|true|false)$/.test(kv[1])) errors.push(`${rel(yamlFile)}: unquoted string value: ${line.trim()}`);
      }
      const sd = val('short_description')?.replace(/^"|"$/g, '');
      if (sd === undefined || sd.length < 25 || sd.length > 64) errors.push(`${rel(yamlFile)}: short_description must be 25-64 chars (got ${sd?.length})`);
      if (!val('default_prompt')?.includes(`$${name}`)) errors.push(`${rel(yamlFile)}: default_prompt must contain $${name}`);
    } else errors.push(`${rel(yamlFile)}: missing`);

    // Relative links in SKILL.md and references/ must resolve.
    const refs = path.join(dir, 'references');
    const mdFiles = [skillFile, ...(existsSync(refs) ? [...walk(refs)].filter((f) => f.endsWith('.md')) : [])];
    for (const f of mdFiles) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const target = m[1].split('#')[0];
        if (!target || /^([a-z][a-z0-9+.-]*:|\/)/i.test(target)) continue;
        if (!existsSync(path.resolve(path.dirname(f), target))) errors.push(`${rel(f)}: broken link ${m[1]}`);
      }
    }

    // pag skills: the workflow must teach every lane that can run and every command that exists, and use no other.
    const pagFile = path.join(dir, 'scripts', 'pag.mjs');
    if (!existsSync(pagFile)) continue;
    for (const lane of Object.values(LANES).filter((l) => l.available)) {
      const ref = `references/lanes/${family(lane.id)}.md`;
      if (!existsSync(path.join(dir, ...ref.split('/')))) errors.push(`${rel(skillFile)}: lane ${lane.id} needs ${ref}, which is missing`);
      if (!text.includes(ref)) errors.push(`${rel(skillFile)}: lane ${lane.id} is available but SKILL.md does not mention ${ref}`);
    }
    const commands = [...readFileSync(pagFile, 'utf8').matchAll(/^\s+([\w-]+): \(\) => import\(/gm)].map((m) => m[1]);
    for (const c of commands) {
      if (!new RegExp(`\\bpag(\\.mjs)? ${c}\\b`).test(text)) errors.push(`${rel(skillFile)}: SKILL.md never mentions \`pag ${c}\``);
    }
    for (const f of mdFiles) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bpag\.mjs\s+([a-z][\w-]*)/g)) {
        if (!commands.includes(m[1])) errors.push(`${rel(f)}: uses \`pag ${m[1]}\`, which pag.mjs does not have`);
      }
    }
  }
  return errors;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = validateRepo(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('validate: ok');
}
