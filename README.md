# CAT Monitor

An adaptive personal planning system for CAT 2026. Local-first, offline-capable, no account, no server.

This is not a timetable generator, a habit tracker, or a productivity app. It exists to answer one question, continuously:

> **Given everything that has actually happened, what is the highest-value realistic thing I should do next?**

It optimises for exam readiness — mock performance, section balance, error reduction, question selection — not for making a schedule look full. Hours are an input. Percentile is the outcome.

---

## Contents

- [What it does](#what-it-does)
- [Product principles](#product-principles)
- [Architecture](#architecture)
- [How the adaptive planning engine works](#how-the-adaptive-planning-engine-works)
- [How the CAT tracker works](#how-the-cat-tracker-works)
- [How weekly recalculation works](#how-weekly-recalculation-works)
- [Local development](#local-development)
- [Deploying to GitHub Pages](#deploying-to-github-pages)
- [Installing as a PWA](#installing-as-a-pwa)
- [Syncing between devices](#syncing-between-devices)
- [Backup, export and reset](#backup-export-and-reset)
- [Configuration: changing topics, sections and targets](#configuration-changing-topics-sections-and-targets)
- [Testing](#testing)
- [Known limits and future work](#known-limits-and-future-work)

---

## What it does

| Area | Behaviour |
| --- | --- |
| **Onboarding** | Collects goal, exam date, commitments, realistic availability, energy profile and any existing mock data before generating anything. |
| **Feasibility engine** | Reports `ON TRACK` / `AT RISK` / `BEHIND` / `INSUFFICIENT DATA` with the evidence behind it. Never a fabricated probability. |
| **Capacity model** | `base × energy × commitments × learned realism`, then 20–30% buffer held back. Every factor is shown and configurable. |
| **Weekly planning** | 3–5 outcomes and a small number of specific, startable tasks that fit inside planned capacity. |
| **Daily planning** | 1–2 must-do, 1–2 should-do, 1 optional, plus visible unallocated buffer. No hourly timetable. |
| **Missed-task algorithm** | Every miss gets a fresh decision: reschedule, shorten, combine, postpone, delegate, replace or remove. Nothing carries forward automatically. |
| **Behaviour learning** | Rolling averages on estimate-vs-actual, time-of-day completion rates, postponement patterns and weekly capacity drift. |
| **CAT tracking** | VARC / DILR / QA with topic-level accuracy, DILR set-level tracking and miss reasons, and a classified error log. |
| **Mock Centre** | A mock is incomplete until it is analysed. Analysis debt throttles the mock cadence. |
| **Weekly review** | Seven questions in, a full recalculation and next week's plan out. |
| **Analytics** | Plan vs reality, mock trends, completion rates, estimate drift, topic accuracy, error distribution, DILR volume. |
| **Decision log** | Every automatic change is recorded with its reason, and every one can be overridden. |
| **Device sync** | Optional. Keeps phone and computer in step through one secret gist in your own GitHub account. Per-record merge, so simultaneous edits on both devices do not overwrite each other. |

---

## Product principles

These are enforced in code, not just documentation:

1. **Results over activity.** Priority weighs expected impact, weakness and value density — not task count.
2. **The plan adapts.** It is rebuilt from actual data, not patched.
3. **Buffer is protected.** Planning uses ~70–80% of realistic capacity. Buffer is never allocated.
4. **No task debt.** Missed work is judged, not stacked onto tomorrow. The system will say "this is no longer worth carrying forward."
5. **No fake certainty.** Qualitative labels with stated evidence, never "87.32% chance of 96 percentile."
6. **Diagnose the system, not the user.** The copy says "your original estimate was inaccurate", never "you failed to follow your plan."
7. **The user can always override.** Keep, move, protect, remove, ignore — all available on every task.

---

## Architecture

```
src/
  config/catConfig.ts      Sections, topic seeds, planning parameters, labels.
                           The only place CAT specifics are defined.
  domain/
    types.ts               Typed entities: Task, Goal, WeekPlan, Mock, ErrorEntry…
    date.ts                Local-calendar ISO date maths (never UTC-shifted).
    ids.ts                 Stable id generation.
  engine/                  Pure, testable planning logic. No React, no storage.
    derive.ts              Read-models: accuracy, coverage, weakness, trends.
    capacity.ts            Capacity model + learned realism factor.
    estimation.ts          Duration learning (EWMA with a sample gate).
    patterns.ts            Behaviour patterns and their interventions.
    priority.ts            Task priority + the Today plan.
    readiness.ts           Section readiness, trajectory, mock cadence.
    workload.ts            Remaining workload, safety check, feasibility.
    generateWeek.ts        Candidate generation, selection and day placement.
    rebalance.ts           Fitting committed work into real capacity.
    missedTask.ts          The nine-step missed-task decision.
    conflicts.ts           Time / energy / deadline / goal / capacity conflicts.
    monthly.ts             Dynamic monthly strategy and milestones.
    weeklyReview.ts        Review output + capacity-reality assessment.
    insights.ts            Plain-language statements of what changed and why.
  data/                    Persistence boundary.
    db.ts                  IndexedDB key-value store, localStorage fallback.
    repository.ts          StateRepository interface + local implementation.
    migrate.ts             Forward-only migration of stored state.
    defaultState.ts        Seed profile, settings, goals and topics.
    sync/
      merge.ts             Per-record merge with deletion tombstones (pure).
      gistClient.ts        GitHub Gist API wrapper.
      syncService.ts       Connect, pull, merge, push orchestration.
  state/
    store.tsx              Reducer + context + debounced persistence.
    useSync.ts             Background sync loop (debounced push, foreground pull).
    useEngine.ts           Single memoised entry point for derived values.
  ui/
    components/            Card, StatusPill, Stat, CapacityMeter, Modal, TaskCard…
    charts/                Hand-rolled SVG charts (no charting library).
    layout/Shell.tsx       Hash router, sidebar (desktop), bottom nav (mobile).
  pages/                   Home, Today, Week, Goals, CAT, Mocks, Errors,
                           Review, Analytics, Settings, Onboarding.
```

**Separation is strict.** The engine is pure functions of `AppState` and a date — no clock reads, no storage, no React. That is what makes the planner testable, and it is why the test suite can simulate eight weeks of behaviour in milliseconds.

**Stack:** React 18, TypeScript (strict), Vite 5, Vitest. No state library, no router, no chart library, no UI framework. Total production bundle: ~110 KB gzipped, most of which is React.

---

## How the adaptive planning engine works

### 1. Capacity

```
base available time (weekday/weekend "normal" hours)
  × energy factor          (1 → 0.5 … 5 → 1.2, from profile or a logged day)
  × commitment factor      (travel, exams, one-off events)
  × realism factor         (median of focused-vs-available across logged days)
= realistic available time
  − buffer (20–30%)
= planned capacity
```

Routine recurring college/work hours are treated as already netted out of your stated availability — otherwise "3 hours on a weekday" minus "5 hours of lectures" would give zero. Every commitment can be flipped either way.

The realism factor needs at least four logged days before it moves, and is blended towards 1 so it converges instead of oscillating.

### 2. Candidate generation

Each week, work is generated from current evidence, in this order of value:

1. Mock analysis backlog (the highest-value work in the system)
2. Baseline mock, if none exists
3. Mocks on the derived cadence, with a paired analysis task the following day
4. Sectionals, weighted towards the weakest sections
5. Error review, once enough logged errors are due
6. Weak-topic remediation, driven by measured accuracy
7. Coverage of high-weight topics not yet built (de-emphasised as the exam nears)
8. Standing RC and DILR volume
9. Revision of covered ground (weighted up near the exam)
10. Exam strategy, once there is mock evidence to work from
11. The weekly review itself

### 3. Selection and placement

Candidates are sorted **by value first, density second** — otherwise a stack of cheap 15-minute tasks crowds out the mock the whole plan depends on. They are then selected greedily until planned capacity is reached, and placed on days that can host them: energy fit, remaining day capacity, a per-day task cap, dependencies after their prerequisites, and mocks preferring high-energy weekend days.

Anything valuable that does not fit stays in the backlog with a logged reason. It is not forced into an overloaded day.

### 4. Priority

`calculateTaskPriority` combines nine components: goal priority, importance, deadline urgency, dependency count, section weakness, exam relevance, staleness, energy fit, and value density. A 20-minute high-value task can and does outrank a 2-hour low-value one — this is asserted in the tests.

### 5. Missed tasks

`handleMissedTask` runs the nine steps and returns exactly one decision:

| Situation | Decision |
| --- | --- |
| Optional and low-impact, week under pressure | **REMOVE** |
| Genuinely blocks downstream work, or deadline ≤ 2 days | **RESCHEDULE** (or SHORTEN if nothing fits) |
| Postponed 3+ times, still P1 | **REPLACE** with a smaller, startable version |
| Postponed 3+ times, not P1 | **REMOVE** |
| Non-CAT overhead in a full week | **DELEGATE** |
| An equivalent session already scheduled | **COMBINE** |
| Over capacity, critical | **SHORTEN** |
| Over capacity, not critical | **POSTPONE** to backlog |
| Room exists | **RESCHEDULE** |

Every decision carries the remaining workload, the available capacity and a verdict (`manageable` / `tight` / `over capacity`), and every one can be overridden in the UI.

### 6. Behaviour learning

- **Duration drift** — EWMA over completed tasks, minimum 3 samples, damped to half the observed drift, clamped to [0.6, 1.8]. Estimates move gradually, never on one observation.
- **Time-of-day failure** — needs ≥ 6 attempts in the weak window and a ≥ 25-point gap against the best window before deep work is moved. The recommendation is to move the work, never to "wake up earlier".
- **Repeated postponement** — grouped by type and section, then diagnosed: too large, too demanding for the slot it keeps landing in, mostly optional, or too vague. Each gets a different intervention.
- **Capacity drift** — four-week completion ratios decide whether planned volume goes down (reality is lower) or up (estimates were conservative).

---

## How the CAT tracker works

**Sections.** VARC, DILR and QA each get a readiness score (0–100) blending latest sectional percentile, practice accuracy, weighted topic coverage, error recurrence and logged volume — so the score means something before any mock exists.

**Topics.** ~40 seeded topics with an exam weight (1–5) and an hours-to-competence estimate, each moving through `not-started → learning → practised → strong` (or `skipped`). Topic status drives the remaining-workload projection.

**DILR** is tracked at set level, not just question level: sets attempted, sets solved, time per set, and why each set was missed (chose incorrectly, understood but could not solve, calculation, logic, time, abandoned too late, abandoned too early, careless).

**Error log.** Twelve error categories, each entry carrying date, section, topic, question reference, what went wrong, the corrected approach, a revisit date and resolution state. Error history feeds directly into what gets planned next: repeated types raise the priority of the matching topics and generate error-review tasks.

**Mocks.** A mock is only complete when it has been attempted, recorded, analysed, its errors classified, its weak topics identified and its lessons written. Until then it is flagged **Incomplete analysis**, and the mock cadence is throttled — because a mock without analysis is worth less than one with it.

**Trajectory.** Percentile history is smoothed (most recent mocks weighted highest) and projected forward with a damped slope, crediting at most four weeks of continued improvement. A steep early trend cannot silently declare a distant target already achieved. With no mocks the answer is `Target feasibility: UNCONFIRMED` — not an optimistic guess.

---

## How weekly recalculation works

1. **You answer seven questions** — achieved, missed, what happened, energy, actual focused hours, friction, wins.
2. **Plan vs reality is computed** — planned against actual hours, tasks, outcomes, expected against actual capacity, plus notes on what took longer, what finished early and which assumptions proved wrong.
3. **Capacity reality is assessed** — the system distinguishes a *temporary disruption* (the shortfall lines up with a commitment that does not repeat) from a *new reality* (consistently lower output). Only the second permanently lowers the plan.
4. **Workload is recalculated** — remaining work, required pace, realistic pace, surplus or deficit, and a health label.
5. **Next week is generated** against the corrected capacity target — with buffer preserved.
6. **What changed is explained**, along with removed and deprioritised work, risks, and the single most important focus.

The canonical case, which is a test: *week 1 planned 18 hours, 11 actually happened.* The next week is planned at roughly 11–12 hours, not 25. The seven missed hours are not redistributed; the lowest-value work is dropped instead.

---

## Local development

Requires Node 20+.

```bash
npm install
npm run dev
```

Then open the printed URL (default <http://localhost:5173>).

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm run build:only` | Production build without the typecheck |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, zero warnings tolerated |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest in watch mode |
| `npm run icons` | Regenerate the PWA icons from `scripts/generate-icons.mjs` |
| `npm run verify` | Typecheck + lint + test + build (what CI runs) |

---

## Deploying to GitHub Pages

The build uses a **relative base** (`base: './'`), so it works from a project page, a user page or a subfolder without configuration.

1. Create a repository and push:

   ```bash
   git init
   git add .
   git commit -m "CAT Monitor"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```

2. In the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**.

3. Push to `main`. The workflow in `.github/workflows/deploy.yml` typechecks, lints, tests and builds, then publishes `dist/`. A failing check blocks the deploy.

4. The site appears at `https://<you>.github.io/<repo>/`.

No server, no database and no environment variables are required.

---

## Installing as a PWA

The app ships a web manifest, maskable icons and a dependency-free service worker (network-first for navigation so a new deploy is picked up, cache-first for content-hashed assets).

- **Android / Chrome** — open the site, then **⋮ → Add to Home screen** (or accept the install prompt).
- **iOS / Safari** — open the site, then **Share → Add to Home Screen**.
- **Desktop Chrome / Edge** — click the install icon in the address bar.

Once installed it launches standalone, works offline after the first visit, and keeps your data on the device.

Service workers require HTTPS (or `localhost`). On GitHub Pages that is automatic. When running `npm run dev` the service worker is deliberately not registered, so you never debug against a stale cache.

---

## Syncing between devices

Off by default. When enabled, your data lives in **one secret gist in your own GitHub account** — no server, no third-party service, no extra account.

### Setting it up

1. Create a token at **github.com/settings/tokens → Generate new token (classic)**. Tick **`gist`** and nothing else. Copy it.
2. On your main device: **Settings → Sync across devices → paste the token → Connect**. This creates the gist and uploads your data.
3. On the second device: paste **the same token**. The app finds the existing gist automatically and pulls everything across.

If the second device has not been set up yet, use **"Restore from another device"** on the first onboarding screen rather than going through setup — setting up separately on two devices creates two of everything.

### When it syncs

Automatically a few seconds after you make a change, when you reopen the app, and every five minutes. Plus **Sync now** in Settings. Sync is never on the critical path: if GitHub is unreachable the app keeps working and retries later.

### How conflicts are resolved

Per record, not per document. Every task, mock, error and log entry carries an `updatedAt`, and the newer edit of *each individual record* wins. Tick tasks off on your phone during the day while your laptop sits open on the Week view, and nothing is lost — "last device to sync" never overwrites the other wholesale.

Deletions are remembered as tombstones (pruned after 90 days) so a record deleted on one device is not resurrected by the other. A device that has never been used adopts the existing data outright instead of merging its own blank seed into it. All of this is covered by tests in `src/data/sync/__tests__/merge.test.ts` — it is the code most capable of losing data, so it is the most heavily tested.

### What to know before enabling it

- **The token is stored on each device** (browser local storage) and is never included in exports or in the synced file. It can only touch Gists — nothing else in your GitHub account.
- **A "secret" gist is unlisted, not access-controlled.** Anyone who has its 32-character address could read it. Treat the link as private. The gist contains your mock scores, task titles and error notes — no passwords and no contact details.
- **Disconnecting** removes the token from that device only. Your data stays, on both the device and GitHub.

## Backup, export and reset

Your data lives in IndexedDB on your device, mirrored to `localStorage` as a recovery path. Nothing is sent anywhere.

- **Export** — Settings → *Export data (JSON)*. Do this regularly; clearing browser data deletes everything.
- **Import** — Settings → *Import backup*. A snapshot of your current data is taken automatically before the import is applied.
- **Automatic snapshots** — one per day, last seven kept, restorable from Settings → *Local snapshots*.
- **Reset** — Settings → *Reset everything*, behind a confirmation. A snapshot is saved first, so a reset is recoverable.

Data is never deleted silently.

---

## Configuration: changing topics, sections and targets

Everything CAT-specific lives in [`src/config/catConfig.ts`](src/config/catConfig.ts). The engine and the UI read from it.

- **Topics** — edit `TOPIC_SEEDS`. Each entry has a `name`, `section`, `area`, `baseHours` (time to working competence) and `weight` (1–5 exam value). Weight drives both planning priority and the remaining-workload projection.
  You can also add, rename or skip topics in-app from the **CAT** page; seeds only apply to a fresh install.
- **Sections** — `SECTIONS`, `SECTION_LABELS`, `SECTION_FULL_NAMES`, `SECTION_DURATION_MIN`.
- **Planning parameters** — `DEFAULT_PLANNING`: buffer percentage, tasks per day, energy factors, estimation learning rate and bounds, mock/sectional/analysis durations, error-review and revision budgets. Most are also editable from **Settings** at runtime.
- **Phase thresholds** — `PHASE_THRESHOLDS` decides when the plan moves from foundation to application to readiness. These are days-remaining bands, not hardcoded months.
- **Target and exam date** — `DEFAULT_TARGET_PERCENTILE` and `DEFAULT_EXAM_DATE` seed a fresh install; both are editable in Settings, and every date calculation derives from `examDate − today`.
- **Mock providers** — `DEFAULT_MOCK_PROVIDERS`.

---

## Testing

```bash
npm test
```

139 tests across 13 files. The planning engine is pure, so the scenarios are exercised directly:

| Scenario | Expected behaviour | Covered in |
| --- | --- | --- |
| Everything completed | Next week progresses normally | `scenarios.test.ts` |
| Only 50% completed | Next week rebalanced, not doubled | `scenarios.test.ts` |
| Travel cuts capacity | Workload reduced, P1 protected, no backlog built | `scenarios.test.ts`, `capacity.test.ts` |
| Important task missed | Dependency and deadline evaluated | `missedTask.test.ts` |
| Low-priority task missed | Removed, not carried | `missedTask.test.ts` |
| Tasks consistently run long | Estimates increase gradually | `estimation.test.ts` |
| Tasks consistently finish early | Estimates decrease; freed time goes to high-value work | `estimation.test.ts`, `rebalance.test.ts` |
| Repeated morning failures | Deep work moves to the stronger window | `patterns.test.ts` |
| Work exceeds capacity | Target flagged, low-value work cut | `workload.test.ts`, `scenarios.test.ts` |
| Mock percentile improves rapidly | Focus shifts to consistency and analysis | `readiness.test.ts` |
| **Week 1: 18h planned, 11h actual** | **Week 2 planned at ~11h, weakest sections weighted, buffer preserved** | `scenarios.test.ts`, `weeklyReview.test.ts` |

`src/data/sync/__tests__/merge.test.ts` covers two-device merges: simultaneous edits, deletions, tombstone expiry, idempotence, symmetry (both devices converge on the same answer), and a brand-new device adopting existing data rather than duplicating it.

`src/state/__tests__/store.test.ts` walks the same path the UI does — onboarding, completing and missing work, applying a decision, recording and analysing a mock, logging errors, running the review — and asserts on the resulting state.

---

## Known limits and future work

Stated plainly, because the app's whole premise is not overstating what it knows:

- **The capacity formula is a planning aid, not a prediction.** It cannot know that you will be ill on Thursday. That is what buffer is for.
- **Feasibility labels are judgements from thin evidence.** Three mocks are three data points. The app says so, and refuses to convert them into a probability.
- **Topic hour estimates are generic**, not personalised, until you have logged enough practice for accuracy data to take over.
- **No natural-language input yet.** Quick actions cover the common updates (low energy, unexpected commitment, travel, finished early, missed). Free-text parsing would sit behind an interface so an AI API could be added later — the core planner must keep working without one.
- **Sync is eventually consistent, not real-time.** Changes propagate within seconds of an edit settling, or when you reopen the app — not instantly while both devices are open. Two devices editing *the same record* within the same few seconds resolve to the newer edit, so one of the two is discarded by design.
- **Sync depends on GitHub being reachable.** Offline, the app is unaffected; it reconciles on the next connection.
- **Notifications are preferences only.** There is no background scheduler; reminders surface in-app.
- **Charts are deliberately minimal.** Hand-rolled SVG keeps the bundle small; they are not interactive.

---

Built for one person, one exam, one date: **29 November 2026**.
