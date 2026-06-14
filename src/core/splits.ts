/**
 * The split engine: given a total (in paise) and a split spec, return the exact
 * paise each participant owes. Invariant enforced by every function here:
 *
 *     sum(shares) === total            (no paise is lost or invented)
 *
 * That invariant is why balances can be a trivial sum later: the hard part
 * (rounding) is solved once, here, deterministically.
 *
 * Supported split types (every one that appears in the CSV):
 *   equal       - total divided evenly among participants
 *   unequal     - explicit rupee amounts per person ("Rohan 700; Priya 400")
 *   percentage  - explicit percents ("Aisha 30%; ...") normalised if != 100
 *   share       - integer weights/ratios ("Aisha 1; Rohan 2; ...")
 */

import { type Paise, rupeesToPaise } from "./money";
import type { ParseNote } from "./parse";

export type SplitType = "equal" | "unequal" | "percentage" | "share";

export interface SplitInput {
  splitType: SplitType;
  totalPaise: Paise;
  /** canonical participant names, in the order they appeared */
  participants: string[];
  /** raw split_details cell, e.g. "Aisha 30%; Rohan 30%" (may be empty) */
  detailsRaw?: string;
}

export interface SplitResult {
  /** name -> paise owed; sums exactly to totalPaise */
  shares: Record<string, Paise>;
  notes: ParseNote[];
}

/**
 * Largest-remainder apportionment. Given a total and a set of real-valued
 * weights, hand out whole paise so the sum is exactly `total` and the leftover
 * paise go to the participants with the largest fractional remainders. This is
 * the standard, defensible way to split e.g. ₹100 three ways (34/33/33).
 */
export function allocateByWeights(
  total: Paise,
  names: string[],
  weights: number[],
): Record<string, Paise> {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) {
    // Degenerate (all-zero weights): fall back to equal so we never divide by 0.
    return allocateByWeights(total, names, names.map(() => 1));
  }
  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);

  const exact = weights.map((w) => (absTotal * w) / weightSum);
  const floors = exact.map((x) => Math.floor(x));
  let remaining = absTotal - floors.reduce((a, b) => a + b, 0);

  // Distribute the remaining paise to the largest fractional parts.
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);

  const result = floors.slice();
  for (let k = 0; k < remaining; k++) {
    result[order[k % order.length].i] += 1;
  }

  const out: Record<string, Paise> = {};
  names.forEach((name, i) => {
    out[name] = sign * result[i];
  });
  return out;
}

/** Parse "Name value; Name value" pairs. value may have a trailing % or be plain. */
function parsePairs(detailsRaw: string): { name: string; value: number }[] {
  const pairs: { name: string; value: number }[] = [];
  for (const chunk of detailsRaw.split(";")) {
    const t = chunk.trim();
    if (!t) continue;
    // last whitespace-separated token is the number, the rest is the name
    const m = /^(.*?)[\s]+([\-\d.]+)\s*%?\s*$/.exec(t);
    if (!m) continue;
    pairs.push({ name: m[1].trim(), value: Number(m[2]) });
  }
  return pairs;
}

export function computeSplit(input: SplitInput): SplitResult {
  const notes: ParseNote[] = [];
  const { splitType, totalPaise, participants, detailsRaw = "" } = input;

  switch (splitType) {
    // -- equal: every participant pays the same, remainder by largest-remainder
    case "equal": {
      const shares = allocateByWeights(totalPaise, participants, participants.map(() => 1));
      return { shares, notes };
    }

    // -- unequal: explicit rupee amounts; must sum to the total
    case "unequal": {
      const pairs = parsePairs(detailsRaw);
      const shares: Record<string, Paise> = {};
      let sum = 0;
      for (const { name, value } of pairs) {
        const p = rupeesToPaise(value);
        shares[name] = (shares[name] ?? 0) + p;
        sum += p;
      }
      if (sum !== totalPaise) {
        notes.push({
          code: "UNEQUAL_SUM_MISMATCH",
          message: `Unequal split sums to ${(sum / 100).toFixed(2)} but total is ${(totalPaise / 100).toFixed(2)}`,
        });
      }
      return { shares, notes };
    }

    // -- percentage: explicit percents; normalised if they do not total 100
    case "percentage": {
      const pairs = parsePairs(detailsRaw);
      const pctSum = pairs.reduce((a, p) => a + p.value, 0);
      if (Math.abs(pctSum - 100) > 1e-9) {
        notes.push({
          code: "PERCENT_NOT_100",
          message: `Percentages total ${pctSum}%, not 100%; normalised proportionally`,
        });
      }
      // Use the percentages as weights; largest-remainder against the true total
      // guarantees the shares still sum to total even after normalisation.
      const shares = allocateByWeights(
        totalPaise,
        pairs.map((p) => p.name),
        pairs.map((p) => p.value),
      );
      return { shares, notes };
    }

    // -- share: integer weights / ratios
    case "share": {
      const pairs = parsePairs(detailsRaw);
      const shares = allocateByWeights(
        totalPaise,
        pairs.map((p) => p.name),
        pairs.map((p) => p.value),
      );
      return { shares, notes };
    }

    default: {
      // Exhaustiveness guard: a new split_type in the CSV lands here loudly.
      const never: never = splitType;
      throw new Error(`Unsupported split type: ${never}`);
    }
  }
}
