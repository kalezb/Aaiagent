import {
  DEFAULT_GEMINI_INPUT_COST_PER_MILLION,
  DEFAULT_GEMINI_OUTPUT_COST_PER_MILLION,
  buildModelHeaders,
  buildModelRequestPayload,
} from "./_model_runtime";
import { createTimeoutSignal } from "./_http_runtime";
import { currentMonthKey } from "./_time_runtime";

const MAX_REPAIR_TIMEOUT_MS = 3_500;
const MIN_REPAIR_TIMEOUT_MS = 1_000;

export function estimateLlmCost({ usage, inputChars = 0, outputChars = 0 }, env, modelConfig = null) {
  const usingGemini = String(modelConfig?.provider || "").trim().toLowerCase() === "gemini";
  const inputRate = usingGemini
    ? Math.max(0, Number(env?.GEMINI_INPUT_COST_PER_MILLION ?? DEFAULT_GEMINI_INPUT_COST_PER_MILLION) || 0)
    : Math.max(0, Number(env?.LLM_INPUT_COST_PER_MILLION ?? 2) || 0);
  const outputRate = usingGemini
    ? Math.max(0, Number(env?.GEMINI_OUTPUT_COST_PER_MILLION ?? DEFAULT_GEMINI_OUTPUT_COST_PER_MILLION) || 0)
    : Math.max(0, Number(env?.LLM_OUTPUT_COST_PER_MILLION ?? 8) || 0);
  const promptTokens = Math.max(0, Number(usage?.prompt_tokens || usage?.input_tokens || inputChars / 1.8));
  const completionTokens = Math.max(0, Number(usage?.completion_tokens || usage?.output_tokens || outputChars / 1.8));
  const cost = (promptTokens * inputRate + completionTokens * outputRate) / 1_000_000;
  return Math.max(0.001, Number(cost.toFixed(6)));
}

export async function recordTokenUsage(db, token, cost) {
  const nowSec = Math.floor(Date.now() / 1000);
  const month = currentMonthKey(nowSec);
  const amount = Math.max(0, Number(cost || 0));
  await db.prepare(
    "UPDATE tokens SET last_used_at = ?, " +
    "spent = CASE WHEN spent_month = ? THEN spent + ? ELSE ? END, " +
    "spent_month = ? WHERE token = ?"
  ).bind(nowSec, month, amount, amount, month, token).run();
}

export async function enforceTokenBudget(db, tokenRow) {
  const nowSec = Math.floor(Date.now() / 1000);
  const month = currentMonthKey(nowSec);
  let spent = Number(tokenRow?.spent || 0);
  if (String(tokenRow?.spent_month || "") !== month) {
    spent = 0;
    await db.prepare("UPDATE tokens SET spent = 0, spent_month = ? WHERE token = ?")
      .bind(month, tokenRow.token).run();
  }
  const limit = Number(tokenRow?.monthly_limit ?? 30);
  return {
    allowed: !Number.isFinite(limit) || limit < 0 || spent < limit,
    spent,
    limit,
    month,
  };
}

export async function requestReplyRepair({
  env,
  token,
  apiKey,
  modelConfig,
  modelName,
  systemPrompt,
  userPrompt,
  maxTokens = 96,
  deadlineAt,
}) {
  const repairMessages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  const remainingMs = Math.floor(Number(deadlineAt || 0) - Date.now());
  if (!Number.isFinite(remainingMs) || remainingMs < MIN_REPAIR_TIMEOUT_MS) {
    throw new Error("llm_repair_budget_exhausted");
  }
  const repairTimeoutMs = Math.min(MAX_REPAIR_TIMEOUT_MS, remainingMs);
  const response = await fetch(modelConfig.baseUrl + "/chat/completions", {
    method: "POST",
    headers: buildModelHeaders(apiKey, modelConfig),
    body: JSON.stringify(buildModelRequestPayload(modelConfig, modelName, repairMessages, 0.35, maxTokens)),
    signal: createTimeoutSignal(repairTimeoutMs),
  });
  if (!response.ok) return "";
  const data = await response.json();
  await recordTokenUsage(
    env.DB,
    token,
    estimateLlmCost({
      usage: data.usage,
      inputChars: repairMessages.reduce((total, message) => total + String(message.content || "").length, 0),
      outputChars: String(data.choices?.[0]?.message?.content || "").length,
    }, env, modelConfig)
  );
  return String(data.choices?.[0]?.message?.content || "").trim();
}
