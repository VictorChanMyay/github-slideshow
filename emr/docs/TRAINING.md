# Training plan and slide outline

Aim: staff can do their own daily tasks safely after short sessions on the demo system. Use **fake data only**. Keep sessions short (45 to 60 minutes), hands-on, in the language people are comfortable with (the Burmese and Karen screens need native-speaker review first).

## Who, what, how long

| Session | Who | Content | Practice task |
|---|---|---|---|
| 0. Overview (30 min) | everyone | Why an EMR, privacy rules, the three promises (see below), how to sign in | Sign in, change the password, find a demo patient |
| 1. Front desk (45 min) | registration clerks | Register, duplicates, estimated age, IDs, consent for phone, check-in, urgent flag | Register 3 fake patients, one a duplicate on purpose |
| 2. Triage and consultation (60 min) | nurses, doctors, medics | Vitals and alerts, SOAP, diagnoses, allergies, sign and addendum | Run one visit from check-in to signature |
| 3. Orders (45 min) | doctors, lab, pharmacy | Lab order to result; prescribing with allergy warning; dispensing, stock, expiry | Order, result, prescribe, dispense one patient |
| 4. Mothers and children (60 min) | midwives, doctors, nurses | Antenatal booking and alerts, delivery and babies, postnatal, family planning, immunization, growth charts | Book a pregnancy, record delivery of twins, vaccinate a baby |
| 5. Programmes and wards (60 min) | programme officers, doctors, nurses | TB/malaria/malnutrition/chronic enrolment and follow-up, referral, admission, discharge, procedures, blood bank | Enrol, refer, admit, discharge |
| 6. Reports and records (45 min) | records officers, programme officers, leaders | Dashboard, reports, definitions, donor templates, export, small-number rule | Produce the monthly report and export it |
| 7. Administrators (90 min) | IT / admin | Users, backups, restore drill, updating, audit log | Create a user, run a backup, restore on a spare computer |

Add a **super-user** for each department: one person who does the sessions first and helps colleagues for the first month. Floor-walking beats classrooms.

## The three promises (say these in session 0)
1. **Look only at records you need for your work.** Every opening is logged and reviewed.
2. **Your account is yours.** Never share a password; sign out when you leave.
3. **We never delete; we correct.** Mistakes are voided or added to with a reason, so the history stays honest.

## Slide outline (about 20 slides, ready to paste into a deck)
1. Title: Clinic EMR, a volunteer prototype (demo data only)
2. Why: lost or duplicate records, slow reports, continuity of care
3. What it does today: one slide with the 9 areas (registry, outpatient, lab and pharmacy, mother and child, children, programmes, referrals and appointments, wards and blood bank, reports)
4. How a patient moves through the clinic (diagram: register, queue, triage, consult, lab, pharmacy, follow-up)
5. Your role, your screens (table of roles)
6. Privacy: restricted records, HIV invisible without permission, sensitive results hidden, consent for phone numbers
7. The audit log: what is recorded, what never is
8. Registering a patient well (duplicates, estimated age, alternate-script names)
9. Triage and alerts (draft rules, clinical judgement first)
10. The visit: SOAP, diagnoses, signing, addenda
11. Safety checks: allergies, duplicate medicines, no dose calculation
12. Lab and pharmacy: result flags, FEFO stock, expiry
13. Mothers: antenatal alerts, delivery, babies linked to mothers
14. Children: immunization due and overdue, growth z-scores
15. Programmes and follow-up lists
16. Referrals and take-home summaries
17. Wards, procedures, blood bank
18. Reports and the "<5" rule
19. If something goes wrong: paper fallback, who to call, backups
20. Practice time, and how to give feedback

## Quick reference card (print, one page)
- Sign in. Wrong password five times locks you for 15 minutes.
- Idle for 60 minutes signs you out.
- Search by name, MRN, phone or ID. Check name, age, village.
- Duplicate? Open the existing record.
- Restricted record: type a real reason.
- Signed visit locked: add an addendum.
- Mistake: void with a reason; nothing is deleted.
- Cannot see something? Your role does not include it. Ask your supervisor.
- System down: use the paper forms; enter later with the true date and note "entered late".
- Report a problem to: ______ (clinic fills in).

## Feedback loop
After each session ask three questions: what was confusing, what is missing, what would you hate to lose from the paper process? Write the answers in `emr-prototype/DISCOVERY_QUESTIONS.md` style notes (who said it, when) and review monthly with the clinic's project owner.

## Offline paper fallback (to agree with the clinic)
Printed registration form, triage sheet, visit sheet; keep a numbered stack at each desk. After an outage, enter visits with their real dates. Do not back-fill vital signs you did not take.
