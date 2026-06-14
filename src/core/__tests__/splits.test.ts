import { describe, it, expect } from "vitest";
import { computeSplit, allocateByWeights } from "../splits";

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe("allocateByWeights", () => {
  it("splits 100.00 three ways with no lost paise", () => {
    const r = allocateByWeights(10000, ["A", "B", "C"], [1, 1, 1]);
    expect(sum(r)).toBe(10000);
    // largest-remainder gives the extra paise to the first comers
    expect(Object.values(r).sort()).toEqual([3333, 3333, 3334]);
  });

  it("preserves sign for refunds", () => {
    const r = allocateByWeights(-3000, ["A", "B", "C", "D"], [1, 1, 1, 1]);
    expect(sum(r)).toBe(-3000);
  });
});

describe("computeSplit", () => {
  it("equal split sums to total", () => {
    const { shares } = computeSplit({
      splitType: "equal",
      totalPaise: 234000,
      participants: ["Aisha", "Rohan", "Priya", "Meera"],
    });
    expect(sum(shares)).toBe(234000);
  });

  it("unequal split uses explicit amounts and flags a mismatch", () => {
    const { shares, notes } = computeSplit({
      splitType: "unequal",
      totalPaise: 150000,
      participants: ["Rohan", "Priya", "Meera"],
      detailsRaw: "Rohan 700; Priya 400; Meera 400",
    });
    expect(shares).toEqual({ Rohan: 70000, Priya: 40000, Meera: 40000 });
    expect(sum(shares)).toBe(150000);
    expect(notes.length).toBe(0);
  });

  it("percentage split normalises when it does not total 100", () => {
    const { shares, notes } = computeSplit({
      splitType: "percentage",
      totalPaise: 144000,
      participants: ["Aisha", "Rohan", "Priya", "Meera"],
      detailsRaw: "Aisha 30%; Rohan 30%; Priya 30%; Meera 20%", // = 110%
    });
    expect(sum(shares)).toBe(144000); // still exact after normalising
    expect(notes.map((n) => n.code)).toContain("PERCENT_NOT_100");
    // Aisha/Rohan/Priya equal, Meera less
    expect(shares.Aisha).toBe(shares.Rohan);
    expect(shares.Meera).toBeLessThan(shares.Aisha);
  });

  it("share split uses integer ratios", () => {
    const { shares } = computeSplit({
      splitType: "share",
      totalPaise: 360000,
      participants: ["Aisha", "Rohan", "Priya", "Dev"],
      detailsRaw: "Aisha 1; Rohan 2; Priya 1; Dev 2",
    });
    expect(sum(shares)).toBe(360000);
    // total weight 6: Rohan and Dev pay 2/6 each, Aisha and Priya 1/6
    expect(shares.Rohan).toBe(120000);
    expect(shares.Dev).toBe(120000);
    expect(shares.Aisha).toBe(60000);
  });
});
