'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'public');
const en = JSON.parse(fs.readFileSync(path.join(dir, 'i18n', 'en.json'), 'utf8'));
const src = ['app.js', 'clinical.js'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');

test('every literal t("key") used in the screens exists in English', () => {
  const keys = [...src.matchAll(/\bt\('([A-Za-z0-9_.]+)'\)/g)].map((m) => m[1]);
  assert.ok(keys.length > 80);
  const missing = [...new Set(keys)].filter((k) => !(k in en));
  assert.deepEqual(missing, []);
});
test('every dynamic t("prefix." + value) prefix has entries', () => {
  const prefixes = [...new Set([...src.matchAll(/\bt\('([A-Za-z0-9_.]+\.)' \+/g)].map((m) => m[1]))];
  assert.ok(prefixes.length > 5);
  for (const p of prefixes) assert.ok(Object.keys(en).some((k) => k.startsWith(p)), p);
});
test('flag, vital and error codes from the server all have text', () => {
  const clinical = fs.readFileSync(path.join(__dirname, '..', 'lib', 'clinical.js'), 'utf8');
  const codes = new Set([...clinical.matchAll(/add\('[a-z]+', '(?:warn|critical)', '([a-z_0-9]+)'\)/g)].map((m) => m[1]));
  assert.ok(codes.size >= 15);
  for (const c of codes) assert.ok(('flag.' + c) in en, 'flag.' + c);
  for (const f of ['temp', 'sys', 'dia', 'pulse', 'rr', 'spo2', 'weight', 'height', 'muac']) assert.ok(('vital.' + f) in en, f);
  for (const e of ['not_a_number', 'out_of_range', 'dia_not_below_sys']) assert.ok(('verr.' + e) in en, e);
});
test('Burmese and Karen files only contain keys that exist in English', () => {
  for (const l of ['my', 'kar']) {
    const x = JSON.parse(fs.readFileSync(path.join(dir, 'i18n', l + '.json'), 'utf8'));
    assert.deepEqual(Object.keys(x).filter((k) => !(k in en)), [], l);
  }
});
