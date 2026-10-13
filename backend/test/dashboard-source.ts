import { readFileSync } from "node:fs";

const dashboardScripts = [
  "dashboard-core.js",
  "dashboard-customers.js",
  "dashboard-chat.js",
  "dashboard-operations.js",
  "dashboard-settings.js",
  "dashboard-library.js",
  "dashboard-rules.js",
  "dashboard-init.js",
];

export function readDashboardScript(): string {
  return dashboardScripts
    .map((name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8"))
    .join("\n");
}

export function readDashboardStyles(): string {
  return readFileSync(new URL("../src/dashboard.css", import.meta.url), "utf8");
}
