'use strict';
// DRAFT routine schedule in the style of the WHO EPI. The clinic must confirm it against the plan it really follows
// (Thai MOPH, Myanmar EPI or WHO) and edit the table in the admin screen. Times are in days from birth.
const VACCINES = [['BCG', 'BCG'], ['HEPB_B', 'Hepatitis B (birth dose)'], ['OPV', 'Oral polio (OPV)'], ['PENTA', 'Pentavalent (DTP-HepB-Hib)'], ['PCV', 'Pneumococcal (PCV)'],
  ['ROTA', 'Rotavirus'], ['IPV', 'Inactivated polio (IPV)'], ['MR', 'Measles-containing (MR / MMR)']];
// [vaccine, dose_no, due_days, min_age_days, min_interval_days, max_age_days, late_days]
const DOSES = [
  ['BCG', 1, 0, 0, null, 365, 28], ['HEPB_B', 1, 0, 0, null, 7, 28],
  ['OPV', 0, 0, 0, null, 14, 14], ['OPV', 1, 42, 42, null, null, 28], ['OPV', 2, 70, 42, 28, null, 28], ['OPV', 3, 98, 42, 28, null, 28],
  ['PENTA', 1, 42, 42, null, null, 28], ['PENTA', 2, 70, 42, 28, null, 28], ['PENTA', 3, 98, 42, 28, null, 28],
  ['PCV', 1, 42, 42, null, null, 28], ['PCV', 2, 70, 42, 28, null, 28], ['PCV', 3, 98, 42, 28, null, 28],
  ['ROTA', 1, 42, 42, null, 105, 28], ['ROTA', 2, 70, 42, 28, 224, 28],
  ['IPV', 1, 98, 42, null, null, 28],
  ['MR', 1, 270, 270, null, null, 28], ['MR', 2, 540, 270, 28, null, 28],
];
module.exports = { VACCINES, DOSES };
