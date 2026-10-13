(function () {
  const PLATFORMS = [
    { id: "soul", label: "Soul", short: "S" },
    { id: "qq", label: "QQ", short: "Q" },
    { id: "douban", label: "豆瓣", short: "豆" },
    { id: "lianxin", label: "连信", short: "连" },
  ];

  const $ = (id) => document.getElementById(id);

  function contactKey(platform, contactId) {
    return `${String(platform || "")}\u0000${String(contactId || "")}`;
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function platformMeta(id) {
    return PLATFORMS.find((item) => item.id === id) || { id, label: id || "未知", short: "?" };
  }

  function platformName(id) {
    return platformMeta(id).label;
  }

  function renderPlatforms(platforms, className = "platforms") {
    const active = new Set(Array.isArray(platforms) ? platforms : []);
    return `<span class="${className}">` + PLATFORMS.map((platform) =>
      `<span class="pf ${active.has(platform.id) ? "on " + platform.id : ""}" title="${platform.label}">${platform.short}</span>`
    ).join("") + `</span>`;
  }

  function showToast(message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast ${type === "error" ? "error" : type === "warning" ? "warning" : ""}`;
    toast.textContent = message;
    $("toastStack").appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  function dashboardIncidentNow() {
    return new Date().toISOString();
  }

  function sanitizeDashboardPath(path) {
    return String(path || "").replace(
      /([?&](?:token|password|key|authorization|secret)=)[^&]*/giu,
      "$1[已隐藏]"
    );
  }

  function sourceLabel(source) {
    return ({ ai: "AI", human_phone: "手机", dashboard: "后台", sync: "同步" })[source] || "同步";
  }

  // 2026-10-07 学 LinkPilot：把“这时间是怎么来的”摊开给你看，才知道哪些时间可信。
  function kindLabel(timeKind) {
    return ({
      ui_explicit: "他发的",
      first_observed: "读到",
      ai_generated: "AI生成",
      manual: "人工",
      derived: "推算",
    })[String(timeKind || "")] || "";
  }

  function formatShortTime(epochSeconds) {
    const date = new Date(epochSeconds * 1000);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function formatFullTime(epochSeconds) {
    if (!epochSeconds) return "";
    return new Date(epochSeconds * 1000).toLocaleString("zh-CN", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  }

  function keywordText(value) {
    var text = String(value || "").trim();
    if (!text) return "还没有设置对方要说的词";
    try {
      var parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).join("、") || "还没有设置对方要说的词";
    } catch (_) { /* Plain comma-separated text is also supported. */ }
    return text;
  }

  function ruleGateLabel(gate) {
    return ({ input: "收到消息先处理", prompt: "给大模型看", output: "发出前检查", execution: "系统直接执行" })[gate] || gate;
  }

  function rulePersonaLabel(personaId) {
    var ids = String(personaId || "").split(",").map(function (item) { return item.trim(); }).filter(Boolean);
    if (!ids.length) return "全部人设";
    var labels = { female: "星暮", female_sutang: "苏棠", male: "阿杰", male_chenyu: "陈屿" };
    return "仅" + ids.map(function (id) { return labels[id] || id; }).join("、");
  }

  function ruleKey(item) {
    return String(item?.legacy_rule_id || item?.id || "");
  }

  function ruleTopicLabel(item) {
    var text = String((item?.title || "") + (item?.detail || "")).toLowerCase();
    var topics = [
      ["年龄和出生年份", ["年龄", "多大", "几岁", "出生年份", "哪年生的"]],
      ["婚姻状态", ["婚姻", "已婚", "未婚", "单身", "离婚", "离异"]],
      ["孩子和家庭", ["孩子", "子女", "娃", "家庭", "家人"]],
      ["联系方式", ["联系方式", "微信", "qq", "电话", "手机号", "号码"]],
      ["照片和图片", ["照片", "发图", "图片", "图库", "身材照"]],
      ["语音和视频", ["语音", "视频", "通话", "打电话"]],
      ["见面和关系升级", ["见面", "约见", "酒店", "关系升级", "下一步"]],
      ["暧昧和亲密边界", ["暧昧", "撩", "调情", "亲密", "私密照", "裸照"]],
      ["工作和业务", ["工作", "业务", "推销", "催单", "报价", "回收"]],
      ["聊天推进", ["冷场", "主动", "推进", "追问", "问问题"]],
      ["回复格式", ["字数", "长度", "15字", "两条", "分段"]],
      ["重复回复", ["重复", "复读", "连续发送"]],
      ["睡觉和休息", ["睡觉", "睡了", "晚安", "休息", "洗澡"]],
      ["人设身份", ["人设", "身份", "名字", "姓名", "星暮", "苏棠", "阿杰", "陈屿"]],
      ["知识库", ["知识库", "知识卡", "命中卡", "触发词"]],
      ["事实一致", ["事实", "档案", "资料", "改口", "编造"]],
      ["平台消息", ["平台提示", "系统通知", "已读回执", "正在输入", "礼物"]],
      ["表情处理", ["表情", "表情包", "互动表情"]],
      ["时间和历史", ["时间", "历史", "旧消息"]],
      ["语气和人味", ["客服", "ai腔", "说教", "语气", "真人感"]],
    ];
    var hit = topics.find(function (entry) {
      return entry[1].some(function (word) { return text.includes(word); });
    });
    return hit ? hit[0] : "其他规则";
  }

  function conflictLevelLabel(level) {
    return ({ error: "会打架", warn: "范围重叠", info: "重复或相近", muted: "已停用提醒" })[level] || "提醒";
  }

  function factText(value) {
    if (Array.isArray(value)) return value.filter(Boolean).join("、") || "未设置";
    var text = String(value ?? "").trim();
    return text || "未设置";
  }

  function drawerKindLabel(kind) {
    return ({
      identity: "身份事实",
      speech: "说话方式",
      policy: "禁止事项",
      lore: "生活素材",
      scene: "场景素材",
      counter: "接话技巧",
      topic: "起话题",
    })[kind] || "生活素材";
  }

  function drawerKindOptions(selected) {
    return [
      ["identity", "身份事实"], ["speech", "说话方式"], ["policy", "禁止事项"],
      ["lore", "生活素材"], ["scene", "场景素材"], ["counter", "接话技巧"], ["topic", "起话题"]
    ].map(function (item) {
      return '<option value="' + item[0] + '" ' + (selected === item[0] ? "selected" : "") + ">" + item[1] + "</option>";
    }).join("");
  }

  window.DashboardUtils = {
    PLATFORMS,
    $,
    contactKey,
    esc,
    platformMeta,
    platformName,
    renderPlatforms,
    showToast,
    dashboardIncidentNow,
    sanitizeDashboardPath,
    sourceLabel,
    kindLabel,
    formatShortTime,
    formatFullTime,
    keywordText,
    ruleGateLabel,
    rulePersonaLabel,
    ruleKey,
    ruleTopicLabel,
    conflictLevelLabel,
    factText,
    drawerKindLabel,
    drawerKindOptions,
  };
})();
