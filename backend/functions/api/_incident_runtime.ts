export async function cleanupOldAutomationIncidents(env, nowSec = Math.floor(Date.now() / 1000)) {
  try {
    const lastCleanup = Number(await env.KV.get("automation_incidents:last_cleanup") || 0);
    if (lastCleanup > nowSec - 24 * 3600) return;
    const cutoff = nowSec - 30 * 24 * 3600;
    await env.DB.prepare(
      "DELETE FROM automation_incidents WHERE created_at < ? AND id NOT IN (SELECT incident_id FROM replay_cases)"
    ).bind(cutoff).run();
    await env.KV.put("automation_incidents:last_cleanup", String(nowSec));
  } catch (_) {
    // Cleanup must never block incident upload or reading.
  }
}

export function parseReplayFixtureEvents(fixture) {
  const text = String(fixture || "");
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed?.events)) return parsed.events;
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch (_) {
    return text.split(/\r?\n/u).map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
  }
}

export function evaluateReplayCaseRecord(row) {
  const events = parseReplayFixtureEvents(row.fixture_json);
  let expectation = {};
  try {
    expectation = JSON.parse(String(row.expectation_json || "{}"));
  } catch (_) {
    // Invalid expectation is handled by the final has_expectation check.
  }
  const expected = Array.isArray(expectation.anomaly_actions) ? expectation.anomaly_actions : [];
  let profileTriggered = false;
  let refreshTriggered = false;
  let browserErrorTriggered = false;
  let replyContextUntilMs = 0;
  const contentChanges = [];
  const listScans = [];
  for (const event of events) {
    const timestampMs = Number(
      event?.timestampMs ||
      event?.timestamp_ms ||
      Date.parse(String(event?.time || event?.timestamp || "")) ||
      0,
    );
    const eventName = String(event?.event || event?.type || "");
    const action = String(event?.action || "");
    if (eventName === "delivery_finished" || eventName === "return_to_list_started") {
      replyContextUntilMs = Math.max(replyContextUntilMs, timestampMs + 15_000);
    }
    if (String(event?.pageKind || "") === "PROFILE_PAGE" && timestampMs <= replyContextUntilMs) {
      profileTriggered = true;
    }
    if (eventName === "content_changed") {
      const key = [event?.platform || "", event?.stage || "", action].join("|");
      contentChanges.push({ timestampMs, key });
      if (contentChanges.filter((item) =>
        item.key === key && timestampMs - item.timestampMs <= 2_000
      ).length >= 20) refreshTriggered = true;
    }
    if (eventName === "list_scan_finished") {
      const fingerprint = String(event?.listFingerprint || "");
      if (fingerprint) {
        listScans.push({ timestampMs, fingerprint, unreadCount: Number(event?.unreadCount || 0) });
        if (listScans.filter((item) =>
          item.fingerprint === fingerprint &&
          item.unreadCount <= 0 &&
          timestampMs - item.timestampMs <= 5_000
        ).length >= 3) refreshTriggered = true;
      }
    }
    if (["api_error", "network_error", "javascript_error", "unhandled_rejection"].includes(eventName)) {
      browserErrorTriggered = true;
    }
  }
  const checks = [{ name: "has_fixture_events", passed: events.length > 0 }];
  if (expected.includes("UnexpectedProfilePageAfterReply")) {
    checks.push({ name: "profile_anomaly_reproduced", passed: profileTriggered });
  }
  if (expected.includes("ConversationListRefreshStorm")) {
    checks.push({ name: "refresh_storm_reproduced", passed: refreshTriggered });
  }
  if (!expected.length && String(row.source || "") === "dashboard") {
    checks.push({ name: "browser_error_reproduced", passed: browserErrorTriggered });
  }
  checks.push({ name: "has_expectation", passed: Boolean(String(expectation.expected || "").trim()) });
  checks.push({ name: "has_forbidden_rule", passed: Boolean(String(expectation.forbidden || "").trim()) });
  return {
    id: row.id,
    incident_id: row.incident_id,
    title: row.title,
    passed: checks.every((check) => check.passed),
    checks,
  };
}
