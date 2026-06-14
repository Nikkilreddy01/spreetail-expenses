/**
 * Balance engine. Pure: plain expense/settlement data in, balances out. The DB
 * layer feeds it rows; the UI renders its output. Three things it produces:
 *
 *   1. computeNetBalances  -> one signed number per person (Aisha's request).
 *   2. simplifyDebts       -> a minimal who-pays-whom list (Aisha's request).
 *   3. memberLedger        -> every line that makes up a person's number,
 *                             itemised (Rohan's "no magic numbers" request).
 *
 * Sign convention: net > 0 means the group owes this person (creditor);
 * net < 0 means this person owes the group (debtor). The sum of all nets is
 * always 0 (money is conserved), which is asserted in the tests.
 *
 * Why a balance is just a sum here: the split engine already computed the exact
 * paise each person owes per expense at import time. So a balance never
 * re-derives a split; it only adds up shares the person already has.
 */

import { type Paise } from "./money";

export interface BalExpense {
  id: string;
  date: string;
  description: string;
  paidBy: string;
  amountPaise: Paise;
  shares: Record<string, Paise>;
}

export interface BalSettlement {
  id: string;
  date: string;
  payer: string;
  payee: string;
  amountPaise: Paise;
}

/**
 * Net position per person.
 *   For each expense: payer is credited the full amount; each participant is
 *   debited their share. (The payer is usually also a participant, so their net
 *   effect is amount - own_share.)
 *   For each settlement X->Y: X (who paid cash) is credited; Y (who received) is
 *   debited — settling reduces what X owes and what Y is owed.
 */
export function computeNetBalances(
  expenses: BalExpense[],
  settlements: BalSettlement[],
): Record<string, Paise> {
  const net: Record<string, Paise> = {};
  const add = (name: string, delta: Paise) => {
    net[name] = (net[name] ?? 0) + delta;
  };

  for (const e of expenses) {
    add(e.paidBy, e.amountPaise);
    for (const [name, share] of Object.entries(e.shares)) {
      add(name, -share);
    }
  }
  for (const s of settlements) {
    add(s.payer, s.amountPaise);
    add(s.payee, -s.amountPaise);
  }
  // Drop dust: clean exact zeros stay; we keep everyone who appeared.
  return net;
}

export interface Transfer {
  from: string; // debtor
  to: string; // creditor
  amountPaise: Paise;
}

/**
 * Greedy debt simplification: repeatedly match the biggest debtor to the biggest
 * creditor and transfer the smaller of the two magnitudes. Produces at most
 * (n-1) transfers and answers "who pays whom" with the fewest moves.
 */
export function simplifyDebts(net: Record<string, Paise>): Transfer[] {
  const debtors: { name: string; amt: number }[] = [];
  const creditors: { name: string; amt: number }[] = [];
  for (const [name, amt] of Object.entries(net)) {
    if (amt < 0) debtors.push({ name, amt: -amt });
    else if (amt > 0) creditors.push({ name, amt });
  }
  // Largest first for a stable, minimal set of transfers.
  debtors.sort((a, b) => b.amt - a.amt);
  creditors.sort((a, b) => b.amt - a.amt);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > 0) {
      transfers.push({ from: debtors[i].name, to: creditors[j].name, amountPaise: pay });
    }
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }
  return transfers;
}

export interface LedgerLine {
  date: string;
  description: string;
  /** "+" = this person is owed for it (they paid), "-" = they owe a share */
  kind: "paid" | "share" | "settle_out" | "settle_in";
  /** signed paise contribution to this person's net balance */
  deltaPaise: Paise;
  /** human note, e.g. "paid ₹3,200, your share ₹800" */
  detail: string;
}

/**
 * Every line that makes up `person`'s net number — so the number is never magic.
 * One expense can produce two lines for the payer: a +amount "paid" line and a
 * -share "share" line, because they paid the whole thing but only owe a part.
 */
export function memberLedger(
  person: string,
  expenses: BalExpense[],
  settlements: BalSettlement[],
): { lines: LedgerLine[]; totalPaise: Paise } {
  const lines: LedgerLine[] = [];
  for (const e of expenses) {
    if (e.paidBy === person) {
      lines.push({
        date: e.date,
        description: e.description,
        kind: "paid",
        deltaPaise: e.amountPaise,
        detail: `You paid the full ${fmt(e.amountPaise)}`,
      });
    }
    const share = e.shares[person];
    if (share !== undefined && share !== 0) {
      lines.push({
        date: e.date,
        description: e.description,
        kind: "share",
        deltaPaise: -share,
        detail: `Your share was ${fmt(share)}`,
      });
    }
  }
  for (const s of settlements) {
    if (s.payer === person) {
      lines.push({
        date: s.date,
        description: "Settlement → " + s.payee,
        kind: "settle_out",
        deltaPaise: s.amountPaise,
        detail: `You paid ${s.payee} ${fmt(s.amountPaise)}`,
      });
    }
    if (s.payee === person) {
      lines.push({
        date: s.date,
        description: "Settlement ← " + s.payer,
        kind: "settle_in",
        deltaPaise: -s.amountPaise,
        detail: `${s.payer} paid you ${fmt(s.amountPaise)}`,
      });
    }
  }
  lines.sort((a, b) => a.date.localeCompare(b.date));
  const totalPaise = lines.reduce((acc, l) => acc + l.deltaPaise, 0);
  return { lines, totalPaise };
}

function fmt(paise: Paise): string {
  return `₹${(Math.abs(paise) / 100).toFixed(2)}`;
}
