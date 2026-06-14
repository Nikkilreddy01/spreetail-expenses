/**
 * The CSV importer. Pure: text in, a structured ImportReport out. No DB, no I/O.
 * The persistence layer (lib/import-persist.ts) takes this report and writes it.
 *
 * Pipeline per the assignment's "detect / surface / handle" rule:
 *   1. Parse every cell, collecting fix-notes -> anomalies (surface).
 *   2. Classify each row: expense | settlement | skip (handle).
 *   3. Cross-row pass: detect duplicates (exact + conflicting).
 *   4. Membership pass: drop participants outside their window.
 *   5. Emit a report listing every anomaly and the action taken.
 *
 * Every anomaly carries a reviewStatus:
 *   - "auto":    a lossless/cosmetic normalisation, applied silently but logged.
 *   - "pending": a delete or a change to who-owes-what. Applied by default so
 *                balances are usable immediately, but flagged for approval
 *                (Meera: "I want to approve anything the app deletes or changes").
 */

import { parseCsv } from "./csv";
import { parseAmount, parseDate, parseName, parseNameList, type ParseNote } from "./parse";
import { computeSplit, type SplitType } from "./splits";
import { convertPaise, isKnownCurrency } from "./fx";
import { type Paise } from "./money";
import { isActiveMember, type MemberWindow } from "./membership";

export interface ImportContext {
  filename: string;
  baseCurrency: string; // "INR"
  membership: MemberWindow[];
  defaultYear: number;
}

export interface NormalizedExpense {
  sourceRow: number;
  date: string; // ISO
  description: string;
  paidBy: string;
  amountPaise: Paise; // in base currency, after FX
  originalAmountPaise: Paise;
  originalCurrency: string;
  fxRate: number | null;
  splitType: SplitType;
  notes: string | null;
  shares: Record<string, Paise>; // sums to amountPaise
}

export interface NormalizedSettlement {
  sourceRow: number;
  date: string;
  payer: string;
  payee: string;
  amountPaise: Paise;
  note: string | null;
}

export interface AnomalyRecord {
  sourceRow: number | null;
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  action: string; // imported | converted | reclassified | skipped | merged | normalized | needs_review
  reviewStatus: "auto" | "pending";
  detail?: Record<string, unknown>;
}

export interface ImportReport {
  filename: string;
  totalRows: number; // data rows (excludes header)
  expenses: NormalizedExpense[];
  settlements: NormalizedSettlement[];
  skipped: { sourceRow: number; reason: string }[];
  anomalies: AnomalyRecord[];
  summary: {
    expenses: number;
    settlements: number;
    skipped: number;
    anomalies: number;
    pendingApprovals: number;
  };
}

const EXPECTED_HEADER = [
  "date", "description", "paid_by", "amount", "currency",
  "split_type", "split_with", "split_details", "notes",
];

/** Codes that represent a delete or a change to amounts/participants. */
const PENDING_CODES = new Set([
  "DUPLICATE_EXACT",
  "DUPLICATE_CONFLICT",
  "SETTLEMENT_RECLASSIFIED",
  "EX_MEMBER_IN_SPLIT",
  "PERCENT_NOT_100",
  "MISSING_PAYER",
]);

function noteToAnomaly(row: number, note: ParseNote): AnomalyRecord {
  const severity: AnomalyRecord["severity"] =
    note.code.startsWith("BAD_") || note.code.startsWith("MISSING_") ? "warning" : "info";
  return {
    sourceRow: row,
    code: note.code,
    severity,
    message: note.message,
    action: "normalized",
    reviewStatus: "auto",
    detail: note.raw !== undefined ? { raw: note.raw } : undefined,
  };
}

/** Normalise a description for duplicate detection: lowercase, alnum tokens, sorted. */
function descKey(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && t !== "at" && t !== "the")
    .sort()
    .join(" ");
}

export function importCsv(text: string, ctx: ImportContext): ImportReport {
  const rows = parseCsv(text);
  const anomalies: AnomalyRecord[] = [];
  const expenses: NormalizedExpense[] = [];
  const settlements: NormalizedSettlement[] = [];
  const skipped: { sourceRow: number; reason: string }[] = [];

  // --- header check -------------------------------------------------------
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  if (header.join(",") !== EXPECTED_HEADER.join(",")) {
    anomalies.push({
      sourceRow: 1,
      code: "HEADER_MISMATCH",
      severity: "warning",
      message: `Header did not match expected columns; parsing positionally. Got: ${header.join(", ")}`,
      action: "normalized",
      reviewStatus: "auto",
    });
  }

  // line numbers are 1-based with the header on line 1
  const dataRows = rows.slice(1).map((cells, i) => ({ lineNo: i + 2, cells }));

  for (const { lineNo, cells } of dataRows) {
    const [dateRaw, descRaw, paidByRaw, amountRaw, currencyRaw, splitTypeRaw, splitWithRaw, splitDetailsRaw, notesRaw] =
      cells.map((c) => c ?? "");

    const rowNotes: ParseNote[] = [];

    // -- date
    const d = parseDate(dateRaw, ctx.defaultYear);
    rowNotes.push(...d.notes);

    // -- amount
    const a = parseAmount(amountRaw);
    rowNotes.push(...a.notes);

    // -- payer
    const payer = parseName(paidByRaw);
    rowNotes.push(...payer.notes);

    // -- participants
    const participants = parseNameList(splitWithRaw);
    rowNotes.push(...participants.notes);

    // surface all field-level fixes
    for (const n of rowNotes) anomalies.push(noteToAnomaly(lineNo, n));

    const description = descRaw.trim();

    // -- hard failures: cannot place this row at all ----------------------
    if (!d.iso) {
      skipped.push({ sourceRow: lineNo, reason: "unparseable date" });
      anomalies.push(mk(lineNo, "BAD_ROW", "error", `Row skipped: date "${dateRaw}" is unparseable`, "skipped", "pending"));
      continue;
    }
    if (a.paise === null) {
      skipped.push({ sourceRow: lineNo, reason: "missing/invalid amount" });
      anomalies.push(mk(lineNo, "BAD_ROW", "error", `Row skipped: amount "${amountRaw}" is invalid`, "skipped", "pending"));
      continue;
    }

    // -- missing payer: cannot attribute who fronted the money ------------
    if (!payer.name) {
      skipped.push({ sourceRow: lineNo, reason: "missing payer" });
      anomalies.push(
        mk(lineNo, "MISSING_PAYER", "warning",
          `"${description}" has no payer ("${paidByRaw}"); cannot attribute. Held out of balances for manual entry.`,
          "needs_review", "pending",
          { description, amount: a.paise }),
      );
      continue;
    }

    // -- currency: default missing -> base; convert non-base ---------------
    let currency = currencyRaw.trim().toUpperCase();
    if (currency === "") {
      currency = ctx.baseCurrency;
      anomalies.push(
        mk(lineNo, "CURRENCY_DEFAULTED", "warning",
          `"${description}" had no currency; defaulted to ${ctx.baseCurrency}.`,
          "normalized", "auto"),
      );
    }
    let amountPaise = a.paise;
    let fxRate: number | null = null;
    const originalAmountPaise = a.paise;
    const originalCurrency = currency;
    if (currency !== ctx.baseCurrency) {
      if (!isKnownCurrency(currency)) {
        skipped.push({ sourceRow: lineNo, reason: `unknown currency ${currency}` });
        anomalies.push(mk(lineNo, "BAD_ROW", "error", `Row skipped: unknown currency "${currency}"`, "skipped", "pending"));
        continue;
      }
      const conv = convertPaise(a.paise, currency, ctx.baseCurrency);
      amountPaise = conv.paise;
      fxRate = conv.rate;
      anomalies.push(
        mk(lineNo, "CURRENCY_CONVERTED", "info",
          `"${description}" was ${originalCurrency} ${(originalAmountPaise / 100).toFixed(2)}; converted at ${fxRate} to ${ctx.baseCurrency} ${(amountPaise / 100).toFixed(2)}.`,
          "converted", "auto",
          { from: originalCurrency, to: ctx.baseCurrency, rate: fxRate }),
      );
    }

    const splitTypeRawTrim = splitTypeRaw.trim().toLowerCase();

    // -- settlement detection ---------------------------------------------
    // A row whose participant list is a single person other than the payer is a
    // transfer (payer -> that person), not a shared expense. Catches both the
    // explicit "Rohan paid Aisha back" (empty split_type) and "Sam deposit
    // share" (split_type=equal but really a payment).
    const otherParticipants = participants.names.filter((n) => n !== payer.name);
    const isSettlement =
      splitTypeRawTrim === "" ||
      (participants.names.length === 1 && otherParticipants.length === 1);

    if (isSettlement) {
      const payee = otherParticipants[0] ?? participants.names[0];
      if (!payee || payee === payer.name) {
        skipped.push({ sourceRow: lineNo, reason: "settlement with no counterparty" });
        anomalies.push(mk(lineNo, "BAD_ROW", "error", `Row skipped: settlement "${description}" has no counterparty`, "skipped", "pending"));
        continue;
      }
      settlements.push({
        sourceRow: lineNo,
        date: d.iso,
        payer: payer.name,
        payee,
        amountPaise,
        note: notesRaw.trim() || description,
      });
      anomalies.push(
        mk(lineNo, "SETTLEMENT_RECLASSIFIED", "warning",
          `"${description}" is a payment (${payer.name} → ${payee}), not a shared expense. Recorded as a settlement.`,
          "reclassified", "pending",
          { payer: payer.name, payee, amount: amountPaise }),
      );
      continue;
    }

    // -- it's an expense: validate split type -----------------------------
    const allowed: SplitType[] = ["equal", "unequal", "percentage", "share"];
    if (!allowed.includes(splitTypeRawTrim as SplitType)) {
      skipped.push({ sourceRow: lineNo, reason: `unknown split_type ${splitTypeRawTrim}` });
      anomalies.push(mk(lineNo, "BAD_ROW", "error", `Row skipped: unknown split_type "${splitTypeRaw}"`, "skipped", "pending"));
      continue;
    }
    const splitType = splitTypeRawTrim as SplitType;

    // equal-with-stray-shares: split_type says equal but details list shares
    if (splitType === "equal" && splitDetailsRaw.trim() !== "") {
      anomalies.push(
        mk(lineNo, "SPLIT_DETAILS_IGNORED", "warning",
          `"${description}" is split_type=equal but also lists shares ("${splitDetailsRaw.trim()}"). Honoured equal; ignored the shares.`,
          "normalized", "auto"),
      );
    }

    // -- guest / unknown participants --------------------------------------
    for (const name of participants.names) {
      const m = isActiveMember(ctx.membership, name, d.iso);
      if (!m.known) {
        anomalies.push(
          mk(lineNo, "UNKNOWN_PARTICIPANT", "info",
            `"${name}" on "${description}" is not a known flatmate; included as an ad-hoc participant.`,
            "imported", "auto"),
        );
      } else if (m.role === "guest") {
        anomalies.push(
          mk(lineNo, "GUEST_PARTICIPANT", "info",
            `"${name}" is a guest (not a flatmate); included on "${description}" because they were listed.`,
            "imported", "auto"),
        );
      }
    }

    // -- membership window: drop members who weren't liable on this date ---
    let liable = participants.names.slice();
    const dropped: string[] = [];
    for (const name of participants.names) {
      const m = isActiveMember(ctx.membership, name, d.iso);
      if (m.known && m.role === "member" && !m.active) {
        dropped.push(name);
      }
    }
    if (dropped.length > 0) {
      liable = liable.filter((n) => !dropped.includes(n));
      anomalies.push(
        mk(lineNo, "EX_MEMBER_IN_SPLIT", "warning",
          `"${description}" (${d.iso}) listed ${dropped.join(", ")}, who was not a flatmate on that date. Re-split among ${liable.join(", ")}.`,
          "normalized", "pending",
          { dropped, dateIso: d.iso }),
      );
    }
    if (liable.length === 0) {
      skipped.push({ sourceRow: lineNo, reason: "no liable participants after membership filter" });
      anomalies.push(mk(lineNo, "BAD_ROW", "error", `Row skipped: "${description}" has no liable participants`, "skipped", "pending"));
      continue;
    }

    // -- compute the split -------------------------------------------------
    const split = computeSplit({
      splitType,
      totalPaise: amountPaise,
      participants: liable,
      detailsRaw: splitDetailsRaw,
    });
    for (const n of split.notes) anomalies.push(noteToAnomaly(lineNo, n));

    // zero / negative amount classification (informational)
    if (amountPaise === 0) {
      anomalies.push(
        mk(lineNo, "ZERO_AMOUNT", "info",
          `"${description}" has amount 0; imported but has no effect on balances.`,
          "imported", "auto"),
      );
    } else if (amountPaise < 0) {
      anomalies.push(
        mk(lineNo, "NEGATIVE_AS_REFUND", "info",
          `"${description}" is negative; treated as a refund (credits participants), not an error.`,
          "imported", "auto"),
      );
    }

    expenses.push({
      sourceRow: lineNo,
      date: d.iso,
      description,
      paidBy: payer.name,
      amountPaise,
      originalAmountPaise,
      originalCurrency,
      fxRate,
      splitType,
      notes: notesRaw.trim() || null,
      shares: split.shares,
    });
  }

  // --- cross-row duplicate detection -------------------------------------
  detectDuplicates(expenses, anomalies);

  const pendingApprovals = anomalies.filter((x) => x.reviewStatus === "pending").length;
  return {
    filename: ctx.filename,
    totalRows: dataRows.length,
    expenses: expenses.filter((e) => !(e as ExpenseWithFlag)._suppressed),
    settlements,
    skipped,
    anomalies,
    summary: {
      expenses: expenses.filter((e) => !(e as ExpenseWithFlag)._suppressed).length,
      settlements: settlements.length,
      skipped: skipped.length,
      anomalies: anomalies.length,
      pendingApprovals,
    },
  };
}

type ExpenseWithFlag = NormalizedExpense & { _suppressed?: boolean };

/**
 * Group expenses by (date + participant set + normalised description). A group
 * with more than one row is a duplicate. If the amounts AND payer match it's an
 * exact dupe (drop the later copy); otherwise it's a conflict (keep the later
 * row as the correction, drop the earlier, and flag both for approval).
 */
function detectDuplicates(expenses: ExpenseWithFlag[], anomalies: AnomalyRecord[]) {
  const groups = new Map<string, ExpenseWithFlag[]>();
  for (const e of expenses) {
    const participantKey = Object.keys(e.shares).sort().join(",");
    const key = `${e.date}|${participantKey}|${descKey(e.description)}`;
    const g = groups.get(key) ?? [];
    g.push(e);
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    // process in source-row order; keep one, suppress the rest
    g.sort((x, y) => x.sourceRow - y.sourceRow);
    const amountsEqual = g.every((e) => e.amountPaise === g[0].amountPaise);
    const payersEqual = g.every((e) => e.paidBy === g[0].paidBy);

    if (amountsEqual && payersEqual) {
      // exact duplicate: keep the first, suppress the rest
      for (let i = 1; i < g.length; i++) {
        g[i]._suppressed = true;
        anomalies.push(
          mk(g[i].sourceRow, "DUPLICATE_EXACT", "warning",
            `"${g[i].description}" duplicates row ${g[0].sourceRow} (same date, payer, amount). Kept row ${g[0].sourceRow}, dropped this one.`,
            "skipped", "pending",
            { keptRow: g[0].sourceRow }),
        );
      }
    } else {
      // conflicting duplicate: keep the LATEST row as the correction
      const keep = g[g.length - 1];
      for (const e of g) {
        if (e === keep) continue;
        e._suppressed = true;
        anomalies.push(
          mk(e.sourceRow, "DUPLICATE_CONFLICT", "warning",
            `"${e.description}" (${e.paidBy}, ${(e.amountPaise / 100).toFixed(2)}) appears to duplicate row ${keep.sourceRow} (${keep.paidBy}, ${(keep.amountPaise / 100).toFixed(2)}) with different values. Kept the later row ${keep.sourceRow}; dropped this one.`,
            "skipped", "pending",
            { keptRow: keep.sourceRow, droppedAmount: e.amountPaise, keptAmount: keep.amountPaise }),
        );
      }
    }
  }
}

function mk(
  sourceRow: number | null,
  code: string,
  severity: AnomalyRecord["severity"],
  message: string,
  action: string,
  reviewStatus: "auto" | "pending",
  detail?: Record<string, unknown>,
): AnomalyRecord {
  return {
    sourceRow,
    code,
    severity,
    message,
    action,
    reviewStatus: PENDING_CODES.has(code) ? "pending" : reviewStatus,
    detail,
  };
}
