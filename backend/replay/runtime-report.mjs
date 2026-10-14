import { pathToFileURL } from "node:url";
import { evaluateReplayCase } from "./incident-replay.mjs";

export function summarizeReplayCases(cases) {
  const results = (cases || []).map(evaluateReplayCase);
  const passed = results.filter((result) => result.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    pass_rate: results.length ? passed / results.length : 1,
    failed_cases: results
      .filter((result) => !result.passed)
      .map((result) => ({
        incident_id: String(result.incident_id || ""),
        title: String(result.title || ""),
        checks: result.checks
          .filter((check) => !check.passed)
          .map((check) => check.name),
      })),
  };
}

export function summarizeTokenBudget(tokens) {
  const summary = (tokens || []).reduce((current, row) => {
    const limit = Number(row?.monthly_limit ?? 0);
    const spent = Number(row?.spent ?? 0);
    current.devices += 1;
    current.spent += Number.isFinite(spent) ? Math.max(0, spent) : 0;
    if (limit >= 0 && Number.isFinite(limit)) {
      current.limited_devices += 1;
      current.limit += limit;
    } else {
      current.unlimited_devices += 1;
    }
    return current;
  }, {
    devices: 0,
    limited_devices: 0,
    unlimited_devices: 0,
    spent: 0,
    limit: 0,
    remaining: 0,
    used_ratio: 0,
  });
  return finalizeBudget(summary);
}

function finalizeBudget(summary) {
  summary.remaining = Math.max(0, summary.limit - summary.spent);
  summary.used_ratio = summary.limit > 0 ? summary.spent / summary.limit : 0;
  return summary;
}

export function summarizeIncidents(incidents) {
  const byStatus = {};
  const byKind = {};
  for (const incident of incidents || []) {
    const status = String(incident?.status || "unknown");
    const kind = String(incident?.kind || "unknown");
    byStatus[status] = (byStatus[status] || 0) + 1;
    byKind[kind] = (byKind[kind] || 0) + 1;
  }
  return {
    total: (incidents || []).length,
    by_status: byStatus,
    by_kind: byKind,
  };
}

export async function buildRuntimeReport({
  baseUrl,
  password,
  fetchImpl = fetch,
}) {
  const base = String(baseUrl || "").replace(/\/+$/u, "");
  const headers = { "X-Dashboard-Password": String(password || "") };
  const [replayResponse, tokenResponse, incidentResponse] = await Promise.all([
    fetchImpl(base + "/api/replay-cases?limit=200", { headers }),
    fetchImpl(base + "/api/token", { headers }),
    fetchImpl(base + "/api/automation-incidents?limit=200", { headers }),
  ]);
  if (!replayResponse.ok) throw new Error("回放题库读取失败：" + replayResponse.status);
  if (!tokenResponse.ok) throw new Error("额度读取失败：" + tokenResponse.status);
  if (!incidentResponse.ok) throw new Error("故障列表读取失败：" + incidentResponse.status);
  const replayPayload = await replayResponse.json();
  const tokenPayload = await tokenResponse.json();
  const incidentPayload = await incidentResponse.json();
  return {
    replay: summarizeReplayCases(replayPayload.replay_cases || []),
    budget: summarizeTokenBudget(tokenPayload.tokens || []),
    incidents: summarizeIncidents(incidentPayload.incidents || []),
  };
}

export function formatRuntimeReport(report) {
  const replay = report.replay;
  const budget = report.budget;
  const incidents = report.incidents;
  return [
    `回放：${replay.passed}/${replay.total} 通过，失败 ${replay.failed}`,
    `额度：已用 ${budget.spent.toFixed(3)}，总额 ${budget.limit.toFixed(3)}，剩余 ${budget.remaining.toFixed(3)}`,
    `设备：${budget.devices} 台，限额度 ${budget.limited_devices} 台，不限额度 ${budget.unlimited_devices} 台`,
    `故障：共 ${incidents.total} 条`,
  ].join("\n");
}

async function main() {
  const baseUrl = String(process.env.API_BASE || "https://ai-agent-api.pages.dev");
  const password = String(process.env.DASHBOARD_PASSWORD || "").trim();
  if (!password) {
    console.error("缺少 DASHBOARD_PASSWORD，无法读取运行报告。");
    process.exit(2);
  }
  const report = await buildRuntimeReport({ baseUrl, password });
  console.log(formatRuntimeReport(report));
  console.log(JSON.stringify(report, null, 2));
  if (report.replay.failed > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  });
}
