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
  };
})();
