/**
 * Membership windows for the flat, derived from the assignment narrative:
 *   "Meera moved out at the end of March, and Sam moved in mid-April."
 *   "Dev joined them for a trip" -> Dev is a guest, not a flatmate.
 *
 * These windows are the single source of truth for two questions the data forces:
 *   - Sam: "Why would March electricity affect my balance?"  -> it doesn't,
 *     because Sam's window starts in April; he is never a valid participant
 *     in a March expense.
 *   - Meera: should she owe an April expense she was still listed on? -> no,
 *     because her window ends 2026-03-31; the importer drops her from any
 *     post-departure split (and flags it for her approval).
 *
 * role "guest" (Dev, Kabir) is exempt from window enforcement: a guest is only
 * ever present because they were explicitly listed on a specific expense.
 */

export interface MemberWindow {
  name: string;
  joinedAt: string; // ISO date, inclusive
  leftAt: string | null; // ISO date, inclusive; null = still a member
  role: "member" | "guest";
}

export const DEFAULT_MEMBERSHIP: MemberWindow[] = [
  { name: "Aisha", joinedAt: "2026-02-01", leftAt: null, role: "member" },
  { name: "Rohan", joinedAt: "2026-02-01", leftAt: null, role: "member" },
  { name: "Priya", joinedAt: "2026-02-01", leftAt: null, role: "member" },
  { name: "Meera", joinedAt: "2026-02-01", leftAt: "2026-03-31", role: "member" },
  // Sam paid his deposit on 2026-04-08 ("Sam moving in!"); that is his join date.
  { name: "Sam", joinedAt: "2026-04-08", leftAt: null, role: "member" },
  // Guests: present only on the expenses that explicitly list them.
  { name: "Dev", joinedAt: "2026-02-08", leftAt: null, role: "guest" },
  { name: "Kabir", joinedAt: "2026-03-11", leftAt: "2026-03-11", role: "guest" },
];

/** Is `name` a liable member on `dateIso`? Guests are always allowed when listed. */
export function isActiveMember(
  windows: MemberWindow[],
  name: string,
  dateIso: string,
): { active: boolean; known: boolean; role?: string } {
  const w = windows.find((m) => m.name === name);
  if (!w) return { active: true, known: false }; // unknown person: don't block, importer flags separately
  if (w.role === "guest") return { active: true, known: true, role: "guest" };
  const afterJoin = dateIso >= w.joinedAt;
  const beforeLeave = w.leftAt === null || dateIso <= w.leftAt;
  return { active: afterJoin && beforeLeave, known: true, role: "member" };
}
