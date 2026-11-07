# Demo script (about 20 minutes, plus questions)

**Goal of the meeting:** not to sell a finished product, but to show that the work is serious, listen, and agree a next step. Say clearly at the start: *this is a volunteer prototype with fake data only; nothing here is for real patients yet.*

## Before you go
- Charge the laptop. Check `node --version` (22.13 or newer). Close other programs.
- Start fresh: delete `data/emr.db`, then run `start-demo.bat` (or `./start-demo.sh`). Open http://localhost:3000.
- Open **two browser windows** (one normal, one private window) so you can show two roles at once without signing out.
- Have the phone hotspot ready; the demo needs **no internet**.
- Bring: printed one-page summary, `docs/HANDOVER.md` (print sections 2 and 3), the first-meeting questions (`emr-prototype/DISCOVERY_QUESTIONS.md`).
- Password for all demo users is printed in the terminal when the server starts.
- Rehearse once at home. If anything breaks live, say so calmly, and switch to the screenshots you took beforehand.

## Opening (2 minutes)
1. Who you are, why you are here (volunteer, no fee, not applying for a job, wants to give something back to the community the clinic serves).
2. What you are asking for today: feedback, and a decision on whether to continue.
3. Three promises: fake data only; the clinic owns what is made; nothing goes live without clinicians, privacy review and written agreement.

## The walk-through (14 minutes)
Use one story: **a mother and her small child come to the clinic.**

| Min | Role (sign in as) | Show | Point to make |
|---|---|---|---|
| 2 | Registration (`reg1`) | Register a fake patient with a Burmese-script name and an estimated age; show the duplicate warning; check her in on the queue | Works for people without documents and with names in other scripts |
| 2 | Nurse (`nurse1`) | Triage: enter vital signs, show an abnormal alert | Alerts support, never replace, nurse judgement; rules are drafts the clinic will set |
| 3 | Doctor (`doctor1`) | Open the visit: notes, diagnosis, order a lab test, prescribe (show the allergy warning), sign. Then show that a signed visit is locked and can only get an addendum | Safety checks and honest history |
| 1 | Lab (`lab1`), Pharmacy (`pharm1`) | Enter the result (flagged); dispense (stock goes down, oldest expiry first) | The whole loop in one system |
| 2 | Midwife (`midwife1`) | Pregnancy record, due date, an antenatal alert, delivery with a baby who gets a linked record | Mother and baby connected |
| 1 | Child health | Immunization due/overdue list and a growth chart | WHO growth standards |
| 1 | Privacy (second window) | Open a restricted patient: it asks for a reason. As a role without permission, show that sensitive results and HIV programme records are not visible | Privacy by design, not by trust |
| 2 | Records officer (`his1`) | Dashboard, then Reports: set dates, show a morbidity report with definitions, download Excel; point at a "<5" cell | Donor reports in minutes; small numbers protected |

If time is short, drop child health and the lab/pharmacy step.

## What to say about limits (1 minute, do not skip)
- Not security-audited; needs HTTPS and disk encryption before real data (`docs/SECURITY_REVIEW.md`).
- All clinical rules are drafts that need their clinicians.
- Burmese is partial, Karen not started: reviewers from the clinic needed.
- Single volunteer: the clinic's Tech Team should review the code and share ownership.

## Ask (3 minutes)
Use the **first-meeting questions** (12 in `DISCOVERY_QUESTIONS.md`). If time allows only these:
1. What problem should an EMR solve first?
2. Who on your side owns this, and who is the Tech Team contact?
3. What system do you use now (HIS), and what did the Digitize project leave?
4. Which donor reports matter most? Can I see one blank template?
5. Who decides privacy and data-sharing rules?
6. Can we sign a short volunteer agreement (who owns the code, confidentiality, no real data until approved)?

## Close
- Agree one next step with a date (for example: two staff test on fake data for two weeks; one clinician reviews the maternal alerts).
- Say what you will send within a week: notes from the meeting for them to correct, the handover document, and the demo link or a copy on a USB drive.
- Write down who said what, and the date.

## If someone asks...
- **"Is it free?"** Yes, volunteer work. Running costs are a computer and someone to look after backups; the program has no licence fees.
- **"Can it replace our system?"** Not now. It is a prototype to learn what you need.
- **"Is the data safe?"** With fake data, nothing to protect. For real data, the go-live gate in the security review must be completed first, with an independent check.
- **"Does it need internet?"** No. It runs on a computer in the clinic; staff use browsers on the local network (HTTPS to be set up).
- **"What if you leave?"** No dependencies, full documentation, tests, and the Tech Team can take over; that is why a Tech Team review matters.
- **"Can you import our old records?"** Not yet; needs the formats and the clinic's approval.
