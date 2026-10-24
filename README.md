# HIXOR Care · Ward

The nursing care and medication app for HIXOR Care, built for the ward tablet in Singapore nursing homes.
It covers the AM-shift work of a ward nurse end to end: the medication round, observations and escalation,
assessments and care plans, wounds, notes, alerts, handover and the audit trail.

Demo ward: **Ward 2B General, Harmony Nursing Home (Bukit Panjang)**, 12 residents, including a respite stay,
a new admission awaiting transcription check, and a resident in hospital. Every demo user's PIN is `1234`.

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

`shared/seed.json` (demo ward) and `shared/assessments.json` (Morse, Braden, MNA-SF, Abbey) are read by both.

## Run it

```bash
# Database (any PostgreSQL 16; the default URL expects port 5433, user hixor)
export DATABASE_URL=postgresql+psycopg://hixor@127.0.0.1:5433/hixor

# Backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
python -m app.seed                       # loads Ward 2B, timed to today
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
   it is blocked for her penicillin anaphylaxis. Scan the sachet and give the rest.
4. **Insulin / morphine**: high-alert and controlled drugs need a second nurse's PIN. Controlled drugs write to the
   **electronic CD register** with a running balance, and only an RN may give them.
5. **Mdm Lee Swee Chin** (new admission): her orders were transcribed overnight and must be verified by a
   different RN before the first dose.
6. **Mr Goh**: record obs, NEWS2 rises to 6, and the app drafts an **SBAR** for the doctor that the nurse must review.
7. **Handover**: summaries since shift start, the watch list and care left undone; the incoming nurse signs with a PIN.
8. **Audit**: every action is hash-chained; the chain check shows *Chain intact*.

## Safety rules implemented

- Five rights at the bedside: wristband/manual ID with reason, sachet and pack barcodes, wrong-resident and wrong-time blocks.
- Allergy and drug-class clash blocks (e.g. penicillin → co-amoxiclav, NSAID → ibuprofen).
- Hold parameters before giving: SBP < 100, pulse < 60, CBG < 4.
- Witness (second RN/EN/NM PIN) for high-alert drugs and controlled drugs; RN-only for CDs and injectables.
- PRN minimum interval and 24-hour maximum, with an effect check task.
- Admission transcription double-check before first dose.
- Append-only e-CD register and audit log, enforced in PostgreSQL triggers, not just in the app.
- Deny-by-default role permissions declared per server action (`backend/app/actions.py`).
- NEWS2 (SpO₂ scale 1) with the home's escalation policy and observation frequency.

## Compared with the systems in use today

Customers run **Leecare Platinum6** (Vanguard Healthcare may be moving to **Tetsuyu**); **iNGOT** is also common.
Those are form-and-menu systems built around the record. HIXOR Care is built around the nurse's shift:

| Ward work | Typical today | HIXOR Care |
| --- | --- | --- |
| Start of shift | Open each resident's chart | *Needs you now* list, ranked |
| Med round | eMAR grid, tick per drug | Resident-by-resident round, sachet scan, give-all with blocks |
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
