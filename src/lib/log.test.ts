import { describe, it, expect, vi } from "vitest";
import { logEvent } from "./log";

describe("logEvent", () => {
  it("writes a JSON line with event and context", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logEvent("migrate.start", { userId: "u1", oktaAppId: "a1" });
    const line = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.event).toBe("migrate.start");
    expect(parsed.userId).toBe("u1");
    expect(typeof parsed.ts).toBe("string");
    spy.mockRestore();
  });
});
