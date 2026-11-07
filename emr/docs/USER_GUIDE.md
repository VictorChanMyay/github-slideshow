# User guide (staff)

**Demo only: do not enter real patients.** Sign in with your own username. After the first sign-in you choose a new password. You are signed out after 60 minutes of no activity. Choose English, Burmese or Karen at the sign-in screen (Karen currently shows English until translated).

What you see depends on your role. If a button or menu is missing, your role is not meant to do that step.

## Everyone
- **Search a patient:** Patients, then type a name, MRN (the clinic number), phone or ID number. Always check name, age and village before you open a record. If you find a likely duplicate while registering, **open the existing record instead**.
- **Restricted record:** the system asks why you need it. Type a real reason. Your access lasts 60 minutes and is logged.
- **Never share your password or leave a patient open on a screen you walk away from.**
- **A mistake in a signed visit** cannot be edited. Add an addendum (a dated correction). Wrong entries elsewhere are voided with a reason, never deleted.

## Registration clerk
1. Patients, Register: name (and alternate-script names), sex, date of birth (or estimated age, tick "estimated"), village, ID document if any, phone and consent to be contacted.
2. Check for duplicates before saving.
3. Check the patient in on **Today's queue** with the visit type; tick **urgent** for emergencies.
You do not see clinical information.

## Nurse
- **Queue → Triage:** enter vital signs. Impossible values are rejected; abnormal values raise an alert (draft rules; use your judgement and protocol). MUAC for children.
- Collect lab specimens (mark collected), record ward observations and notes, record transfusions and any reaction, see the dashboard.

## Doctor / medic and midwife
- **Visit:** chief complaint, SOAP notes, diagnoses (ICD-10; one main diagnosis), order tests, prescribe, then **Sign**. Signing locks the visit.
- Allergies and the problem list show as a banner on every visit. Allergy warnings on prescribing need a typed reason to override.
- The system never calculates doses: type dose, frequency, duration, quantity.
- **Referrals:** with the patient's consent (emergency exception needs a reason). **Take-home visit summary** can be printed.
- **Midwife/doctor, maternal and child:** pregnancy booking, antenatal visits (alerts), labour observations, delivery with up to 4 babies (each baby gets a record linked to the mother), postnatal and family planning. Child health: immunization due/overdue and growth charts.
- **Programmes:** TB, malaria, malnutrition, chronic disease, and HIV where you have permission. Follow-up lists show who is overdue.
- **Inpatient:** admit to a bed, ward notes, observations, discharge summary (a "died" outcome needs a cause), procedures with the WHO safety checklist for surgery, blood requests.

## Lab technician
Laboratory: worklist → collected → enter results. Numeric results are flagged normal/abnormal/critical. Changing a result needs a reason and keeps the old value. Sensitive results (HIV, hepatitis B, syphilis) are only visible to permitted roles.
Blood bank: record donor screening tests; a unit stays in quarantine until all five tests are negative.

## Pharmacist
Pharmacy worklist: dispense prescriptions. Stock is taken from the batch that expires first; expired stock is never dispensed. Stock screen: receive, adjust, write off (reason required), low-stock and expiry alerts.

## Records officer (HIS) and programme officer
- **Dashboard:** counts only, no names.
- **Reports:** choose a report or donor template, set the dates (or This month, Last month, Last 3 months, Year to date), **Show report**, then **Download CSV** or **Download Excel**. Each number has a definition. Numbers of 1 to 4 for sensitive indicators show as "<5" by design.
- Follow-up list: who is overdue (only what your role may see).

## Administrator
Users screen (create, reset password, deactivate, unlock), audit log. See the Administrator guide.

## Common questions
- *I cannot find a menu item.* Your role does not include it.
- *The screen says Not signed in.* You were idle over 60 minutes or someone reset your password. Sign in again.
- *A baby has no record.* Stillbirths are recorded without a patient record; live babies get one automatically at delivery.
- *Can I delete a patient or visit?* No. Ask a clinician to void it with a reason.
