export const DEFAULT_PERSONA_FACTS = Object.freeze({
  age_mode: "fixed_age",
  fixed_age: 29,
  birth_year: null,
  marital_status: "married",
  has_children: false,
  children_age: null,
  vehicle: "",
  housing: "",
  contact_qq: "",
  hometown: "重庆",
  current_city: "重庆",
  current_district: "两江新区",
  common_area: "",
  work_city: "重庆",
  work_district: "江北区",
  location_precision: "district",
  proactive_location_allowed: false,
});

const MARITAL_STATUSES = new Set(["single", "married", "divorced"]);
const LOCATION_PRECISIONS = new Set(["city", "district", "landmark"]);

function text(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/[\r\n]+/gu, " ").trim().slice(0, 64);
  return normalized || fallback;
}

function optionalText(value) {
  if (value === null || value === undefined) return "";
  return text(value, "");
}

function integer(value, fallback = null) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function boolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return fallback;
}

export function parsePersonaFacts(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function normalizePersonaFacts(value, fallback = DEFAULT_PERSONA_FACTS) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_PERSONA_FACTS;
  const requestedMode = source.age_mode === "birth_year" || source.age_mode === "fixed_age"
    ? source.age_mode
    : base.age_mode;
  const fixedAgeCandidate = integer(source.fixed_age, integer(base.fixed_age, 29));
  const birthYearCandidate = integer(source.birth_year, integer(base.birth_year, null));
  const fixedAge = fixedAgeCandidate >= 18 && fixedAgeCandidate <= 80 ? fixedAgeCandidate : 29;
  const birthYear = birthYearCandidate >= 1900 && birthYearCandidate <= 2099 ? birthYearCandidate : null;
  const ageMode = requestedMode === "birth_year" && birthYear ? "birth_year" : "fixed_age";
  const hasChildren = boolean(source.has_children, Boolean(base.has_children));
  const childrenAgeCandidate = integer(source.children_age, integer(base.children_age, null));
  const maritalStatus = MARITAL_STATUSES.has(String(source.marital_status || "").trim())
    ? String(source.marital_status).trim()
    : (MARITAL_STATUSES.has(String(base.marital_status || "").trim())
      ? String(base.marital_status).trim()
      : "married");
  const locationPrecision = LOCATION_PRECISIONS.has(String(source.location_precision || "").trim())
    ? String(source.location_precision).trim()
    : (LOCATION_PRECISIONS.has(String(base.location_precision || "").trim())
      ? String(base.location_precision).trim()
      : "district");
  const contactQqCandidate = String(source.contact_qq ?? base.contact_qq ?? "")
    .replace(/\D/gu, "")
    .slice(0, 12);
  const contactQq = /^\d{5,12}$/u.test(contactQqCandidate) ? contactQqCandidate : "";

  return {
    age_mode: ageMode,
    fixed_age: ageMode === "fixed_age" ? fixedAge : null,
    birth_year: ageMode === "birth_year" ? birthYear : null,
    marital_status: maritalStatus,
    has_children: hasChildren,
    children_age: hasChildren && childrenAgeCandidate !== null && childrenAgeCandidate >= 0 && childrenAgeCandidate <= 80
      ? childrenAgeCandidate
      : null,
    vehicle: optionalText(source.vehicle ?? base.vehicle),
    housing: optionalText(source.housing ?? base.housing),
    contact_qq: contactQq,
    hometown: text(source.hometown, text(base.hometown, "重庆")),
    current_city: text(source.current_city, text(base.current_city, "重庆")),
    current_district: text(source.current_district, text(base.current_district, "两江新区")),
    common_area: optionalText(source.common_area ?? base.common_area),
    work_city: text(source.work_city, text(base.work_city, "重庆")),
    work_district: text(source.work_district, text(base.work_district, "江北区")),
    location_precision: locationPrecision,
    proactive_location_allowed: boolean(
      source.proactive_location_allowed,
      Boolean(base.proactive_location_allowed),
    ),
  };
}

export function mergePersonaFacts(baseFacts, overrideFacts) {
  const base = normalizePersonaFacts(baseFacts);
  const override = overrideFacts && typeof overrideFacts === "object" ? overrideFacts : {};
  return normalizePersonaFacts({ ...base, ...override }, base);
}

export function resolvePersonaAge(facts, now = new Date()) {
  const normalized = normalizePersonaFacts(facts);
  if (normalized.age_mode === "birth_year" && normalized.birth_year) {
    const year = now.getFullYear();
    const age = year - Number(normalized.birth_year);
    return age >= 18 && age <= 99 ? age : null;
  }
  return normalized.fixed_age;
}

export function validatePersonaFactsInput(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fixedProvided = source.fixed_age !== null && source.fixed_age !== undefined && String(source.fixed_age).trim() !== "";
  const birthProvided = source.birth_year !== null && source.birth_year !== undefined && String(source.birth_year).trim() !== "";
  if (fixedProvided && birthProvided) {
    return { ok: false, error: "固定年龄和出生年份只能填写一个" };
  }
  const normalized = normalizePersonaFacts(source);
  const mode = String(source.age_mode || "").trim();
  if (mode && mode !== "fixed_age" && mode !== "birth_year") {
    return { ok: false, error: "年龄模式无效" };
  }
  if (normalized.age_mode === "birth_year" && !normalized.birth_year) {
    return { ok: false, error: "出生年份需要在 1900 到 2099 之间" };
  }
  if (normalized.age_mode === "fixed_age" && !normalized.fixed_age) {
    return { ok: false, error: "固定年龄需要在 18 到 80 之间" };
  }
  if (normalized.has_children && normalized.children_age === null) {
    return { ok: false, error: "有孩子时需要填写 0 到 80 之间的孩子年龄" };
  }
  const contactQqProvided = source.contact_qq !== null &&
    source.contact_qq !== undefined &&
    String(source.contact_qq).trim() !== "";
  if (contactQqProvided && !normalized.contact_qq) {
    return { ok: false, error: "QQ号需要填写 5 到 12 位数字" };
  }
  return { ok: true, facts: normalized };
}

function maritalFactLine(facts) {
  if (facts.marital_status === "married") return "已婚";
  if (facts.marital_status === "divorced") return "离异";
  return "未婚";
}

function locationPrecisionLine(facts) {
  if (facts.location_precision === "city") return "只说到城市";
  if (facts.location_precision === "landmark") return "可以说到常用区域或地标";
  return "只说到区县";
}

export function buildPersonaFactsPrompt(facts) {
  const normalized = normalizePersonaFacts(facts);
  const age = resolvePersonaAge(normalized);
  const lines = [
    "【人物事实｜最高优先级】",
    "以下是你本人的固定事实。优先级高于历史聊天、人设风格描述、对方推测和模型推断。不得自行改写、补充或编造。",
    age ? `年龄：${age}岁。被问年龄时只回答这个年龄。` : "",
    normalized.age_mode === "fixed_age"
      ? "年龄模式：固定年龄。禁止说、猜或暗示自己的出生年份。"
      : "年龄模式：出生年份。可以回答出生年份，但不要另外编造固定年龄。",
    `婚姻状态：${maritalFactLine(normalized)}。`,
    normalized.has_children
      ? `子女：有孩子${normalized.children_age !== null ? `，孩子${normalized.children_age}岁` : ""}。`
      : "子女：没有孩子。",
    normalized.vehicle ? `车辆：${normalized.vehicle}。被问车辆时只说这个事实，不能否认或更换车型。` : "",
    normalized.housing ? `住房：${normalized.housing}。被问住房时只说这个事实，不展开价格或地址。` : "",
    normalized.contact_qq
      ? `QQ号：${normalized.contact_qq}。这是唯一允许使用的QQ号。只有系统明确允许披露联系方式时才能发送；不得使用旧提示词、环境变量或自行编造其他联系方式。`
      : "QQ号：未设置。不得自行编造、猜测或从旧提示词里补出任何联系方式。",
    normalized.hometown ? `老家/籍贯：${normalized.hometown}。` : "",
    normalized.current_city
      ? `现居地：${normalized.current_city}${normalized.current_district || ""}。`
      : "",
    normalized.common_area ? `常用活动区域：${normalized.common_area}。` : "",
    normalized.work_city
      ? `工作地：${normalized.work_city}${normalized.work_district || ""}。`
      : "",
    `位置公开精度：${locationPrecisionLine(normalized)}。`,
    normalized.proactive_location_allowed
      ? "位置话题：可以在自然语境里提到位置，但不能主动暴露精确住址。"
      : "位置话题：只在对方明确询问时回答，不主动提现居地和工作地。",
  ];
  return lines.filter(Boolean).join("\n");
}

export function factsVersion(row, fallback = 1) {
  const version = Number(row?.config_version ?? row?.version ?? fallback);
  return Number.isFinite(version) && version > 0 ? Math.floor(version) : fallback;
}
