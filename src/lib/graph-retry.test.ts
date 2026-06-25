import { describe, it, expect, vi } from "vitest";
import { withRetry } from "./graph-retry";

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await withRetry(fn, { retries: 3, baseMs: 0 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("retries on a 429 then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 429 })
      .mockResolvedValue("ok");
    expect(await withRetry(fn, { retries: 3, baseMs: 0 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("rethrows a non-retryable error", async () => {
    const fn = vi.fn().mockRejectedValue({ statusCode: 400 });
    await expect(withRetry(fn, { retries: 3, baseMs: 0 })).rejects.toMatchObject({ statusCode: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("gives up after the retry budget", async () => {
    const fn = vi.fn().mockRejectedValue({ statusCode: 429 });
    await expect(withRetry(fn, { retries: 2, baseMs: 0 })).rejects.toBeTruthy();
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
  it("retries a 404 when listed in retryOn", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 404 })
      .mockResolvedValue("ok");
    expect(await withRetry(fn, { retries: 3, baseMs: 0, retryOn: [404] })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("does not retry a 404 without retryOn", async () => {
    const fn = vi.fn().mockRejectedValue({ statusCode: 404 });
    await expect(withRetry(fn, { retries: 3, baseMs: 0 })).rejects.toMatchObject({ statusCode: 404 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
