'use strict';
// DRAFT placeholders. The clinic replaces them with its real wards, beds and procedure list (the admin screen edits them).
const WARDS = [['Adult ward', 'general', ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']], ['Maternity', 'maternity', ['M1', 'M2', 'M3', 'M4']], ['Children', 'paediatric', ['C1', 'C2', 'C3', 'C4']], ['Isolation', 'isolation', ['I1', 'I2']]];
// [code, name, surgical (needs the WHO safety checklist), needs_consent]
const PROCEDURES = [['WOUND_CARE', 'Wound cleaning and dressing', 0, 1], ['SUTURE', 'Suturing of a wound', 0, 1], ['INCISION_DRAIN', 'Incision and drainage of an abscess', 0, 1], ['SPLINT', 'Splinting or casting', 0, 1], ['IV_ACCESS', 'Intravenous cannulation', 0, 0],
  ['LUMBAR_PUNCTURE', 'Lumbar puncture', 0, 1], ['TRANSFUSION', 'Blood transfusion', 0, 1], ['MINOR_SURGERY', 'Minor surgery', 1, 1], ['MAJOR_SURGERY', 'Major surgery', 1, 1], ['CAESAREAN', 'Caesarean section', 1, 1], ['EVAC_UTERUS', 'Evacuation of the uterus', 1, 1], ['CHEST_DRAIN', 'Chest drain insertion', 1, 1], ['OTHER', 'Other procedure', 0, 1]];
module.exports = { WARDS, PROCEDURES };
