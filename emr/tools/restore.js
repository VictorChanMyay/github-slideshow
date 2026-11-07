#!/usr/bin/env node
'use strict';
// Usage: node tools/restore.js <backup-file> [--db=data/emr.db] [--check-only] [--yes] [--passphrase-env=EMR_BACKUP_PASSPHRASE]
// STOP THE SERVER FIRST. The current database is kept as emr.db.before-restore-<time>; nothing is deleted.
const path = require('node:path');
const b = require('../lib/backup');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const src = process.argv.slice(2).find((x) => !x.startsWith('--'));
if (!src) { console.error('Usage: node tools/restore.js <backup-file> [--check-only] [--yes]'); process.exit(2); }
const target = path.resolve(arg('db', process.env.EMR_DB || path.join(__dirname, '..', 'data', 'emr.db')));
const pass = process.env[arg('passphrase-env', 'EMR_BACKUP_PASSPHRASE')] || undefined;
try {
  const v = b.verify(path.resolve(src), { passphrase: pass });
  console.log(`Backup check: ${v.ok ? 'GOOD' : 'BAD'} (integrity ${v.integrity}, checksum ${v.checksum}, schema ${v.schema_version}, ${v.counts ? v.counts.patients + ' patients, ' + v.counts.encounters + ' visits' : ''})`);
  if (!v.ok) process.exit(1);
  if (process.argv.includes('--check-only')) process.exit(0);
  if (!process.argv.includes('--yes')) { console.log(`\nThis would replace ${target} with the backup. Make sure the server is stopped, then run again with --yes.`); process.exit(0); }
  const r = b.restore(path.resolve(src), target, { passphrase: pass });
  console.log(`Restored. Previous database kept as: ${r.previous_kept_as || '(there was none)'}\nStart the server again. Check recent records before using it.`);
} catch (e) { console.error('RESTORE FAILED: ' + e.message); process.exit(1); }
