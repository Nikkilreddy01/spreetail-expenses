import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/guard";
import { Topbar } from "../_components/Topbar";
import { ImportForm } from "./ImportForm";

export default async function GroupsPage() {
  const user = await requireUser();
  const groups = await prisma.group.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { expenses: true, settlements: true } },
      memberships: { include: { user: true } },
    },
  });

  return (
    <>
      <Topbar userName={user.name} />
      <div className="container">
        <h1>Groups</h1>
        <p className="sub">Each group is one flat with its own roster, expenses and balances.</p>

        <div className="grid cols-2">
          {groups.map((g) => {
            const members = g.memberships.filter((m) => m.role === "member").map((m) => m.user.name);
            return (
              <Link key={g.id} href={`/groups/${g.id}`} className="card" style={{ display: "block" }}>
                <div className="row">
                  <strong>{g.name}</strong>
                  <span className="spacer" />
                  <span className="muted small">{g.baseCurrency}</span>
                </div>
                <div className="muted small" style={{ marginTop: 6 }}>
                  {g._count.expenses} expenses · {g._count.settlements} settlements
                </div>
                <div className="muted small" style={{ marginTop: 4 }}>
                  {members.join(", ")}
                </div>
              </Link>
            );
          })}
          {groups.length === 0 && <p className="muted">No groups yet. Import the spreadsheet to create one.</p>}
        </div>

        <h2>Import a spreadsheet</h2>
        <div className="card">
          <p className="muted small" style={{ marginTop: 0 }}>
            Upload <span className="mono">expenses_export.csv</span> exactly as exported. The importer detects every
            data problem, applies a documented policy, and produces a report you can review.
          </p>
          <ImportForm />
        </div>
      </div>
    </>
  );
}
