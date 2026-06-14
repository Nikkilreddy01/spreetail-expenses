import { notFound } from "next/navigation";
import { requireUser } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { Topbar } from "../../../_components/Topbar";
import { GroupTabs } from "../../../_components/GroupTabs";
import { reviewAnomalyAction } from "../../../actions";

export default async function ImportReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const batch = await prisma.importBatch.findFirst({
    where: { groupId: id },
    orderBy: { createdAt: "desc" },
    include: { anomalies: { orderBy: [{ sourceRow: "asc" }] } },
  });
  if (!batch) notFound();

  const pending = batch.anomalies.filter((a) => a.reviewStatus === "pending");
  const reviewed = batch.anomalies.filter((a) => a.reviewStatus === "approved" || a.reviewStatus === "rejected");
  const auto = batch.anomalies.filter((a) => a.reviewStatus === "auto");

  return (
    <>
      <Topbar userName={user.name} />
      <div className="container">
        <h1>Import report</h1>
        <p className="sub">
          From <span className="mono">{batch.filename}</span> — every problem the importer found and what it did.
        </p>
        <GroupTabs groupId={id} active="import" />

        <div className="grid cols-2">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Summary</h3>
            <table>
              <tbody>
                <tr><td>Rows read</td><td className="num">{batch.totalRows}</td></tr>
                <tr><td>Expenses imported</td><td className="num">{batch.importedExpenses}</td></tr>
                <tr><td>Settlements recorded</td><td className="num">{batch.importedSettlements}</td></tr>
                <tr><td>Rows skipped</td><td className="num">{batch.skippedRows}</td></tr>
                <tr><td>Anomalies detected</td><td className="num">{batch.anomalies.length}</td></tr>
                <tr><td>Awaiting approval</td><td className="num">{pending.length}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>How to read this</h3>
            <p className="small muted" style={{ marginTop: 0 }}>
              <strong>Auto</strong> changes are lossless normalisations (date formats, name spelling, currency
              conversion) applied silently but logged. <strong>Pending</strong> changes delete or alter who-owes-what
              — they are applied by default so balances work now, but Meera can approve or reject each one.
            </p>
          </div>
        </div>

        <h2>Changes awaiting approval ({pending.length})</h2>
        {pending.length === 0 ? (
          <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing pending — every change has been reviewed.</p></div>
        ) : (
          <div className="card">
            <table>
              <thead>
                <tr><th>Row</th><th>Problem</th><th>What the app did</th><th>Decision</th></tr>
              </thead>
              <tbody>
                {pending.map((a) => (
                  <tr key={a.id}>
                    <td className="mono">{a.sourceRow ?? "—"}</td>
                    <td><span className={`pill ${a.severity}`}>{a.code}</span></td>
                    <td className="small">{a.message}</td>
                    <td>
                      <div className="row">
                        <form action={reviewAnomalyAction}>
                          <input type="hidden" name="anomalyId" value={a.id} />
                          <input type="hidden" name="groupId" value={id} />
                          <input type="hidden" name="decision" value="approved" />
                          <button className="small" type="submit">Approve</button>
                        </form>
                        <form action={reviewAnomalyAction}>
                          <input type="hidden" name="anomalyId" value={a.id} />
                          <input type="hidden" name="groupId" value={id} />
                          <input type="hidden" name="decision" value="rejected" />
                          <button className="small ghost" type="submit">Reject</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small" style={{ marginBottom: 0 }}>
              Rejecting a duplicate brings the dropped copy back into balances; approving keeps it removed.
            </p>
          </div>
        )}

        {reviewed.length > 0 && (
          <>
            <h2>Reviewed ({reviewed.length})</h2>
            <div className="card">
              <table>
                <thead><tr><th>Row</th><th>Problem</th><th>Message</th><th>Decision</th></tr></thead>
                <tbody>
                  {reviewed.map((a) => (
                    <tr key={a.id}>
                      <td className="mono">{a.sourceRow ?? "—"}</td>
                      <td><span className={`pill ${a.severity}`}>{a.code}</span></td>
                      <td className="small">{a.message}</td>
                      <td><span className={`pill ${a.reviewStatus}`}>{a.reviewStatus}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <h2>All detected anomalies ({auto.length} auto-handled)</h2>
        <div className="card">
          <table>
            <thead>
              <tr><th>Row</th><th>Code</th><th>Severity</th><th>Action</th><th>Message</th></tr>
            </thead>
            <tbody>
              {auto.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{a.sourceRow ?? "—"}</td>
                  <td className="small">{a.code}</td>
                  <td><span className={`pill ${a.severity}`}>{a.severity}</span></td>
                  <td className="small muted">{a.action}</td>
                  <td className="small">{a.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
