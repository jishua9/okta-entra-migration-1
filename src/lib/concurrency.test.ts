import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("preserves order and maps all items", async () => {
    const r = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(r).toEqual([10, 20, 30, 40]);
  });
  it("never exceeds the concurrency limit", async () => {
    let active = 0, peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--; return n;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
