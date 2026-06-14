import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/guard";
import { getBalances } from "@/lib/queries";
import { prisma } from "@/lib/db";
import { Topbar } from "../../_components/Topbar";
import { GroupTabs, Money } from "../../_components/GroupTabs";
import { SettleForm } from "./SettleForm";

export default async function GroupDashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const { group, net, transfers } = await getBalances(id);
  if (!group) notFound();

  const pending = await prisma.anomaly.count({ where: { importBatch: { groupId: id }, reviewStatus: "pending" } });

  // Sort people: creditors first, then debtors, settled last.
  const people = Object.entries(net).sort((a, b) => b[1] - a[1]);
  const memberNames = group.memberships.map((m) => m.user.name);

  return (
    <>
      <Topbar userName={user.name} />
      <div className="container">
        <div className="row">
          <h1>{group.name}</h1>
          <span className="spacer" />
          {pending > 0 && (
            <Link href={`/groups/${id}/import`} className="pill warning">
              {pending} change{pending === 1 ? "" : "s"} awaiting approval
            </Link>
          )}
        </div>
        <p className="sub">Balances in {group.baseCurrency}. Click a name to see exactly which expenses make it up.</p>
        <GroupTabs groupId={id} active="" />

        <h2>Where everyone stands</h2>
        <div className="card">
          <table>
            <thead>
              <tr><th>Person</th><th>Status</th><th className="num">Net balance</th></tr>
            </thead>
            <tbody>
              {people.map(([name, paise]) => (
                <tr key={name}>
                  <td>
                    <Link href={`/groups/${id}/members/${encodeURIComponent(name)}`}>{name}</Link>
                  </td>
                  <td className="muted small">
                    {paise > 0 ? "is owed by the group" : paise < 0 ? "owes the group" : "all settled"}
                  </td>
                  <td><Money paise={paise} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>Who pays whom (simplest settlement)</h2>
        <div className="card">
          {transfers.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Everyone is settled up. 🎉</p>
          ) : (
            <table>
              <thead><tr><th>From</th><th>To</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {transfers.map((t, i) => (
                  <tr key={i}>
                    <td className="neg">{t.from}</td>
                    <td className="pos">{t.to}</td>
                    <td><Money paise={t.amountPaise} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="grid cols-2">
          <div>
            <h2>Membership timeline</h2>
            <div className="card">
              <table>
                <thead><tr><th>Person</th><th>Joined</th><th>Left</th><th>Role</th></tr></thead>
                <tbody>
                  {group.memberships
                    .slice()
                    .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
                    .map((m) => (
                      <tr key={m.id}>
                        <td>{m.user.name}</td>
                        <td className="mono small">{m.joinedAt.toISOString().slice(0, 10)}</td>
                        <td className="mono small">{m.leftAt ? m.leftAt.toISOString().slice(0, 10) : "—"}</td>
                        <td><span className={`pill ${m.role}`}>{m.role}</span></td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="muted small" style={{ marginBottom: 0 }}>
                Expenses are only split among people who were members on the expense date — so Sam is never charged for
                March, and Meera is dropped from anything after she left.
              </p>
            </div>
          </div>

          <div>
            <h2>Record a payment</h2>
            <div className="card">
              <SettleForm groupId={id} members={memberNames} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
