export function isDashboardAuthorized(request, env) {
  const expected = env.DASHBOARD_PASSWORD || "";
  const supplied = request.headers.get("X-Dashboard-Password") || "";
  return Boolean(expected) && supplied === expected;
}

export async function validateToken(db, authHeader) {
  const token = (authHeader || "").replace("Bearer ", "");
  if (!token) return null;
  const row = await db.prepare(
    "SELECT token, is_active, monthly_limit, spent, spent_month, active_persona_id FROM tokens WHERE token = ?"
  ).bind(token).first();
  return (row && row.is_active !== 0) ? row : null;
}
