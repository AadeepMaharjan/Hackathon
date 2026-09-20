# Meridian Triage — Hospital Resource Allocation App

A full-stack demo: React + Vite frontend and an Express backend,
persisting to `db.json`, implementing disease-based triage and
priority-driven resource allocation with automatic transfer of
lower-priority patients when a red (critical) patient needs a bed.

## What it does

1. **Intake**: enter a patient's name, age, phone, and problem/condition.
2. **Auto triage**: the problem text is checked against a red / yellow /
   green reference table (`backend/diseaseMap.js`) and a priority is
   suggested automatically. A clinician can override it with one click.
3. **Allocation**: on submit, the backend checks live resource counts
   (beds, ICU beds, operating rooms, doctors, nurses, emergency vehicles).
   - Red patients need an ICU bed + doctor + nurse.
   - Yellow patients need a bed + doctor.
   - Green patients need a bed.
4. **Priority bumping**: if a **red** patient arrives and there isn't
   capacity, the system automatically frees resources by transferring out
   the lowest-priority admitted patients (green first, then yellow, oldest
   arrival first) to the nearest suitable nearby hospital, logs the
   transfer, then admits the red patient.
5. Everything — resource counts, the patient list, and the transfer log —
   is persisted in `backend/db.json`.

## Note on the disease → urgency mapping

The brief asked for this to be looked up "from Google and different
resources." This environment has no live network access, so
`backend/diseaseMap.js` ships a static reference table modeled on the
standard Emergency Severity Index (ESI) conventions hospitals use, with
keyword matching. If you want a live lookup instead, swap the
`lookupUrgency()` function for a call to a real clinical API or search
service (you'll need your own API key).

## Running it locally

From the project root, install dependencies once and start both services:

```bash
npm install
npm run dev
```

This starts the API on `http://localhost:4000`, starts Vite, and opens the
frontend automatically in your default browser. Vite proxies `/api` requests
to the backend, so no frontend API URL needs to be changed for local use.

## Project structure

```
hospital-triage/
├── backend/
│   ├── db.json          # the "database" — resources, patients, transfer log, nearby hospitals
│   ├── diseaseMap.js     # red/yellow/green reference table + lookup
│   ├── server.js         # Express API + allocation/bump logic
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/          # backend request functions
│   │   ├── components/   # reusable UI components
│   │   ├── constants/    # UI labels and triage metadata
│   │   ├── routes/       # Intake and Dashboard screens
│   │   ├── App.jsx       # application state and screen selection
│   │   └── styles.css    # application styles
│   ├── vite.config.js    # Vite dev server, API proxy, browser opening
│   └── package.json
├── package.json          # root workspace scripts
└── README.md
```

## API reference

| Method | Route                    | Purpose                                            |
|--------|---------------------------|-----------------------------------------------------|
| GET    | `/api/resources`          | Current resource totals/availability                |
| GET    | `/api/patients`            | All patients, with status and urgency                |
| GET    | `/api/transfers`           | Log of patients bumped to another hospital           |
| POST   | `/api/lookup-urgency`      | `{ problem }` → suggested urgency (used for the live preview) |
| POST   | `/api/patients`            | `{ name, age, phone, problem, urgencyOverride? }` → registers and allocates a patient |

## Extending it

- Add authentication for the "login" step (the brief called it a login
  page; here it's the intake form — wire in a real auth layer if you need
  staff accounts).
- Replace the static triage table with a live medical API.
- Add a map/geocoding call to pick the nearest hospital by real distance
  instead of the static `nearbyHospitals` list in `db.json`.
