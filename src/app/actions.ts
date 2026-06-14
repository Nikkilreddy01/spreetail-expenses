"use server";

/**
 * All mutations live here as Next.js server actions. Reads are done directly in
 * server components via src/lib/queries. Keeping mutations in one file makes the
 * "what can change the database" surface easy to audit in the live review.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession, destroySession, getCurrentUser } from "@/lib/auth";
import { importCsv } from "@/core/importer";
import { computeSplit, type SplitType } from "@/core/splits";
import { rupeesToPaise } from "@/core/money";
import { DEFAULT_MEMBERSHIP } from "@/core/membership";
import { persistImport } from "@/lib/import-persist";

// --- auth -----------------------------------------------------------------

export async function loginAction(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.password || !verifyPassword(password, user.password)) {
    return { error: "Invalid email or password." };
  }
  await createSession(user.id);
  redirect("/groups");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

// --- import ---------------------------------------------------------------

export async function importAction(_prev: unknown, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const file = formData.get("file") as File | null;
  const groupName = String(formData.get("groupName") ?? "Imported Flat").trim() || "Imported Flat";
  if (!file || file.size === 0) return { error: "Please choose a CSV file." };

  const text = await file.text();
  const report = importCsv(text, {
    filename: file.name,
    baseCurrency: "INR",
    membership: DEFAULT_MEMBERSHIP,
    defaultYear: 2026,
  });

  const { groupId } = await persistImport(report, {
    groupName,
    membership: DEFAULT_MEMBERSHIP,
  });
  redirect(`/groups/${groupId}/import`);
}

// --- anomaly review (Meera: approve anything that deletes or changes) ------

export async function reviewAnomalyAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const anomalyId = String(formData.get("anomalyId"));
  const decision = String(formData.get("decision")); // "approved" | "rejected"
  const groupId = String(formData.get("groupId"));

  const anomaly = await prisma.anomaly.findUnique({ where: { id: anomalyId } });
  if (!anomaly) return;

  await prisma.anomaly.update({
    where: { id: anomalyId },
    data: { reviewStatus: decision },
  });

  // For a duplicate, rejecting the dedupe brings the dropped copy back into
  // balances; approving keeps it suppressed. This is the one change we can fully
  // reverse from stored state, so we wire it through.
  if (anomaly.expenseId && (anomaly.code === "DUPLICATE_EXACT" || anomaly.code === "DUPLICATE_CONFLICT")) {
    await prisma.expense.update({
      where: { id: anomaly.expenseId },
      data: { suppressed: decision === "approved" },
    });
  }

  revalidatePath(`/groups/${groupId}/import`);
  revalidatePath(`/groups/${groupId}`);
}

// --- add expense ----------------------------------------------------------

export async function addExpenseAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const groupId = String(formData.get("groupId"));
  const description = String(formData.get("description") ?? "").trim();
  const date = String(formData.get("date"));
  const paidByName = String(formData.get("paidBy"));
  const amountRupees = Number(formData.get("amount"));
  const splitType = String(formData.get("splitType")) as SplitType;
  const participants = formData.getAll("participants").map(String);
  const detailsRaw = String(formData.get("splitDetails") ?? "");

  if (!description || !Number.isFinite(amountRupees) || participants.length === 0) {
    return;
  }

  const amountPaise = rupeesToPaise(amountRupees);
  const { shares } = computeSplit({ splitType, totalPaise: amountPaise, participants, detailsRaw });

  // Resolve names -> user ids
  const users = await prisma.user.findMany({ where: { name: { in: [paidByName, ...Object.keys(shares)] } } });
  const idByName = new Map(users.map((u) => [u.name, u.id]));

  await prisma.expense.create({
    data: {
      groupId,
      date: new Date(date),
      description,
      paidById: idByName.get(paidByName)!,
      amountPaise,
      originalAmountPaise: amountPaise,
      originalCurrency: "INR",
      fxRate: null,
      splitType,
      splits: {
        create: Object.entries(shares).map(([name, sharePaise]) => ({
          userId: idByName.get(name)!,
          sharePaise,
        })),
      },
    },
  });

  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/expenses`);
  redirect(`/groups/${groupId}/expenses`);
}

// --- record a settlement / payment ----------------------------------------

export async function recordSettlementAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const groupId = String(formData.get("groupId"));
  const payerName = String(formData.get("payer"));
  const payeeName = String(formData.get("payee"));
  const amountRupees = Number(formData.get("amount"));
  const date = String(formData.get("date"));

  if (payerName === payeeName || !Number.isFinite(amountRupees) || amountRupees <= 0) return;

  const users = await prisma.user.findMany({ where: { name: { in: [payerName, payeeName] } } });
  const idByName = new Map(users.map((u) => [u.name, u.id]));

  await prisma.settlement.create({
    data: {
      groupId,
      date: new Date(date),
      payerId: idByName.get(payerName)!,
      payeeId: idByName.get(payeeName)!,
      amountPaise: rupeesToPaise(amountRupees),
      note: "Recorded in app",
    },
  });

  revalidatePath(`/groups/${groupId}`);
  redirect(`/groups/${groupId}`);
}
