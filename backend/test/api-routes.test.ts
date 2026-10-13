import {
  describe,
  expect,
  it,
} from "vitest";
import { readFileSync } from "node:fs";
import { onRequest } from "../functions/api/[[route]]";

describe("API routes", () => {
  it("routes every explicit Pages API entry through the full handler", () => {
    const routes = ["chat", "config", "contacts", "history", "messages", "persona", "status", "token"];
    const rootSource = readFileSync(new URL("../functions/[[route]].ts", import.meta.url), "utf8").trim();
    expect(rootSource).toBe('export { onRequest } from "./api/route";');
    for (const route of routes) {
      const source = readFileSync(new URL(`../functions/api/${route}.ts`, import.meta.url), "utf8").trim();
      expect(source).toBe('export { onRequest } from "./route";');
    }
  });
});
