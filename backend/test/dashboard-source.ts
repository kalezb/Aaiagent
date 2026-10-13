import { readFileSync } from "node:fs";

const dashboardScripts = [
  "app.js",
  "dashboard-library.js",
  "dashboard-rules.js",
  "dashboard-init.js",
];

export function readDashboardScript(): string {
  return dashboardScripts
    .map((name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8"))
    .join("\n");
}
