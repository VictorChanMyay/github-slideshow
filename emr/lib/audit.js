'use strict';
function log(db, user, action, { patientId = null, detail = null, ip = null } = {}) {
  db.prepare('INSERT INTO audit_log(user_id,username,action,patient_id,detail,ip) VALUES(?,?,?,?,?,?)')
    .run(user ? user.id : null, user ? user.username : null, action, patientId, detail, ip);
}
module.exports = { log };
