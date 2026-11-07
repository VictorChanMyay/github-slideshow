'use strict';
/* Dashboard and reports screens. Report titles, column headings and indicator definitions come from the server (English),
   because donors read them in English. Everything else is translated. */

const isoDay = (d) => d.toISOString().slice(0, 10);
const monthStart = (y, m) => isoDay(new Date(Date.UTC(y, m, 1))), monthEnd = (y, m) => isoDay(new Date(Date.UTC(y, m + 1, 0)));
function presets() {
  const n = new Date(), y = n.getUTCFullYear(), m = n.getUTCMonth(); const lm = new Date(Date.UTC(y, m - 1, 1));
  return [['this_month', monthStart(y, m), isoDay(n)], ['last_month', monthStart(lm.getUTCFullYear(), lm.getUTCMonth()), monthEnd(lm.getUTCFullYear(), lm.getUTCMonth())], ['last_3_months', monthStart(y, m - 2), isoDay(n)], ['year_to_date', monthStart(y, 0), isoDay(n)]];
}

/* ---- small SVG charts ---- */
function barChart(data, labelOf, w = 640, h = 190) {
  const L = 34, R = 8, T = 10, B = 24; const max = Math.max(1, ...data.map((d) => d.count)); const bw = (w - L - R) / data.length;
  const bars = data.map((d, i) => svg('rect', { x: L + i * bw + 1, y: T + (1 - d.count / max) * (h - T - B), width: Math.max(1, bw - 2), height: (d.count / max) * (h - T - B), fill: '#4cb86a' }, svg('title', {}, `${labelOf(d)}: ${d.count}`)));
  const ticks = [0, 1].map((f) => svg('text', { x: L - 4, y: T + (1 - f) * (h - T - B) + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#8aa3ab' }, Math.round(max * f)));
  const every = Math.ceil(data.length / 8); const labels = data.map((d, i) => (i % every === 0 ? svg('text', { x: L + i * bw + bw / 2, y: h - 8, 'text-anchor': 'middle', 'font-size': 10, fill: '#8aa3ab' }, labelOf(d)) : null));
  return svg('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', role: 'img' }, svg('line', { x1: L, x2: w - R, y1: h - B, y2: h - B, stroke: '#223540' }), ticks, bars, labels);
}
function hBars(data) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return h('div', {}, data.map((d) => h('div', { class: 'hbar' }, h('div', { class: 'hbar-label' }, `${d.code} ${d.name}`), h('div', { class: 'hbar-track' }, h('div', { class: 'hbar-fill', 'data-w': String(Math.round((d.count / max) * 100)) }), h('span', { class: 'hbar-n' }, String(d.count))))));
}
function sizeBars(root) { for (const el of root.querySelectorAll('.hbar-fill')) el.style.width = el.dataset.w + '%'; }

/* ---- dashboard ---- */
async function dashboardView() {
  const r = await api('GET', '/api/dashboard'); const D = r.data; const root = h('div');
  root.append(h('div', { class: 'cards' }, (D.tiles || []).map((x) => h('div', { class: 'card ' + (x.level || ''), role: 'button', tabindex: '0', onclick: () => { state.view = x.link; render(); }, onkeydown: (e) => { if (e.key === 'Enter') { state.view = x.link; render(); } } }, h('b', {}, String(x.value)), h('span', {}, t('dash.tile.' + x.key))))));
  const c = D.charts; if (!c) return root;
  root.append(h('div', { class: 'panel' }, h('h4', {}, t('dash.chart.visits_per_day')), barChart(c.visits_per_day, (d) => d.date.slice(5))));
  const two = h('div', { class: 'grid2' }, h('div', { class: 'panel' }, h('h4', {}, t('dash.chart.top_diagnoses')), c.top_diagnoses.length ? hBars(c.top_diagnoses) : h('div', { class: 'note' }, t('fu.empty'))), h('div', { class: 'panel' }, h('h4', {}, t('dash.chart.visits_per_month')), barChart(c.visits_per_month, (d) => d.month.slice(2), 420, 190)));
  root.append(two, h('p', { class: 'note' }, t('dash.note'))); setTimeout(() => sizeBars(root), 0);
  return root;
}

/* ---- reports ---- */
async function reportsView() {
  const cat = await api('GET', '/api/reports'); const list = cat.data.reports || []; const canExport = !!cat.data.can_export;
  const key = state.repKey || list[0].key; const dflt = presets()[0]; const from = state.repFrom || dflt[1], to = state.repTo || dflt[2];
  const root = h('div'); const fromI = h('input', { type: 'date', value: from, 'aria-label': t('rep.from') }), toI = h('input', { type: 'date', value: to, 'aria-label': t('rep.to') }); const allDx = h('input', { type: 'checkbox' }); allDx.checked = !!state.repAllDx;
  const go = () => { state.repFrom = fromI.value; state.repTo = toI.value; state.repAllDx = allDx.checked; render(); };
  const picker = (kind) => h('div', { class: 'row' }, h('b', {}, t('rep.kind.' + kind) + ':'), list.filter((x) => x.kind === kind).map((x) => h('button', { class: 'sm ' + (x.key === key ? 'pri' : ''), onclick: () => { state.repKey = x.key; render(); } }, x.title.replace(/ \(donor template, draft\)/, ''))));
  root.append(picker('report'), picker('template'),
    h('div', { class: 'row' }, h('label', { class: 'check' }, t('rep.from'), fromI), h('label', { class: 'check' }, t('rep.to'), toI), presets().map(([k, f, tt]) => h('button', { class: 'sm', onclick: () => { state.repFrom = f; state.repTo = tt; render(); } }, t('rep.preset.' + k))),
      key === 'morbidity' ? h('label', { class: 'check' }, allDx, t('rep.all_dx')) : null, h('button', { class: 'pri sm', onclick: go }, t('rep.run'))));
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${state.repAllDx && key === 'morbidity' ? '&all_diagnoses=1' : ''}`; const r = await api('GET', `/api/reports/${key}?${q}`);
  if (!r.ok) { root.append(h('div', { class: 'err' }, r.data.error || t('common.error'))); return root; }
  const R = r.data;
  root.append(h('div', { class: 'panel' }, h('h3', {}, R.title), R.meta.map((m) => h('div', { class: 'note' }, m)),
    R.masked ? h('div', { class: 'banner info' }, t('rep.masked_note')) : null,
    canExport ? h('div', { class: 'row noprint' }, h('a', { class: 'btnlink', href: `/api/reports/${key}/export?${q}&format=csv`, download: '' }, t('rep.export_csv')), h('a', { class: 'btnlink', href: `/api/reports/${key}/export?${q}&format=xlsx`, download: '' }, t('rep.export_xlsx')), h('button', { class: 'sm', onclick: () => window.print() }, t('summary.print'))) : h('div', { class: 'note' }, t('rep.no_export'))));
  for (const s of R.sections) root.append(h('div', { class: 'panel tablewrap' }, s.title ? h('h4', {}, s.title) : null, s.rows.length ? h('table', {}, h('tr', {}, s.columns.map((c) => h('th', {}, c.label))),
    s.rows.map((row) => h('tr', {}, s.columns.map((c) => h('td', { class: c.key === 'definition' || c.key === 'why' ? 'note' : '' }, row[c.key] == null ? '' : String(row[c.key])))))) : h('p', { class: 'note' }, t('rep.empty')), (s.notes || []).map((n) => h('p', { class: 'note' }, n))));
  root.append(h('p', { class: 'note' }, t('rep.footer')));
  return root;
}
