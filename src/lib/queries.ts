/**
 * Read-side helpers: pull a group's expenses/settlements from the DB and hand
 * them to the pure balance engine. The DB is the system of record; the math
 * lives in src/core and is unit-tested independently.
 */
import { prisma } from "./db";
import {
  computeNetBalances,
  simplifyDebts,
  memberLedger,
  type BalExpense,
  type BalSettlement,
} from "@/core/balances";

export async function loadGroupData(groupId: string) {
  const [group, expenses, settlements] = await Promise.all([
    prisma.group.findUnique({
      where: { id: groupId },
      include: { memberships: { include: { user: true } } },
    }),
    prisma.expense.findMany({
      where: { groupId },
      include: { paidBy: true, splits: { include: { user: true } } },
      orderBy: { date: "asc" },
    }),
    prisma.settlement.findMany({
      where: { groupId },
      include: { payer: true, payee: true },
      orderBy: { date: "asc" },
    }),
  ]);
  return { group, expenses, settlements };
}

/** Map DB rows -> the plain shapes the pure engine expects (excluding suppressed). */
function toBalInputs(
  expenses: Awaited<ReturnType<typeof loadGroupData>>["expenses"],
  settlements: Awaited<ReturnType<typeof loadGroupData>>["settlements"],
) {
  const balExpenses: BalExpense[] = expenses
    .filter((e) => !e.suppressed)
    .map((e) => ({
      id: e.id,
      date: e.date.toISOString().slice(0, 10),
      description: e.description,
      paidBy: e.paidBy.name,
      amountPaise: e.amountPaise,
      shares: Object.fromEntries(e.splits.map((s) => [s.user.name, s.sharePaise])),
    }));
  const balSettlements: BalSettlement[] = settlements.map((s) => ({
    id: s.id,
    date: s.date.toISOString().slice(0, 10),
    payer: s.payer.name,
    payee: s.payee.name,
    amountPaise: s.amountPaise,
  }));
  return { balExpenses, balSettlements };
}

export async function getBalances(groupId: string) {
  const { group, expenses, settlements } = await loadGroupData(groupId);
  const { balExpenses, balSettlements } = toBalInputs(expenses, settlements);
  const net = computeNetBalances(balExpenses, balSettlements);
  const transfers = simplifyDebts(net);
  return { group, net, transfers };
}

export async function getMemberLedger(groupId: string, personName: string) {
  const { expenses, settlements } = await loadGroupData(groupId);
  const { balExpenses, balSettlements } = toBalInputs(expenses, settlements);
  return memberLedger(personName, balExpenses, balSettlements);
}
