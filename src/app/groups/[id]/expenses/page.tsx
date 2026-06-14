import { notFound } from "next/navigation";
import { requireUser } from "@/lib/guard";
import { loadGroupData } from "@/lib/queries";
import { Topbar } from "../../../_components/Topbar";
import { GroupTabs, Money } from "../../../_components/GroupTabs";
import { AddExpenseForm } from "./AddExpenseForm";

export default async function ExpensesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const { group, expenses, settlements } = await loadGroupData(id);
  if (!group) notFound();

  const memberNames = group.memberships.map((m) => m.user.name);

  return (
    <>
      <Topbar userName={user.name} />
      <div className="container">
        <h1>{group.name} — expenses</h1>
        <p className="sub">{expenses.filter((e) => !e.suppressed).length} active expenses · {settlements.length} settlements.</p>
        <GroupTabs groupId={id} active="expenses" />

        <h2>Add an expense</h2>
        <div className="card">
          <AddExpenseForm groupId={id} members={memberNames} />
        </div>

        <h2>Expenses</h2>
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Description</th><th>Paid by</th>
                <th className="num">Amount</th><th>Split</th><th>Shares</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} style={e.suppressed ? { opacity: 0.45 } : undefined}>
                  <td className="mono small">{e.date.toISOString().slice(0, 10)}</td>
                  <td>
                    {e.description}
                    {e.suppressed && <span className="pill rejected" style={{ marginLeft: 6 }}>dropped: {e.suppressedReason}</span>}
                    {e.notes && <div className="muted small">{e.notes}</div>}
                  </td>
                  <td>{e.paidBy.name}</td>
                  <td>
                    <Money paise={e.amountPaise} />
                    {e.originalCurrency !== group.baseCurrency && (
                      <div className="muted small">
                        was {e.originalCurrency} {(e.originalAmountPaise / 100).toFixed(2)} @ {e.fxRate}
                      </div>
                    )}
                  </td>
                  <td><span className="pill info">{e.splitType}</span></td>
                  <td className="small">
                    {e.splits.map((s) => (
                      <div key={s.id}>
                        {s.user.name}: <span className="mono">₹{(s.sharePaise / 100).toFixed(2)}</span>
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {settlements.length > 0 && (
          <>
            <h2>Settlements</h2>
            <div className="card">
              <table>
                <thead><tr><th>Date</th><th>From</th><th>To</th><th className="num">Amount</th><th>Note</th></tr></thead>
                <tbody>
                  {settlements.map((s) => (
                    <tr key={s.id}>
                      <td className="mono small">{s.date.toISOString().slice(0, 10)}</td>
                      <td className="neg">{s.payer.name}</td>
                      <td className="pos">{s.payee.name}</td>
                      <td><Money paise={s.amountPaise} /></td>
                      <td className="muted small">{s.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
