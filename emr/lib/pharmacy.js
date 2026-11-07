'use strict';
const { tx } = require('./db');
const { HttpError } = require('./encounters');

const text = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));
const todayStr = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const intIn = (v, min, max, label) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}`); return n; };

/* ---- formulary ---- */
function listDrugs(db, q, all) {
  q = text(q, 60); const l = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  return db.prepare(`SELECT id,name,strength,form,class,reorder_level,active FROM drugs WHERE (?=1 OR active=1) AND (name LIKE ? ESCAPE '\\' OR class LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\') ORDER BY name,strength LIMIT 60`).all(all ? 1 : 0, l, l, l);
}
function addDrug(db, input) {
  const name = text(input.name, 80), strength = text(input.strength, 40), form = text(input.form, 40);
  if (!name || !strength || !form) throw new HttpError(400, 'Name, strength and form are required');
  if (db.prepare('SELECT 1 FROM drugs WHERE name=? COLLATE NOCASE AND strength=? COLLATE NOCASE AND form=? COLLATE NOCASE').get(name, strength, form)) throw new HttpError(409, 'This medicine is already in the list');
  const r = db.prepare('INSERT INTO drugs(name,strength,form,class,tags,reorder_level) VALUES(?,?,?,?,?,?)')
    .run(name, strength, form, text(input.class, 40).toLowerCase() || null, text(input.tags, 200).toLowerCase() || null, intIn(input.reorder_level ?? 0, 0, 1000000, 'Reorder level'));
  return Number(r.lastInsertRowid);
}
function updateDrug(db, id, input) {
  const d = db.prepare('SELECT * FROM drugs WHERE id=?').get(id); if (!d) throw new HttpError(404, 'Medicine not found');
  db.prepare('UPDATE drugs SET reorder_level=?, active=? WHERE id=?').run(input.reorder_level == null ? d.reorder_level : intIn(input.reorder_level, 0, 1000000, 'Reorder level'), input.active == null ? d.active : (input.active ? 1 : 0), id);
  return d;
}

/* ---- safety checks ---- */
function allergyWarnings(db, patientId, drug) {
  const tags = (drug.tags || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).concat([drug.name.toLowerCase(), (drug.class || '').toLowerCase()]).filter(Boolean);
  return db.prepare('SELECT id,allergen,reaction,severity FROM allergies WHERE patient_id=? AND active=1').all(patientId).filter((a) => {
    const al = a.allergen.toLowerCase().trim();
    return al.length >= 3 && tags.some((t) => t.includes(al) || (t.length >= 4 && al.includes(t)));
  });
}
function duplicateWarnings(db, encounterId, drug) {
  return db.prepare(`SELECT p.id, d.name, d.strength FROM prescriptions p JOIN drugs d ON d.id=p.drug_id
    WHERE p.encounter_id=? AND p.status!='cancelled' AND (p.drug_id=? OR (d.class IS NOT NULL AND d.class=?))`).all(encounterId, drug.id, drug.class || '\u0000');
}

/* ---- prescribing ---- */
function prescribe(db, user, encounter, input) {
  const drug = db.prepare('SELECT * FROM drugs WHERE id=? AND active=1').get(Number(input.drug_id));
  if (!drug) throw new HttpError(400, 'Unknown medicine');
  const dose = text(input.dose, 100), frequency = text(input.frequency, 100);
  if (!dose || !frequency) throw new HttpError(400, 'Dose and frequency are required');
  const days = intIn(input.duration_days, 1, 365, 'Duration (days)'), qty = intIn(input.quantity, 1, 10000, 'Quantity');
  const allergies = allergyWarnings(db, encounter.patient_id, drug);
  const dups = duplicateWarnings(db, encounter.id, drug);
  const reason = text(input.allergy_override_reason, 300);
  const problems = {};
  if (allergies.length && reason.length < 5) problems.allergy_warnings = allergies;
  if (dups.length && !input.confirm_duplicate) problems.duplicate_warnings = dups;
  if (Object.keys(problems).length) throw new HttpError(409, 'Safety check needs confirmation', problems);
  const r = db.prepare(`INSERT INTO prescriptions(encounter_id,patient_id,drug_id,dose,frequency,duration_days,quantity,instructions,allergy_override_reason,duplicate_confirmed,prescribed_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(encounter.id, encounter.patient_id, drug.id, dose, frequency, days, qty, text(input.instructions), allergies.length ? reason : null, dups.length ? 1 : 0, user.id);
  return { id: Number(r.lastInsertRowid), overrode_allergy: allergies.length > 0 };
}
function rxRow(db, id) { const r = db.prepare('SELECT * FROM prescriptions WHERE id=?').get(id); if (!r) throw new HttpError(404, 'Prescription not found'); return r; }
const dispensedQty = (db, id) => db.prepare('SELECT COALESCE(SUM(qty),0) n FROM dispensing WHERE prescription_id=?').get(id).n;
function cancelRx(db, id, input) {
  const r = rxRow(db, id);
  if (r.status !== 'prescribed' || dispensedQty(db, id) > 0) throw new HttpError(409, 'Only prescriptions that have not been dispensed can be cancelled');
  const reason = text(input.reason, 200); if (reason.length < 3) throw new HttpError(400, 'A reason is required');
  db.prepare("UPDATE prescriptions SET status='cancelled', cancel_reason=? WHERE id=?").run(reason, id);
  return r;
}
function rxView(db, r) {
  const d = db.prepare('SELECT name,strength,form FROM drugs WHERE id=?').get(r.drug_id);
  const by = db.prepare('SELECT full_name FROM users WHERE id=?').get(r.prescribed_by);
  return { id: r.id, encounter_id: r.encounter_id, patient_id: r.patient_id, drug_id: r.drug_id, drug: `${d.name} ${d.strength} ${d.form}`, dose: r.dose, frequency: r.frequency,
    duration_days: r.duration_days, quantity: r.quantity, dispensed: dispensedQty(db, r.id), instructions: r.instructions, status: r.status,
    allergy_override_reason: r.allergy_override_reason, prescribed_by: by ? by.full_name : null, prescribed_at: r.prescribed_at, cancel_reason: r.cancel_reason };
}
const forEncounter = (db, encounterId) => db.prepare('SELECT * FROM prescriptions WHERE encounter_id=? ORDER BY id').all(encounterId).map((r) => rxView(db, r));

/* ---- pharmacy worklist and dispensing ---- */
function usable(db, drugId) {
  return db.prepare('SELECT COALESCE(SUM(qty_on_hand),0) n FROM stock_batches WHERE drug_id=? AND expiry>=?').get(drugId, todayStr()).n;
}
function worklist(db, status) {
  const where = status === 'done' ? "status='dispensed'" : "status IN ('prescribed','partial')";
  const rows = db.prepare(`SELECT * FROM prescriptions WHERE ${where} ORDER BY id ${status === 'done' ? 'DESC' : 'ASC'} LIMIT 200`).all();
  return rows.map((r) => {
    const p = db.prepare('SELECT id,mrn,name_en,sex,dob,restricted FROM patients WHERE id=?').get(r.patient_id);
    const allergies = db.prepare('SELECT allergen,reaction,severity FROM allergies WHERE patient_id=? AND active=1').all(r.patient_id);
    return { ...rxView(db, r), usable_stock: usable(db, r.drug_id), allergies,
      patient: { id: p.id, mrn: p.mrn, name_en: p.restricted ? null : p.name_en, sex: p.sex, dob: p.dob, restricted: !!p.restricted } };
  });
}
// First-expiry-first-out. Expired stock is never used.
function dispense(db, user, id, input) {
  return tx(db, () => {
    const r = rxRow(db, id);
    if (r.status !== 'prescribed' && r.status !== 'partial') throw new HttpError(409, 'Prescription is not waiting to be dispensed');
    const already = dispensedQty(db, id), remaining = r.quantity - already;
    const qty = input.qty == null || input.qty === '' ? remaining : intIn(input.qty, 1, remaining, 'Quantity to dispense');
    const batches = db.prepare('SELECT * FROM stock_batches WHERE drug_id=? AND qty_on_hand>0 AND expiry>=? ORDER BY expiry ASC, id ASC').all(r.drug_id, todayStr());
    const available = batches.reduce((s, b) => s + b.qty_on_hand, 0);
    if (available < qty) throw new HttpError(409, 'Not enough in-date stock', { available });
    let need = qty; const used = [];
    for (const b of batches) {
      if (need <= 0) break;
      const take = Math.min(need, b.qty_on_hand);
      db.prepare('UPDATE stock_batches SET qty_on_hand=qty_on_hand-? WHERE id=?').run(take, b.id);
      db.prepare('INSERT INTO dispensing(prescription_id,batch_id,qty,by_user) VALUES(?,?,?,?)').run(id, b.id, take, user.id);
      db.prepare("INSERT INTO stock_movements(drug_id,batch_id,type,qty,reference,by_user) VALUES(?,?,'dispense',?,?,?)").run(r.drug_id, b.id, -take, 'rx ' + id, user.id);
      used.push({ batch_no: b.batch_no, expiry: b.expiry, qty: take }); need -= take;
    }
    const status = already + qty >= r.quantity ? 'dispensed' : 'partial';
    db.prepare('UPDATE prescriptions SET status=? WHERE id=?').run(status, id);
    return { status, dispensed: already + qty, batches: used, patient_id: r.patient_id };
  });
}

/* ---- stock ---- */
function stockSummary(db) {
  const t = todayStr(), soon = plusDays(90);
  const out = db.prepare('SELECT id,name,strength,form,reorder_level FROM drugs WHERE active=1 ORDER BY name,strength').all().map((d) => {
    const batches = db.prepare('SELECT id,batch_no,expiry,qty_received,qty_on_hand,source FROM stock_batches WHERE drug_id=? AND qty_on_hand>0 ORDER BY expiry').all(d.id)
      .map((b) => ({ ...b, state: b.expiry < t ? 'expired' : b.expiry <= soon ? 'expiring' : 'ok' }));
    const sum = (f) => batches.filter(f).reduce((s, b) => s + b.qty_on_hand, 0);
    const usableQty = sum((b) => b.state !== 'expired');
    return { ...d, usable: usableQty, expired: sum((b) => b.state === 'expired'), expiring: sum((b) => b.state === 'expiring'), low: usableQty <= d.reorder_level, batches };
  });
  return out;
}
function receive(db, user, input) {
  const drug = db.prepare('SELECT id FROM drugs WHERE id=? AND active=1').get(Number(input.drug_id)); if (!drug) throw new HttpError(400, 'Unknown medicine');
  const batch = text(input.batch_no, 40); if (!batch) throw new HttpError(400, 'Batch number is required');
  const expiry = text(input.expiry, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || Number.isNaN(Date.parse(expiry))) throw new HttpError(400, 'Expiry must be a valid date');
  if (expiry < todayStr()) throw new HttpError(400, 'This batch is already expired and cannot be received');
  const qty = intIn(input.qty, 1, 1000000, 'Quantity');
  return tx(db, () => {
    const ex = db.prepare('SELECT id FROM stock_batches WHERE drug_id=? AND batch_no=? AND expiry=?').get(drug.id, batch, expiry);
    let bid;
    if (ex) { db.prepare('UPDATE stock_batches SET qty_on_hand=qty_on_hand+?, qty_received=qty_received+? WHERE id=?').run(qty, qty, ex.id); bid = ex.id; }
    else bid = Number(db.prepare('INSERT INTO stock_batches(drug_id,batch_no,expiry,qty_received,qty_on_hand,source,received_by) VALUES(?,?,?,?,?,?,?)').run(drug.id, batch, expiry, qty, qty, text(input.source, 100), user.id).lastInsertRowid);
    db.prepare("INSERT INTO stock_movements(drug_id,batch_id,type,qty,reason,by_user) VALUES(?,?,'receive',?,?,?)").run(drug.id, bid, qty, text(input.source, 100), user.id);
    return { batch_id: bid };
  });
}
function adjust(db, user, batchId, input) {
  const b = db.prepare('SELECT * FROM stock_batches WHERE id=?').get(batchId); if (!b) throw new HttpError(404, 'Batch not found');
  const delta = intIn(input.delta, -1000000, 1000000, 'Change'); if (delta === 0) throw new HttpError(400, 'Change must not be zero');
  const reason = text(input.reason, 200); if (reason.length < 3) throw new HttpError(400, 'A reason is required');
  if (b.qty_on_hand + delta < 0) throw new HttpError(409, 'Stock cannot go below zero');
  tx(db, () => {
    db.prepare('UPDATE stock_batches SET qty_on_hand=qty_on_hand+? WHERE id=?').run(delta, batchId);
    db.prepare("INSERT INTO stock_movements(drug_id,batch_id,type,qty,reason,by_user) VALUES(?,?,'adjust',?,?,?)").run(b.drug_id, batchId, delta, reason, user.id);
  });
  return b;
}
function writeOff(db, user, batchId, input) {
  const b = db.prepare('SELECT * FROM stock_batches WHERE id=?').get(batchId); if (!b) throw new HttpError(404, 'Batch not found');
  const reason = text(input.reason, 200); if (reason.length < 3) throw new HttpError(400, 'A reason is required');
  if (b.qty_on_hand === 0) throw new HttpError(409, 'Batch is already empty');
  tx(db, () => {
    db.prepare('UPDATE stock_batches SET qty_on_hand=0 WHERE id=?').run(batchId);
    db.prepare("INSERT INTO stock_movements(drug_id,batch_id,type,qty,reason,by_user) VALUES(?,?,'writeoff',?,?,?)").run(b.drug_id, batchId, -b.qty_on_hand, reason, user.id);
  });
  return b;
}
function movements(db, limit) {
  return db.prepare(`SELECT m.id,m.at,m.type,m.qty,m.reference,m.reason,d.name,d.strength,b.batch_no,u.full_name by_name FROM stock_movements m
    JOIN drugs d ON d.id=m.drug_id LEFT JOIN stock_batches b ON b.id=m.batch_id LEFT JOIN users u ON u.id=m.by_user ORDER BY m.id DESC LIMIT ?`).all(Math.min(Number(limit) || 100, 500));
}

module.exports = { listDrugs, addDrug, updateDrug, allergyWarnings, prescribe, rxRow, cancelRx, forEncounter, worklist, dispense, stockSummary, receive, adjust, writeOff, movements };
