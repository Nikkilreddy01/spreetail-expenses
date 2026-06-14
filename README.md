# Settlr — Shared Expenses for Flat 4B

A shared-expenses app for a flat whose history lives in a deliberately messy
spreadsheet. The app imports that spreadsheet (`expenses_export.csv`) **exactly
as exported**, detects every data problem, applies a documented policy to each,
and produces a reviewable import report. It then tracks balances, supports every
split type in the data, lets the flat settle up, and respects a roster that
changes over time (Meera leaves, Sam joins).

This README covers setup, the AI used, and how the pieces fit. The deeper docs:

- **[SCOPE.md](SCOPE.md)** — the anomaly log (every CSV problem + how it is
  handled) and the database schema.
- **[DECISIONS.md](DECISIONS.md)** — each significant decision, the options, and
  why this one was chosen.
- **[IMPORT_REPORT.md](IMPORT_REPORT.md)** — the report the app produces when it
  ingests the CSV (regenerate with `npm run import:report`).
- **[AI_USAGE.md](AI_USAGE.md)** — the AI tools used, key prompts, and concrete
  cases where the AI was wrong and what was changed.

---

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js 15** (App Router, server components + server actions) | One deployable unit for UI + API; mutations are auditable in one file |
| Language | **TypeScript** (strict) | Types catch split/rounding mistakes at compile time |
| Database | **SQLite via Prisma** | Relational (requirement); zero-config local; one file to back up |
| Tests | **Vitest** | The import + balance logic is pure and unit-tested (52 tests) |
| Money | **integer paise** everywhere | No float drift; every rounding decision is explicit |

The design principle is that **all the hard logic is pure** and lives in
`src/core/` with no database or framework imports. The DB and UI are thin wrappers
around it. That is what makes the live walkthrough tractable: a balance is a sum
over data the split engine already computed.

```
src/core/        pure domain logic (no DB, no React) — unit tested
  money.ts       integer paise, rounding, formatting
  fx.ts          USD→INR conversion at a fixed documented rate
  csv.ts         RFC-4180 CSV parser
  parse.ts       field parsers (name/amount/date) that emit fix-notes
  splits.ts      equal / unequal / percentage / share, largest-remainder
  membership.ts  join/leave windows (Sam & Meera)
  importer.ts    the importer: detect → classify → dedupe → report
  balances.ts    net balances, who-pays-whom, per-member ledger
src/lib/         glue: prisma client, auth, persistence, queries
src/app/         Next.js pages + server actions
scripts/         run-import (report) and seed (CSV → DB)
prisma/          schema + SQLite db
```

---

## Setup

Requirements: Node 18+ (built on Node 22) and npm.

```bash
# 1. install
npm install

# 2. create the local env file
cp .env.example .env
# .env should contain:
#   DATABASE_URL="file:./dev.db"
#   AUTH_SECRET="any-random-string"

# 3. create the database tables
npm run db:push

# 4. import the CSV into the database (creates the "Flat 4B" group + logins)
npm run seed

# 5. run
npm run dev
# open http://localhost:3000
```

**Log in** with any flatmate, password `password`:
`aisha@flat.local`, `rohan@flat.local`, `priya@flat.local`, `sam@flat.local`.

### Useful commands

```bash
npm test                 # run the 52 unit/integration tests
npm run import:report    # ingest the CSV and (re)write IMPORT_REPORT.md
npm run seed             # reset the DB and re-import the CSV
npm run build            # production build (also runs prisma generate)
```

---

## What each flatmate asked for, and where it lives

| Flatmate | Request | Where it is implemented |
| --- | --- | --- |
| **Aisha** | "One number per person. Who pays whom." | Dashboard net table + greedy `simplifyDebts` (`src/core/balances.ts`) |
| **Rohan** | "No magic numbers — show the expenses behind ₹2,300." | Member ledger page with running balance (`memberLedger`) |
| **Priya** | "A dollar isn't a rupee." | `src/core/fx.ts` converts USD→INR on import; the expense keeps the original amount + rate, shown in the UI |
| **Sam** | "Why would March electricity affect me?" | Membership windows (`src/core/membership.ts`); he is never a valid participant before he joined |
| **Meera** | "Approve anything the app deletes or changes." | Anomalies marked `pending`; approve/reject on the import page; rejecting a dedupe restores the dropped row |

---

## The import in one paragraph

`importCsv(text, ctx)` parses every cell, turning each fix into an anomaly
(surface). It classifies each row as an **expense**, a **settlement** (a row that
is really a payment), or a **skip** (e.g. no payer). It converts non-INR money,
computes the split so shares sum exactly to the total, drops participants who
were not members on the expense date, and then does a cross-row pass to find
duplicates. The output is a structured `ImportReport`; `persistImport` writes it
to the DB in one transaction. The same function backs both the CLI report and the
web upload, so they can never disagree.

## AI used

This project was built with **Claude (Anthropic) via Claude Code** as the primary
collaborator — used for scaffolding, the importer/split/balance logic, tests, and
the docs. The AI was treated as a fast but fallible pair: every output was reviewed,
and several of its first answers were wrong (asymmetric rounding on refunds, a
missed settlement row, a split that broke the sum invariant, a bad dedupe key, an
off-by-one on Meera's departure). Each is documented — with how it was caught and
what changed — in **[AI_USAGE.md](AI_USAGE.md)**, along with the key prompts.

## Deployment

See **[DEPLOY.md](DEPLOY.md)**. The app is a standard Next.js server; it deploys
to any host that gives the SQLite file a persistent disk (Render, Railway, Fly),
or you can point `DATABASE_URL` at Postgres for a serverless host like Vercel.
