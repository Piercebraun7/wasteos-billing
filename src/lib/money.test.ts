import { describe, expect, it } from "vitest";
import { bpsToInput, centsToInput, formatCents, lineAmountCents, parseDollarsToCents, parsePercentToBps, parseSignedDollarsToCents } from "./money";

describe("parseDollarsToCents", () => {
  it.each([
    ["12.50", 1250], ["$12.50", 1250], ["12.5", 1250], ["12", 1200], ["0", 0],
    ["1,234.56", 123456], [" $3,000 ", 300000], ["0.07", 7], ["19.99", 1999], ["1.10", 110],
  ])("%s -> %i", (input, cents) => expect(parseDollarsToCents(input)).toBe(cents));

  it.each(["", "abc", "12.505", "-5", "1.2.3", "12.", ".5"])("rejects %j", (input) =>
    expect(parseDollarsToCents(input)).toBeNull(),
  );
});

describe("formatCents", () => {
  it.each([
    [0, "$0.00"], [7, "$0.07"], [1250, "$12.50"], [300000, "$3,000.00"],
    [123456789, "$1,234,567.89"], [-500, "-$5.00"],
  ])("%i -> %s", (cents, text) => expect(formatCents(cents)).toBe(text));
});

describe("input round trips", () => {
  it("cents", () => {
    for (const cents of [0, 7, 110, 1250, 1999, 300000]) {
      expect(parseDollarsToCents(centsToInput(cents))).toBe(cents);
    }
    expect(centsToInput(null)).toBe("");
  });
  it("percent", () => {
    expect(parsePercentToBps("3")).toBe(300);
    expect(parsePercentToBps("1.5%")).toBe(150);
    expect(parsePercentToBps("0.25")).toBe(25);
    expect(parsePercentToBps("x")).toBeNull();
    expect(bpsToInput(300)).toBe("3");
    expect(bpsToInput(150)).toBe("1.5");
    expect(bpsToInput(25)).toBe("0.25");
    expect(bpsToInput(0)).toBe("0");
  });
});

describe("invoice line helpers", () => {
  it("reads a discount as a negative amount", () => {
    expect(parseSignedDollarsToCents("-25")).toBe(-2500);
    expect(parseSignedDollarsToCents("(25.00)")).toBe(-2500);
    expect(parseSignedDollarsToCents("350")).toBe(35000);
    expect(parseSignedDollarsToCents("-")).toBeNull();
  });
  it.each([
    ["1", 35000, 35000], ["1.5", 35000, 52500], ["2", 35000, 70000], ["0.5", 30000, 15000],
    ["1.25", 1999, 2499], ["3", 3333, 9999], ["1", -2500, -2500], ["0.33", 100, 33], ["0.35", 10, 4],
  ])("%s x %i cents = %i", (qty, rate, expected) => expect(lineAmountCents(qty, rate)).toBe(expected));
  it("rejects a quantity that is not a plain number", () => {
    expect(lineAmountCents("x", 100)).toBeNull();
    expect(lineAmountCents("1.234", 100)).toBeNull();
  });
});
