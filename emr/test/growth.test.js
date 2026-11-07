'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const g = require('../lib/growth');

test('anchor values: WHO medians I can verify independently', () => {
  const cell = (ind, sex, x) => g.TABLES[ind][sex].find((r) => r[0] === x);
  assert.equal(cell('wfa', 'M', 0)[2], 3.3464); // boys, birth weight median (kg)
  assert.equal(cell('wfa', 'F', 0)[2], 3.2322); // girls
  assert.equal(cell('wfa', 'M', 60)[2], 18.3366);
  assert.equal(cell('lhfa_l', 'M', 0)[2], 49.8842); // boys, birth length (cm)
  assert.equal(cell('lhfa_l', 'F', 0)[2], 49.1477);
  assert.equal(cell('lhfa_l', 'M', 24)[2], 87.8161);
  assert.ok(Math.abs(cell('lhfa_l', 'M', 24)[2] - cell('lhfa_h', 'M', 24)[2] - 0.7) < 1e-9); // lying vs standing differ by 0.7 cm at 24 months
});
test('engine reproduces the rounded SD columns of every row of every table (all 8 indicators, both sexes)', () => {
  let checked = 0;
  for (const [ind, t] of Object.entries(g.TABLES)) for (const sex of ['M', 'F']) for (const r of t[sex]) {
    const p = { L: r[1], M: r[2], S: r[3] };
    [-3, -2, -1, 0, 1, 2, 3].forEach((z, i) => {
      const v = g.valueAtZ(p, z), published = r[4 + i];
      assert.ok(Math.abs(v - published) <= 0.0501 + 1e-9, `${ind} ${sex} x=${r[0]} z=${z}: computed ${v.toFixed(3)} vs published ${published}`);
      checked += 1;
    });
    assert.ok(Math.abs(g.zscore(ind === 'wfa' ? 'wfa' : ind, sex, r[0], r[2], false)) < 0.01, `${ind} median z`);
  }
  assert.ok(checked > 3000);
});
test('z-scores: median is 0, published SD values give about +/-2, direction is right', () => {
  const sd2 = g.TABLES.wfa.F.find((r) => r[0] === 12), sd2neg = sd2[5], sd2pos = sd2[9];
  assert.ok(Math.abs(g.zscore('wfa', 'F', 12, sd2neg, true) + 2) < 0.1); assert.ok(Math.abs(g.zscore('wfa', 'F', 12, sd2pos, true) - 2) < 0.1);
  assert.ok(g.zscore('wfa', 'M', 12, 7, true) < g.zscore('wfa', 'M', 12, 9, true));
  assert.equal(g.zscore('wfa', 'M', 61, 10, true), null); assert.equal(g.zscore('wfa', 'M', 12, -1, true), null); assert.equal(g.zscore('wfa', 'X', 12, 9, true), null);
  assert.equal(g.zscore('wfl', 'M', 44, 2.4, true), null); // below the table range
});
test('weight-based z-scores beyond +/-3 use the WHO linear adjustment and stay continuous', () => {
  const p = g.lms('wfa', 'M', 6), at = (z) => g.valueAtZ(p, z);
  assert.ok(Math.abs(g.zscore('wfa', 'M', 6, at(3), true) - 3) < 0.02);
  assert.ok(Math.abs(g.zscore('wfa', 'M', 6, at(3) + (at(3) - at(2)), true) - 4) < 0.02); // one "SD2-SD3 step" above +3 SD is z = 4
  assert.ok(Math.abs(g.zscore('wfa', 'M', 6, at(-3) - (at(-2) - at(-3)), true) + 4) < 0.02);
  const raw = g.zscore('lhfa_l', 'M', 6, g.valueAtZ(g.lms('lhfa_l', 'M', 6), -4), false); assert.ok(Math.abs(raw + 4) < 0.02); // length-for-age is not adjusted
});
test('interpolation between months is monotonic and stays between neighbours', () => {
  const a = g.lms('wfa', 'F', 6).M, b = g.lms('wfa', 'F', 6.5).M, c = g.lms('wfa', 'F', 7).M;
  assert.ok(a < b && b < c); assert.ok(Math.abs(b - (a + c) / 2) < 1e-9);
});
const base = { sex: 'F', dob: '2025-05-07' }; // measured on 2026-11-07 => 18 months
const child = (o) => g.compute({ ...base, measured_on: '2026-11-07', ...o });
test('compute: healthy 18-month-old girl has no flags and z-scores near 0', () => {
  const r = child({ weight_kg: 10.2, length_cm: 81.7, head_cm: 46.2, muac_cm: 14.5 });
  assert.equal(r.age_days, 549); assert.equal(Math.round(r.age_months), 18);
  for (const k of ['waz', 'haz', 'whz', 'baz', 'hcz']) assert.ok(Math.abs(r.z[k]) < 1.2, `${k}=${r.z[k]}`);
  assert.deepEqual(r.flags, []);
});
test('compute: severe wasting, stunting and underweight are flagged; MUAC and oedema are independent triggers', () => {
  const thin = child({ weight_kg: 5.9, length_cm: 70, muac_cm: 11.0 });
  const codes = thin.flags.map((f) => f.code);
  for (const c of ['sam', 'sam_muac', 'stunted_severe', 'underweight_severe']) assert.ok(codes.includes(c), c);
  assert.equal(g.worst(thin.flags), 'critical');
  assert.ok(child({ weight_kg: 10, length_cm: 81, edema: true }).flags.some((f) => f.code === 'sam_edema'));
  const mam = child({ weight_kg: 10, length_cm: 81, muac_cm: 12.0 }); assert.deepEqual(mam.flags.map((f) => f.code), ['mam_muac']);
  assert.deepEqual(child({ weight_kg: 10, length_cm: 81, muac_cm: 13 }).flags, []);
});
test('compute: overweight and obesity; MUAC only counts from 6 to 59 months', () => {
  assert.ok(child({ weight_kg: 14.0, length_cm: 82 }).flags.some((f) => ['overweight', 'obese'].includes(f.code)));
  const infant = g.compute({ sex: 'M', dob: '2026-08-07', measured_on: '2026-11-07', weight_kg: 5, muac_cm: 11 }); // 3 months
  assert.ok(!infant.flags.some((f) => f.code.startsWith('sam_muac')));
  const old = g.compute({ sex: 'M', dob: '2020-01-01', measured_on: '2026-11-07', weight_kg: 20, muac_cm: 11 });
  assert.deepEqual(old.flags.map((f) => f.code), ['no_standard_over_5y']);
});
test('compute: lying versus standing measurement adjusts length by 0.7 cm', () => {
  const lying = child({ weight_kg: 10, length_cm: 80, lying: true }), standing = child({ weight_kg: 10, length_cm: 80, lying: false });
  assert.equal(lying.height_used, 80); assert.equal(standing.height_used, 80.7); assert.ok(standing.z.haz > lying.z.haz);
  const two = g.compute({ sex: 'F', dob: '2024-09-07', measured_on: '2026-11-07', weight_kg: 11.5, length_cm: 86, lying: true }); // 26 months, measured lying
  assert.equal(two.height_used, 85.3);
});
test('compute: unspecified sex gives no z-scores but MUAC and oedema still work; implausible values are flagged', () => {
  const r = g.compute({ sex: 'O', dob: '2025-05-07', measured_on: '2026-11-07', weight_kg: 9, length_cm: 80, muac_cm: 11 });
  assert.deepEqual(r.z, { waz: null, haz: null, whz: null, baz: null, hcz: null }); assert.deepEqual(r.flags.map((f) => f.code).sort(), ['sam_muac', 'sex_unspecified']);
  const bad = child({ weight_kg: 30, length_cm: 81 }); assert.ok(bad.flags.some((f) => f.code === 'implausible_waz'));
  assert.ok(child({ weight_kg: 10, length_cm: 150 }).flags.some((f) => f.code === 'height_out_of_range'));
});
test('curves for charts', () => {
  const c = g.curveAt('wfa', 'F', 12); assert.ok(c[-3] < c[-2] && c[-2] < c[0] && c[0] < c[2] && c[2] < c[3]);
  assert.deepEqual(g.curveRange('wfa', 'M'), [0, 60]); assert.equal(g.curveAt('wfa', 'M', 99), null);
});
