import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/guard";
import { getMemberLedger, getBalances } from "@/lib/queries";
import { Topbar } from "../../../../_components/Topbar";
import { Money } from "../../../../_components/GroupTabs";

export default async function MemberLedgerPage({
  params,
}: {
  params: Promise<{ id: string; name: string }>;
}) {
  const { id, name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  const user = await requireUser();
  const { group, net } = await getBalances(id);
  if (!group) notFound();

  const { lines, totalPaise } = await getMemberLedger(id, name);

  // Running balance so the column "adds up" visibly (Rohan: no magic numbers).
  let running = 0;
  const rows = lines.map((l) => {
    running += l.deltaPaise;
    return { ...l, running };
  });

  const KIND_LABEL: Record<string, string> = {
    paid: "paid in full",
    share: "your share",
    settle_out: "you paid",
    settle_in: "paid to you",
  };

  return (
    <>
      <Topbar userName={user.name} />
      <div className="container">
        <div className="row">
          <Link href={`/groups/${id}`} className="small">← {group.name}</Link>
        </div>
        <h1 style={{ marginTop: 10 }}>{name}</h1>
        <p className="sub">
          Net balance{" "}
          <Money paise={net[name] ?? 0} />{" "}
          — and every line that makes it up.
        </p>

        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Expense</th><th>What</th>
                <th className="num">Effect</th><th className="num">Running</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="mono small">{r.date}</td>
                  <td>{r.description}</td>
                  <td className="muted small">{KIND_LABEL[r.kind]}: {r.detail}</td>
                  <td><Money paise={r.deltaPaise} /></td>
                  <td><Money paise={r.running} /></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="muted">No expenses involve {name}.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}><strong>Net</strong></td>
                <td></td>
                <td><strong><Money paise={totalPaise} /></strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted small">
          A positive line means the group owes {name} for it (they paid); a negative line is {name}&apos;s share of an
          expense. The running column is the exact arithmetic behind the headline number — nothing is hidden.
        </p>
      </div>
    </>
  );
}
