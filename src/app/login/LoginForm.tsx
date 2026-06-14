"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, { error: "" } as { error: string });
  return (
    <form action={formAction}>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" placeholder="aisha@flat.local" required style={{ width: "100%" }} />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" placeholder="password" required style={{ width: "100%" }} />
      <button type="submit" disabled={pending} style={{ width: "100%", marginTop: 16 }}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {state?.error ? <div className="error-text">{state.error}</div> : null}
    </form>
  );
}
