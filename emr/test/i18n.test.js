'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'public');
const en = JSON.parse(fs.readFileSync(path.join(dir, 'i18n', 'en.json'), 'utf8'));
const src = ['app.js', 'clinical.js', 'orders.js', 'mch.js'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');

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
test('view titles and navigation labels have text', () => {
  const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
  const titles = [...app.matchAll(/\b\w+: \['([a-z]+\.[a-z_]+)',/g)].map((m) => m[1]);
  const navs = [...app.matchAll(/'(nav\.[a-z]+)'/g)].map((m) => m[1]);
  assert.ok(titles.length >= 9 && navs.length >= 7);
  for (const k of [...titles, ...navs]) assert.ok(k in en, k);
});
test('server enum values shown in the UI have text (lab flags, statuses, stock types)', () => {
  for (const k of ['lab.flag.normal', 'lab.flag.abnormal', 'lab.flag.critical', 'lab.flag.invalid', 'lab.flag.not_assessed', 'lab.status.ordered', 'lab.status.collected', 'lab.status.resulted', 'lab.status.cancelled',
    'rx.status.prescribed', 'rx.status.partial', 'rx.status.dispensed', 'rx.status.cancelled', 'stock.type.receive', 'stock.type.dispense', 'stock.type.adjust', 'stock.type.writeoff', 'lab.tab.ordered', 'lab.tab.collected', 'lab.tab.resulted', 'rx.tab.pending', 'rx.tab.done']) assert.ok(k in en, k);
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

test('every maternal option, alert and window from the server has text', () => {
  const M = require('../lib/maternal'); const mch = require('../lib/mch');
  const want = (prefix, list) => { for (const v of list) assert.ok(`mch.${prefix}.${v}` in en, `mch.${prefix}.${v}`); };
  want('danger', M.DANGER_SIGNS); want('risk', M.RISK_FACTORS); want('pres', M.PRESENTATIONS); want('fm', M.FETAL_MOVEMENT); want('liquor', M.LIQUOR);
  want('md', M.MOTHER_DANGER); want('bd', M.BABY_DANGER); want('fpm', M.FP_METHODS); want('fpa', M.FP_ACTIONS); want('mode', mch.MODES); want('place', mch.PLACES);
  want('tear', mch.TEARS); want('comp', mch.COMPLICATIONS); want('outcome', mch.OUTCOMES); want('pnc', M.PNC_WINDOWS.map((w) => w.key));
  want('pncstate', ['done', 'due', 'missed', 'upcoming']); want('status', ['active', 'delivered', 'miscarriage', 'transferred', 'closed']); want('fpwarn', ['coc_hypertension', 'coc_postpartum']);
  want('mo', ['well', 'referred', 'died']); want('bleed', ['none', 'normal', 'heavy', 'offensive']); want('feed', ['exclusive', 'mixed', 'formula', 'not_feeding']);
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'maternal.js'), 'utf8');
  const codes = new Set([...src.matchAll(/add\('([a-z_0-9]+)'/g)].map((m) => m[1]).concat([...src.matchAll(/code: '([a-z_0-9]+)'/g)].map((m) => m[1])));
  for (const c of [...codes]) if (c.endsWith('_')) codes.delete(c);
  codes.add('bleeding_heavy'); codes.add('bleeding_offensive'); codes.add('pph'); codes.add('pph_severe');
  assert.ok(codes.size > 25);
  for (const c of codes) assert.ok(`mch.alert.${c}` in en, `mch.alert.${c}`);
  for (const s of M.DANGER_SIGNS) assert.ok(`mch.alert.danger.${s}` in en); for (const s of M.MOTHER_DANGER) assert.ok(`mch.alert.mother.${s}` in en); for (const s of M.BABY_DANGER) assert.ok(`mch.alert.baby.${s}` in en);
});
