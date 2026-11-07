'use strict';
// Helpers for aggregate reports: small-number protection, CSV (safe for Excel) and age groups.
const MIN_CELL = 5;
const suppress = (v) => (typeof v === 'number' && v > 0 && v < MIN_CELL ? '<5' : v);

// SQL fragment: age group on a given date column, for a patients alias
const AGE_GROUPS = [['u1', '<1 year'], ['1_4', '1-4 years'], ['5_14', '5-14 years'], ['15_24', '15-24 years'], ['25_49', '25-49 years'], ['50p', '50+ years']];
// Age group from an expression that already holds the age in days (compute it once per row for speed).
const ageGroupOfDays = (d) => `CASE WHEN ${d}<365.25 THEN 'u1' WHEN ${d}<1826.25 THEN '1_4' WHEN ${d}<5478.75 THEN '5_14' WHEN ${d}<9131.25 THEN '15_24' WHEN ${d}<18262.5 THEN '25_49' ELSE '50p' END`;
const ageGroupSql = (dateCol, dobCol) => ageGroupOfDays(`(julianday(${dateCol})-julianday(${dobCol}))`);

// CSV: UTF-8 with a byte-order mark so Excel reads Burmese and Karen text. Cells that start like a formula are neutralised.
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
function toCsv(title, sections, meta = []) {
  const lines = [csvCell(title)]; for (const m of meta) lines.push(csvCell(m));
  for (const s of sections) {
    lines.push(''); if (s.title) lines.push(csvCell(s.title));
    lines.push(s.columns.map((c) => csvCell(c.label)).join(','));
    for (const r of s.rows) lines.push(s.columns.map((c) => csvCell(r[c.key])).join(','));
    for (const n of s.notes || []) lines.push(csvCell(n));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
module.exports = { MIN_CELL, suppress, AGE_GROUPS, ageGroupSql, ageGroupOfDays, csvCell, toCsv };
