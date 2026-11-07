'use strict';
const { tx } = require('./db');

const SCRIPTS = ['my', 'kar', 'th', 'other'];
const ID_TYPES = ['thai_id', 'myanmar_id', 'unhcr_camp_card', 'passport', 'other'];

class ValidationError extends Error { constructor(msg, field) { super(msg); this.field = field; this.status = 400; } }

const clean = (v, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));

function validateDob(dob) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) throw new ValidationError('Date of birth must be YYYY-MM-DD', 'dob');
  const d = new Date(dob + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dob) throw new ValidationError('Invalid date of birth', 'dob');
  if (d.getTime() > Date.now()) throw new ValidationError('Date of birth is in the future', 'dob');
  if (new Date().getUTCFullYear() - d.getUTCFullYear() > 120) throw new ValidationError('Date of birth is more than 120 years ago', 'dob');
}

function nextMrn(db) {
  const r = db.prepare("SELECT value FROM settings WHERE key='mrn_seq'").get();
  const n = (r ? Number(r.value) : 1000) + 1;
  db.prepare("INSERT INTO settings(key,value) VALUES('mrn_seq',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(n));
  return 'MTC-' + String(n).padStart(6, '0');
}

function findDuplicates(db, name, dob) {
  return db.prepare(`SELECT id,mrn,name_en,dob FROM patients
    WHERE voided=0 AND name_en=? COLLATE NOCASE AND dob=?`).all(name, dob);
}

function create(db, input, user) {
  const name = clean(input.name_en, 120);
  if (!name) throw new ValidationError('Name is required', 'name_en');
  const sex = clean(input.sex, 1).toUpperCase();
  if (!['F', 'M', 'O'].includes(sex)) throw new ValidationError('Sex must be F, M or O', 'sex');
  const dob = clean(input.dob, 10); validateDob(dob);
  const names = (Array.isArray(input.names) ? input.names : []).slice(0, 6).map((n) => ({ script: clean(n.script, 10), name: clean(n.name, 120) }))
    .filter((n) => n.name);
  for (const n of names) if (!SCRIPTS.includes(n.script)) throw new ValidationError('Unknown name script', 'names');
  const ids = (Array.isArray(input.ids) ? input.ids : []).slice(0, 6).map((n) => ({ id_type: clean(n.id_type, 30), number: clean(n.number, 40) }))
    .filter((n) => n.number);
  for (const n of ids) if (!ID_TYPES.includes(n.id_type)) throw new ValidationError('Unknown ID type', 'ids');

  if (!input.force) {
    const dups = findDuplicates(db, name, dob);
    if (dups.length) { const e = new Error('Possible duplicate'); e.status = 409; e.duplicates = dups; throw e; }
  }
  return tx(db, () => {
    const mrn = nextMrn(db);
    const r = db.prepare(`INSERT INTO patients(mrn,name_en,sex,dob,dob_estimated,phone,village,ethnicity,language,nationality,restricted,created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(mrn, name, sex, dob, input.dob_estimated ? 1 : 0, clean(input.phone, 30), clean(input.village),
      clean(input.ethnicity, 60), clean(input.language, 60), clean(input.nationality, 60), input.restricted ? 1 : 0, user.id);
    const pid = Number(r.lastInsertRowid);
    for (const n of names) db.prepare('INSERT INTO patient_names(patient_id,script,name) VALUES(?,?,?)').run(pid, n.script, n.name);
    for (const n of ids) db.prepare('INSERT INTO patient_ids(patient_id,id_type,number) VALUES(?,?,?)').run(pid, n.id_type, n.number);
    return { id: pid, mrn };
  });
}

const like = (q) => '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';

// List/search. Restricted patients appear in results with limited fields only.
function search(db, q, limit = 50) {
  q = clean(q, 80);
  let rows;
  if (!q) {
    rows = db.prepare('SELECT * FROM patients WHERE voided=0 ORDER BY id DESC LIMIT ?').all(limit);
  } else {
    const l = like(q);
    rows = db.prepare(`SELECT DISTINCT p.* FROM patients p
      LEFT JOIN patient_names n ON n.patient_id=p.id
      LEFT JOIN patient_ids i ON i.patient_id=p.id
      WHERE p.voided=0 AND (p.name_en LIKE ? ESCAPE '\\' OR p.mrn LIKE ? ESCAPE '\\' OR p.phone LIKE ? ESCAPE '\\'
        OR n.name LIKE ? ESCAPE '\\' OR i.number LIKE ? ESCAPE '\\')
      ORDER BY p.id DESC LIMIT ?`).all(l, l, l, l, l, limit);
  }
  return rows.map((p) => summary(db, p));
}

function summary(db, p) {
  const names = db.prepare('SELECT script,name FROM patient_names WHERE patient_id=?').all(p.id);
  return { id: p.id, mrn: p.mrn, name_en: p.name_en, sex: p.sex, dob: p.dob, dob_estimated: !!p.dob_estimated,
    village: p.village, restricted: !!p.restricted, names: p.restricted ? [] : names };
}

function getFull(db, id) {
  const p = db.prepare('SELECT * FROM patients WHERE id=? AND voided=0').get(id);
  if (!p) return null;
  return { ...p, dob_estimated: !!p.dob_estimated, restricted: !!p.restricted,
    names: db.prepare('SELECT script,name FROM patient_names WHERE patient_id=?').all(id),
    ids: db.prepare('SELECT id_type,number FROM patient_ids WHERE patient_id=?').all(id) };
}

module.exports = { create, search, getFull, summary, ValidationError, SCRIPTS, ID_TYPES };
