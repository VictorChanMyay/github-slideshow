'use strict';
/* Orders screens: lab and prescribing panels inside a visit, lab worklist, pharmacy worklist, stock. Shares globals with app.js / clinical.js. */

async function loadLabTests() {
  if (!state.labTests && (can('lab.order') || can('lab.read'))) { const r = await api('GET', '/api/lab/tests'); state.labTests = r.data.tests || []; }
}
const flagClass = (f) => (f === 'critical' ? 'crit' : f === 'abnormal' || f === 'invalid' ? 'warn' : f === 'normal' ? 'ok' : '');
const dateOnly = (s) => (s || '').slice(0, 10);

/* ---- panels inside the visit ---- */
function ordersPanels(E, e, locked, reload, redraw) {
  const panels = [];
  if (can('lab.read')) panels.push(labPanel(E, e, locked, reload, redraw));
  if (can('rx.read')) panels.push(rxPanel(E, e, locked, reload, redraw));
  return panels;
}

function resultCell(o) {
  if (o.status === 'cancelled') return h('span', { class: 'note' }, t('lab.status.cancelled') + (o.cancel_reason ? ': ' + o.cancel_reason : ''));
  if (o.hidden) return h('span', { class: 'tag warn' }, t('lab.hidden'));
  if (o.status !== 'resulted') return h('span', { class: 'tag' }, t('lab.status.' + o.status));
  return h('span', {}, h('b', {}, o.result_value + (o.unit ? ' ' + o.unit : '')), ' ', h('span', { class: 'tag ' + flagClass(o.result_flag) }, t('lab.flag.' + o.result_flag)),
    o.amended ? h('span', { class: 'tag' }, ' ' + t('lab.amended')) : null, o.result_comment ? h('span', { class: 'note' }, ' ' + o.result_comment) : null);
}

function labPanel(E, e, locked, reload, redraw) {
  const tests = state.labTests || [];
  const sel = h('select', { 'aria-label': t('lab.test') }, tests.map((x) => h('option', { value: x.id }, x.name + (x.sensitive ? ' 🔒' : ''))));
  const urgent = h('input', { type: 'checkbox' });
  async function add(confirm) {
    const r = await api('POST', `/api/encounters/${e.id}/lab-orders`, { test_id: sel.value, priority: urgent.checked ? 'urgent' : 'routine', confirm_duplicate: !!confirm });
    if (r.status === 409 && r.data.duplicate) { if (window.confirm(t('lab.dup'))) return add(true); return; }
    if (await reload(r)) redraw();
  }
  const rows = E.lab_orders.map((o) => h('tr', {}, h('td', {}, o.test, o.priority === 'urgent' ? h('span', { class: 'tag warn' }, ' ' + t('queue.urgent')) : null), h('td', {}, resultCell(o)),
    h('td', {}, o.status === 'ordered' && can('lab.order') ? h('button', { class: 'sm', onclick: () => cancelWithReason(t('lab.cancel'), async (reason) => api('POST', `/api/lab-orders/${o.id}/cancel`, { reason }), reload, redraw) }, t('common.remove')) : null)));
  return h('div', { class: 'panel' }, h('h4', {}, t('lab.title')),
    rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, rows)) : h('div', { class: 'note' }, t('common.none')),
    !locked && can('lab.order') ? h('div', { class: 'row' }, sel, h('label', { class: 'check' }, urgent, t('queue.urgent')), h('button', { onclick: () => add(false) }, '+ ' + t('lab.add'))) : null,
    locked && can('lab.order') ? h('div', { class: 'note' }, t('orders.locked')) : null);
}

function cancelWithReason(title, fn, reload, redraw) {
  const r = h('input', { 'aria-label': t('enc.cancel_reason') }); const err = h('div', { class: 'err' });
  const d = modal([h('h3', {}, title), h('label', {}, t('enc.cancel_reason')), r, err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
    const x = await fn(r.value); if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; } d.close(); if (await reload(x)) redraw();
  } }, t('common.confirm')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}

function rxPanel(E, e, locked, reload, redraw) {
  const rows = E.prescriptions.map((x) => h('tr', {}, h('td', {}, h('b', {}, x.drug), x.allergy_override_reason ? h('div', { class: 'banner' }, '⚠ ' + t('rx.override') + ': ' + x.allergy_override_reason) : null),
    h('td', {}, `${x.dose} · ${x.frequency} · ${x.duration_days} ${t('rx.days')}`, x.instructions ? h('div', { class: 'note' }, x.instructions) : null),
    h('td', {}, `${x.dispensed}/${x.quantity}`, ' ', h('span', { class: 'tag ' + (x.status === 'dispensed' ? 'ok' : '') }, t('rx.status.' + x.status)), x.cancel_reason ? h('span', { class: 'note' }, ' ' + x.cancel_reason) : null),
    h('td', {}, x.status === 'prescribed' && can('rx.write') ? h('button', { class: 'sm', onclick: () => cancelWithReason(t('rx.cancel'), async (reason) => api('POST', `/api/prescriptions/${x.id}/cancel`, { reason }), reload, redraw) }, t('common.remove')) : null)));
  const form = h('div');
  if (!locked && can('rx.write')) {
    let drug = null; const chosen = h('div', { class: 'note' }, t('rx.nodrug'));
    const f = { dose: h('input', { 'aria-label': t('rx.dose'), placeholder: t('rx.dose') }), frequency: h('input', { 'aria-label': t('rx.frequency'), placeholder: t('rx.frequency') }),
      days: h('input', { type: 'number', min: '1', max: '365', 'aria-label': t('rx.duration') }), qty: h('input', { type: 'number', min: '1', 'aria-label': t('rx.quantity') }), note: h('input', { 'aria-label': t('rx.instructions'), placeholder: t('rx.instructions') }) };
    const out = h('div'); const q = h('input', { placeholder: t('rx.search'), 'aria-label': t('rx.search') }); let timer;
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(async () => {
      if (q.value.trim().length < 2) { out.replaceChildren(); return; }
      const r = await api('GET', '/api/drugs?q=' + encodeURIComponent(q.value));
      out.replaceChildren(...(r.data.drugs || []).map((d) => h('div', { class: 'pick', tabindex: '0', role: 'button', onclick: () => { drug = d; chosen.textContent = `${d.name} ${d.strength} ${d.form}`; chosen.className = 'tag ok'; out.replaceChildren(); }, onkeydown: (ev) => { if (ev.key === 'Enter') ev.target.click(); } }, `${d.name} ${d.strength} · ${d.form}`)));
    }, 250); });
    const err = h('div', { class: 'err' });
    async function submit(extra) {
      err.textContent = '';
      if (!drug) { err.textContent = t('rx.nodrug'); return; }
      const r = await api('POST', `/api/encounters/${e.id}/prescriptions`, { drug_id: drug.id, dose: f.dose.value, frequency: f.frequency.value, duration_days: f.days.value, quantity: f.qty.value, instructions: f.note.value, ...(extra || {}) });
      if (r.status === 409 && (r.data.allergy_warnings || r.data.duplicate_warnings)) return safetyDialog(r.data, extra || {}, submit);
      if (!r.ok) { err.textContent = r.data.error || t('common.error'); return; }
      if (await reload(r)) redraw();
    }
    form.append(h('div', { class: 'grid' }, h('div', {}, h('label', {}, t('rx.search')), q, out, chosen), h('label', {}, t('rx.dose'), f.dose), h('label', {}, t('rx.frequency'), f.frequency), h('label', {}, t('rx.duration'), f.days), h('label', {}, t('rx.quantity'), f.qty), h('label', {}, t('rx.instructions'), f.note)),
      err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => submit() }, '+ ' + t('rx.add'))), h('p', { class: 'note' }, t('rx.nocalc')));
  } else if (locked && can('rx.write')) form.append(h('div', { class: 'note' }, t('orders.locked')));
  return h('div', { class: 'panel' }, h('h4', {}, t('rx.title')), rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, rows)) : h('div', { class: 'note' }, t('common.none')), form);
}

function safetyDialog(data, prev, resubmit) {
  const reason = h('input', { 'aria-label': t('rx.override_reason') }); const err = h('div', { class: 'err' });
  const dup = h('input', { type: 'checkbox' });
  const d = modal([h('h3', {}, t('rx.safety')),
    data.allergy_warnings ? h('div', { class: 'banner' }, h('b', {}, '⚠ ' + t('rx.allergy_match')), data.allergy_warnings.map((a) => h('div', {}, `${a.allergen}${a.reaction ? ' (' + a.reaction + ')' : ''} [${t('severity.' + a.severity)}]`)), h('label', {}, t('rx.override_reason')), reason) : null,
    data.duplicate_warnings ? h('div', { class: 'banner info' }, h('b', {}, t('rx.dup_match')), data.duplicate_warnings.map((x) => h('div', {}, `${x.name} ${x.strength}`)), h('label', { class: 'check' }, dup, t('rx.dup_confirm'))) : null,
    err, h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => {
      const extra = { ...prev };
      if (data.allergy_warnings) { if (reason.value.trim().length < 5) { err.textContent = t('rx.override_short'); return; } extra.allergy_override_reason = reason.value.trim(); }
      if (data.duplicate_warnings) { if (!dup.checked) { err.textContent = t('rx.dup_tick'); return; } extra.confirm_duplicate = true; }
      d.close(); resubmit(extra);
    } }, t('rx.proceed')), h('button', { onclick: () => d.close() }, t('rx.back_change')))]);
}

/* ---- lab worklist ---- */
async function labView() {
  await loadLabTests();
  const tab = state.labTab || 'ordered'; const box = h('div', { class: 'panel tablewrap' });
  const r = await api('GET', '/api/lab/worklist?status=' + tab);
  const rows = r.data.orders || [];
  if (!rows.length) box.append(h('p', { class: 'note' }, t('lab.empty')));
  else box.append(h('table', {}, h('tr', {}, ['patient.name_en', 'patient.age', 'lab.test', 'enc.status', ''].map((k) => h('th', {}, k ? t(k) : ''))),
    rows.map((o) => h('tr', {}, h('td', {}, o.patient.name_en || o.patient.mrn, ' ', o.patient.restricted ? h('span', { class: 'tag warn' }, t('patient.restricted')) : null),
      h('td', {}, ageText(o.patient.dob) + ' · ' + sexLabel(o.patient.sex)), h('td', {}, o.test, o.priority === 'urgent' ? h('span', { class: 'tag warn' }, ' ' + t('queue.urgent')) : null, o.sensitive ? ' 🔒' : ''),
      h('td', {}, o.status === 'resulted' ? resultCell(o) : h('span', { class: 'tag' }, t('lab.status.' + o.status)), o.status !== 'resulted' ? h('span', { class: 'note' }, ' ' + dateOnly(o.ordered_at)) : null),
      h('td', {}, o.status === 'ordered' && can('lab.collect') ? h('button', { class: 'sm pri', onclick: async () => { const x = await api('POST', `/api/lab-orders/${o.id}/collect`, {}); if (x.ok) render(); else oops(x); } }, t('lab.collect'))
        : (o.status === 'collected' || (o.status === 'resulted' && !o.hidden)) && can('lab.result') ? h('button', { class: 'sm pri', onclick: () => resultDialog(o) }, o.status === 'resulted' ? t('lab.amend') : t('lab.enter')) : null)))));
  const tabs = ['ordered', 'collected', 'resulted'].map((s) => h('button', { class: s === tab ? 'pri' : '', onclick: () => { state.labTab = s; render(); } }, t('lab.tab.' + s)));
  return h('div', {}, h('div', { class: 'row' }, tabs), box);
}
function resultDialog(o) {
  const test = (state.labTests || []).find((x) => x.code === o.code) || {};
  const input = test.kind === 'qualitative' ? h('select', {}, (test.options || []).map((x) => h('option', { value: x }, x))) : h('input', { type: 'number', step: 'any', inputmode: 'decimal', 'aria-label': t('lab.value') });
  if (o.status === 'resulted' && o.result_value != null) input.value = o.result_value;
  const comment = h('input', { 'aria-label': t('lab.comment'), placeholder: t('lab.comment') }); const reason = h('input', { 'aria-label': t('lab.amend_reason') }); const err = h('div', { class: 'err' });
  const amending = o.status === 'resulted';
  const d = modal([h('h3', {}, `${o.test} · ${o.patient.name_en || o.patient.mrn}`), test.unit ? h('div', { class: 'note' }, t('lab.unit') + ': ' + test.unit + (test.ref_low != null ? ` · ${t('lab.ref')}: ${test.ref_low}–${test.ref_high} (${t('lab.ref_note')})` : '')) : null,
    h('label', {}, t('lab.value'), input), h('label', {}, t('lab.comment'), comment), amending ? h('label', {}, t('lab.amend_reason'), reason) : null, test.sensitive ? h('div', { class: 'note' }, t('lab.sens_note')) : null, err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
      const x = await api('POST', `/api/lab-orders/${o.id}/result`, { value: input.value, comment: comment.value, amend_reason: amending ? reason.value : undefined });
      if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; } d.close(); render();
    } }, t('common.save')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}

/* ---- pharmacy worklist ---- */
async function pharmacyView() {
  const tab = state.rxTab || 'pending'; const box = h('div');
  const r = await api('GET', '/api/pharmacy/worklist?status=' + tab);
  const rows = r.data.prescriptions || [];
  if (!rows.length) box.append(h('div', { class: 'panel' }, h('p', { class: 'note' }, t('rx.empty'))));
  for (const x of rows) {
    const remaining = x.quantity - x.dispensed;
    box.append(h('div', { class: 'panel' }, h('div', { class: 'row' }, h('b', {}, x.patient.name_en || x.patient.mrn), x.patient.restricted ? h('span', { class: 'tag warn' }, t('patient.restricted')) : null, h('span', { class: 'note' }, `${ageText(x.patient.dob)} · ${sexLabel(x.patient.sex)} · ${x.patient.mrn}`)),
      x.allergies.length ? h('div', { class: 'banner' }, '⚠ ' + t('allergy.title') + ': ' + x.allergies.map((a) => `${a.allergen} [${t('severity.' + a.severity)}]`).join(', ')) : h('div', { class: 'note' }, t('allergy.none')),
      x.allergy_override_reason ? h('div', { class: 'banner' }, '⚠ ' + t('rx.override') + ': ' + x.allergy_override_reason) : null,
      h('div', {}, h('b', {}, x.drug), ` · ${x.dose} · ${x.frequency} · ${x.duration_days} ${t('rx.days')}`), x.instructions ? h('div', { class: 'note' }, x.instructions) : null,
      h('div', { class: 'row' }, h('span', {}, `${t('rx.quantity')}: ${x.dispensed}/${x.quantity}`), h('span', { class: 'tag ' + (x.usable_stock < remaining ? 'warn' : 'ok') }, `${t('stock.usable')}: ${x.usable_stock}`), h('span', { class: 'note' }, `${x.prescribed_by || ''} ${dateOnly(x.prescribed_at)}`),
        tab === 'pending' && can('rx.dispense') ? h('button', { class: 'pri sm', onclick: () => dispenseDialog(x, remaining) }, t('rx.dispense')) : h('span', { class: 'tag ok' }, t('rx.status.' + x.status)))));
  }
  return h('div', {}, h('div', { class: 'row' }, ['pending', 'done'].map((s) => h('button', { class: s === tab ? 'pri' : '', onclick: () => { state.rxTab = s; render(); } }, t('rx.tab.' + s)))), box);
}
function dispenseDialog(x, remaining) {
  const qty = h('input', { type: 'number', min: '1', max: String(remaining), value: String(Math.min(remaining, x.usable_stock) || remaining), 'aria-label': t('rx.dispense_qty') }); const err = h('div', { class: 'err' });
  const d = modal([h('h3', {}, t('rx.dispense') + ': ' + x.drug), x.allergies.length ? h('div', { class: 'banner' }, '⚠ ' + t('allergy.title') + ': ' + x.allergies.map((a) => a.allergen).join(', ')) : null,
    h('p', {}, `${t('rx.remaining')}: ${remaining} · ${t('stock.usable')}: ${x.usable_stock}`), h('label', {}, t('rx.dispense_qty'), qty), err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
      const r = await api('POST', `/api/prescriptions/${x.id}/dispense`, { qty: qty.value });
      if (!r.ok) { err.textContent = r.status === 409 && r.data.available != null ? `${t('rx.nostock')} (${t('stock.usable')}: ${r.data.available})` : (r.data.error || t('common.error')); return; }
      d.close(); render();
    } }, t('rx.dispense')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}

/* ---- stock ---- */
async function stockView() {
  const r = await api('GET', '/api/stock'); const drugs = r.data.drugs || [];
  const mv = (await api('GET', '/api/stock/movements?limit=40')).data.movements || [];
  const wide = h('div');
  const table = h('div', { class: 'panel tablewrap' }, h('table', {}, h('tr', {}, ['stock.drug', 'stock.usable', 'stock.expiring', 'stock.expired', 'stock.reorder', 'enc.status', ''].map((k) => h('th', {}, k ? t(k) : ''))),
    drugs.map((d) => h('tr', { class: 'click', onclick: () => batchDialog(d) }, h('td', {}, `${d.name} ${d.strength} ${d.form}`), h('td', {}, String(d.usable)), h('td', {}, String(d.expiring)), h('td', {}, String(d.expired)), h('td', {}, String(d.reorder_level)),
      h('td', {}, d.low ? h('span', { class: 'tag warn' }, t('stock.low')) : h('span', { class: 'tag ok' }, 'OK'), d.expiring ? h('span', { class: 'tag warn' }, ' ' + t('stock.expiring_soon')) : null, d.expired ? h('span', { class: 'tag crit' }, ' ' + t('stock.has_expired')) : null), h('td', {}, '›')))));
  wide.append(table);
  if (can('stock.write')) {
    const dsel = h('select', {}, drugs.map((d) => h('option', { value: d.id }, `${d.name} ${d.strength} ${d.form}`)));
    const b = h('input', { 'aria-label': t('stock.batch') }), ex = h('input', { type: 'date', 'aria-label': t('stock.expiry') }), qn = h('input', { type: 'number', min: '1', 'aria-label': t('rx.quantity') }), src = h('input', { 'aria-label': t('stock.source') }); const err = h('div', { class: 'err' });
    wide.append(h('div', { class: 'panel' }, h('h4', {}, t('stock.receive')), h('div', { class: 'grid' }, h('label', {}, t('stock.drug'), dsel), h('label', {}, t('stock.batch'), b), h('label', {}, t('stock.expiry'), ex), h('label', {}, t('rx.quantity'), qn), h('label', {}, t('stock.source'), src)), err,
      h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => { const x = await api('POST', '/api/stock/receive', { drug_id: dsel.value, batch_no: b.value, expiry: ex.value, qty: qn.value, source: src.value }); if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; } render(); } }, t('stock.receive')))));
  }
  if (can('formulary.admin')) {
    const f = Object.fromEntries(['name', 'strength', 'form', 'class', 'tags', 'reorder'].map((k) => [k, h('input', { 'aria-label': t('formulary.' + k) })])); const err = h('div', { class: 'err' });
    wide.append(h('div', { class: 'panel' }, h('h4', {}, t('formulary.add')), h('div', { class: 'grid' }, Object.keys(f).map((k) => h('label', {}, t('formulary.' + k), f[k]))), err,
      h('div', { class: 'row' }, h('button', { onclick: async () => { const x = await api('POST', '/api/drugs', { name: f.name.value, strength: f.strength.value, form: f.form.value, class: f.class.value, tags: f.tags.value, reorder_level: f.reorder.value || 0 }); if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; } render(); } }, t('formulary.add'))), h('p', { class: 'note' }, t('formulary.note'))));
  }
  wide.append(h('div', { class: 'panel tablewrap' }, h('h4', {}, t('stock.movements')), h('table', {}, h('tr', {}, ['audit.time', 'stock.drug', 'stock.batch', 'stock.type', 'rx.quantity', 'audit.user'].map((k) => h('th', {}, t(k)))),
    mv.map((m) => h('tr', {}, h('td', {}, m.at), h('td', {}, `${m.name} ${m.strength}`), h('td', {}, m.batch_no || ''), h('td', {}, t('stock.type.' + m.type), m.reason ? h('span', { class: 'note' }, ' ' + m.reason) : null), h('td', {}, (m.qty > 0 ? '+' : '') + m.qty), h('td', {}, m.by_name || ''))))));
  return wide;
}
function batchDialog(d) {
  const write = can('stock.write'); const err = h('div', { class: 'err' });
  const body = [h('h3', {}, `${d.name} ${d.strength} ${d.form}`), d.batches.length ? h('table', {}, h('tr', {}, ['stock.batch', 'stock.expiry', 'stock.on_hand', ''].map((k) => h('th', {}, k ? t(k) : ''))),
    d.batches.map((b) => h('tr', {}, h('td', {}, b.batch_no), h('td', {}, b.expiry, b.state === 'expired' ? h('span', { class: 'tag crit' }, ' ' + t('stock.state.expired')) : b.state === 'expiring' ? h('span', { class: 'tag warn' }, ' ' + t('stock.state.expiring')) : null), h('td', {}, String(b.qty_on_hand)),
      h('td', {}, write ? [h('button', { class: 'sm', onclick: () => { dlg.close(); batchAction(b, 'adjust'); } }, t('stock.adjust')), ' ', h('button', { class: 'sm', onclick: () => { dlg.close(); batchAction(b, 'writeoff'); } }, t('stock.writeoff'))] : null)))) : h('p', { class: 'note' }, t('stock.none')), err,
    h('div', { class: 'row' }, h('button', { onclick: () => dlg.close() }, t('common.back')))];
  const dlg = modal(body);
}
function batchAction(b, kind) {
  const delta = h('input', { type: 'number', 'aria-label': t('stock.change') }); const reason = h('input', { 'aria-label': t('enc.cancel_reason') }); const err = h('div', { class: 'err' });
  const d = modal([h('h3', {}, `${t('stock.' + kind)}: ${b.batch_no}`), kind === 'adjust' ? h('label', {}, t('stock.change'), delta) : h('p', {}, t('stock.writeoff_text') + ' ' + b.qty_on_hand), h('label', {}, t('enc.cancel_reason'), reason), err,
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: async () => {
      const x = await api('POST', `/api/stock/${b.id}/${kind}`, kind === 'adjust' ? { delta: delta.value, reason: reason.value } : { reason: reason.value });
      if (!x.ok) { err.textContent = x.data.error || t('common.error'); return; } d.close(); render();
    } }, t('common.confirm')), h('button', { onclick: () => d.close() }, t('common.cancel')))]);
}
