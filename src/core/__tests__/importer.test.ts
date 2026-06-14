import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { importCsv, type ImportReport } from "../importer";
import { DEFAULT_MEMBERSHIP } from "../membership";

const csv = readFileSync(
  fileURLToPath(new URL("../../../data/expenses_export.csv", import.meta.url)),
  "utf8",
);

function run(): ImportReport {
  return importCsv(csv, {
    filename: "expenses_export.csv",
    baseCurrency: "INR",
    membership: DEFAULT_MEMBERSHIP,
    defaultYear: 2026,
  });
}

const codes = (r: ImportReport) => new Set(r.anomalies.map((a) => a.code));
const byRow = (r: ImportReport, row: number) => r.anomalies.filter((a) => a.sourceRow === row);

describe("importer against the real CSV", () => {
  const report = run();

  it("detects at least 12 distinct anomaly types", () => {
    expect(codes(report).size).toBeGreaterThanOrEqual(12);
  });

  it("dedupes the exact Marina Bites dinner (rows 5 & 6)", () => {
    const dup = report.anomalies.find((a) => a.code === "DUPLICATE_EXACT");
    expect(dup).toBeTruthy();
    expect(dup!.sourceRow).toBe(6); // the second copy is dropped
  });

  it("flags the conflicting Thalassa dinner (rows 24 & 25) and keeps the later", () => {
    const c = report.anomalies.find((a) => a.code === "DUPLICATE_CONFLICT");
    expect(c).toBeTruthy();
    expect(c!.detail!.keptRow).toBe(25);
    // only one Thalassa expense survives (the rest are suppressed)
    const thal = report.expenses.filter((e) => /thalassa/i.test(e.description) && !e.suppressed);
    expect(thal.length).toBe(1);
    expect(thal[0].sourceRow).toBe(25);
  });

  it("parses the comma-thousands amount (row 7 = ₹1,200)", () => {
    const e = report.expenses.find((x) => x.sourceRow === 7)!;
    expect(e.amountPaise).toBe(120000);
    expect(codes(report).has("AMOUNT_THOUSANDS_SEP")).toBe(true);
  });

  it("rounds the sub-paise cylinder refill (row 10 = 899.995)", () => {
    const e = report.expenses.find((x) => x.sourceRow === 10)!;
    expect(e.amountPaise).toBe(90000);
    expect(codes(report).has("AMOUNT_SUBPAISE")).toBe(true);
  });

  it("normalises name variants (priya, rohan , Priya S)", () => {
    expect(codes(report).has("NAME_NORMALIZED")).toBe(true);
  });

  it("reclassifies both settlements (row 14 Rohan->Aisha, row 38 Sam->Aisha)", () => {
    expect(report.settlements.length).toBe(2);
    const r14 = report.settlements.find((s) => s.sourceRow === 14)!;
    expect(r14.payer).toBe("Rohan");
    expect(r14.payee).toBe("Aisha");
    expect(r14.amountPaise).toBe(500000);
    const r38 = report.settlements.find((s) => s.sourceRow === 38)!;
    expect(r38.payer).toBe("Sam");
    expect(r38.payee).toBe("Aisha");
  });

  it("normalises percentages that total 110% (rows 15 & 32)", () => {
    expect(codes(report).has("PERCENT_NOT_100")).toBe(true);
    for (const row of [15, 32]) {
      const e = report.expenses.find((x) => x.sourceRow === row)!;
      const total = Object.values(e.shares).reduce((a, b) => a + b, 0);
      expect(total).toBe(e.amountPaise); // still exact after normalising
    }
  });

  it("converts USD trip expenses to INR (rows 20,21,23,26)", () => {
    expect(codes(report).has("CURRENCY_CONVERTED")).toBe(true);
    const villa = report.expenses.find((x) => x.sourceRow === 20)!; // 540 USD
    expect(villa.originalCurrency).toBe("USD");
    expect(villa.amountPaise).toBe(540 * 83 * 100);
    expect(villa.fxRate).toBe(83);
  });

  it("treats the parasailing refund as a refund, not an error (row 26 = -30 USD)", () => {
    const refund = report.expenses.find((x) => x.sourceRow === 26)!;
    expect(refund.amountPaise).toBeLessThan(0);
    expect(codes(report).has("NEGATIVE_AS_REFUND")).toBe(true);
  });

  it("includes guest Kabir on parasailing but flags him (row 23)", () => {
    const para = report.expenses.find((x) => x.sourceRow === 23)!;
    expect(Object.keys(para.shares)).toContain("Kabir");
    expect(codes(report).has("GUEST_PARTICIPANT") || codes(report).has("UNKNOWN_PARTICIPANT")).toBe(true);
  });

  it("defaults the missing currency to INR (row 28)", () => {
    expect(codes(report).has("CURRENCY_DEFAULTED")).toBe(true);
    const e = report.expenses.find((x) => x.sourceRow === 28)!;
    expect(e.originalCurrency).toBe("INR");
  });

  it("flags ambiguous date 04/05/2026 (row 34)", () => {
    expect(codes(report).has("DATE_AMBIGUOUS")).toBe(true);
  });

  it("imports the zero-amount Swiggy order with no balance effect (row 31)", () => {
    expect(codes(report).has("ZERO_AMOUNT")).toBe(true);
    const e = report.expenses.find((x) => x.sourceRow === 31)!;
    expect(e.amountPaise).toBe(0);
  });

  it("ignores stray shares on an equal split (row 42 furniture)", () => {
    expect(codes(report).has("SPLIT_DETAILS_IGNORED")).toBe(true);
    const e = report.expenses.find((x) => x.sourceRow === 42)!;
    const vals = Object.values(e.shares);
    expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(1); // equal
  });

  it("drops ex-member Meera from the April groceries split (row 36)", () => {
    const ex = report.anomalies.find((a) => a.code === "EX_MEMBER_IN_SPLIT");
    expect(ex).toBeTruthy();
    const e = report.expenses.find((x) => x.sourceRow === 36)!;
    expect(Object.keys(e.shares)).not.toContain("Meera");
  });

  it("holds out the payer-less row for manual review (row 13)", () => {
    expect(codes(report).has("MISSING_PAYER")).toBe(true);
    expect(report.skipped.find((s) => s.sourceRow === 13)).toBeTruthy();
  });

  it("never invents or loses paise: every expense split sums to its amount", () => {
    for (const e of report.expenses) {
      const total = Object.values(e.shares).reduce((a, b) => a + b, 0);
      expect(total).toBe(e.amountPaise);
    }
  });

  it("Sam is never charged for any expense before he joined (2026-04-08)", () => {
    for (const e of report.expenses) {
      if (e.date < "2026-04-08" && e.shares.Sam !== undefined) {
        throw new Error(`Sam charged on ${e.date} row ${e.sourceRow}`);
      }
    }
  });
});
