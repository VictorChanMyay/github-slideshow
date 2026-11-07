'use strict';
const crypto = require('node:crypto');
const { hashPassword } = require('./auth');
const patients = require('./patients');

const DEMO_USERS = [
  ['doctor1', 'Demo Doctor', 'doctor'], ['nurse1', 'Demo Nurse', 'nurse'], ['midwife1', 'Demo Midwife', 'midwife'],
  ['pharm1', 'Demo Pharmacist', 'pharmacist'], ['lab1', 'Demo Lab Technician', 'lab'],
  ['reg1', 'Demo Registration Clerk', 'registration'], ['his1', 'Demo HIS Officer', 'his'],
  ['prog1', 'Demo Program Officer', 'program'], ['admin', 'Demo Administrator', 'admin'],
];
const DEMO_PASSWORD = 'demo-pass-12345';

function addUser(db, username, fullName, role, password, mustChange) {
  const { hash, salt } = hashPassword(password);
  db.prepare('INSERT INTO users(username,full_name,role,pass_hash,pass_salt,must_change) VALUES(?,?,?,?,?,?)')
    .run(username, fullName, role, hash, salt, mustChange ? 1 : 0);
}

function seed(db, { demo }) {
  const n = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (n > 0) return null;
  if (!demo) { // production-like first run: one admin with a random password, must be changed
    const pw = crypto.randomBytes(9).toString('base64url') + '9a';
    addUser(db, 'admin', 'Administrator', 'admin', pw, true);
    return { admin_password: pw };
  }
  for (const [u, f, r] of DEMO_USERS) addUser(db, u, f, r, DEMO_PASSWORD, false);
  const admin = db.prepare("SELECT * FROM users WHERE username='admin'").get();
  // FAKE people only. Names are invented placeholders.
  const demo_patients = [
    { name_en: 'Demo Patient One', sex: 'F', dob: '1992-03-14', village: 'Demo Village 1', ethnicity: 'Karen', language: 'Karen',
      nationality: 'Myanmar', names: [{ script: 'my', name: 'စမ်းသပ်လူနာ တစ်' }], ids: [{ id_type: 'unhcr_camp_card', number: 'DEMO-0001' }] },
    { name_en: 'Demo Patient Two', sex: 'M', dob: '2019-07-02', dob_estimated: true, village: 'Demo Village 2', ethnicity: 'Burman', nationality: 'Myanmar' },
    { name_en: 'Demo Patient Three', sex: 'F', dob: '1975-11-23', village: 'Demo Village 3', restricted: true, nationality: 'Myanmar' },
  ];
  for (const p of demo_patients) patients.create(db, p, admin);
  return { demo_password: DEMO_PASSWORD };
}

module.exports = { seed, DEMO_PASSWORD };
