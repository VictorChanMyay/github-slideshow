# EMR Proposal for Mae Tao Clinic — Research Draft

Status: working draft for discussion. Facts about the clinic come from public web sources (listed at the end) and are marked **[verified]** (stated by a source) or **[to confirm]** (not found, or sources conflict). Anything marked **[to confirm]** must be checked with the clinic before it goes into a final proposal.

---

## 1. Purpose of this proposal

Offer Mae Tao Clinic (MTC) a volunteer, pro bono contribution: design and help build an Electronic Medical Record (EMR) that matches how the clinic really works, instead of copying a hospital system built for a different setting. This is an outside proposal from a community volunteer, **not** an application for the advertised Software Developer post, and no salary or fee is requested. The clinic's own Health Information System (HIS) staff and in-house Tech Team remain the owners and decision makers.

---

## 2. About Mae Tao Clinic

**Who they are**
- Community-based organization in Mae Sot, Tak Province, on the Thai–Myanmar border. Founded by Dr. Cynthia Maung, an ethnic Karen physician who left Burma after the 1988 uprising. **[verified]**
- Opening date differs by source: February 1989 (clinic's own site, per search summary), December 1989 (Taipei Times), 1988 (some reference entries). **[to confirm — ask the clinic which date they use]**
- Started in a dilapidated building with dirt floors on the edge of Mae Sot. **[verified]**
- Mission (from the clinic's job description): provide and advocate for an equitable and essential health system, education and protection for vulnerable and displaced people in the Thai–Burma border area. **[verified, from the posting you shared]**
- Recognition: Sydney Peace Prize 2013 and Gwangju Prize for Human Rights 2022 (Dr. Cynthia). **[verified]**

**What they do** (services mentioned across sources)
- Inpatient and outpatient care for adults and children; major focus on maternal and child health. **[verified]**
- Reproductive health: antenatal care, family planning, deliveries. **[verified]**
- Child health: vaccinations (hepatitis B for infants mentioned). **[verified]**
- Laboratory; HIV counselling and testing; TB case finding and referral; safe blood. **[verified, partly]**
- Referral of serious cases to Mae Sot Hospital; the referral system is still in use. **[verified]**
- Child protection, education, training and community health outreach programs. **[verified]**
- Eye care, dental, blood bank, prosthetics/rehabilitation, surgery as formal departments: listed by some sources, not confirmed by others. **[to confirm]**

**Scale** (older press figures; treat as indicative)
- Roughly 75,000 to 150,000+ patients a year depending on source; about 300 a day; 2,500+ deliveries a year; 10,000+ admissions. **[to confirm — ask for the 2025 Annual Report]**

**Operating reality that shapes the EMR**
- Donor-funded. Reports from around 2017–2019 describe funding cuts, a 20% spending reduction, and fundraising covering only about 30% of costs. Current status **[to confirm]**. Implication: low running cost, low maintenance burden, and strong donor reporting matter more than advanced features.
- Patients are mostly displaced people and migrants, many without Thai ID. Implication: registration cannot depend on a national ID number.
- Records are largely paper today. A university project (the "Digitize" project) has worked with the Reproductive Health Department since June 2019 on automated digitization of paper records, because off-the-shelf EMRs were judged not feasible in this setting. Data is held in a Health Information System (HIS); the software behind it is **[to confirm]**. Implication: learn from that project and integrate with the existing HIS rather than ignore it.

**Logo and branding** **[verified from the job description PDF]**
- The logo is a caduceus: a green staff with two intertwined green serpents, topped by yellow-gold wings, with the words "MAE TAO CLINIC" beneath in dark text. The PDF also uses a faint copy as a page watermark.
- Extracted copy: `emr-prototype/assets/mtc-logo.png` (low resolution, 126x121 px in the PDF). Ask the clinic for the original high-resolution file and brand guidelines before using it in the final proposal.
- Brand colors to use in the EMR theme: green and gold from the logo, with dark text. The prototype still uses a neutral teal theme.

---

## 3. How other EMR systems are built (lessons)

| System | What it is | Useful lesson for MTC |
|---|---|---|
| **OpenMRS** | Open-source, modular medical record platform used in low-resource settings; concept dictionary (shared coded vocabulary for diagnoses, tests, drugs); REST and FHIR APIs; works with intermittent connectivity | Use a coded vocabulary from day one so reports are consistent and data can be shared |
| **Bahmni** | Built on OpenMRS; adds registration, lab, pharmacy, billing, radiology; "Bahmni Lite" for small clinics | Module list is a good checklist; a lite edition shows small clinics need fewer modules done well |
| **OpenEMR** | Open-source, covers clinical plus administrative/financial side; certified in the US | Strong on scheduling and billing, which MTC may need less of |
| **Hikma Health** | Offline-first open-source EHR designed with displaced populations | Closest match to MTC's patient population; study its offline and registration design |
| **DHIS2** | Reporting and dashboard platform used by health ministries, not an EMR | Pair an EMR with DHIS2-style aggregate reporting for donors and health authorities |

Sources note that vendor blogs inflate adoption numbers; check each project's official docs before quoting module lists or deployment counts.

**Build vs adopt (honest options)**
1. **Build in Retool** (what the job post asks for): fastest to prototype, flexible, low coding load. Risks: Retool licensing cost for many users, vendor lock-in, weaker offline support, and you own all clinical logic and security.
2. **Adopt/adapt OpenMRS or Bahmni Lite**: mature clinical model, free licence, FHIR support. Risks: heavier to host and customize, steeper learning curve.
3. **Hybrid**: Retool front-end over a standard database/FHIR layer, so the data can later move to another system.

Recommendation to discuss: option 3, with the data model aligned to OpenMRS/FHIR concepts so MTC is never locked in.

---

## 4. Feature checklist (so nothing important is missed)

Priority: **P1** = needed to go live, **P2** = soon after, **P3** = later.

### A. Patient identity and registration
- P1 Unique patient ID (MRN) not dependent on national ID; optional fields for Thai ID, Myanmar ID, UNHCR/other card, passport
- P1 Name in multiple scripts (Burmese, Karen, English, Thai) and alias/nickname search
- P1 Date of birth with "estimated age" option
- P1 Duplicate detection and record merge
- P1 Address by village/camp/township, contact, next of kin, ethnicity, language, nationality, migration/legal status (sensitive, restricted view)
- P2 Photo and/or fingerprint/QR/barcode card for fast re-identification
- P2 Family/household linking (mother–baby linking is critical for MCH)

### B. Clinical care
- P1 Triage and vital signs (temp, BP, pulse, RR, SpO₂, weight, height, MUAC for children)
- P1 Visit/encounter record (outpatient, inpatient, emergency, antenatal, follow-up)
- P1 Structured notes (SOAP) plus problem list, allergy list, chronic conditions
- P1 Diagnosis coding with ICD-10 (consider ICD-11 later)
- P1 Orders: lab, medication, imaging, referral
- P1 Medication prescribing with dose/frequency/duration and allergy and duplicate-drug alerts
- P2 Growth charts (WHO) and z-scores for children
- P2 Clinical decision support: danger-sign prompts (e.g., IMCI, pregnancy danger signs), abnormal vitals flags
- P2 Standard order sets and templates per department
- P2 Wound/injury documentation with body diagram and photo
- P3 Telemedicine/teleconsult notes, images

### C. Reproductive, maternal and child health (MTC's core strength)
- P1 Antenatal care card: gravida/para, LMP, EDD, visits, risk factors, tetanus, iron/folate, ultrasound
- P1 Delivery/partograph, outcome, newborn details, birth weight, APGAR
- P1 Postnatal and newborn care; family planning register
- P1 Child immunization schedule with due/overdue alerts
- P2 Birth notification support and linkage to birth certificate process **[to confirm local process]**
- P2 Nutrition program (screening, SAM/MAM follow-up)

### D. Infectious disease and special programs
- P1 Malaria RDT/microscopy result capture and case reporting
- P1 TB screening, treatment follow-up, contact tracing
- P1 HIV counselling/testing with strict confidentiality; PMTCT linkage
- P2 Chronic disease follow-up (hypertension, diabetes, asthma) with recall lists
- P2 Outbreak detection (sudden rises by diagnosis/village)

### E. Laboratory, pharmacy, supplies
- P1 Lab orders, specimen labelling, result entry, abnormal flags, reference ranges, results visible to prescriber
- P1 Pharmacy: dispensing against prescription, batch/expiry, stock levels, low-stock and near-expiry alerts
- P2 Blood bank inventory, donor/recipient records
- P2 Consumables and equipment stock, stock-outs, supplier/donor-supplied items
- P3 Laboratory instrument integration

### F. Referrals and continuity
- P1 Referral form out (to Mae Sot Hospital and others) with summary; referral-back tracking
- P1 Printable patient summary/discharge summary in patient's language
- P2 Patient-held record/QR so patients can carry history across providers
- P2 Follow-up scheduling and SMS/phone reminders (consent required)

### G. Inpatient and operations
- P2 Admission, bed management, ward round notes, discharge
- P2 Surgery/procedure log and consent
- P2 Appointment/queue management and waiting-list display
- P3 Rehabilitation and prosthetics case records **[confirm if in scope]**

### H. Protection and sensitive services
- P1 "Break-glass" and restricted access for sensitive records (child protection, gender-based violence, HIV, legal status)
- P2 Link to child protection case management **[confirm how MTC separates this data]**

### I. Reporting and donor needs
- P1 Daily/weekly/monthly statistics: patients by department, age, sex, diagnosis (morbidity), deliveries, immunizations
- P1 CSV/Excel export for donors and partners
- P2 Dashboard for management (trends, workload, stock)
- P2 Donor-specific report templates; indicator definitions kept in one place
- P2 Reporting to Thai health authorities where required **[confirm requirements]**
- P3 DHIS2 integration

### J. Security, privacy, safety
- P1 Individual logins, role-based access, strong passwords
- P1 Audit log of who viewed/changed which record
- P1 Backups (daily, tested restore), encryption at rest and in transit
- P1 Data entry validation (ranges, required fields) and safe edit history; no silent deletion
- P1 Paper downtime procedure for power/internet failure
- P2 Consent capture; data-sharing agreements with partners
- P2 Two-factor sign-in for admins; session timeout
- P3 Penetration test / security review

### K. Usability and rollout
- P1 Interface in the languages staff use (English, Burmese; Karen if needed) and large touch targets
- P1 Works on low-spec computers/tablets and slow connections
- P2 Offline mode with later sync **[Retool is weak here; evaluate]**
- P1 Training materials, quick-reference sheets, super-users per department
- P1 Data migration/digitization plan for existing paper and HIS data
- P2 Feedback button and bug tracking inside the app

### L. Interoperability and standards
- P1 Coded vocabularies: ICD-10 for diagnoses; a drug list aligned to the clinic formulary
- P2 LOINC for lab tests; SNOMED CT or OpenMRS concept dictionary if adopting OpenMRS
- P2 HL7 FHIR export so the data is portable
- P3 Link with Mae Sot Hospital and partner systems

---

## 5. Compliance and ethics

- **Thailand PDPA**: health data is *sensitive personal data* and needs stronger protection; explicit consent or another valid legal basis, and breach notification to the regulator within 72 hours unless low risk. Secondary sources agree on the 72-hour rule; sources differ on how strict consent must be for treatment. **[Have a lawyer or the clinic's data protection officer confirm.]**
- **Displaced and undocumented patients**: legal status and ethnicity data can cause harm if exposed. Collect only what is needed, restrict access, and decide in advance who may share data and with whom.
- **Data ownership**: agree in writing who owns the data, where it is hosted (country), and what happens if the project ends or the developer leaves.
- **Donor and partner data requests**: share de-identified or aggregate data by default.

---

## 6. Suggested roadmap

1. **Weeks 0–4, discovery**: shadow each department; map paper forms and the existing HIS; collect the official logo, formulary, lab list and donor indicator definitions; agree scope with Health Services leadership.
2. **Weeks 4–12, pilot (P1 features)**: registration, outpatient encounter, lab, pharmacy, referral, basic reports, audit log. Pilot in one or two departments (outpatient + reproductive health).
3. **Months 3–6**: add MCH, immunization, TB/HIV/malaria modules, stock management, training, paper-downtime procedure.
4. **Months 6–12**: inpatient, dashboards, donor reports, FHIR/DHIS2 integration, security review.
5. **Ongoing**: documentation, user training, backups and restore drills, yearly review.

**Success measures**: percentage of visits recorded electronically, time to register a returning patient, report preparation time, user satisfaction, number of data errors found in audit.

---

## 6b. Volunteer engagement terms (to agree in writing before any work)

A volunteer offer still needs clear terms so it helps the clinic and does not become a risk to it.

- **Written agreement (MoU or volunteer agreement)** covering scope, duration, who the volunteer reports to, and that either side can end it with notice.
- **Ownership**: the clinic owns the system, data and documentation. Code goes in a repository the clinic controls, with an open-source or clinic-owned licence.
- **Confidentiality and data access**: sign a confidentiality agreement; use fake data during design; any access to real patient data only after the clinic's data-protection approval, with the least access needed, and on clinic-controlled devices or servers.
- **Continuity**: a volunteer can leave. Write documentation as you go, train at least two clinic staff to maintain it, and avoid tools that only the volunteer can run.
- **Low running cost**: prefer free or open-source tools. Do not commit the clinic to paid licences (for example Retool seats) unless the clinic agrees and can fund them after the pilot.
- **No pressure to adopt**: the pilot is a trial; the clinic can stop or change direction at any point.
- **Legal status of volunteering in Thailand**: check whether unpaid work for the clinic needs any permit or approval for the volunteer's nationality or visa, and whether remote volunteering from outside Thailand avoids this. **[to confirm with the clinic and an adviser; not legal advice]**
- **Liability and clinical safety**: an EMR can affect patient care. Agree that the clinic's clinicians validate all forms, drug lists, alerts and calculations, and that paper fallback exists.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Staff overload or low computer familiarity | Simple screens, short training, super-users, phased rollout |
| Power/internet outages | Local server or offline mode, paper downtime forms |
| Single-volunteer dependency (volunteer may become unavailable) | Documentation, code in the clinic's own repository, two trained clinic staff, handover plan |
| Retool cost and lock-in | Standard database and FHIR-aligned model; confirm licence cost early |
| Funding shortfall | Phase delivery; prefer open-source components; low hosting cost |
| Data breach affecting vulnerable patients | Role-based access, encryption, audit, PDPA process |

---

## 8. Questions to ask the clinic

1. Which departments exist today, and which go first?
2. What software does the current HIS use, and who maintains it?
3. What did the Digitize project deliver, and is it still in use?
4. Who are the funders and what indicators must be reported?
5. How reliable are power and internet in each building?
6. What devices do staff have? Which languages do they work in?
7. What ID types do patients carry, and how are patients without ID registered today?
8. Who decides data-sharing policy? Is there a data protection officer?
9. What is the budget for licences, hosting and training?
10. Can we get the official logo, brand colours and the 2025 Annual Report?

---

## 9. Sources used (secondary; verify before quoting)

- Wikipedia: Mae Tao Clinic — https://en.wikipedia.org/wiki/Mae_Tao_Clinic (surfaced in search; page itself could not be opened here)
- Mae Tao Clinic website — https://maetaoclinic.org/ (surfaced in search; could not be opened here)
- Digitize Project (paper-record digitization at MTC) — https://sdrp.github.io/digitize-mtc/ (search summary only)
- Funding coverage: DVB https://english.dvb.no/funding-crisis-causes-cuts-mae-tao-clinic/ ; The Irrawaddy https://www.irrawaddy.com/news/burma/funding-cuts-threaten-mae-tao-clinic.html ; BNI https://www.bnionline.net/en/news/mae-tao-clinic-facing-funding-shortages-border-aid-dries
- The World / PRI feature — https://theworld.org/stories/2020/01/15/thai-clinic-struggles-serve-migrants-and-refugees-myanmar
- EMR platform overviews: https://techmagic.co/blog/open-source-emr ; https://synodus.com/blog/healthcare/free-hospital-information-system-open-source/ ; Bahmni https://bahmni.atlassian.net/wiki/x/KIDg
- Displaced-population EHR research (Hikma Health) — https://www.frontiersin.org/articles/10.3389/fdgth.2022.847002/pdf
- Thailand PDPA overviews: https://securiti.ai/thailand-personal-data-protection-act-pdpa ; https://www.tilleke.com/insights/thailand-pdpc-notification-on-data-breaches/2/
