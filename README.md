# HIXOR Care · Ward

The nursing care and medication app for HIXOR Care, built for the ward tablet in Singapore nursing homes.
It covers the AM-shift work of a ward nurse end to end: the medication round, observations and escalation,
assessments and care plans, wounds, notes, alerts, handover and the audit trail.

Demo home: **Harmony Nursing Home (Bukit Panjang)** with two wards. Every demo user's PIN is `1234`.

- **Ward 2B, general nursing**: 12 beds, including a respite stay, a new admission awaiting transcription check,
  a resident in hospital and an overnight fall.
- **Ward 3A, dementia care**: 10 beds, 9 residents, with refused antipsychotics, an overdue antipsychotic review,
  a behaviour incident this morning and a fall ready for the manager to close.

Each tablet works on one ward (chosen on the lock screen). The nurse manager covers both and can switch between them.

## Stack

| Part | Tech |
| --- | --- |
| Frontend | React 19, TypeScript, Vite. Tablet-first, works on phone and desktop, light and dark. |
| Backend | Python 3.12+, FastAPI, SQLAlchemy 2, Alembic |
| Database | PostgreSQL 16 (append-only triggers on the audit log and the e-CD register) |

The frontend talks to one `Api` interface with two implementations:

- **Demo** (default): an in-browser engine (`frontend/src/api/engine.ts`) with the same rules as the server,
  saved in `localStorage`. This is what the single-file demo uses.
- **Server**: the FastAPI backend. Open the app with `?api=server` or build with `VITE_API=server`.

`shared/seed.json` (home, staff and Ward 2B), `shared/seed-3a.json` (Ward 3A) and `shared/assessments.json` (Morse, Braden, MNA-SF, Abbey) are read by both.

## Run it

```bash
# Database (any PostgreSQL 16; the default URL expects port 5433, user hixor)
export DATABASE_URL=postgresql+psycopg://hixor@127.0.0.1:5433/hixor

# Backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
python -m app.seed                       # loads both wards, timed to today
HIXOR_DEMO=1 uvicorn app.main:app --port 8000

# Frontend
cd ../frontend
npm install
npm run dev                              # http://localhost:5173 (demo engine)
                                         # http://localhost:5173/?api=server (FastAPI)
npm run build:demo                       # dist-demo/index.html, one self-contained file
```

Tests: `cd backend && DATABASE_URL=postgresql+psycopg://hixor@127.0.0.1:5433/hixor_test pytest -q`

## Five-minute walkthrough

1. **Unlock** as Aisyah Rahman (RN, nurse in charge), PIN `1234`. The tablet locks itself after 2 minutes idle.
2. **Today** shows the 08:00 round, open alerts, tasks due in the next hour, and *Needs you now*, ranked by urgency.
3. **Med round** → Mdm Tan Siew Lan. Confirm identity (scan wristband), then scan the **Augmentin** decoy pack:
   it is blocked for her penicillin anaphylaxis. Scan the blister pack and give the rest.
4. **Insulin / morphine**: high-alert and controlled drugs need a second nurse's PIN. Controlled drugs write to the
   **electronic CD register** with a running balance, and only an RN may give them.
5. **Mdm Lee Swee Chin** (new admission): her orders were transcribed overnight and must be verified by a
   different RN before the first dose.
6. **Mr Goh**: record obs, NEWS2 rises to 6, and the app drafts an **SBAR** for the doctor that the nurse must review.
7. **Handover**: summaries since shift start, the watch list and care left undone; the incoming nurse signs with a PIN.
8. **Audit**: every action is hash-chained; the chain check shows *Chain intact*.
9. **Incidents**: on Mdm Chua's page, see last night's unwitnessed fall: neuro observations are scheduled for 24 hours,
   and a drop in GCS raises an alert. *Report incident* on any resident covers falls, medication errors, skin tears,
   behaviour, abuse allegations (MOH notification within 72 hours) and missing residents.
10. **Nurse manager**: lock the tablet and sign in as Mary Lim (NM). *Overview* opens with a card for each ward she covers
   (decisions waiting, high alerts, overdue doses, open incidents, staffing, residents with NEWS2 5 or more) and a total
   for the home. Tap a ward to see it in detail: alerts nobody has acknowledged, incidents to review and close, admission
   medicines awaiting verification, the team on shift, controlled drug balances, seven days of medication timeliness,
   patterns to review (repeated refusals, held doses, PRN use, antipsychotic reviews), a clinical risk register for every
   resident, and assessments and care plan reviews that are due. On Ward 3A, Mr Teo's fall is ready to close.

## Safety rules implemented

- Five rights at the bedside: wristband/manual ID with reason, multi-dose blister pack and original pack barcodes, wrong-resident and wrong-time blocks.
- Allergy and drug-class clash blocks (e.g. penicillin → co-amoxiclav, NSAID → ibuprofen).
- Hold parameters before giving: SBP < 100, pulse < 60, CBG < 4.
- Witness (second RN/EN/NM PIN) for high-alert drugs and controlled drugs; RN-only for CDs and injectables.
- PRN minimum interval and 24-hour maximum, with an effect check task.
- Stopped medicines stay in the 28-day blister pack: the round blocks them and asks the nurse to pop out and discard, recorded on the MAR and audit trail.
- Admission transcription double-check before first dose.
- Append-only e-CD register and audit log, enforced in PostgreSQL triggers, not just in the app.
- Deny-by-default role permissions declared per server action (`backend/app/actions.py`).
- NEWS2 (SpO₂ scale 1) with the home's escalation policy and observation frequency.
- Incidents: post-fall neuro observations (every 15 minutes for the first hour, then to 24 hours) when the fall was
  unwitnessed, the head may have been hit, or the resident is on a blood thinner. Only a nurse manager reviews and closes,
  and closing is blocked until family and doctor are told, the post-fall analysis is done, falls risk is reassessed and
  the observations are finished.

## Compared with the systems in use today

Customers run **Leecare Platinum6** (Vanguard Healthcare may be moving to **Tetsuyu**); **iNGOT** is also common.
Those are form-and-menu systems built around the record. HIXOR Care is built around the nurse's shift:

| Ward work | Typical today | HIXOR Care |
| --- | --- | --- |
| Start of shift | Open each resident's chart | *Needs you now* list, ranked |
| Med round | eMAR grid, tick per drug | Resident-by-resident round, blister pack scan, give-all with blocks |
| CD drugs | Paper register or separate screen | Witness PIN on the dose writes the e-CD register |
| Deterioration | Obs form, nurse calculates | Live NEWS2 while typing, SBAR draft |
| Assessments | Forms on a schedule | Due tasks, scoring, care-plan suggestions to sign |
| Handover | Verbal or free text | Generated per resident since shift start, signed by incoming nurse |

## Interfaces

- **AIC referrals via Bright** (Open Government Products): system-to-system. Placeholder at
  `POST /api/integrations/bright/referrals` (returns 501) until the spec is available.

## Layout

```
frontend/   React app (src/views, src/domain rules, src/api demo engine + server client)
backend/    FastAPI app, models, rules, actions, Alembic migrations, tests
shared/     Demo seed data and assessment definitions used by both
```
