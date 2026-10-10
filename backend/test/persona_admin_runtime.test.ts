import { describe, expect, it } from "vitest";
import { sharedPersonaConflict } from "../functions/api/_persona_admin";

describe("persona admin runtime", () => {
  it("returns a clear version conflict response", async () => {
    const response = sharedPersonaConflict(7);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "persona_version_conflict",
      current_version: 7,
    });
  });
});
