/**
 * Currency conversion for the trip-in-dollars problem (Priya's request).
 *
 * The spreadsheet "pretends a dollar is a rupee". We fix that by converting
 * every non-INR amount into the group's base currency (INR) at import time,
 * while preserving the original amount + currency on the expense for the audit
 * trail.
 *
 * Rate policy (documented in DECISIONS.md): we use a SINGLE FIXED rate per
 * currency, not a live or per-date rate. Rationale:
 *   - The trip happened over a few days in March 2026; intraday FX noise is
 *     irrelevant to splitting a villa booking four ways.
 *   - A fixed, committed rate is reproducible: the same CSV always yields the
 *     same balances, which the live evaluation can re-derive by hand.
 *   - A live API would make imports non-deterministic and add a failure mode.
 * The rate is therefore a product decision, surfaced in the import report so
 * the flat can see exactly what was used and change it if they disagree.
 */

/** INR per 1 unit of the given currency. */
export const FX_RATES: Record<string, number> = {
  INR: 1,
  USD: 83, // 1 USD = ₹83 (fixed rate as of the March 2026 trip)
};

export function isKnownCurrency(currency: string): boolean {
  return currency in FX_RATES;
}

/**
 * Convert an integer-paise amount in `from` currency to integer-paise in `to`.
 * Paise here means 1/100 of the respective currency unit (so USD "paise" = cents).
 */
export function convertPaise(
  amountPaise: number,
  from: string,
  to: string,
): { paise: number; rate: number } {
  const fromRate = FX_RATES[from];
  const toRate = FX_RATES[to];
  if (fromRate === undefined || toRate === undefined) {
    throw new Error(`Unknown currency in conversion: ${from} -> ${to}`);
  }
  // rate = INR-per-from / INR-per-to  (e.g. USD->INR = 83/1 = 83)
  const rate = fromRate / toRate;
  const sign = amountPaise < 0 ? -1 : 1;
  const converted = sign * Math.round(Math.abs(amountPaise) * rate);
  return { paise: converted, rate };
}
