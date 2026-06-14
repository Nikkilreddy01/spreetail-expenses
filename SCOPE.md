# SCOPE — Anomaly log & database schema

Row numbers below are **CSV line numbers** (the header is line 1, so the first
data row "February rent" is line 2). They match the `sourceRow` shown in the app
and in [IMPORT_REPORT.md](IMPORT_REPORT.md). Every anomaly has a machine `code`
emitted by `src/core/importer.ts`, a severity, and a **review status**:

- **auto** — a lossless or cosmetic normalisation; applied silently but logged.
- **pending** — a delete or a change to who-owes-what; applied by default so the
  app is usable immediately, but surfaced for approval (Meera's requirement).

The importer detected **53 anomaly instances across 20 distinct problem
classes** in the supplied file. The 20 classes:

## Anomaly log

| # | Row(s) | Problem | Code | Policy & action taken | Review |
|---|--------|---------|------|-----------------------|--------|
| 1 | 5 & 6 | Same dinner logged twice — "Dinner at Marina Bites" and "dinner - marina bites", same date/payer/amount | `DUPLICATE_EXACT` | Group by (date + participants + normalised description). Identical amount **and** payer ⇒ exact dupe. Keep the first (row 5), suppress the second (row 6). Suppressed rows stay in the DB so the dedupe is reversible. | pending |
| 2 | 24 & 25 | Same dinner, **conflicting** values — Aisha logged ₹2,400, Rohan logged ₹2,450 (note: "hers is wrong") | `DUPLICATE_CONFLICT` | Same dedupe key but different amount/payer ⇒ conflict. Keep the **later** row (25) as the correction, suppress the earlier (24). Both surfaced for approval since we are choosing a winner. | pending |
| 3 | 14 | A settlement logged as an expense — "Rohan paid Aisha back", empty `split_type`, `split_with=Aisha` | `SETTLEMENT_RECLASSIFIED` | A row whose participants are a single person other than the payer is a transfer, not a shared cost. Recorded as a **settlement** Rohan→Aisha ₹5,000, removed from expense splits. | pending |
| 4 | 38 | A deposit payment logged as an expense — "Sam deposit share", `split_type=equal` but `split_with=Aisha` | `SETTLEMENT_RECLASSIFIED` | Same rule (single non-payer participant). Recorded as settlement Sam→Aisha ₹15,000. | pending |
| 5 | 36 | A member who left is still on a later split — April groceries lists Meera, who moved out 31 Mar | `EX_MEMBER_IN_SPLIT` | Membership window says Meera is not liable on 2026-04-02. Drop her and **re-split** ₹2,640 among the remaining members (Aisha, Rohan, Priya). | pending |
| 6 | 13 | No payer — "House cleaning supplies", `paid_by` empty ("can't remember who paid") | `MISSING_PAYER` | Cannot attribute who fronted the money, so the balance is undefined. Row is **held out of balances** and flagged for manual entry rather than guessing. | pending |
| 7 | 15 & 32 | Percentages total 110% — `Aisha 30%; Rohan 30%; Priya 30%; Meera 20%` | `PERCENT_NOT_100` | Treat the percentages as **weights** and apportion the true total by largest-remainder, so shares still sum exactly. (Equivalent to normalising to 100%.) | pending |
| 8 | 7 | Thousands separator in amount — `"1,200"` (quoted) | `AMOUNT_THOUSANDS_SEP` | Strip grouping commas → 1200. Commas are never treated as decimals (every decimal in the file uses `.`). | auto |
| 9 | 29 | Whitespace around amount — `" 1450 "` | `AMOUNT_WHITESPACE` | Trim → 1450. | auto |
| 10 | 10 | Sub-paise precision — `899.995` (3 dp; INR has 2) | `AMOUNT_SUBPAISE` | Round half-away-from-zero to 2 dp → ₹900.00. | auto |
| 11 | 26 | Negative amount — "Parasailing refund" `-30 USD` | `NEGATIVE_AS_REFUND` | A negative amount is a **refund**, not an error: kept negative so it credits the participants. (Contrast: a missing/zero amount is treated separately.) | auto |
| 12 | 31 | Zero amount — "Dinner order Swiggy" `0` ("counted twice earlier") | `ZERO_AMOUNT` | Imported as ₹0 with an equal split; has no effect on balances, but kept visible so the history is complete. | auto |
| 13 | 20, 21, 23, 26 | Currency is USD but treated as INR by the sheet | `CURRENCY_CONVERTED` | Convert to INR at a fixed documented rate (₹83/USD). The expense stores the original amount, currency, and rate; the UI shows "was USD x @ 83". | auto |
| 14 | 28 | Missing currency — "forgot to set currency" | `CURRENCY_DEFAULTED` | Default to the group base currency (INR) and flag it. | auto |
| 15 | 16–33, 34 | Mixed date formats — ISO `2026-02-01`, `DD/MM/YYYY`, "Mar 14" | `DATE_FORMAT` / `DATE_NO_YEAR` | Parse ISO as-is; slash dates as **day-first** (matches the file); "Mar 14" assumes the dataset year 2026. | auto |
| 16 | 34 | Ambiguous date — `04/05/2026` ("April 5 or May 4?") | `DATE_AMBIGUOUS` | Apply the file's dominant day-first rule ⇒ 2026-05-04, **flagged** so the flat can correct it. | auto (flagged) |
| 17 | 9, 11, 27 | Name variants — `priya`, `Priya S`, `rohan ` (trailing space) | `NAME_NORMALIZED` | Canonicalise via an explicit alias map. `Priya S`→`Priya` is an **assumption**, documented and surfaced rather than fuzzy-guessed. | auto |
| 18 | 23 | A non-flatmate on a split — "Dev's friend Kabir" joined the trip for a day | `GUEST_PARTICIPANT` / `UNKNOWN_PARTICIPANT` | Kabir is kept as his own person and **included** on that one expense (so the split is honest), but flagged as a guest, not a flatmate. | auto |
| 19 | 42 | `split_type=equal` but `split_details` also lists shares | `SPLIT_DETAILS_IGNORED` | The `split_type` wins: split equally and **ignore** the stray shares, flagged. | auto |
| 20 | 5, 19–27 | Guest Dev appears on trip expenses | `GUEST_PARTICIPANT` | Dev is modelled as a `guest` member (no window enforcement); included whenever listed. | auto |

### Cross-cutting policies behind the table

- **Money is integer paise.** No float is ever stored. Rounding happens once, explicitly (`roundToPaise`, largest-remainder allocation), so totals are exact.
- **Split invariant.** For every imported expense, `sum(shares) === amount`. Asserted in tests against the real CSV.
- **Membership drives liability.** A person is only split into an expense if they were an active member (or a listed guest) on the expense date. This is what answers Sam ("not charged for March") and Meera ("not charged after I left") at the same time.
- **A skip is never silent.** Rows we cannot place (missing payer, unparseable) are listed in the report with a reason, not dropped quietly.

---

## Database schema

Relational (SQLite via Prisma). All money columns are `Int` paise.

```
User(id, name⋆unique, email⋆unique, password, createdAt)
  — one row per person (flatmate or guest). Name variants normalise to one User.

Group(id, name, baseCurrency, createdAt)
  — one flat. baseCurrency = "INR"; every balance is reported in it.

Membership(id, groupId→Group, userId→User, joinedAt, leftAt?, role)
  — the join/leave WINDOW. leftAt null = still here. role = member | guest.
  — UNIQUE(groupId, userId). This table is the source of truth for liability.

Expense(id, groupId→Group, date, description, paidById→User,
        amountPaise, originalAmountPaise, originalCurrency, fxRate?,
        splitType, notes?, suppressed, suppressedReason?,
        importBatchId?→ImportBatch, sourceRow?)
  — amountPaise is post-FX in base currency; originalAmount* is the audit trail.
  — suppressed = a de-duplicated copy (kept for reversibility, excluded from balances).

ExpenseSplit(id, expenseId→Expense, userId→User, sharePaise)
  — exactly what each participant owes. UNIQUE(expenseId, userId).
  — Sum of sharePaise for an expense == Expense.amountPaise (enforced at write time).

Settlement(id, groupId→Group, date, payerId→User, payeeId→User,
           amountPaise, note?, importBatchId?, sourceRow?)
  — a payment (incl. rows reclassified out of the CSV).

ImportBatch(id, groupId→Group, filename, createdAt,
            totalRows, importedExpenses, importedSettlements, skippedRows)
  — one import run; the header of the report.

Anomaly(id, importBatchId→ImportBatch, sourceRow?, code, severity,
        message, action, reviewStatus, detail?, expenseId?→Expense)
  — the persisted, queryable import report. expenseId links a duplicate anomaly
    to the suppressed expense so approve/reject can flip it.
```

### Why these tables

- **Membership is separate from User** because liability changes over time; a
  boolean "is in group" cannot express "Meera was here Feb–Mar".
- **ExpenseSplit is precomputed** at import/create time, so a balance is a pure
  sum and never re-runs the rounding logic (which would risk drift).
- **Settlement is first-class**, not a negative expense, because "who paid whom
  back" is a different concept from "who shared a cost" and the CSV conflated them.
- **Anomaly is a table, not a log file**, so the report is queryable and each
  change is individually approvable.
