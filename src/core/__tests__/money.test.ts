import { describe, it, expect } from "vitest";
import { roundToPaise, rupeesToPaise, formatPaise, paiseToRupees } from "../money";

describe("money", () => {
  it("rounds sub-paise half away from zero, symmetric for negatives", () => {
    expect(roundToPaise(89999.5)).toBe(90000); // 899.995 -> 900.00
    expect(roundToPaise(-89999.5)).toBe(-90000); // -899.995 -> -900.00
    expect(roundToPaise(12344.4)).toBe(12344);
  });

  it("converts rupees to paise without float drift", () => {
    expect(rupeesToPaise(1200)).toBe(120000);
    expect(rupeesToPaise(899.995)).toBe(90000);
    expect(rupeesToPaise(0)).toBe(0);
    expect(rupeesToPaise(-30)).toBe(-3000);
  });

  it("round-trips paise to rupees for display", () => {
    expect(paiseToRupees(120000)).toBe(1200);
  });

  it("formats with Indian grouping and currency symbol", () => {
    expect(formatPaise(120000)).toBe("₹1,200.00");
    expect(formatPaise(-3000)).toBe("-₹30.00");
    expect(formatPaise(4482000, "INR")).toBe("₹44,820.00");
  });
});
