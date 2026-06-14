import Link from "next/link";
import { logoutAction } from "../actions";

export function Topbar({ userName }: { userName?: string }) {
  return (
    <div className="topbar">
      <Link href="/groups" className="brand">
        Flat <span>Expenses</span>
      </Link>
      <div className="row">
        {userName ? <span className="muted small">{userName}</span> : null}
        <form action={logoutAction}>
          <button className="ghost small" type="submit">Sign out</button>
        </form>
      </div>
    </div>
  );
}
