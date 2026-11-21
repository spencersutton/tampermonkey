import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(p));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

function importsOf(source) {
  const specs = [];
  const re = /\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(re)) {
    specs.push(m[1] ?? m[2]);
  }
  return specs;
}

const stripComments = source =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('pure logic layer has no Preact, signals, server, UI, or DOM/network dependencies', () => {
  const files = listFiles('src/app/logic');
  assert.ok(files.length > 0);
  const forbiddenGlobals =
    /(?<![.\w$])(?:window|document|localStorage|sessionStorage|fetch|EventSource|IntersectionObserver)\b(?!\s*:)/;
  for (const file of files) {
    assert.ok(!file.endsWith('.tsx'), `${file} should not be a .tsx file`);
    const raw = readFileSync(file, 'utf8');
    const code = stripComments(raw);
    for (const spec of importsOf(code)) {
      assert.ok(
        spec !== 'preact' &&
          !spec.startsWith('preact/') &&
          spec !== '@preact/signals' &&
          spec !== 'centrifuge' &&
          !spec.includes('/server/') &&
          !spec.includes('/ui/') &&
          spec !== './api' &&
          spec !== './state',
        `${file} imports forbidden module ${spec}`,
      );
    }
    const globalMatch = code.match(forbiddenGlobals);
    assert.equal(
      globalMatch,
      null,
      `${file} references browser/network global ${globalMatch?.[0]}`,
    );
  }
});

test('server/data layer has no Preact or UI dependencies', () => {
  const files = listFiles('src/app/server');
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.ok(!file.endsWith('.tsx'), `${file} should not be a .tsx file`);
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const spec of importsOf(code)) {
      assert.ok(
        spec !== 'preact' &&
          !spec.startsWith('preact/') &&
          !spec.includes('/ui/') &&
          !spec.endsWith('.tsx'),
        `${file} imports forbidden UI module ${spec}`,
      );
    }
  }
});
