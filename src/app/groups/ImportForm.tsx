"use client";

import { useActionState } from "react";
import { importAction } from "../actions";

export function ImportForm() {
  const [state, formAction, pending] = useActionState(importAction, { error: "" } as { error: string });
  return (
    <form action={formAction}>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div>
          <label htmlFor="groupName">Group name</label>
          <input id="groupName" name="groupName" defaultValue="Flat 4B" />
        </div>
        <div>
          <label htmlFor="file">CSV file</label>
          <input id="file" name="file" type="file" accept=".csv,text/csv" required />
        </div>
        <button type="submit" disabled={pending}>{pending ? "Importing…" : "Import"}</button>
      </div>
      {state?.error ? <div className="error-text">{state.error}</div> : null}
    </form>
  );
}
