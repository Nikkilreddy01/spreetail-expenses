import Link from "next/link";

const TABS = [
  { slug: "", label: "Balances" },
  { slug: "expenses", label: "Expenses" },
  { slug: "import", label: "Import report" },
];

export function GroupTabs({ groupId, active }: { groupId: string; active: string }) {
  return (
    <div className="tabs">
      {TABS.map((t) => {
        const href = t.slug ? `/groups/${groupId}/${t.slug}` : `/groups/${groupId}`;
        return (
          <Link key={t.slug} href={href} className={active === t.slug ? "active" : ""}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Money cell coloured by sign. paise is signed. */
export function Money({ paise }: { paise: number }) {
  const cls = paise > 0 ? "pos" : paise < 0 ? "neg" : "zero";
  const rupees = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Math.abs(paise) / 100,
  );
  return (
    <span className={`num ${cls}`}>
      {paise < 0 ? "−" : ""}₹{rupees}
    </span>
  );
}
