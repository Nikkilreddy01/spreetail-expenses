/**
 * A minimal RFC-4180 CSV parser. We hand-roll it (rather than pull a library)
 * for two reasons: (1) the live review can read every line of how a quoted
 * "1,200" stays one field, and (2) zero dependencies in the hot path.
 *
 * Handles: quoted fields, commas and newlines inside quotes, and escaped
 * double-quotes ("" -> "). Returns rows of string cells, trimming the trailing
 * newline but NOT the cell contents (the field parsers decide about whitespace).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  // Normalise CRLF -> LF so a stray \r never sneaks into a cell.
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'; // escaped quote
          i++;
        } else {
          inQuotes = false; // closing quote
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
  }
  // Flush the last field/row if the file did not end with a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty trailing rows (e.g. a blank final line).
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}
