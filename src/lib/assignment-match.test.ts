import { describe, it, expect } from "vitest";
import { classifyMatch } from "./assignment-match";

describe("classifyMatch", () => {
  it("matched on exactly one candidate", () => {
    const r = classifyMatch("Sales", [{ id: "1", displayName: "Sales" }]);
    expect(r.status).toBe("matched");
    expect(r.entraId).toBe("1");
  });
  it("ambiguous on multiple", () => {
    const r = classifyMatch("Sales", [
      { id: "1", displayName: "Sales" },
      { id: "2", displayName: "Sales" },
    ]);
    expect(r.status).toBe("ambiguous");
    expect(r.candidates).toHaveLength(2);
  });
  it("not_found on none", () => {
    expect(classifyMatch("Sales", []).status).toBe("not_found");
  });
});
