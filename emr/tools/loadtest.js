#!/usr/bin/env node
'use strict';
// Builds a large FAKE database and times the screens that scale with data. Run on the weakest PC the clinic has.
// Usage: node tools/loadtest.js [--patients=30000] [--visits-per=4] [--file=<path>] [--keep]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dbm = require('../lib/db');
const patients = require('../lib/patients');
const reports = require('../lib/reports');
const dashboard = require('../lib/dashboard');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const N = Number(arg('patients', 30000)), VPP = Number(arg('visits-per', 4));
const file = arg('file', path.join(os.tmpdir(), `emr-load-${process.pid}.db`));
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const iso = (d) => d.toISOString().slice(0, 10);
const time = (label, fn, rep = 5) => { const t = []; let r; for (let i = 0; i < rep; i++) { const s = process.hrtime.bigint(); r = fn(); t.push(Number(process.hrtime.bigint() - s) / 1e6); } t.sort((a, b) => a - b); console.log(`${label.padEnd(44)} median ${t[Math.floor(t.length / 2)].toFixed(1).padStart(8)} ms   worst ${t[t.length - 1].toFixed(1).padStart(8)} ms`); return r; };

const db = dbm.open(file);
const codes = db.prepare('SELECT code FROM icd10').all().map((r) => r.code);
console.log(`Building ${N} patients with about ${VPP} visits each (fake data) in ${file} ...`);
const t0 = Date.now();
const today = new Date(); const ids = [];
db.exec('BEGIN');
const ip = db.prepare('INSERT INTO patients(mrn,name_en,sex,dob,village,phone) VALUES(?,?,?,?,?,?)');
const inm = db.prepare('INSERT INTO patient_names(patient_id,script,name) VALUES(?,?,?)');
const iid = db.prepare('INSERT INTO patient_ids(patient_id,id_type,number) VALUES(?,?,?)');
const ie = db.prepare("INSERT INTO encounters(patient_id,visit_date,queue_no,type,status,signed_at) VALUES(?,?,?,?,?,?)");
const iv = db.prepare('INSERT INTO vitals(encounter_id,temp,sys,dia,pulse,weight) VALUES(?,?,?,?,?,?)');
const idx = db.prepare("INSERT INTO diagnoses(encounter_id,code,kind) VALUES(?,?,'primary')");
const first = ['Aye', 'Mya', 'Kyaw', 'Thida', 'Saw', 'Naw', 'Min', 'Hla', 'Zin', 'Htoo'], last = ['Win', 'Moe', 'Paw', 'Thu', 'Oo', 'Htun', 'Lay', 'Soe', 'Phyu', 'Nyein'];
for (let i = 1; i <= N; i++) {
  const id = Number(ip.run('L' + String(i).padStart(7, '0'), `${pick(first)} ${pick(last)} ${i}`, pick(['F', 'M']), iso(new Date(today - rnd() * 80 * 365 * 864e5)), 'Village ' + (i % 40), '09' + String(100000000 + i)).lastInsertRowid);
  ids.push(id); inm.run(id, 'my', 'မြန်မာ ' + i); iid.run(id, 'unhcr', 'ID' + i);
  const k = 1 + Math.floor(rnd() * VPP * 2 - 1);
  for (let j = 0; j < k; j++) {
    const day = iso(new Date(today - rnd() * 365 * 864e5)); const e = Number(ie.run(id, day, 1, 'outpatient', 'signed', day + ' 10:00:00').lastInsertRowid);
    iv.run(e, 36 + rnd() * 3, 100 + rnd() * 50, 60 + rnd() * 30, 60 + rnd() * 40, 40 + rnd() * 40); idx.run(e, pick(codes));
  }
}
db.exec('COMMIT');
const c = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
console.log(`Built in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${c('patients')} patients, ${c('encounters')} visits, ${c('diagnoses')} diagnoses, file ${(fs.statSync(file).size / 1048576).toFixed(0)} MB\n`);

const user = { id: 1, role: 'admin' };
const res = {};
res.search_name = time('Patient search by name fragment', () => patients.search(db, 'Aye Win'));
res.search_mrn = time('Patient search by MRN', () => patients.search(db, 'L0012345'));
res.search_phone = time('Patient search by phone', () => patients.search(db, '0910000'));
res.search_none = time('Patient search, no match (worst case)', () => patients.search(db, 'zzzzzz'));
res.dash = time('Dashboard', () => dashboard.dashboard(db, user));
const y = iso(today), from = iso(new Date(today - 364 * 864e5));
for (const key of ['morbidity', 'workload', 'maternal', 'child', 'programmes', 'lab', 'pharmacy', 'inpatient', 'referrals', 'dataquality']) res[key] = time(`Report ${key} (12 months)`, () => reports.run(db, key, from, y, { mask: true }), 3);
time('Database backup (VACUUM INTO)', () => { const f = file + '.bk'; fs.rmSync(f, { force: true }); db.exec(`VACUUM INTO '${f}'`); fs.rmSync(f); }, 1);
const slow = Object.entries(res).length; console.log(`\nTip: anything over about 1000 ms on the clinic's weakest PC deserves attention.`);
db.close();
if (!process.argv.includes('--keep')) for (const e of ['', '-wal', '-shm']) fs.rmSync(file + e, { force: true });
