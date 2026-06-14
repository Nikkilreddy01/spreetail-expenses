/**
 * Seed the database by importing the canonical CSV through the SAME pipeline the
 * web app uses (importCsv -> persistImport). Resets to a single "Flat 4B" group.
 *   npm run seed
 */
import { readFileSync } from "node:fs";
import { importCsv } from "../src/core/importer";
import { DEFAULT_MEMBERSHIP } from "../src/core/membership";
import { persistImport } from "../src/lib/import-persist";
import { prisma } from "../src/lib/db";
import { getBalances } from "../src/lib/queries";
import { formatPaise } from "../src/core/money";

async function main() {
  // Reset (dev convenience): clear everything so seeding is repeatable.
  await prisma.anomaly.deleteMany();
  await prisma.expenseSplit.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.group.deleteMany();
  await prisma.user.deleteMany();

  const csv = readFileSync("data/expenses_export.csv", "utf8");
  const report = importCsv(csv, {
    filename: "expenses_export.csv",
    baseCurrency: "INR",
    membership: DEFAULT_MEMBERSHIP,
    defaultYear: 2026,
  });

  const { groupId } = await persistImport(report, {
    groupName: "Flat 4B",
    membership: DEFAULT_MEMBERSHIP,
    defaultPassword: "password",
  });

  const { net, transfers } = await getBalances(groupId);

  console.log(`Seeded group Flat 4B (${groupId})`);
  console.log(`Users: log in as e.g. aisha@flat.local / password\n`);
  console.log("Net balances:");
  for (const [name, paise] of Object.entries(net).sort((a, b) => b[1] - a[1])) {
    const label = paise > 0 ? "is owed" : paise < 0 ? "owes" : "settled";
    console.log(`  ${name.padEnd(8)} ${formatPaise(paise).padStart(14)}  (${label})`);
  }
  console.log("\nWho pays whom:");
  for (const t of transfers) {
    console.log(`  ${t.from} → ${t.to}: ${formatPaise(t.amountPaise)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
