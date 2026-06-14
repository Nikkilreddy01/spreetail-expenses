/**
 * Writes a pure ImportReport into the relational DB inside one transaction.
 *
 * Order matters: users -> group -> memberships -> import batch -> expenses
 * (+ splits) -> settlements -> anomalies (linked back to suppressed expenses so
 * approve/reject can flip them). Everything is one transaction so a failure
 * never leaves a half-imported group.
 */
import { prisma } from "./db";
import type { ImportReport } from "@/core/importer";
import type { MemberWindow } from "@/core/membership";
import { hashPassword } from "./auth";

export interface PersistOptions {
  groupName: string;
  membership: MemberWindow[];
  /** default password for any auto-created user (the flatmates) */
  defaultPassword?: string;
}

export async function persistImport(report: ImportReport, opts: PersistOptions) {
  const { groupName, membership, defaultPassword = "password" } = opts;

  // Everyone referenced anywhere in the report needs a User row.
  const names = new Set<string>();
  for (const e of report.expenses) {
    names.add(e.paidBy);
    Object.keys(e.shares).forEach((n) => names.add(n));
  }
  for (const s of report.settlements) {
    names.add(s.payer);
    names.add(s.payee);
  }
  membership.forEach((m) => names.add(m.name));

  return prisma.$transaction(async (tx) => {
    // 1. Users (upsert by unique name). Members get a login; guests don't need one.
    const userByName = new Map<string, string>();
    for (const name of names) {
      const email = `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}@flat.local`;
      const user = await tx.user.upsert({
        where: { name },
        update: {},
        create: { name, email, password: hashPassword(defaultPassword) },
      });
      userByName.set(name, user.id);
    }

    // 2. Group
    const group = await tx.group.create({
      data: { name: groupName, baseCurrency: "INR" },
    });

    // 3. Memberships (the join/leave windows that drive the balance rules)
    for (const m of membership) {
      const userId = userByName.get(m.name);
      if (!userId) continue;
      await tx.membership.create({
        data: {
          groupId: group.id,
          userId,
          joinedAt: new Date(m.joinedAt),
          leftAt: m.leftAt ? new Date(m.leftAt) : null,
          role: m.role,
        },
      });
    }

    // 4. Import batch
    const batch = await tx.importBatch.create({
      data: {
        groupId: group.id,
        filename: report.filename,
        totalRows: report.totalRows,
        importedExpenses: report.summary.expenses,
        importedSettlements: report.summary.settlements,
        skippedRows: report.summary.skipped,
      },
    });

    // 5. Expenses + splits. Keep a sourceRow -> expenseId map to link anomalies.
    const expenseByRow = new Map<number, string>();
    for (const e of report.expenses) {
      const created = await tx.expense.create({
        data: {
          groupId: group.id,
          date: new Date(e.date),
          description: e.description,
          paidById: userByName.get(e.paidBy)!,
          amountPaise: e.amountPaise,
          originalAmountPaise: e.originalAmountPaise,
          originalCurrency: e.originalCurrency,
          fxRate: e.fxRate,
          splitType: e.splitType,
          notes: e.notes,
          suppressed: e.suppressed,
          suppressedReason: e.suppressedReason,
          importBatchId: batch.id,
          sourceRow: e.sourceRow,
          splits: {
            create: Object.entries(e.shares).map(([name, sharePaise]) => ({
              userId: userByName.get(name)!,
              sharePaise,
            })),
          },
        },
      });
      expenseByRow.set(e.sourceRow, created.id);
    }

    // 6. Settlements
    for (const s of report.settlements) {
      await tx.settlement.create({
        data: {
          groupId: group.id,
          date: new Date(s.date),
          payerId: userByName.get(s.payer)!,
          payeeId: userByName.get(s.payee)!,
          amountPaise: s.amountPaise,
          note: s.note,
          importBatchId: batch.id,
          sourceRow: s.sourceRow,
        },
      });
    }

    // 7. Anomalies (link duplicate anomalies to the suppressed expense row)
    for (const a of report.anomalies) {
      const linkExpenseId =
        (a.code === "DUPLICATE_EXACT" || a.code === "DUPLICATE_CONFLICT") && a.sourceRow
          ? expenseByRow.get(a.sourceRow)
          : undefined;
      await tx.anomaly.create({
        data: {
          importBatchId: batch.id,
          sourceRow: a.sourceRow,
          code: a.code,
          severity: a.severity,
          message: a.message,
          action: a.action,
          reviewStatus: a.reviewStatus,
          detail: a.detail ? JSON.stringify(a.detail) : null,
          expenseId: linkExpenseId,
        },
      });
    }

    return { groupId: group.id, batchId: batch.id };
  });
}
