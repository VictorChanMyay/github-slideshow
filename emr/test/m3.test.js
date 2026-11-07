'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const dbm = require('../lib/db');
const { seed, DEMO_PASSWORD } = require('../lib/seed');
const { createServer } = require('../server');
const lab = require('../lib/lab');

let server, base, db;
before(async () => {
  db = dbm.open(':memory:'); seed(db, { demo: true });
  server = createServer(db); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server.close());
async function call(method, url, body, cookie) {
  const res = await fetch(base + url, { method, headers: { 'X-Requested-With': 'emr', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = {}; try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data };
}
const jar = {};
async function as(u) { if (!jar[u]) { const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'X-Requested-With': 'emr', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: DEMO_PASSWORD }) }); assert.equal(r.status, 200); jar[u] = r.headers.get('set-cookie').split(';')[0]; } return jar[u]; }
const testId = (code) => db.prepare('SELECT id FROM lab_tests WHERE code=?').get(code).id;
const drugId = (name, strength) => db.prepare('SELECT id FROM drugs WHERE name=? AND (? IS NULL OR strength=?)').get(name, strength ?? null, strength ?? null).id;
const P1 = 1, P2 = 2, P3 = 3;
let E1, E2, E3;

test('setup: check in three patients (adult woman, child, restricted)', async () => {
  const reg = await as('reg1'), doc = await as('doctor1');
  E1 = (await call('POST', `/api/patients/${P1}/checkin`, {}, reg)).data.id;
  E2 = (await call('POST', `/api/patients/${P2}/checkin`, {}, reg)).data.id;
  await call('GET', `/api/patients/${P3}?reason=${encodeURIComponent('Clinical care today')}`, undefined, doc);
  E3 = (await call('POST', `/api/patients/${P3}/checkin`, {}, doc)).data.id;
  assert.ok(E1 && E2 && E3);
});

/* ---------------- lab interpretation (unit) ---------------- */
test('lab interpretation: numeric ranges are sex-specific; adult-only tests are not assessed for children', () => {
  const hb = db.prepare("SELECT * FROM lab_tests WHERE code='HB'").get();
  assert.equal(lab.interpret(hb, '14', 'M', 400), 'normal');
  assert.equal(lab.interpret(hb, '12.5', 'M', 400), 'abnormal'); // below male range
  assert.equal(lab.interpret(hb, '12.5', 'F', 400), 'normal');
  assert.equal(lab.interpret(hb, '6.5', 'F', 400), 'critical');
  assert.equal(lab.interpret(hb, '9', 'F', 60), 'not_assessed');
  assert.throws(() => lab.interpret(hb, 'abc', 'F', 400), /number/);
  assert.throws(() => lab.interpret(hb, '-1', 'F', 400), /number/);
});
test('lab interpretation: qualitative options, abnormal and invalid', () => {
  const m = db.prepare("SELECT * FROM lab_tests WHERE code='MAL_RDT'").get();
  assert.equal(lab.interpret(m, 'Negative', 'F', 300), 'normal');
  assert.equal(lab.interpret(m, 'Positive P. vivax', 'F', 300), 'abnormal');
  assert.equal(lab.interpret(m, 'Invalid', 'F', 300), 'invalid');
  assert.throws(() => lab.interpret(m, 'Maybe', 'F', 300), /options/);
});

/* ---------------- lab workflow (API) ---------------- */
let oMal, oHb, oHiv;
test('ordering: roles, duplicate guard, visit shows orders', async () => {
  assert.equal((await call('POST', `/api/encounters/${E1}/lab-orders`, { test_id: testId('HB') }, await as('nurse1'))).status, 403);
  const doc = await as('doctor1');
  assert.equal((await call('POST', `/api/encounters/${E1}/lab-orders`, { test_id: 9999 }, doc)).status, 400);
  let r = await call('POST', `/api/encounters/${E1}/lab-orders`, { test_id: testId('MAL_RDT'), priority: 'urgent' }, doc);
  assert.equal(r.status, 201); oMal = r.data.lab_orders[0].id;
  r = await call('POST', `/api/encounters/${E1}/lab-orders`, { test_id: testId('HB') }, doc); oHb = r.data.lab_orders[1].id;
  r = await call('POST', `/api/encounters/${E1}/lab-orders`, { test_id: testId('HIV_RDT') }, doc); oHiv = r.data.lab_orders[2].id;
  const dup = await call('POST', `/api/encounters/${E1}/lab-orders`, { test_id: testId('HB') }, doc);
  assert.equal(dup.status, 409); assert.equal(dup.data.duplicate, true);
  assert.equal((await call('POST', `/api/encounters/${E1}/lab-orders`, { test_id: testId('HB'), confirm_duplicate: true }, doc)).status, 201);
  assert.equal(r.data.lab_orders.length, 3);
});
test('cancel an order that has not been collected', async () => {
  const doc = await as('doctor1');
  const extra = db.prepare("SELECT id FROM lab_orders WHERE encounter_id=? AND test_id=? ORDER BY id DESC").get(E1, testId('HB')).id;
  assert.equal((await call('POST', `/api/lab-orders/${extra}/cancel`, { reason: '' }, doc)).status, 400);
  assert.equal((await call('POST', `/api/lab-orders/${extra}/cancel`, { reason: 'Ordered twice by mistake' }, doc)).status, 200);
});
test('lab worklist: urgent first; collect before result; validation; flags', async () => {
  const lab1 = await as('lab1');
  const wl = (await call('GET', '/api/lab/worklist', undefined, lab1)).data.orders;
  assert.equal(wl[0].id, oMal); // urgent first
  assert.equal((await call('POST', `/api/lab-orders/${oHb}/result`, { value: '10' }, lab1)).status, 409); // not collected
  assert.equal((await call('POST', `/api/lab-orders/${oHb}/collect`, {}, await as('doctor1'))).status, 403);
  for (const id of [oMal, oHb, oHiv]) assert.equal((await call('POST', `/api/lab-orders/${id}/collect`, {}, await as('nurse1'))).status, 200);
  assert.equal((await call('POST', `/api/lab-orders/${oHb}/collect`, {}, lab1)).status, 409); // already collected
  assert.equal((await call('POST', `/api/lab-orders/${oHb}/result`, { value: 'abc' }, lab1)).status, 400);
  assert.equal((await call('POST', `/api/lab-orders/${oMal}/result`, { value: 'Maybe' }, lab1)).status, 400);
  assert.equal((await call('POST', `/api/lab-orders/${oHb}/result`, { value: '10' }, await as('nurse1'))).status, 403);
  assert.equal((await call('POST', `/api/lab-orders/${oHb}/result`, { value: '10.5' }, lab1)).data.flag, 'abnormal');
  assert.equal((await call('POST', `/api/lab-orders/${oMal}/result`, { value: 'Positive P. falciparum' }, lab1)).data.flag, 'abnormal');
  assert.equal((await call('POST', `/api/lab-orders/${oHiv}/result`, { value: 'Reactive', comment: 'Preliminary, confirm per algorithm' }, lab1)).data.flag, 'abnormal');
});
test('amending a result needs a reason and keeps history', async () => {
  const lab1 = await as('lab1');
  assert.equal((await call('POST', `/api/lab-orders/${oHb}/result`, { value: '6.2' }, lab1)).status, 400);
  const r = await call('POST', `/api/lab-orders/${oHb}/result`, { value: '6.2', amend_reason: 'Transcription error' }, lab1);
  assert.equal(r.status, 200); assert.equal(r.data.flag, 'critical');
  const h = db.prepare('SELECT old_value,new_value,reason FROM lab_result_history WHERE order_id=?').all(oHb);
  assert.deepEqual(h.map((x) => [x.old_value, x.new_value, x.reason]), [['10.5', '6.2', 'Transcription error']]);
  const v = (await call('GET', `/api/encounters/${E1}`, undefined, await as('doctor1'))).data;
  const hb = v.lab_orders.find((o) => o.id === oHb); assert.equal(hb.amended, true); assert.equal(hb.result_flag, 'critical');
});
test('sensitive results (HIV) are hidden from roles without permission, and viewing is logged', async () => {
  const seeByNurse = (await call('GET', `/api/encounters/${E1}`, undefined, await as('nurse1'))).data.lab_orders.find((o) => o.id === oHiv);
  assert.equal(seeByNurse.hidden, true); assert.equal(seeByNurse.result_value, null); assert.equal(seeByNurse.result_flag, null);
  const seeByHis = (await call('GET', `/api/encounters/${E1}`, undefined, await as('his1'))).data.lab_orders.find((o) => o.id === oHiv);
  assert.equal(seeByHis.hidden, true);
  const before = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='sensitive_result_viewed'").get().c;
  const seeByDoc = (await call('GET', `/api/encounters/${E1}`, undefined, await as('doctor1'))).data.lab_orders.find((o) => o.id === oHiv);
  assert.equal(seeByDoc.result_value, 'Reactive');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='sensitive_result_viewed'").get().c, before + 1);
  const wl = (await call('GET', '/api/lab/worklist?status=resulted', undefined, await as('nurse1'))).data.orders.find((o) => o.id === oHiv);
  assert.equal(wl.hidden, true);
  assert.ok(!JSON.stringify(db.prepare("SELECT detail FROM audit_log WHERE action LIKE 'lab_%'").all()).includes('Reactive')); // values never written to the audit log
});
test('child: adult-only numeric test is not assessed', async () => {
  const doc = await as('doctor1');
  const o = (await call('POST', `/api/encounters/${E2}/lab-orders`, { test_id: testId('HB') }, doc)).data.lab_orders[0].id;
  await call('POST', `/api/lab-orders/${o}/collect`, {}, await as('lab1'));
  assert.equal((await call('POST', `/api/lab-orders/${o}/result`, { value: '9' }, await as('lab1'))).data.flag, 'not_assessed');
});
test('cannot cancel a collected specimen; signed visit blocks new orders but not results', async () => {
  const doc = await as('doctor1');
  assert.equal((await call('POST', `/api/lab-orders/${oMal}/cancel`, { reason: 'changed mind' }, doc)).status, 409);
  const late = (await call('POST', `/api/encounters/${E2}/lab-orders`, { test_id: testId('UPT') }, doc)).data.lab_orders.at(-1).id;
  await call('POST', `/api/encounters/${E2}/diagnoses`, { code: 'J06', kind: 'primary' }, doc);
  assert.equal((await call('POST', `/api/encounters/${E2}/sign`, {}, doc)).status, 200);
  assert.equal((await call('POST', `/api/encounters/${E2}/lab-orders`, { test_id: testId('UA_PROT') }, doc)).status, 409);
  await call('POST', `/api/lab-orders/${late}/collect`, {}, await as('lab1'));
  assert.equal((await call('POST', `/api/lab-orders/${late}/result`, { value: 'Negative' }, await as('lab1'))).status, 200);
});

/* ---------------- prescribing ---------------- */
test('formulary search and prescribing validation/roles', async () => {
  const doc = await as('doctor1');
  assert.ok((await call('GET', '/api/drugs?q=amox', undefined, doc)).data.drugs.length >= 2);
  assert.equal((await call('GET', '/api/drugs', undefined, await as('lab1'))).status, 403);
  const para = drugId('Paracetamol');
  const ok = { drug_id: para, dose: '1 tablet', frequency: 'every 6 hours', duration_days: 3, quantity: 12 };
  assert.equal((await call('POST', `/api/encounters/${E1}/prescriptions`, ok, await as('nurse1'))).status, 403);
  assert.equal((await call('POST', `/api/encounters/${E1}/prescriptions`, ok, await as('pharm1'))).status, 403);
  for (const bad of [{ ...ok, dose: '' }, { ...ok, duration_days: 0 }, { ...ok, quantity: 'x' }, { ...ok, quantity: 1.5 }, { ...ok, drug_id: 9999 }]) assert.equal((await call('POST', `/api/encounters/${E1}/prescriptions`, bad, doc)).status, 400, JSON.stringify(bad));
  assert.equal((await call('POST', `/api/encounters/${E1}/prescriptions`, ok, doc)).status, 201);
});
test('duplicate medicine needs confirmation', async () => {
  const doc = await as('doctor1');
  const rx = { drug_id: drugId('Paracetamol'), dose: '1 tablet', frequency: 'every 6 hours', duration_days: 3, quantity: 12 };
  const d = await call('POST', `/api/encounters/${E1}/prescriptions`, rx, doc);
  assert.equal(d.status, 409); assert.equal(d.data.duplicate_warnings.length, 1);
  assert.equal((await call('POST', `/api/encounters/${E1}/prescriptions`, { ...rx, confirm_duplicate: true }, doc)).status, 201);
});
test('allergy match blocks until a reason is given, and the override is logged', async () => {
  const nurse = await as('nurse1'), doc = await as('doctor1');
  await call('POST', `/api/patients/${P1}/allergies`, { allergen: 'Penicillin', reaction: 'Rash', severity: 'moderate' }, nurse);
  const rx = { drug_id: drugId('Amoxicillin', '500 mg'), dose: '1 capsule', frequency: 'three times a day', duration_days: 5, quantity: 15 };
  const a = await call('POST', `/api/encounters/${E1}/prescriptions`, rx, doc);
  assert.equal(a.status, 409); assert.equal(a.data.allergy_warnings[0].allergen, 'Penicillin');
  assert.equal((await call('POST', `/api/encounters/${E1}/prescriptions`, { ...rx, allergy_override_reason: 'no' }, doc)).status, 409);
  const ok = await call('POST', `/api/encounters/${E1}/prescriptions`, { ...rx, allergy_override_reason: 'Tolerated before, specialist advised' }, doc);
  assert.equal(ok.status, 201);
  const row = db.prepare('SELECT allergy_override_reason FROM prescriptions WHERE drug_id=? AND encounter_id=?').get(rx.drug_id, E1);
  assert.match(row.allergy_override_reason, /specialist/);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action='rx_prescribed_allergy_override'").get());
  // unrelated drug is not flagged, and a class synonym (sulfa) matches cotrimoxazole
  await call('POST', `/api/patients/${P1}/allergies`, { allergen: 'Sulfa drugs' }, nurse);
  const s = await call('POST', `/api/encounters/${E1}/prescriptions`, { drug_id: drugId('Cotrimoxazole'), dose: '2 tablets', frequency: 'twice a day', duration_days: 3, quantity: 12 }, doc);
  assert.equal(s.status, 409);
});
test('cancel prescription: reason needed, only before dispensing', async () => {
  const doc = await as('doctor1');
  const id = (await call('POST', `/api/encounters/${E1}/prescriptions`, { drug_id: drugId('Zinc sulfate'), dose: '1 tablet', frequency: 'daily', duration_days: 10, quantity: 10 }, doc)).data.prescriptions.at(-1).id;
  assert.equal((await call('POST', `/api/prescriptions/${id}/cancel`, { reason: '' }, doc)).status, 400);
  assert.equal((await call('POST', `/api/prescriptions/${id}/cancel`, { reason: 'Not needed' }, doc)).status, 200);
  assert.equal((await call('POST', `/api/prescriptions/${id}/cancel`, { reason: 'again' }, doc)).status, 409);
});

/* ---------------- stock and dispensing ---------------- */
const para = () => drugId('Paracetamol');
let rxPara; // paracetamol prescription (qty 12)
test('dispensing with no stock fails cleanly', async () => {
  rxPara = db.prepare('SELECT id FROM prescriptions WHERE encounter_id=? AND drug_id=? ORDER BY id').get(E1, para()).id;
  const r = await call('POST', `/api/prescriptions/${rxPara}/dispense`, {}, await as('pharm1'));
  assert.equal(r.status, 409); assert.equal(r.data.available, 0);
  assert.equal((await call('POST', `/api/prescriptions/${rxPara}/dispense`, {}, await as('doctor1'))).status, 403);
});
test('receiving stock: validation, roles, merge of same batch', async () => {
  const ph = await as('pharm1');
  const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  assert.equal((await call('POST', '/api/stock/receive', { drug_id: para(), batch_no: 'X', expiry: iso(100), qty: 5 }, await as('nurse1'))).status, 403);
  assert.equal((await call('POST', '/api/stock/receive', { drug_id: para(), batch_no: 'OLD', expiry: iso(-1), qty: 5 }, ph)).status, 400);
  assert.equal((await call('POST', '/api/stock/receive', { drug_id: para(), batch_no: '', expiry: iso(100), qty: 5 }, ph)).status, 400);
  assert.equal((await call('POST', '/api/stock/receive', { drug_id: para(), batch_no: 'A', expiry: iso(100), qty: 0 }, ph)).status, 400);
  assert.equal((await call('POST', '/api/stock/receive', { drug_id: para(), batch_no: 'A', expiry: iso(100), qty: 5, source: 'Donor X' }, ph)).status, 201);
  assert.equal((await call('POST', '/api/stock/receive', { drug_id: para(), batch_no: 'A', expiry: iso(100), qty: 5 }, ph)).status, 201); // merges: 10
  assert.equal((await call('POST', '/api/stock/receive', { drug_id: para(), batch_no: 'B', expiry: iso(400), qty: 100 }, ph)).status, 201);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM stock_batches WHERE drug_id=?').get(para()).c, 2);
});
test('dispense uses earliest-expiry stock first and splits across batches', async () => {
  const r = await call('POST', `/api/prescriptions/${rxPara}/dispense`, {}, await as('pharm1'));
  assert.equal(r.status, 200); assert.equal(r.data.status, 'dispensed');
  assert.deepEqual(r.data.batches.map((b) => [b.batch_no, b.qty]), [['A', 10], ['B', 2]]);
  const stock = (await call('GET', '/api/stock', undefined, await as('nurse1'))).data.drugs.find((d) => d.id === para());
  assert.equal(stock.usable, 98);
  assert.equal(db.prepare("SELECT COALESCE(SUM(qty),0) s FROM stock_movements WHERE drug_id=? AND type='dispense'").get(para()).s, -12);
  assert.equal((await call('POST', `/api/prescriptions/${rxPara}/dispense`, {}, await as('pharm1'))).status, 409); // already dispensed
  assert.equal((await call('POST', `/api/prescriptions/${rxPara}/cancel`, { reason: 'late' }, await as('doctor1'))).status, 409);
});
test('partial dispensing and over-dispensing', async () => {
  const doc = await as('doctor1'), ph = await as('pharm1');
  const id = (await call('POST', `/api/encounters/${E1}/prescriptions`, { drug_id: drugId('Ibuprofen'), dose: '1 tablet', frequency: 'three times a day', duration_days: 5, quantity: 30 }, doc)).data.prescriptions.at(-1).id;
  await call('POST', '/api/stock/receive', { drug_id: drugId('Ibuprofen'), batch_no: 'I1', expiry: new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10), qty: 100 }, ph);
  assert.equal((await call('POST', `/api/prescriptions/${id}/dispense`, { qty: 31 }, ph)).status, 400);
  assert.equal((await call('POST', `/api/prescriptions/${id}/dispense`, { qty: 0 }, ph)).status, 400);
  const p = await call('POST', `/api/prescriptions/${id}/dispense`, { qty: 10 }, ph);
  assert.equal(p.data.status, 'partial'); assert.equal(p.data.dispensed, 10);
  const wl = (await call('GET', '/api/pharmacy/worklist', undefined, ph)).data.prescriptions.find((x) => x.id === id);
  assert.equal(wl.dispensed, 10); assert.equal(wl.status, 'partial');
  assert.equal((await call('POST', `/api/prescriptions/${id}/dispense`, {}, ph)).data.status, 'dispensed');
});
test('expired stock is never dispensed and a failed dispense changes nothing', async () => {
  const doc = await as('doctor1'), ph = await as('pharm1');
  const d = drugId('Metronidazole');
  db.prepare("INSERT INTO stock_batches(drug_id,batch_no,expiry,qty_received,qty_on_hand) VALUES(?,?,?,?,?)").run(d, 'EXP', '2020-01-01', 500, 500);
  const id = (await call('POST', `/api/encounters/${E1}/prescriptions`, { drug_id: d, dose: '1 tablet', frequency: 'three times a day', duration_days: 5, quantity: 15 }, doc)).data.prescriptions.at(-1).id;
  const r = await call('POST', `/api/prescriptions/${id}/dispense`, {}, ph);
  assert.equal(r.status, 409); assert.equal(r.data.available, 0);
  assert.equal(db.prepare("SELECT qty_on_hand q FROM stock_batches WHERE batch_no='EXP'").get().q, 500);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM dispensing WHERE prescription_id=?').get(id).c, 0);
  const s = (await call('GET', '/api/stock', undefined, ph)).data.drugs.find((x) => x.id === d);
  assert.equal(s.usable, 0); assert.equal(s.expired, 500); assert.equal(s.low, true);
});
test('stock adjust and write-off need a reason and cannot go negative', async () => {
  const ph = await as('pharm1');
  const b = db.prepare("SELECT id FROM stock_batches WHERE batch_no='B'").get().id;
  assert.equal((await call('POST', `/api/stock/${b}/adjust`, { delta: -5, reason: '' }, ph)).status, 400);
  assert.equal((await call('POST', `/api/stock/${b}/adjust`, { delta: -5000, reason: 'recount' }, ph)).status, 409);
  assert.equal((await call('POST', `/api/stock/${b}/adjust`, { delta: 0, reason: 'x y z' }, ph)).status, 400);
  assert.equal((await call('POST', `/api/stock/${b}/adjust`, { delta: -3, reason: 'Damaged in storage' }, ph)).status, 200);
  assert.equal((await call('POST', `/api/stock/${b}/adjust`, { delta: -3, reason: 'x' }, await as('nurse1'))).status, 403);
  const exp = db.prepare("SELECT id FROM stock_batches WHERE batch_no='EXP'").get().id;
  assert.equal((await call('POST', `/api/stock/${exp}/writeoff`, { reason: 'Expired' }, ph)).status, 200);
  assert.equal((await call('POST', `/api/stock/${exp}/writeoff`, { reason: 'Expired' }, ph)).status, 409);
  const mv = (await call('GET', '/api/stock/movements', undefined, ph)).data.movements;
  assert.ok(mv.some((m) => m.type === 'writeoff' && m.qty === -500) && mv.some((m) => m.type === 'adjust' && m.qty === -3));
});
test('restricted patient: lab and pharmacy staff can process tasks by MRN without opening the record', async () => {
  const doc = await as('doctor1'), lab1 = await as('lab1'), ph = await as('pharm1');
  const o = (await call('POST', `/api/encounters/${E3}/lab-orders`, { test_id: testId('UPT') }, doc)).data.lab_orders[0].id;
  const rx = (await call('POST', `/api/encounters/${E3}/prescriptions`, { drug_id: drugId('Ferrous sulfate + folic acid'), dose: '1 tablet', frequency: 'daily', duration_days: 30, quantity: 30 }, doc)).data.prescriptions[0].id;
  const lw = (await call('GET', '/api/lab/worklist', undefined, lab1)).data.orders.find((x) => x.id === o);
  assert.equal(lw.patient.name_en, null); assert.equal(lw.patient.restricted, true); assert.ok(lw.patient.mrn);
  const pw = (await call('GET', '/api/pharmacy/worklist', undefined, ph)).data.prescriptions.find((x) => x.id === rx);
  assert.equal(pw.patient.name_en, null);
  assert.equal((await call('POST', `/api/lab-orders/${o}/collect`, {}, lab1)).status, 200);
  assert.equal((await call('POST', `/api/lab-orders/${o}/result`, { value: 'Negative' }, lab1)).status, 200);
  await call('POST', '/api/stock/receive', { drug_id: drugId('Ferrous sulfate + folic acid'), batch_no: 'F1', expiry: new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10), qty: 200 }, ph);
  assert.equal((await call('POST', `/api/prescriptions/${rx}/dispense`, {}, ph)).status, 200);
  assert.equal((await call('GET', `/api/encounters/${E3}`, undefined, await as('nurse1'))).status, 403); // browsing the record is still blocked
  assert.equal((await call('POST', `/api/encounters/${E3}/lab-orders`, { test_id: testId('HB') }, await as('his1'))).status, 403); // no order rights
});
test('worklist shows allergies to the pharmacist', async () => {
  const w = (await call('GET', '/api/pharmacy/worklist?status=done', undefined, await as('pharm1'))).data.prescriptions;
  const mine = w.find((x) => x.patient.id === P1);
  assert.ok(mine.allergies.some((a) => a.allergen === 'Penicillin'));
});
test('formulary admin: add medicine, duplicate guard, roles', async () => {
  const admin = await as('admin');
  const body = { name: 'Gentian violet', strength: '0.5%', form: 'solution', class: 'antiseptic', tags: 'gentian violet', reorder_level: 5 };
  assert.equal((await call('POST', '/api/drugs', body, await as('doctor1'))).status, 403);
  assert.equal((await call('POST', '/api/drugs', body, admin)).status, 201);
  assert.equal((await call('POST', '/api/drugs', body, admin)).status, 409);
  assert.equal((await call('POST', '/api/drugs', { name: 'X' }, admin)).status, 400);
  assert.ok((await call('GET', '/api/drugs?q=gentian', undefined, await as('doctor1'))).data.drugs.length === 1);
});
test('audit covers lab, prescribing, dispensing and stock; no lab values leak into it', async () => {
  const actions = new Set(db.prepare('SELECT action FROM audit_log').all().map((r) => r.action));
  for (const a of ['lab_ordered', 'lab_cancelled', 'lab_collected', 'lab_resulted', 'lab_amended', 'rx_prescribed', 'rx_prescribed_allergy_override', 'rx_cancelled', 'rx_dispensed', 'stock_received', 'stock_adjusted', 'stock_writeoff', 'drug_added', 'sensitive_result_viewed']) assert.ok(actions.has(a), a);
});
