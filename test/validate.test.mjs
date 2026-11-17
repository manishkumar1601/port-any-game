import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRepo } from '../scripts/validate.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = 'skills/port-any-game/SKILL.md';
const YAML = 'skills/port-any-game/agents/openai.yaml';

// Build a temp repo from the files the validator reads, apply mutate(), validate, clean up.
function check(mutate) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pag-validate-'));
  try {
    for (const p of ['package.json', '.claude-plugin', 'skills']) {
      cpSync(path.join(repoRoot, p), path.join(dir, p), { recursive: true });
    }
    const edit = (rel, fn) => {
      const f = path.join(dir, rel);
      writeFileSync(f, fn(readFileSync(f, 'utf8')));
    };
    mutate({ dir, edit });
    return validateRepo(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const has = (errs, text) => assert.ok(errs.some((e) => e.includes(text)), `expected "${text}" in ${JSON.stringify(errs)}`);

test('accepts the real repo', () => {
  assert.deepEqual(validateRepo(repoRoot), []);
});

test('rejects extra frontmatter key', () => {
  const errs = check(({ edit }) => edit(SKILL, (s) => s.replace(/\r?\n---\r?\n/, '\nversion: 1\n---\n')));
  has(errs, 'unsupported frontmatter key "version"');
});

test('rejects name/folder mismatch', () => {
  const errs = check(({ edit }) => edit(SKILL, (s) => s.replace('name: port-any-game', 'name: other')));
  has(errs, 'does not match folder');
});

test('rejects description over 1024 chars', () => {
  const errs = check(({ edit }) =>
    edit(SKILL, (s) => s.replace(/description: .*/, `description: ${'x'.repeat(1025)}`)));
  has(errs, '1024');
});

test('rejects SKILL.md over 500 lines', () => {
  const errs = check(({ edit }) => edit(SKILL, (s) => s + '\nline'.repeat(500)));
  has(errs, '500 lines');
});

test('rejects short_description outside 25-64', () => {
  const errs = check(({ edit }) =>
    edit(YAML, (s) => s.replace(/short_description: ".*"/, 'short_description: "too short"')));
  has(errs, 'short_description');
});

test('rejects default_prompt without $port-any-game', () => {
  const errs = check(({ edit }) =>
    edit(YAML, (s) => s.replace(/default_prompt: ".*"/, 'default_prompt: "Port a game."')));
  has(errs, 'default_prompt');
});

test('rejects version drift', () => {
  const errs = check(({ edit }) => edit('package.json', (s) => s.replace('"version": "0.1.0"', '"version": "9.9.9"')));
  has(errs, 'version drift');
});

test('rejects broken relative link in references', () => {
  const errs = check(({ dir }) => {
    mkdirSync(path.join(dir, 'skills/port-any-game/references'), { recursive: true });
    writeFileSync(path.join(dir, 'skills/port-any-game/references/a.md'), '[x](./missing.md)\n');
  });
  has(errs, 'broken link');
});
