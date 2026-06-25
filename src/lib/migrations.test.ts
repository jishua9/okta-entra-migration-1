import { describe, it, expect, beforeEach } from "vitest";
import db from "@/lib/db";
import { recordMigration, listMigrations } from "./migrations";

describe("migrations audit", () => {
  beforeEach(() => db.prepare("DELETE FROM migrations").run());

  it("records and lists an attempt for a user", () => {
    recordMigration({
      userId: "u1", oktaAppId: "a1", oktaLabel: "App One", signOnMode: "SAML_2_0",
      status: "success", entraAppId: "e1", entraObjectId: "o1", entraSpId: "sp1",
      assignedGroups: 2, assignedUsers: 5, warnings: ["w"], errors: [],
    });
    const rows = listMigrations("u1");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("success");
    expect(rows[0].warnings).toEqual(["w"]);
  });

  it("scopes listing to the user", () => {
    recordMigration({ userId: "u2", oktaAppId: "a", oktaLabel: "x", status: "failed", assignedGroups: 0, assignedUsers: 0, warnings: [], errors: ["boom"] });
    expect(listMigrations("u1")).toHaveLength(0);
    expect(listMigrations("u2")[0].errors).toEqual(["boom"]);
  });
});
