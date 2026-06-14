"use client";

import { useState } from "react";
import { addExpenseAction } from "../../../actions";

const SPLIT_HELP: Record<string, string> = {
  equal: "Split evenly among the selected people. No details needed.",
  unequal: "Exact rupee amounts per person, e.g. “Rohan 700; Priya 400; Meera 400”. Must sum to the total.",
  percentage: "Percents per person, e.g. “Aisha 30%; Rohan 30%; …”. Normalised if they don’t total 100.",
  share: "Integer weights, e.g. “Aisha 1; Rohan 2; …”. Cost is split in that ratio.",
};

export function AddExpenseForm({ groupId, members }: { groupId: string; members: string[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [splitType, setSplitType] = useState("equal");
  const needsDetails = splitType !== "equal";

  return (
    <form action={addExpenseAction}>
      <input type="hidden" name="groupId" value={groupId} />
      <div className="row">
        <div style={{ flex: 2 }}>
          <label htmlFor="description">Description</label>
          <input id="description" name="description" required style={{ width: "100%" }} placeholder="Groceries" />
        </div>
        <div>
          <label htmlFor="amount">Amount (₹)</label>
          <input id="amount" name="amount" type="number" step="0.01" min="0" required />
        </div>
        <div>
          <label htmlFor="date">Date</label>
          <input id="date" name="date" type="date" defaultValue={today} required />
        </div>
      </div>

      <div className="row">
        <div>
          <label htmlFor="paidBy">Paid by</label>
          <select id="paidBy" name="paidBy" required>
            {members.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="splitType">Split type</label>
          <select id="splitType" name="splitType" value={splitType} onChange={(e) => setSplitType(e.target.value)}>
            <option value="equal">equal</option>
            <option value="unequal">unequal</option>
            <option value="percentage">percentage</option>
            <option value="share">share</option>
          </select>
        </div>
      </div>

      <label>Participants</label>
      <div className="row">
        {members.map((m) => (
          <label key={m} className="row small" style={{ gap: 6, margin: 0 }}>
            <input type="checkbox" name="participants" value={m} defaultChecked style={{ width: "auto" }} />
            {m}
          </label>
        ))}
      </div>

      {needsDetails && (
        <>
          <label htmlFor="splitDetails">Split details</label>
          <input id="splitDetails" name="splitDetails" style={{ width: "100%" }} placeholder="Aisha 30%; Rohan 30%; …" />
        </>
      )}
      <p className="muted small">{SPLIT_HELP[splitType]}</p>

      <button type="submit">Add expense</button>
    </form>
  );
}
