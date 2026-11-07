'use strict';
const enc = require('./encounters');
const lab = require('./lab');
const pharm = require('./pharmacy');
const { can } = require('./permissions');

// A visit with its orders. Sensitive lab results are hidden from roles without permission.
function getVisit(db, user, id) {
  return {
    ...enc.getEncounter(db, id),
    lab_orders: can(user.role, 'lab.read') ? lab.forEncounter(db, user, id) : [],
    prescriptions: can(user.role, 'rx.read') ? pharm.forEncounter(db, id) : [],
  };
}
module.exports = { getVisit };
