import { describe, expect, it } from "vitest";
import { matchProperty } from "./match";

const all = ["Village at Liberty Farms", "Village at Carver Mtn.", "Village at the BLVD", "The Bergen", "Village at Harvard Crossing", "Village at Camelback Park"].map((name) => ({ name }));

describe("matching a typed property name", () => {
  it("finds one property from a short name", () => {
    expect(matchProperty("liberty farms", all).match?.name).toBe("Village at Liberty Farms");
    expect(matchProperty("Carver", all).match?.name).toBe("Village at Carver Mtn.");
    expect(matchProperty("bergen", all).match?.name).toBe("The Bergen");
    expect(matchProperty("the BLVD", all).match?.name).toBe("Village at the BLVD");
  });
  it("matches an exact name even when others share its words", () => {
    expect(matchProperty("Village at the BLVD", all).match?.name).toBe("Village at the BLVD");
  });
  it("refuses to guess when more than one fits, and lists them", () => {
    const r = matchProperty("c", all);
    expect(r.match).toBeNull();
    expect(r.candidates.map((c) => c.name).sort()).toEqual(["Village at Camelback Park", "Village at Carver Mtn.", "Village at Harvard Crossing"]);
  });
  it("finds nothing for a name that is not there", () => {
    expect(matchProperty("Sunset Ridge", all)).toEqual({ match: null, candidates: [] });
  });
});
