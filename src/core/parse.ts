/**
 * Field-level parsers for the messy CSV. Each parser returns BOTH the cleaned
 * value AND a list of notes describing what it had to fix, so the importer can
 * turn those notes into anomalies for the report. Nothing here touches the DB.
 */

import { roundToPaise, type Paise } from "./money";

export interface ParseNote {
  code: string;
  message: string;
  /** original text as it appeared in the cell */
  raw?: string;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * Canonical names for the people in this dataset, plus known aliases. We keep
 * this explicit (rather than fuzzy-matching) so identity decisions are
 * reviewable: "Priya S" collapsing into "Priya" is a deliberate, documented
 * choice, not an accident of a similarity threshold.
 */
const NAME_ALIASES: Record<string, string> = {
  priya: "Priya",
  "priya s": "Priya", // assumed same person; flagged for review on import
  rohan: "Rohan",
  aisha: "Aisha",
  meera: "Meera",
  dev: "Dev",
  sam: "Sam",
  // A guest who joined the trip for one day. Kept as their own person so the
  // parasailing split is honoured, but they are not a flat member.
  "dev's friend kabir": "Kabir",
  kabir: "Kabir",
};

export interface NameResult {
  name: string | null;
  notes: ParseNote[];
}

/** Normalise one name cell to a canonical person, recording what was changed. */
export function parseName(raw: string): NameResult {
  const notes: ParseNote[] = [];
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { name: null, notes: [{ code: "MISSING_NAME", message: "Empty name", raw }] };
  }
  const key = trimmed.toLowerCase().replace(/\s+/g, " ");
  const canonical = NAME_ALIASES[key];
  if (!canonical) {
    // Unknown name: title-case it and pass through, but flag it.
    const titled = trimmed.replace(/\b\w/g, (c) => c.toUpperCase());
    notes.push({
      code: "UNKNOWN_NAME",
      message: `Name "${trimmed}" is not a known member; kept as "${titled}"`,
      raw,
    });
    return { name: titled, notes };
  }
  if (canonical.toLowerCase() !== trimmed.toLowerCase()) {
    notes.push({
      code: "NAME_NORMALIZED",
      message: `Name "${raw}" normalised to "${canonical}"`,
      raw,
    });
  }
  return { name: canonical, notes };
}

/** Parse a "Aisha;Rohan;Priya" participant list into canonical names. */
export function parseNameList(raw: string): { names: string[]; notes: ParseNote[] } {
  const notes: ParseNote[] = [];
  const names: string[] = [];
  for (const part of raw.split(";")) {
    if (part.trim() === "") continue;
    const r = parseName(part);
    notes.push(...r.notes);
    if (r.name) names.push(r.name);
  }
  return { names, notes };
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

export interface AmountResult {
  paise: Paise | null;
  notes: ParseNote[];
}

/**
 * Parse an amount cell into integer paise. Handles:
 *   "1,200"   -> thousands separator
 *   " 1450 "  -> surrounding whitespace
 *   899.995   -> sub-paise precision (rounded, flagged)
 *   -30       -> negative (kept; the importer decides refund vs error)
 *   0         -> zero (kept; flagged as a no-op by the importer)
 */
export function parseAmount(raw: string): AmountResult {
  const notes: ParseNote[] = [];
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { paise: null, notes: [{ code: "MISSING_AMOUNT", message: "Empty amount", raw }] };
  }
  if (trimmed !== raw) {
    notes.push({ code: "AMOUNT_WHITESPACE", message: `Amount "${raw}" had surrounding whitespace`, raw });
  }

  // Strip thousands separators (commas). We only treat a comma as a grouping
  // separator (Indian/Western), never a decimal point, because every decimal
  // in this file uses ".".
  let cleaned = trimmed;
  if (cleaned.includes(",")) {
    notes.push({ code: "AMOUNT_THOUSANDS_SEP", message: `Amount "${raw}" used a thousands separator`, raw });
    cleaned = cleaned.replace(/,/g, "");
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    return { paise: null, notes: [{ code: "BAD_AMOUNT", message: `Amount "${raw}" is not a number`, raw }] };
  }

  // Detect sub-paise precision (more than 2 decimal places) before rounding.
  const decimals = (cleaned.split(".")[1] ?? "").length;
  const paiseFloat = value * 100;
  const paise = roundToPaise(paiseFloat);
  if (decimals > 2) {
    notes.push({
      code: "AMOUNT_SUBPAISE",
      message: `Amount "${raw}" had ${decimals} decimal places; rounded to ${(paise / 100).toFixed(2)}`,
      raw,
    });
  }
  return { paise, notes };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export interface DateResult {
  /** ISO yyyy-mm-dd, or null if unparseable */
  iso: string | null;
  /** true if the format was inherently ambiguous (e.g. 04/05/2026) */
  ambiguous: boolean;
  notes: ParseNote[];
}

/**
 * Parse a date cell. The file mixes:
 *   2026-02-01     ISO
 *   01/03/2026     DD/MM/YYYY  (we assume day-first, matching the rest of the file)
 *   Mar 14         "Mon DD" with no year (assume the dataset year, 2026)
 *   04/05/2026     genuinely ambiguous (April 5 vs May 4) -> flagged
 *
 * DEFAULT_YEAR is the year the dataset belongs to; passed in so the parser
 * stays pure (no reliance on the system clock, which keeps tests deterministic).
 */
export function parseDate(raw: string, defaultYear = 2026): DateResult {
  const notes: ParseNote[] = [];
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { iso: null, ambiguous: false, notes: [{ code: "MISSING_DATE", message: "Empty date", raw }] };
  }

  // ISO yyyy-mm-dd
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (m) {
    return { iso: `${m[1]}-${m[2]}-${m[3]}`, ambiguous: false, notes };
  }

  // DD/MM/YYYY (day-first, the dominant slash format in this file)
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    // Ambiguous only when BOTH components are valid as a month (<=12) and
    // they differ — then DD/MM vs MM/DD genuinely disagree.
    const ambiguous = day <= 12 && month <= 12 && day !== month;
    if (ambiguous) {
      notes.push({
        code: "DATE_AMBIGUOUS",
        message: `Date "${raw}" is ambiguous (DD/MM vs MM/DD); read as day-first = ${pad(year)}-${pad(month)}-${pad(day)}`,
        raw,
      });
    } else {
      notes.push({ code: "DATE_FORMAT", message: `Date "${raw}" parsed as day-first DD/MM/YYYY`, raw });
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return { iso: null, ambiguous, notes: [...notes, { code: "BAD_DATE", message: `Date "${raw}" out of range`, raw }] };
    }
    return { iso: `${pad(year)}-${pad(month)}-${pad(day)}`, ambiguous, notes };
  }

  // "Mar 14" — month name + day, no year
  m = /^([A-Za-z]{3,})\.?\s+(\d{1,2})$/.exec(trimmed);
  if (m) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    const day = Number(m[2]);
    if (month) {
      notes.push({
        code: "DATE_NO_YEAR",
        message: `Date "${raw}" had no year; assumed ${defaultYear}`,
        raw,
      });
      return { iso: `${pad(defaultYear)}-${pad(month)}-${pad(day)}`, ambiguous: false, notes };
    }
  }

  return { iso: null, ambiguous: false, notes: [{ code: "BAD_DATE", message: `Date "${raw}" is unrecognised`, raw }] };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
