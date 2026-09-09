import { describe, expect, it } from "vitest";
import { displayedResponderCount } from "@/lib/urgency";

describe("Urgency Offset (§8): displayed = max(1, actual − 2)", () => {
  it("matches the spec table exactly", () => {
    expect(displayedResponderCount(1)).toBe(1);
    expect(displayedResponderCount(2)).toBe(1);
    expect(displayedResponderCount(3)).toBe(1);
    expect(displayedResponderCount(5)).toBe(3);
  });
  it("scales beyond the offset", () => {
    expect(displayedResponderCount(10)).toBe(8);
    expect(displayedResponderCount(100)).toBe(98);
  });
  it("never displays below 1", () => {
    expect(displayedResponderCount(0)).toBe(1);
  });
});
