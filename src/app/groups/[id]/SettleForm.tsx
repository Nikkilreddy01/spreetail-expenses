"use client";

import { recordSettlementAction } from "../../actions";

export function SettleForm({ groupId, members }: { groupId: string; members: string[] }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={recordSettlementAction}>
      <input type="hidden" name="groupId" value={groupId} />
      <div className="row">
        <div>
          <label htmlFor="payer">Payer</label>
          <select id="payer" name="payer" required>
            {members.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="payee">Payee</label>
          <select id="payee" name="payee" required>
            {members.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label htmlFor="amount">Amount (₹)</label>
          <input id="amount" name="amount" type="number" step="0.01" min="0.01" required />
        </div>
        <div>
          <label htmlFor="date">Date</label>
          <input id="date" name="date" type="date" defaultValue={today} required />
        </div>
      </div>
      <button type="submit" style={{ marginTop: 14 }}>Record payment</button>
    </form>
  );
}
