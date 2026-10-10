import { loadDeviceSettings } from "./_device_runtime";
import {
  buildModelHeaders,
  buildModelRequestPayload,
  isGeminiModelConfig,
  loadLlmConfig,
} from "./_model_runtime";
import {
  enforceTokenBudget,
  estimateLlmCost,
  recordTokenUsage,
} from "./_model_call_runtime";
import { makeSingleGroupId } from "./_history_runtime";
import { formatChinaMessageTime } from "./_time_runtime";

export function formatLocation(row) {
  if (!row) return null;
  return {
    home: { city: row.home_city, district: row.home_district },
    work: { city: row.work_city, district: row.work_district },
  };
}

export function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  const text = String(value).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

export function emptyCustomerProfile() {
  return {
    basic: { name: "", gender: "", age: "" },
    location: { hometown: "", city: "", residence: "" },
    education: { school: "", major: "", degree: "" },
    work: { company: "", role: "", industry: "" },
    family: { marital_status: "", children: "", notes: "" },
    relationship: { status: "", preferences: "" },
    preferences: { likes: [], dislikes: [], hobbies: [] },
    life: { habits: "", schedule: "" },
    recent: { goals: [], events: [] },
    notes: [],
  };
}

export function mergeProfileValue(current, incoming) {
  if (Array.isArray(current) || Array.isArray(incoming)) {
    const values = [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    return [...new Set(values)].slice(-30);
  }
  if (current && incoming && typeof current === "object" && typeof incoming === "object") {
    const merged = { ...current };
    for (const [key, value] of Object.entries(incoming)) {
      merged[key] = mergeProfileValue(merged[key], value);
    }
    return merged;
  }
  const text = typeof incoming === "string" ? incoming.trim() : incoming;
  return text === "" || text === null || text === undefined ? current : text;
}

export function mergeCustomerProfile(existing, incoming) {
  const base = emptyCustomerProfile();
  const current = mergeProfileValue(base, parseJsonObject(existing, {}));
  return mergeProfileValue(current, parseJsonObject(incoming, {}));
}

export function profileCandidateText(value) {
  const text = String(value || "").trim();
  return text.length >= 2 &&
    text.length <= 240 &&
    /(我叫|我是|姓名|名字|年龄|多大|住在|我在|家住|老家|家乡|城市|地址|[\u4e00-\u9fa5A-Za-z0-9]{2,12}(?:区|县|镇|街道)|学校|大学|专业|公司|上班|工作|职业|行业|结婚|离婚|已婚|单身|单身汉|未婚|没结过婚|没结婚|老婆|老公|孩子|娃|儿子|女儿|没娃|没有娃|没孩子|没有孩子|男朋友|女朋友|爱好|习惯|最近|打算|准备|计划|目标|生日|毕业|认识|见过|喜欢|不喜欢)/.test(text);
}

export function extractExplicitCustomerFacts(value) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  if (!text || text.length > 240) return {};
  const compact = text.replace(/\s+/gu, "");
  const aboutOther =
    /(?:你|您|他|她|他们|她们)/u.test(compact) &&
    !/(?:我|本人|俺)/u.test(compact);
  if (aboutOther) return {};

  const selfMarker =
    /(?:我|本人|俺)/u.test(compact) ||
    /^(?:单身|单身汉|未婚|已婚|离异|离婚|没孩子|没有孩子|没娃|没有娃)(?:的|了|啊|呀|哦|撒|哈|哇|嘛)?[。！？!?]*$/u.test(compact) ||
    /(?:肯定|确实|就是|真的|本来|一直)(?:是)?(?:单身|单身汉|未婚|已婚|离异|离婚)/u.test(compact);
  if (!selfMarker) return {};

  const question =
    /[？?]$/u.test(compact) ||
    /(?:吗|嘛|么|呢)$/u.test(compact) ||
    /^(?:你|您|他|她)/u.test(compact);
  if (question && !/(?:我没|我没有|我不是)/u.test(compact)) return {};

  const family = {};
  const location = {};
  const basic = {};

  const singleDeclared =
    /(?:(?:我|本人|俺)(?:是)?(?:单身汉|单身)|(?:我|本人|俺)(?:还)?没结过婚|(?:我|本人|俺)没有结过婚|(?:我|本人|俺)没结婚|(?:我|本人|俺)没有结婚|^(?:单身汉|单身)$|(?:肯定|确实|就是|真的|本来|一直)(?:是)?(?:单身汉|单身))/u.test(compact) &&
    !/(?:不是|没说过|没说|不算)(?:单身|单身汉)/u.test(compact);
  const marriedDeclared =
    /(?:(?:我|本人|俺)(?:是)?(?:已婚|结婚(?:了|过)?)|(?:我|本人|俺)已经结婚|(?:我|本人|俺)有老公|(?:我|本人|俺)有老婆)/u.test(compact);
  const divorcedDeclared =
    /(?:(?:我|本人|俺)(?:是)?(?:离婚|离异)(?:了|过)?|(?:我|本人|俺)离过婚|(?:我|本人|俺)已经离婚)/u.test(compact);
  if (divorcedDeclared) {
    family.marital_status = "离异";
  } else if (singleDeclared) {
    family.marital_status = "单身";
  } else if (marriedDeclared) {
    family.marital_status = "已婚";
  }

  const noChildrenDeclared =
    /(?:(?:我|本人|俺)?(?:没有|没|无)(?:孩子|小孩|娃|娃儿|子女)|^(?:没有孩子|没孩子|没有娃|没娃)$)/u.test(compact);
  const childAgeMatch = compact.match(/(?:我|我家|本人|俺)?(?:的|家)?(?:孩子|娃|娃儿|儿子|女儿)(\d{1,2})岁/u);
  const hasChildrenDeclared =
    /(?:(?:我|本人|俺)(?:有|带着)(?:孩子|小孩|娃|娃儿|儿子|女儿)|(?:我|我家|本人的)?(?:孩子|娃|娃儿|儿子|女儿)(?:今年)?\d{1,2}岁)/u.test(compact);
  if (noChildrenDeclared) {
    family.children = "没有孩子";
  } else if (childAgeMatch) {
    family.children = `孩子${Number(childAgeMatch[1])}岁`;
  } else if (hasChildrenDeclared) {
    family.children = "有孩子";
  }

  const residenceMatch =
    compact.match(/(?:我|本人|俺)(?:现在)?(?:住(?:在)?|在|家住|定居在)([\u4e00-\u9fa5A-Za-z0-9]{2,16}(?:区|县|镇|街道|小区|路))/u) ||
    compact.match(/(?:我|本人|俺)(?:家)?住([\u4e00-\u9fa5A-Za-z0-9]{2,16}(?:区|县|镇|街道|小区|路))/u);
  if (residenceMatch?.[1]) {
    const residence = residenceMatch[1].trim();
    location.residence = residence;
    const cityMatch = residence.match(/^(重庆|北京|上海|天津|广州|深圳|成都|杭州|武汉|西安|南京|苏州)(?:市)?/u);
    if (cityMatch?.[1]) location.city = cityMatch[1];
  }
  const hometownMatch = compact.match(/(?:我|本人|俺)(?:老家|家乡|祖籍)(?:是|在)([\u4e00-\u9fa5A-Za-z0-9]{2,16})/u)
    || compact.match(/(?:我|本人|俺)是([\u4e00-\u9fa5A-Za-z0-9]{2,10})人/u);
  if (hometownMatch?.[1]) {
    location.hometown = hometownMatch[1].replace(/(?:市|省)$/u, "").trim();
  }

  const ageMatch = compact.match(/(?:我|本人|俺)(?:今年|现在|目前)?(\d{1,2})岁/u);
  if (ageMatch?.[1]) {
    const age = Number(ageMatch[1]);
    if (age >= 18 && age <= 80) basic.age = String(age);
  }
  const nameMatch = compact.match(/(?:我|本人|俺)叫([\u4e00-\u9fa5A-Za-z0-9·]{1,12})/u);
  if (nameMatch?.[1]) basic.name = nameMatch[1].trim();

  const result = {};
  if (Object.keys(basic).length) result.basic = basic;
  if (Object.keys(location).length) result.location = location;
  if (Object.keys(family).length) result.family = family;
  return result;
}

function flattenProfileFacts(value, prefix = "", output = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      flattenProfileFacts(child, path, output);
    } else {
      output[path] = child;
    }
  }
  return output;
}

export function explicitFactsPatch(facts, source) {
  const sourceInfo = {
    messageId: Number(source?.id || 0),
    content: String(source?.content || "").slice(0, 180),
    createdAt: Number(source?.created_at || 0),
  };
  const factSources = {};
  for (const path of Object.keys(flattenProfileFacts(facts))) {
    factSources[path] = sourceInfo;
  }
  return {
    ...facts,
    _runtime: {
      factSources,
      lastDeterministicMessageId: Number(source?.id || 0),
    },
  };
}

export async function resolveProfileGroup(db, token, platform, contactId) {
  const link = await db.prepare(
    "SELECT group_id FROM contact_links WHERE token = ? AND platform = ? AND contact_id = ?"
  ).bind(token, platform, contactId).first();
  return link?.group_id || makeSingleGroupId(token, platform, contactId);
}

export async function loadCustomerProfile(db, token, groupId) {
  if (!token || !groupId) {
    return { profile: emptyCustomerProfile(), last_processed_message_id: 0, updated_at: 0 };
  }
  const row = await db.prepare(
    "SELECT profile_json, last_processed_message_id, extracted_at, updated_at FROM customer_profiles WHERE token = ? AND group_id = ?"
  ).bind(token, groupId).first();
  if (!row) {
    return { profile: emptyCustomerProfile(), last_processed_message_id: 0, updated_at: 0 };
  }
  return {
    profile: mergeCustomerProfile({}, parseJsonObject(row.profile_json, emptyCustomerProfile())),
    last_processed_message_id: Number(row.last_processed_message_id || 0),
    extracted_at: Number(row.extracted_at || 0),
    updated_at: Number(row.updated_at || 0),
  };
}

export function compactProfileForPrompt(value) {
  if (Array.isArray(value)) {
    return value
      .map(compactProfileForPrompt)
      .filter((item) => item !== undefined && item !== null && item !== "")
      .slice(0, 12);
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith("_")) continue;
      const compact = compactProfileForPrompt(child);
      if (compact === undefined || compact === null || compact === "") continue;
      if (Array.isArray(compact) && compact.length === 0) continue;
      if (!Array.isArray(compact) && typeof compact === "object" && Object.keys(compact).length === 0) continue;
      result[key] = compact;
    }
    return result;
  }
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 180) : undefined;
}

export function customerProfilePrompt(profile) {
  const compact = compactProfileForPrompt(profile);
  if (!compact || !Object.keys(compact).length) return "";
  return JSON.stringify(compact);
}

export async function loadDeviceLocation(db, token) {
  const row = await db.prepare(
    "SELECT home_city, home_district, work_city, work_district FROM user_locations WHERE token = ?"
  ).bind(token).first();
  return formatLocation(row);
}

export async function maybeExtractCustomerProfile(env, tokenRow, platform, contactId) {
  const token = tokenRow.token;
  const groupId = await resolveProfileGroup(env.DB, token, platform, contactId);
  const existing = await loadCustomerProfile(env.DB, token, groupId);
  const aliases = [{ platform, contact_id: contactId }];
  if (!groupId.startsWith("single:")) {
    const { results } = await env.DB.prepare(
      "SELECT platform, contact_id FROM contact_links WHERE token = ? AND group_id = ? ORDER BY created_at"
    ).bind(token, groupId).all();
    if (results?.length) aliases.splice(0, aliases.length, ...results);
  }
  const clauses = aliases.map(() => "(platform = ? AND contact_id = ?)");
  const aliasParams = aliases.flatMap((alias) => [alias.platform, alias.contact_id]);
  const now = Math.floor(Date.now() / 1000);

  // 明确事实先即时处理，不依赖模型，也不依赖“攒够多少条”。
  // 第一次没有 runtime 指针时回看最近 240 条用户消息，顺手纠正历史错值。
  let profile = existing.profile;
  const deterministicSince = Number(profile?._runtime?.lastDeterministicMessageId || 0);
  const deterministicRows = deterministicSince > 0
    ? (await env.DB.prepare(
      "SELECT id, content, created_at FROM chat_history WHERE token = ? AND role = 'user' AND (" + clauses.join(" OR ") + ") AND id > ? ORDER BY id ASC LIMIT 240"
    ).bind(token, ...aliasParams, deterministicSince).all())?.results || []
    : ((await env.DB.prepare(
      "SELECT id, content, created_at FROM chat_history WHERE token = ? AND role = 'user' AND (" + clauses.join(" OR ") + ") ORDER BY id DESC LIMIT 240"
    ).bind(token, ...aliasParams).all())?.results || []).reverse();

  let deterministicMaxId = deterministicSince;
  for (const row of deterministicRows) {
    const id = Number(row?.id || 0);
    const content = String(row?.content || "").trim();
    deterministicMaxId = Math.max(deterministicMaxId, id);
    if (!content) continue;
    const facts = extractExplicitCustomerFacts(content);
    if (!Object.keys(facts).length) continue;
    profile = mergeCustomerProfile(
      profile,
      explicitFactsPatch(facts, {
        id,
        content,
        created_at: Number(row?.created_at || 0),
      }),
    );
  }
  if (deterministicMaxId > 0) {
    profile = mergeCustomerProfile(profile, {
      _runtime: { lastDeterministicMessageId: deterministicMaxId },
    });
  }
  if (deterministicMaxId > deterministicSince) {
    await env.DB.prepare(
      "INSERT INTO customer_profiles (token, group_id, profile_json, last_processed_message_id, extracted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token, group_id) DO UPDATE SET profile_json = excluded.profile_json, extracted_at = excluded.extracted_at, updated_at = excluded.updated_at"
    ).bind(
      token,
      groupId,
      JSON.stringify(profile),
      existing.last_processed_message_id,
      now,
      now,
    ).run();
  }

  const state = await env.DB.prepare(
    "SELECT COUNT(*) AS user_count, MAX(id) AS max_id FROM chat_history WHERE token = ? AND role = 'user' AND (" + clauses.join(" OR ") + ") AND id > ?"
  ).bind(token, ...aliasParams, existing.last_processed_message_id).first();
  if (Number(state?.user_count || 0) < 40) return;
  const { results } = await env.DB.prepare(
    "SELECT id, content, created_at FROM chat_history WHERE token = ? AND role = 'user' AND (" + clauses.join(" OR ") + ") AND id > ? ORDER BY id ASC LIMIT 240"
  ).bind(token, ...aliasParams, existing.last_processed_message_id).all();
  const candidates = (results || [])
    .map((row) => ({
      id: Number(row.id || 0),
      content: String(row.content || "").trim(),
      created_at: Number(row.created_at || 0),
    }))
    .filter((row) => profileCandidateText(row.content))
    .slice(-80);
  const processedMaxId = (results || []).reduce(
    (max, row) => Math.max(max, Number(row?.id || 0)),
    existing.last_processed_message_id,
  );
  if (!candidates.length) {
    await env.DB.prepare(
      "INSERT INTO customer_profiles (token, group_id, profile_json, last_processed_message_id, extracted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token, group_id) DO UPDATE SET profile_json = excluded.profile_json, last_processed_message_id = excluded.last_processed_message_id, extracted_at = excluded.extracted_at, updated_at = excluded.updated_at"
    ).bind(token, groupId, JSON.stringify(profile), processedMaxId, now, now).run();
    return;
  }

  const deviceSettings = await loadDeviceSettings(env.DB, token);
  const modelConfig = await loadLlmConfig(env.KV, env, deviceSettings.model_line);
  const usingGemini = isGeminiModelConfig(modelConfig);
  const apiKey = usingGemini
    ? (modelConfig.apiKeyOverride || env.GEMINI_API_KEY || "")
    : (env.DEEPSEEK_API_KEY || "");
  if (!apiKey) return;
  const budget = await enforceTokenBudget(env.DB, tokenRow);
  if (!budget.allowed) return;

  const schema = JSON.stringify(emptyCustomerProfile());
  const candidateLines = candidates
    .map((row) => `[${formatChinaMessageTime(row.created_at)}] ${row.content.slice(0, 180)}`)
    .join("\n");
  const profileBaseUrl = usingGemini
    ? modelConfig.baseUrl
    : (env.DEEPSEEK_API_BASE || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const profileModel = usingGemini
    ? modelConfig.modelName
    : (env.PROFILE_MODEL || "deepseek-flash");
  const profilePayload = buildModelRequestPayload(
    usingGemini ? modelConfig : { provider: "deepseek" },
    profileModel,
    [
      {
        role: "system",
        content:
          "你只负责从客户本人说出的聊天里提取长期有效的事实。" +
          "不要总结普通聊天，不要猜测。只输出 JSON，不确定的字段留空。" +
          "如果客户在问‘你……’或在反问，不得把问题里的内容写成客户事实。" +
          "明确否认也要记录：单身、未婚、没结婚、没有孩子、没娃。" +
          "新片段和已有档案冲突时，以最新的明确陈述为准。" +
          "数组去重，最多保留 12 项。只按给定结构输出：" + schema,
      },
      {
        role: "user",
        content: "已有档案：" + JSON.stringify(compactProfileForPrompt(profile)) + "\n可能含个人信息的聊天片段：\n" + candidateLines,
      },
    ],
    0,
    900,
  );
  profilePayload.response_format = { type: "json_object" };
  const response = await fetch(profileBaseUrl + "/chat/completions", {
    method: "POST",
    headers: buildModelHeaders(apiKey, usingGemini ? modelConfig : { provider: "deepseek" }),
    body: JSON.stringify(profilePayload),
  });
  if (!response.ok) return;
  const data = await response.json();
  await recordTokenUsage(
    env.DB,
    token,
    estimateLlmCost({
      usage: data.usage,
      inputChars: schema.length + candidateLines.length,
      outputChars: String(data.choices?.[0]?.message?.content || "").length,
    }, env, usingGemini ? modelConfig : { provider: "deepseek" }),
  );
  const extracted = parseJsonObject(data.choices?.[0]?.message?.content, null);
  if (!extracted || typeof extracted !== "object") return;
  const merged = mergeCustomerProfile(profile, extracted);
  await env.DB.prepare(
    "INSERT INTO customer_profiles (token, group_id, profile_json, last_processed_message_id, extracted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token, group_id) DO UPDATE SET profile_json = excluded.profile_json, last_processed_message_id = excluded.last_processed_message_id, extracted_at = excluded.extracted_at, updated_at = excluded.updated_at"
  ).bind(token, groupId, JSON.stringify(merged), processedMaxId, now, now).run();
}
