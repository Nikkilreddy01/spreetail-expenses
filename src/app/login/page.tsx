import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/groups");
  // Show which logins exist so the reviewer can sign in immediately.
  const members = await prisma.user.findMany({
    where: { memberships: { some: { role: "member" } } },
    select: { name: true, email: true },
    orderBy: { name: "asc" },
  });
  return (
    <div className="center-screen">
      <div className="card login-card">
        <div className="brand" style={{ fontWeight: 700, fontSize: 20, marginBottom: 2 }}>
          Flat 4B <span style={{ color: "var(--accent)" }}>Expenses</span>
        </div>
        <p className="sub small">Sign in to see balances and import the spreadsheet.</p>
        <LoginForm />
        {members.length > 0 && (
          <div className="small muted" style={{ marginTop: 16 }}>
            Demo logins (password <span className="mono">password</span>):
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {members.map((m) => (
                <li key={m.email} className="mono">{m.email}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
