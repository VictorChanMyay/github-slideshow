'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'public');
const en = JSON.parse(fs.readFileSync(path.join(dir, 'i18n', 'en.json'), 'utf8'));
const src = ['app.js', 'clinical.js', 'orders.js', 'mch.js', 'child.js', 'programs.js', 'continuity.js', 'inpatient.js'].map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');

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

test('every child-health flag, status and reason from the server has text', () => {
  const g = fs.readFileSync(path.join(__dirname, '..', 'lib', 'growth.js'), 'utf8'); const c = fs.readFileSync(path.join(__dirname, '..', 'lib', 'child.js'), 'utf8');
  const flags = new Set([...g.matchAll(/add\('([a-z_]+)'/g)].map((m) => m[1]).concat([...c.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1])));
  assert.ok(flags.size >= 18);
  for (const f of flags) assert.ok(`child.flag.${f}` in en, `child.flag.${f}`);
  for (const s of ['done', 'due', 'overdue', 'upcoming', 'blocked', 'too_late']) assert.ok(`child.imm.status.${s}` in en, s);
  for (const r of ['too_young', 'too_soon']) assert.ok(`child.invalid.${r}` in en, r);
  for (const k of ['waz', 'haz', 'whz', 'baz', 'hcz']) assert.ok(`child.z.${k}` in en, k);
  for (const k of ['wfa', 'hfa', 'wfh', 'bfa', 'hcfa']) assert.ok(`child.chart.${k}` in en, k);
  for (const k of ['given_here', 'card', 'birth_record']) assert.ok(`child.source.${k}` in en, k);
});

test('every programme field, option, outcome and flag from the server has text', () => {
  const { PROGRAMS } = require('../lib/programs_spec'); const R = require('../lib/programs_rules');
  const outs = new Set();
  for (const [k, p] of Object.entries(PROGRAMS)) {
    assert.ok(`prog.name.${k}` in en, k);
    for (const f of p.enrol.concat(p.visit)) { assert.ok(`prog.f.${f.key}` in en, f.key); for (const v of f.values || []) assert.ok(`prog.o.${f.key}.${v}` in en, `${f.key}.${v}`); }
    p.outcomes.forEach((o) => outs.add(o));
  }
  for (const o of outs) assert.ok(`prog.outcome.${o}` in en, o);
  for (const c of R.FLAG_CODES) assert.ok(`prog.flag.${c}` in en, c);
  const rules = fs.readFileSync(path.join(__dirname, '..', 'lib', 'programs_rules.js'), 'utf8');
  const used = new Set([...rules.matchAll(/add\('([a-z_0-9]+)'/g)].map((m) => m[1])); assert.ok(used.size >= 30);
  for (const c of used) assert.ok(R.FLAG_CODES.includes(c), 'FLAG_CODES is missing ' + c); // a new rule cannot ship without a listed, translated flag
  for (const r of ['cured_needs_confirmed', 'cured_needs_negative_smears', 'recovered_but_positive', 'nutrition_cured_needs_criteria']) assert.ok(`prog.reason.${r}` in en, r);
  for (const s of ['done', 'due', 'overdue', 'upcoming']) assert.ok(`prog.sched.${s}` in en, s);
  for (const s of ['month2', 'month5', 'end_of_treatment', 'day3', 'day28']) assert.ok(`prog.sched_key.${s}` in en, s);
});

test('every appointment purpose, contact method, referral urgency and state from the server has text', () => {
  const ap = require('../lib/appointments'); const rf = require('../lib/referrals');
  for (const v of ap.PURPOSES) assert.ok(`fu.purpose.${v}` in en, v); for (const v of ap.METHODS) assert.ok(`fu.method.${v}` in en, v); for (const v of ap.RESULTS) assert.ok(`fu.result.${v}` in en, v);
  for (const v of rf.URGENCY) assert.ok(`ref.urgency.${v}` in en, v);
  for (const v of ['open', 'attended', 'completed', 'cancelled']) assert.ok(`ref.status.${v}` in en, v);
  for (const v of ['scheduled', 'attended', 'cancelled', 'rescheduled', 'missed']) assert.ok(`fu.astatus.${v}` in en, v);
  for (const v of ['missed', 'today', 'tomorrow']) assert.ok(`fu.state.${v}` in en, v); for (const v of ['upcoming', 'missed']) assert.ok(`fu.reason.${v}` in en, v);
  for (const v of ['appointment', 'referral', 'anc', 'postnatal', 'fp', 'immunization', 'programme']) assert.ok(`fu.kind.${v}` in en, v);
  const fu = fs.readFileSync(path.join(__dirname, '..', 'lib', 'followup.js'), 'utf8'); for (const k of [...fu.matchAll(/add\('([a-z]+)'/g)].map((m) => m[1])) assert.ok(`fu.kind.${k}` in en, 'follow-up kind ' + k);
  assert.ok(!ap.PURPOSES.includes('hiv') && !ap.PURPOSES.includes('tb')); // an appointment can never name a diagnosis
});

test('every inpatient, procedure and blood bank option, status and message from the server has text', () => {
  const ip = require('../lib/inpatient'); const pr = require('../lib/procedures'); const bl = require('../lib/blood'); const rules = require('../lib/inpatient_rules');
  for (const v of ip.CONDITIONS) assert.ok(`adm.cond.${v}` in en, v); for (const v of ip.NOTE_KINDS) assert.ok(`adm.note.${v}` in en, v); for (const v of ip.DISCHARGE_TYPES) assert.ok(`adm.dtype.${v}` in en, v);
  for (const v of pr.OUTCOMES) assert.ok(`proc.outcome.${v}` in en, v); for (const v of pr.ANAESTHESIA) assert.ok(`proc.anaes.${v}` in en, v); for (const v of ['consent_needed', 'checklist_incomplete']) assert.ok(`proc.problem.${v}` in en, v);
  for (const v of bl.COMPONENTS) assert.ok(`blood.comp.${v}` in en, v); for (const v of bl.REACTIONS) assert.ok(`blood.reaction.${v}` in en, v); for (const v of rules.TESTS) assert.ok(`blood.test.${v}` in en, v);
  for (const v of ['pending', 'negative', 'positive']) assert.ok(`blood.result.${v}` in en, v); for (const v of ['hold', 'release', 'discard']) assert.ok(`blood.outcome.${v}` in en, v);
  for (const v of ['quarantine', 'available', 'issued', 'transfused', 'discarded', 'expired']) assert.ok(`blood.ustatus.${v}` in en, v); for (const v of ['issued', 'transfused', 'returned']) assert.ok(`blood.issue_status.${v}` in en, v);
  for (const v of ['abo_incompatible', 'rh_positive_to_negative', 'recipient_group_unknown']) assert.ok(`blood.why.${v}` in en, v); for (const v of ['stock', 'units', 'issued', 'history']) assert.ok(`blood.tab.${v}` in en, v);
  for (const v of ['general', 'maternity', 'paediatric', 'isolation', 'other']) assert.ok(`ward.kind.${v}` in en, v); assert.ok('flag.title' in en);
  const seed = require('../lib/inpatient_seed'); for (const w of seed.WARDS) assert.ok(`ward.kind.${w[1]}` in en, w[1]); // every seeded ward kind has a label
  const sql = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db.js'), 'utf8'); const kinds = /kind TEXT NOT NULL DEFAULT 'general' CHECK\(kind IN \(([^)]*)\)\)/.exec(sql); assert.ok(kinds); for (const k of kinds[1].replace(/'/g, '').split(',')) assert.ok(`ward.kind.${k.trim()}` in en, k);
});
