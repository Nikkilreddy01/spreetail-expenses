import { describe, it, expect } from "vitest";
import { parseAmount, parseDate, parseName, parseNameList } from "../parse";

describe("parseAmount", () => {
  it("strips thousands separators", () => {
    const r = parseAmount("1,200");
    expect(r.paise).toBe(120000);
    expect(r.notes.map((n) => n.code)).toContain("AMOUNT_THOUSANDS_SEP");
  });

  it("trims surrounding whitespace and flags it", () => {
    const r = parseAmount(" 1450 ");
    expect(r.paise).toBe(145000);
    expect(r.notes.map((n) => n.code)).toContain("AMOUNT_WHITESPACE");
  });

  it("rounds sub-paise precision and flags it", () => {
    const r = parseAmount("899.995");
    expect(r.paise).toBe(90000);
    expect(r.notes.map((n) => n.code)).toContain("AMOUNT_SUBPAISE");
  });

  it("keeps negatives (refund decision is the importer's)", () => {
    expect(parseAmount("-30").paise).toBe(-3000);
  });

  it("keeps zero", () => {
    expect(parseAmount("0").paise).toBe(0);
  });

  it("reports empty amount as missing", () => {
    const r = parseAmount("");
    expect(r.paise).toBeNull();
    expect(r.notes[0].code).toBe("MISSING_AMOUNT");
  });
});

describe("parseDate", () => {
  it("parses ISO unchanged", () => {
    expect(parseDate("2026-02-01").iso).toBe("2026-02-01");
  });

  it("parses DD/MM/YYYY day-first", () => {
    const r = parseDate("01/03/2026");
    expect(r.iso).toBe("2026-03-01");
  });

  it("flags genuinely ambiguous dates", () => {
    const r = parseDate("04/05/2026");
    expect(r.iso).toBe("2026-05-04"); // day-first
    expect(r.ambiguous).toBe(true);
    expect(r.notes.map((n) => n.code)).toContain("DATE_AMBIGUOUS");
  });

  it("is not ambiguous when one component > 12", () => {
    const r = parseDate("15/03/2026");
    expect(r.iso).toBe("2026-03-15");
    expect(r.ambiguous).toBe(false);
  });

  it("assumes the dataset year for 'Mar 14'", () => {
    const r = parseDate("Mar 14", 2026);
    expect(r.iso).toBe("2026-03-14");
    expect(r.notes.map((n) => n.code)).toContain("DATE_NO_YEAR");
  });
});

describe("parseName", () => {
  it("normalises case and aliases", () => {
    expect(parseName("priya").name).toBe("Priya");
    expect(parseName("rohan ").name).toBe("Rohan");
    expect(parseName("Priya S").name).toBe("Priya");
  });

  it("maps the guest alias", () => {
    expect(parseName("Dev's friend Kabir").name).toBe("Kabir");
  });

  it("returns null for empty", () => {
    expect(parseName("").name).toBeNull();
  });

  it("parses a semicolon list", () => {
    const r = parseNameList("Aisha;Rohan;Priya;Meera");
    expect(r.names).toEqual(["Aisha", "Rohan", "Priya", "Meera"]);
  });
});
