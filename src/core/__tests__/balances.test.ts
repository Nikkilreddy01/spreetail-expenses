import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  computeNetBalances,
  simplifyDebts,
  memberLedger,
  type BalExpense,
  type BalSettlement,
} from "../balances";
import { importCsv } from "../importer";
import { DEFAULT_MEMBERSHIP } from "../membership";

describe("balances — small hand-checkable example", () => {
  // A pays ₹300 dinner split equally 3 ways (A,B,C). Each owes ₹100.
  // A's net = 300 - 100 = +200; B = -100; C = -100.
  const expenses: BalExpense[] = [
    {
      id: "e1",
      date: "2026-01-01",
      description: "Dinner",
      paidBy: "A",
      amountPaise: 30000,
      shares: { A: 10000, B: 10000, C: 10000 },
    },
  ];

  it("computes the net positions", () => {
    const net = computeNetBalances(expenses, []);
    expect(net.A).toBe(20000);
    expect(net.B).toBe(-10000);
    expect(net.C).toBe(-10000);
  });

  it("sums to zero", () => {
    const net = computeNetBalances(expenses, []);
    expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("simplifies to two transfers into A", () => {
    const net = computeNetBalances(expenses, []);
    const t = simplifyDebts(net);
    expect(t.length).toBe(2);
    expect(t.every((x) => x.to === "A")).toBe(true);
    expect(t.reduce((a, x) => a + x.amountPaise, 0)).toBe(20000);
  });

  it("a settlement cancels a debt", () => {
    const settlements: BalSettlement[] = [
      { id: "s1", date: "2026-01-02", payer: "B", payee: "A", amountPaise: 10000 },
    ];
    const net = computeNetBalances(expenses, settlements);
    expect(net.B).toBe(0); // B paid off their ₹100
    expect(net.A).toBe(10000); // A now only owed ₹100 (by C)
  });

  it("ledger explains the number line by line (Rohan's request)", () => {
    const { lines, totalPaise } = memberLedger("A", expenses, []);
    expect(totalPaise).toBe(20000);
    // A has a +paid line and a -share line
    expect(lines.find((l) => l.kind === "paid")!.deltaPaise).toBe(30000);
    expect(lines.find((l) => l.kind === "share")!.deltaPaise).toBe(-10000);
  });
});

describe("balances — end to end against the real CSV", () => {
  const csv = readFileSync(
    fileURLToPath(new URL("../../../data/expenses_export.csv", import.meta.url)),
    "utf8",
  );
  const report = importCsv(csv, {
    filename: "expenses_export.csv",
    baseCurrency: "INR",
    membership: DEFAULT_MEMBERSHIP,
    defaultYear: 2026,
  });
  const expenses: BalExpense[] = report.expenses.filter((e) => !e.suppressed).map((e) => ({
    id: String(e.sourceRow),
    date: e.date,
    description: e.description,
    paidBy: e.paidBy,
    amountPaise: e.amountPaise,
    shares: e.shares,
  }));
  const settlements: BalSettlement[] = report.settlements.map((s) => ({
    id: String(s.sourceRow),
    date: s.date,
    payer: s.payer,
    payee: s.payee,
    amountPaise: s.amountPaise,
  }));

  it("money is conserved: all net balances sum to zero", () => {
    const net = computeNetBalances(expenses, settlements);
    const total = Object.values(net).reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });

  it("each member's itemised ledger total equals their net (no magic numbers)", () => {
    const net = computeNetBalances(expenses, settlements);
    for (const person of Object.keys(net)) {
      const { totalPaise } = memberLedger(person, expenses, settlements);
      expect(totalPaise).toBe(net[person]);
    }
  });

  it("simplified transfers settle everyone to zero", () => {
    const net = computeNetBalances(expenses, settlements);
    const transfers = simplifyDebts(net);
    // apply transfers and confirm everyone lands on 0
    const after = { ...net };
    for (const t of transfers) {
      after[t.from] += t.amountPaise;
      after[t.to] -= t.amountPaise;
    }
    for (const v of Object.values(after)) expect(v).toBe(0);
  });
});
