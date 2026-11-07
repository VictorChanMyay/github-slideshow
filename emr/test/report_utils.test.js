'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const U = require('../lib/report_utils');
const X = require('../lib/xlsx');

test('small-number protection: 1 to 4 become "<5"; zero, 5 and above and text are left alone', () => {
  assert.deepEqual([0, 1, 4, 5, 12].map(U.suppress), [0, '<5', '<5', 5, 12]); assert.equal(U.suppress('abc'), 'abc'); assert.equal(U.suppress(null), null); assert.equal(U.suppress(2.5), '<5');
});
test('CSV: quoting, byte-order mark, and no formula injection', () => {
  const csv = U.toCsv('Title, with comma', [{ title: 'S1', columns: [{ key: 'a', label: 'Name' }, { key: 'b', label: 'Count' }], rows: [{ a: 'Say "hi"', b: 3 }, { a: '=HYPERLINK("http://x")', b: 0 }, { a: '+1', b: -5 }, { a: '@cmd', b: 1 }, { a: 'line\nbreak', b: null }], notes: ['A note'] }], ['Period: 2026-01-01 to 2026-01-31']);
  assert.ok(csv.startsWith('﻿')); const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], '"Title, with comma"'); assert.equal(lines[1], 'Period: 2026-01-01 to 2026-01-31'); assert.equal(lines[3], 'S1'); assert.equal(lines[4], 'Name,Count'); assert.equal(lines[5], '"Say ""hi""",3');
  assert.equal(lines[6], "\"'=HYPERLINK(\"\"http://x\"\")\",0"); assert.equal(lines[7], "'+1,-5"); assert.equal(lines[8], "'@cmd,1"); assert.ok(csv.includes('"line\nbreak",')); assert.ok(csv.includes('A note'));
  assert.equal(U.csvCell(-5), '-5'); // real negative numbers stay numbers
});
test('age group SQL matches the group boundaries', () => {
  const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:'); const sql = U.ageGroupSql("'2026-06-15'", 'dob');
  const g = (dob) => db.prepare(`SELECT ${sql} g FROM (SELECT ? dob)`).get(dob).g;
  assert.equal(g('2026-03-01'), 'u1'); assert.equal(g('2025-06-16'), 'u1'); assert.equal(g('2025-06-14'), '1_4'); assert.equal(g('2022-01-01'), '1_4'); assert.equal(g('2021-06-14'), '5_14'); assert.equal(g('2012-01-01'), '5_14'); assert.equal(g('2010-01-01'), '15_24'); assert.equal(g('2002-01-01'), '15_24');
  assert.equal(g('1995-01-01'), '25_49'); assert.equal(g('1980-01-01'), '25_49'); assert.equal(g('1970-01-01'), '50p');
});
// A tiny zip reader to check the workbook we produce
function readZip(buf) {
  const files = {}; const endPos = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); const count = buf.readUInt16LE(endPos + 10); let p = buf.readUInt32LE(endPos + 16);
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50); const crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8'); const ln = buf.readUInt16LE(off + 26), le = buf.readUInt16LE(off + 28); const data = buf.slice(off + 30 + ln + le, off + 30 + ln + le + size);
    assert.equal(zlib.crc32(data) >>> 0, crc, 'crc of ' + name); files[name] = data.toString('utf8'); p += 46 + nl + el + cl;
  }
  return files;
}
test('xlsx workbook: valid zip, every part present, values and escaping correct, one sheet per section', () => {
  const sections = [{ title: 'Visits', columns: [{ key: 'a', label: 'Metric' }, { key: 'b', label: 'Value' }], rows: [{ a: 'OPD visits & more <x>', b: 42 }, { a: 'Hidden', b: '<5' }, { a: 'မြန်မာ', b: 0 }], notes: ['Note one'] }, { title: 'Second', columns: [{ key: 'a', label: 'X' }], rows: [{ a: 'y' }] }];
  const buf = X.buildXlsx(X.sectionsToSheets('My report', ['Period 2026'], sections)); const f = readZip(buf);
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) assert.ok(n in f, n);
  assert.ok(f['xl/workbook.xml'].includes('name="Visits"') && f['xl/workbook.xml'].includes('name="Second"'));
  const s1 = f['xl/worksheets/sheet1.xml']; assert.ok(s1.includes('<v>42</v>')); assert.ok(s1.includes('OPD visits &amp; more &lt;x&gt;')); assert.ok(s1.includes('&lt;5')); assert.ok(s1.includes('မြန်မာ')); assert.ok(s1.includes('My report')); assert.ok(s1.includes('Note one'));
  assert.ok(s1.includes('s="1"')); assert.ok(!/<c [^>]*><v>NaN/.test(s1));
  for (const x of Object.values(f)) assert.ok(x.startsWith('<?xml'), 'well-formed xml header');
});
test('xlsx helpers: column letters, sheet names are cleaned and unique', () => {
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(X.colName), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  const f = readZip(X.buildXlsx([{ name: 'a/b?*[x]:y', rows: [['1']] }, { name: 'a/b?*[x]:y', rows: [['2']] }, { name: 'X'.repeat(40), rows: [['3']] }])); const names = [...f['xl/workbook.xml'].matchAll(/name="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(new Set(names).size, 3); assert.ok(names.every((n) => n.length <= 31 && !/[\\/?*[\]:]/.test(n)));
});
