/**
 * Money is represented as an integer number of PAISE (1 INR = 100 paise).
 *
 * Why integers: floating point cannot represent 0.1 exactly, so summing many
 * rupee-and-paise figures as floats drifts. Storing paise as integers makes
 * every total exact and every rounding decision explicit and testable.
 *
 * The only place fractional paise can appear is a raw CSV amount like 899.995
 * (sub-paise) or a percentage/share split that does not divide evenly. Both are
 * resolved by an explicit rounding policy (see roundToPaise and the split
 * engine's largest-remainder allocation), never by silent float truncation.
 */

export type Paise = number; // integer

/** Rupees (possibly fractional) -> integer paise, banker-free half-up rounding. */
export function rupeesToPaise(rupees: number): Paise {
  return roundToPaise(rupees * 100);
}

/** Round a possibly-fractional paise value to a whole paise (half away from zero). */
export function roundToPaise(paiseFloat: number): Paise {
  // Math.round rounds .5 toward +Infinity, which is asymmetric for negatives
  // (e.g. -0.5 -> -0). We want symmetric "half away from zero" so a -30.5 refund
  // rounds the same magnitude as +30.5.
  const sign = paiseFloat < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(paiseFloat));
}

/** Integer paise -> rupees number (for display / FX math only, never for storage). */
export function paiseToRupees(paise: Paise): number {
  return paise / 100;
}

/** Format paise as "₹1,234.56" using the Indian digit grouping. */
export function formatPaise(paise: Paise, currency = "INR"): string {
  const rupees = paiseToRupees(Math.abs(paise));
  const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : "";
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
  return `${paise < 0 ? "-" : ""}${symbol}${formatted}`;
}

/** Sum a list of paise values. Kept explicit so the type stays integer. */
export function sumPaise(values: Paise[]): Paise {
  return values.reduce((acc, v) => acc + v, 0);
}
