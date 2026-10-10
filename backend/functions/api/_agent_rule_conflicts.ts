import type { ActiveAgentRule } from "./_agent_rule_contract";

// persona-guard: ok (file) — 这里只做规则文字分类和冲突比较，不拼进模型提示词。

export type AgentRuleConflictLevel = "error" | "warn" | "info" | "muted";

export interface AgentRuleConflict {
  id: string;
  level: AgentRuleConflictLevel;
  type: string;
  title: string;
  detail: string;
  suggestion: string;
  topic: string;
  rule_ids: string[];
  rule_titles: string[];
}

const TOPIC_RULES: Array<{ label: string; words: string[] }> = [
  { label: "年龄和出生年份", words: ["年龄", "多大", "几岁", "出生年份", "哪年生的"] },
  { label: "婚姻状态", words: ["婚姻", "已婚", "未婚", "单身", "离婚", "离异"] },
  { label: "孩子和家庭", words: ["孩子", "子女", "娃", "带娃", "家庭", "家人"] },
  { label: "联系方式", words: ["联系方式", "微信", "qq", "qq号", "电话", "手机号", "号码"] },
  { label: "照片和图片", words: ["照片", "发图", "图片", "写真", "身材照", "图库"] },
  { label: "语音和视频", words: ["语音", "视频", "通话", "打电话"] },
  { label: "见面和关系升级", words: ["见面", "约见", "开房", "酒店", "关系升级", "下一步"] },
  { label: "暧昧和亲密边界", words: ["暧昧", "撩", "调情", "亲密", "露骨", "裸照", "私密照"] },
  { label: "工作和业务", words: ["工作", "业务", "推销", "催单", "报价", "回收", "旧数码"] },
  { label: "聊天推进", words: ["冷场", "主动", "推进", "话题", "问问题", "追问"] },
  { label: "回复格式", words: ["字数", "长度", "15字", "两条", "分段", "|||"] },
  { label: "重复回复", words: ["重复", "复读", "同样的话", "连续发送"] },
  { label: "睡觉和休息", words: ["睡觉", "睡了", "晚安", "休息", "洗澡", "忙"] },
  { label: "人设身份", words: ["人设", "身份", "名字", "姓名", "星暮", "苏棠", "阿杰", "陈屿"] },
  { label: "知识库", words: ["知识库", "知识卡", "命中卡", "触发词"] },
  { label: "事实一致", words: ["事实", "档案", "资料", "改口", "编造", "推测"] },
  { label: "平台消息", words: ["平台提示", "系统通知", "已读回执", "正在输入", "礼物"] },
  { label: "表情处理", words: ["表情", "表情包", "互动表情"] },
  { label: "时间和历史", words: ["时间", "历史", "旧消息", "隔了多久"] },
  { label: "语气和人味", words: ["客服", "AI腔", "说教", "语气", "真人感", "情绪"] }
];

const NEGATIVE_WORDS = [
  "不要", "不能", "禁止", "不许", "不准", "不允许", "别", "避免", "不主动", "不回",
  "只回应", "只发", "仅回应", "仅发",
];
const POSITIVE_WORDS = [
  "可以", "允许", "必须", "应当", "主动", "优先",
];

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/gu, "")
    .replace(/[，,。！？!?；;：:“”"'（）()【】\[\]]/gu, "");
}

function wordsOf(rule: ActiveAgentRule) {
  return `${rule.title || ""}${rule.detail || ""}`.toLowerCase();
}

function topicsOf(rule: ActiveAgentRule) {
  const text = wordsOf(rule);
  return TOPIC_RULES.filter((topic) =>
    topic.words.some((word) => text.includes(word.toLowerCase()))
  ).map((topic) => topic.label);
}

function hasAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function overlap(left: string[], right: string[]) {
  return left.filter((item) => right.includes(item));
}

const GENERIC_TOPIC_WORDS = new Set([
  "主动", "不要", "可以", "必须", "规则", "人设", "回复", "内容", "时候",
  "聊天", "对方", "信息", "处理", "方式", "边界", "话题",
]);
const PERSONA_WORDS = new Set(["星暮", "苏棠", "阿杰", "陈屿"]);
const STRONG_TOPIC_ANCHORS = new Set([
  "年龄", "出生年份", "几岁", "多大",
  "婚姻", "已婚", "未婚", "单身", "离婚", "离异",
  "孩子", "子女", "娃",
  "联系方式", "微信", "qq", "电话", "手机号",
  "照片", "图片", "图库", "身材照", "写真",
  "语音", "视频", "通话",
  "见面", "约见", "酒店", "开房",
  "暧昧", "暗昧", "撩", "调情", "亲密", "露骨", "裸照", "私密照",
  "知识库", "知识卡", "触发词",
  "平台提示", "系统通知", "已读回执", "正在输入",
  "表情", "表情包",
  "字数", "长度", "15字", "两条", "分段",
  "重复", "复读",
  "睡觉", "晚安", "休息",
]);

function hasSharedTopicEvidence(leftTitle: string, rightTitle: string) {
  return TOPIC_RULES.some((topic) => {
    const words = topic.words.filter((word) =>
      word.length >= 2 &&
      !GENERIC_TOPIC_WORDS.has(word) &&
      !PERSONA_WORDS.has(word) &&
      STRONG_TOPIC_ANCHORS.has(word.toLowerCase())
    );
    return words.some((word) => leftTitle.includes(word.toLowerCase()) && rightTitle.includes(word.toLowerCase()));
  });
}

function tokenSet(text: string) {
  const compact = normalize(text);
  const tokens = new Set<string>();
  if (!compact) return tokens;
  if (compact.length <= 4) tokens.add(compact);
  for (let index = 0; index < compact.length - 1; index += 1) {
    tokens.add(compact.slice(index, index + 2));
  }
  return tokens;
}

function similarity(left: string, right: string) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  return common / new Set([...a, ...b]).size;
}

function rulePairId(left: ActiveAgentRule, right: ActiveAgentRule, kind: string) {
  return `${kind}:${left.id}:${right.id}`;
}

function stableRuleId(rule: ActiveAgentRule) {
  return String(rule.legacy_rule_id || rule.id || "");
}

export function detectAgentRuleConflicts(rules: ActiveAgentRule[]): AgentRuleConflict[] {
  const list = (Array.isArray(rules) ? rules : [])
    .filter((rule) => Boolean(rule && rule.id));
  const conflicts: AgentRuleConflict[] = [];
  const seen = new Set<string>();

  const push = (conflict: AgentRuleConflict) => {
    if (seen.has(conflict.id)) return;
    seen.add(conflict.id);
    conflicts.push(conflict);
  };

  for (let index = 0; index < list.length; index += 1) {
      const left = list[index];
      const leftText = normalize(`${left.title}${left.detail}`);
      const leftTopics = topicsOf(left);
    for (let otherIndex = index + 1; otherIndex < list.length; otherIndex += 1) {
      const right = list[otherIndex];
      const rightText = normalize(`${right.title}${right.detail}`);
      const rightTopics = topicsOf(right);
      const leftTitleText = normalize(left.title);
      const rightTitleText = normalize(right.title);
      const sharedTopics = overlap(leftTopics, rightTopics);
      const leftPersona = String(left.persona_id || "");
      const rightPersona = String(right.persona_id || "");
      const personaOverlaps = !leftPersona || !rightPersona ||
        leftPersona.split(",").some((part) => rightPersona.split(",").includes(part.trim()));
      const bothEnabled = left.enabled !== false && right.enabled !== false;
      const exactDuplicate = leftText && leftText === rightText;
      const titleSimilarity = similarity(left.title, right.title);
      const detailSimilarity = similarity(left.detail, right.detail);
      const similar = detailSimilarity >= 0.72 || titleSimilarity >= 0.72;
      const opposite =
        (hasAny(leftTitleText, NEGATIVE_WORDS) && hasAny(rightTitleText, POSITIVE_WORDS)) ||
        (hasAny(rightTitleText, NEGATIVE_WORDS) && hasAny(leftTitleText, POSITIVE_WORDS));

      const sharedTopicEvidence = hasSharedTopicEvidence(
        normalize(left.title),
        normalize(right.title),
      );
      if (!personaOverlaps) continue;
      if (!sharedTopics.length && !exactDuplicate) continue;
      if (!exactDuplicate && !opposite && !(personaOverlaps && similar)) continue;
      if (opposite && !sharedTopicEvidence) continue;

      const level: AgentRuleConflictLevel = !bothEnabled
        ? "muted"
        : exactDuplicate
          ? "info"
          : opposite
            ? "error"
            : personaOverlaps
              ? "warn"
              : "info";
      const type = exactDuplicate
        ? "重复规则"
        : opposite
          ? "规则打架"
          : personaOverlaps
            ? "范围重叠"
            : "内容相近";
      const topic = sharedTopics[0] || "同一个话题";
      const detail = exactDuplicate
        ? `这两条规则的内容几乎一样，都会管“${topic}”。重复保留会白占位置，也容易让你改了一条、忘了另一条。`
        : opposite
          ? `这两条规则都在管“${topic}”，但一条要求做，另一条要求别做。同时生效时，模型可能来回变。`
          : `这两条规则都涉及“${topic}”，范围或触发条件有一部分重叠，建议确认哪一条优先。`;
      push({
        id: rulePairId(left, right, type),
        level,
        type,
        title: `${topic}有冲突`,
        detail,
        suggestion: exactDuplicate
          ? "保留一条，另一条删除或停用。"
          : opposite
            ? "确认哪一条才是你要的结果，保留一条或把优先级和范围改清楚。"
            : "检查作用范围和触发词；如果结果一样，可以合并。",
        topic,
        rule_ids: [stableRuleId(left), stableRuleId(right)],
        rule_titles: [left.title, right.title],
      });
    }
  }

  const levelOrder: Record<AgentRuleConflictLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    muted: 3,
  };
  return conflicts.sort((left, right) =>
    levelOrder[left.level] - levelOrder[right.level] ||
    left.title.localeCompare(right.title, "zh-CN")
  );
}

export function summarizeAgentRuleConflicts(conflicts: AgentRuleConflict[]) {
  const list = Array.isArray(conflicts) ? conflicts : [];
  return {
    total: list.length,
    errors: list.filter((item) => item.level === "error").length,
    warnings: list.filter((item) => item.level === "warn").length,
    info: list.filter((item) => item.level === "info").length,
    muted: list.filter((item) => item.level === "muted").length,
  };
}
