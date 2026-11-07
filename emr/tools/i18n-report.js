'use strict';
// Lists UI text that is not translated yet, so translators know what to do.
// Usage: node tools/i18n-report.js [--csv]
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'public', 'i18n');
const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
const csv = process.argv.includes('--csv');
const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
for (const lang of ['my', 'kar']) {
  const cur = JSON.parse(fs.readFileSync(path.join(dir, lang + '.json'), 'utf8'));
  const missing = Object.keys(en).filter((k) => !k.startsWith('_') && !(k in cur));
  if (csv) { console.log(`# ${lang}\nkey,english,translation`); for (const k of missing) console.log([k, q(en[k]), ''].join(',')); }
  else console.log(`${lang}: ${Object.keys(en).length - 1 - missing.length}/${Object.keys(en).length - 1} translated, ${missing.length} missing (falls back to English)`);
}
