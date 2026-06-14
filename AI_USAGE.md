# AI_USAGE — how AI was used, and where it was wrong

## Tools

- **Claude (Opus) via the Claude Code CLI** — primary development collaborator,
  used for scaffolding, the importer/balance logic, the Next.js UI, tests, and
  these docs.
- I (the human, engineer of record) directed the build, made every product and
  engineering decision in [DECISIONS.md](DECISIONS.md), reviewed all generated
  code, and wrote/curated the test assertions that pin the behaviour down.

The working method was **test-first on the hard parts**: before trusting any
generated import or balance code, I had it run against the real
`expenses_export.csv` and assert specific outcomes per anomaly. That is how the
mistakes below were caught — the AI is confidently wrong in plausible ways, and
only concrete assertions surface it.

## Key prompts (paraphrased)

1. "Read `expenses_export.csv` and enumerate every deliberate data problem with
   its row number before writing any code."
2. "Build the money layer as integer paise. Splits must satisfy
   `sum(shares) === total` exactly for equal/unequal/percentage/share. Write the
   failing tests first."
3. "Write the importer as a pure function: CSV text + membership windows in, a
   structured report out. For each anomaly: detect, surface, and apply a
   documented policy. No DB."
4. "Membership has join/leave dates. A person is only split into an expense if
   they were a member on that date. Prove Sam is never charged before April."
5. "Persist the report in one transaction; keep suppressed duplicates so a
   rejection can bring them back."

---

## Three+ concrete cases where the AI was wrong

### Case 1 — Asymmetric rounding of a negative refund

**What the AI produced:** the first money helper rounded with plain
`Math.round(paiseFloat)`.

**Why it's wrong:** `Math.round` rounds half **toward +∞**, so
`Math.round(-0.5) === -0`. For the parasailing **refund** (`-30 USD`) and the
sub-paise case (`899.995`), positive and negative magnitudes would round
differently — `899.995 → 900.00` but `-899.995 → -899.99`. Money rounding should
be symmetric (half **away from zero**).

**How I caught it:** the money test asserts both signs:
`roundToPaise(-89999.5) === -90000`. It failed.

**What I changed:** `roundToPaise` now rounds the absolute value and reapplies
the sign (`src/core/money.ts`). Same fix applied in `fx.convertPaise`.

---

### Case 2 — Settlement rule that only caught one of the two settlements

**What the AI produced:** "a row is a settlement when `split_type` is empty."

**Why it's wrong:** that catches row 14 ("Rohan paid Aisha back", empty split
type) but **misses row 38** ("Sam deposit share"), which has `split_type=equal`.
Row 38 would then be imported as an expense split equally among its single
participant Aisha — charging Aisha ₹15,000 and crediting Sam ₹15,000, a garbage
balance.

**How I caught it:** the importer test asserts `report.settlements.length === 2`
and checks both Rohan→Aisha and Sam→Aisha. It failed at length 1.

**What I changed:** the rule is now structural — *participants are a single
person other than the payer* — which catches both regardless of the stated
`split_type` (`isSettlement` in `src/core/importer.ts`, see [DECISIONS.md D5](DECISIONS.md)).

---

### Case 3 — Percentage split that broke the sum invariant

**What the AI produced:** each person's share computed independently as
`round(total * pct / 100)`.

**Why it's wrong:** for the `30/30/30/20 = 110%` rows (15 and 32) the shares sum
to **110% of the total** — more money than the expense. Even at a correct 100%,
independent rounding can be off by a paisa. Either way `sum(shares) !== amount`,
which silently corrupts every downstream balance.

**How I caught it:** the split test asserts `sum(shares) === amount` for the 110%
case, and the end-to-end balance test asserts all net balances sum to **zero**.
Both failed.

**What I changed:** percentages are fed as **weights** into the shared
`allocateByWeights` (largest-remainder) routine, which apportions the *actual*
total and is exact by construction — and incidentally normalises the 110% away
(`src/core/splits.ts`).

---

### Case 4 — Dedupe key that included the amount, so the conflicting dinner slipped through

**What the AI produced:** a duplicate key of `date + amount + description`.

**Why it's wrong:** the two Thalassa dinners (rows 24 & 25) have **different
amounts** (₹2,400 vs ₹2,450), so they hash to different keys and both survive —
double-counting the dinner. The whole point of that anomaly is that a duplicate
can have a *different* amount.

**How I caught it:** the test "only one Thalassa expense survives" found two.

**What I changed:** the key is now `date + participant-set +
normalised-description` (amount excluded). Within a duplicate group I then
classify **exact** (same amount & payer → keep first) vs **conflict** (differing
→ keep the later correction), per [DECISIONS.md D6](DECISIONS.md).

---

### Case 5 — Off-by-one on Meera's departure boundary

**What the AI initially suggested:** dropping Meera from any March expense once
she was marked as "leaving".

**Why it's wrong:** Meera left at the **end** of March, so she is still liable
for the farewell dinner (2026-03-28), the late-March maid salary, etc. An
exclusive or too-early boundary would wrongly refund her out of legitimate
late-March costs.

**How I caught it:** eyeballing the generated import report — Meera was missing
from "Meera farewell dinner". The membership test now encodes the intent
(`leftAt = 2026-03-31`, inclusive comparison).

**What I changed:** `isActiveMember` uses inclusive `dateIso <= leftAt`, and
`DEFAULT_MEMBERSHIP` sets Meera's `leftAt` to the last day she lived there.

---

## Takeaway

The AI was fastest at producing *structure* (scaffolding, Prisma schema, React
forms) and most dangerous on *numeric edge cases* (signed rounding, the sum
invariant, boundary dates) — exactly the places where a plausible-looking
implementation is silently off by a paisa or a person. Every one of those was
caught by an assertion tied to a specific row of the real CSV, not by reading the
code. That is why the test suite asserts against `expenses_export.csv` directly.
