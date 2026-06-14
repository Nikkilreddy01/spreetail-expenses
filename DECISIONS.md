# DECISIONS — why the app is built this way

Each entry: the decision, the options weighed, and why this one. These are the
choices I expect to defend line-by-line in the live session.

---

### D1. Keep all domain logic pure, in `src/core/`, with no DB or React imports

**Options:** (a) write the import/balance logic inside API routes / components;
(b) isolate it as pure functions the framework calls.

**Chosen: (b).** The import and balance math is the actual difficulty of this
project; the database and UI are plumbing. Pure functions are unit-testable
without a running server (52 tests, ~0.4s) and make the live walkthrough
possible: I can point at `computeSplit` or `memberLedger` and run it on paper.
The cost is a mapping layer (`src/lib/queries.ts`) between DB rows and plain
objects — worth it.

---

### D2. Money is stored as integer **paise**, never floats

**Options:** (a) store rupees as floats/decimals; (b) store integer paise.

**Chosen: (b).** Floating point cannot represent 0.1 exactly, so summing many
rupee figures drifts. Storing paise as `Int` makes every total exact and forces
each rounding decision to be explicit and testable. The only conversions to a
float happen for display and FX, never for storage. (A `Decimal` column would
also work but adds a dependency and is overkill for two-decimal currency.)

---

### D3. Splits use **largest-remainder** apportionment

**Options:** (a) divide and truncate (loses paise); (b) divide and round each
share independently (can over/under-shoot the total); (c) largest-remainder.

**Chosen: (c).** It guarantees `sum(shares) === total` for any split type and
any participant count — ₹100 three ways becomes 33.34 / 33.33 / 33.33, not three
× 33.33 with a lost paisa. The same routine powers equal, percentage and share
splits, so there is one rounding rule to reason about. This is the single most
likely "change a rule live" target (e.g. "give the remainder to the payer
instead") and it is localised to one function, `allocateByWeights`.

---

### D4. Currency conversion uses a **single fixed rate**, not a live or per-date rate

**Options:** (a) live FX API at import time; (b) a historical per-date rate
table; (c) one fixed rate per currency, committed in code.

**Chosen: (c)** (₹83/USD), with the original amount + rate stored on every
converted expense. Rationale: the trip was a few days; intraday FX noise is
irrelevant to splitting a villa four ways. A fixed rate makes imports
**deterministic** — the same CSV always yields the same balances, which the
evaluators can re-derive by hand — and removes a network failure mode. The rate
is surfaced in the import report as a product decision the flat can change.

---

### D5. A row whose participants are **a single person other than the payer** is a settlement

**Options:** (a) only treat an empty `split_type` as a settlement (catches row
14 but not row 38); (b) hardcode the two known rows; (c) a structural rule.

**Chosen: (c).** "Payer P, participants = {Q}" means P gave money to Q — a
transfer, not a shared cost. This one rule catches both the explicit "Rohan paid
Aisha back" (empty split type) and "Sam deposit share" (split_type=equal but
really a payment), and would catch future ones. It is reversible (flagged
`pending`) in case a genuine "I paid, only you owe me" expense ever matches.

---

### D6. Duplicate policy: **keep-first for exact, keep-later for conflicting**

**Options:** for two rows that look like the same event — (a) keep both (double
counts); (b) keep the higher/lower amount; (c) exact ⇒ keep first, conflict ⇒
keep the later row as the correction.

**Chosen: (c).** Exact duplicates (row 6 = row 5) are pure noise, so the first
wins. Conflicting duplicates (row 24 vs 25) are usually a correction logged after
the original — the note on row 25 ("hers is wrong") confirms it — so the later
row wins. Crucially this is a **guess about intent**, so both are flagged
`pending` and the suppressed row is retained in the DB; rejecting the dedupe in
the UI brings it back. The dedupe key is `date + participant-set +
normalised-description-tokens`, which ignores casing/punctuation ("Dinner at
Marina Bites" == "dinner - marina bites").

---

### D7. **Membership windows** decide liability; ex-members are dropped and the split is recomputed

**Options:** (a) split among whoever the row lists; (b) split among the current
roster; (c) split among who was actually a member on the expense date.

**Chosen: (c).** (a) charges Meera for an April expense she was wrongly listed
on; (b) would retroactively charge Sam for March. The window model
(`joinedAt`/`leftAt` per member) answers both Sam and Meera with one mechanism:
a participant is only included if active on `expense.date`. When a listed member
is dropped, the expense is **re-split among the remaining members** (flagged
`pending`), rather than silently leaving a gap that breaks `sum(shares)==total`.
Guests (Dev, Kabir) are exempt — they are only ever present because a row named
them explicitly.

---

### D8. Percentages that don't total 100 are **normalised**, not rejected

**Options:** (a) reject the row; (b) trust the stated total; (c) treat percents
as weights and apportion the real total.

**Chosen: (c).** Rejecting loses a real expense; trusting 110% would make shares
exceed the amount. Using the percents as weights (so 30/30/30/20 → the same
ratios against the true total) preserves intent and keeps the invariant. It is
flagged `pending` because it changes the amounts people owe.

---

### D9. Negative = refund, zero = kept no-op, missing-amount = skip

Three different "weird amounts", three different meanings:
- **Negative** (`-30` refund) is intentional and credits participants — kept.
- **Zero** ("counted twice, fixing later") is a real historical entry with no
  financial effect — kept and shown, so the timeline isn't misleading.
- **Missing/unparseable amount** cannot be split at all — skipped with a reason.

Lumping these together (e.g. "drop anything ≤ 0") would silently delete a refund.

---

### D10. Ambiguous dates resolve **day-first**, consistently with the file

**Options:** (a) reject ambiguous dates; (b) MM/DD (US); (c) DD/MM (day-first).

**Chosen: (c).** The unambiguous slash dates in the file (e.g. `15/03/2026`,
where 15 can't be a month) are day-first, so `04/05/2026` is read as 4 May for
consistency — and **flagged** so the flat can fix it if it was meant to be 5
April. A consistent, surfaced assumption beats a crash or a silent US-format guess.

---

### D11. Name resolution is an **explicit alias map**, not fuzzy matching

**Options:** (a) string-similarity matching; (b) a hand-written alias table.

**Chosen: (b).** Identity decisions ("Priya S" is Priya; "Dev's friend Kabir" is
a guest named Kabir) should be deliberate and reviewable, not the output of a
similarity threshold that could merge two real people. The map lives in
`parse.ts`; unknown names pass through title-cased and flagged rather than being
force-matched.

---

### D12. Changes are **applied by default but marked for approval** (apply-then-review)

**Options:** (a) block the import until every change is approved; (b) apply
silently; (c) apply the documented policy immediately, mark altering changes
`pending`, allow approve/reject afterward.

**Chosen: (c).** "A crashed import and a silent guess are both failing answers."
(a) makes the app unusable until a human clears a queue; (b) is the silent guess.
(c) gives working balances now **and** honours Meera: every delete/alter is
listed with Approve/Reject. The one change we can fully reverse from stored state
— a dedupe — is wired through (reject un-suppresses the row); the rest record the
decision and the audit trail. I chose to be honest about that boundary rather
than fake full reversibility for every case.

---

### D13. Auth is a **scrypt hash + signed cookie**, not a full auth provider

**Options:** (a) NextAuth/Auth.js or an external IdP; (b) a minimal built-in
login.

**Chosen: (b).** The assignment asks for a login module, and the real complexity
here is the import, not OAuth. Passwords use Node's built-in `scrypt`; the
session is an HMAC-signed cookie holding the user id (stateless, forge-proof
without `AUTH_SECRET`). Small, dependency-free, and fully explainable. It is not
what I'd ship for a public multi-tenant product, and I say so.

---

### D14. SQLite for the relational DB

**Options:** Postgres, MySQL, SQLite.

**Chosen: SQLite** via Prisma — relational (meets the requirement), zero-config
locally, one file to back up, and enough for a flat of five. Because it is behind
Prisma, moving to Postgres for a serverless host is a one-line provider change
plus `DATABASE_URL`; see DEPLOY.md. The trade-off (no concurrent writers, weak
typing) is irrelevant at this scale.
