const API_BASE = "/api";
const PLATFORMS = [
  { id: "soul", label: "Soul", short: "S" },
  { id: "qq", label: "QQ", short: "Q" },
  { id: "immomo", label: "陌陌", short: "陌" },
  { id: "lianxin", label: "连信", short: "连" },
];

const state = {
  password: "",
  tokens: [],
  groups: [],
  contacts: [],
  selected: null,
  targetAlias: null,
  refreshTimer: null,
  customerRequest: 0,
  messages: [],
  messageCursor: 0,
  bindingSelection: new Set(),
  libraryGroups: [],
  libraryObjectUrls: [],
  previewObjectUrl: "",
  uploadGroupId: "",
  editingLibraryGroupId: "",
  agentOverview: null,
  agentRules: [],
  agentRuleConflicts: [],
  agentRuleSummary: null,
  ruleCenterTab: "overview",
  ruleExpandedIds: new Set(),
  programRules: null,
  dashboardIncidentEvents: [],
  dashboardIncidentCounter: 0,
  dashboardIncidentSubmitting: false,
  dashboardIncidentDetailId: "",
  editingAgentRuleId: "",
  plainRuleTranslation: null,
  plainRuleText: "",
};

const $ = (id) => document.getElementById(id);

function contactKey(platform, contactId) {
  return `${String(platform || "")}\u0000${String(contactId || "")}`;
}

function syncBindingSelectionFromGroup(group) {
  state.bindingSelection = new Set((group?.aliases || []).map((alias) => contactKey(alias.platform, alias.contact_id)));
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

function dashboardIncidentContext() {
  return {
    page: currentPage,
    href: location.href,
    user_agent: navigator.userAgent,
    online: navigator.onLine,
    app_version: "dashboard-web",
  };
}

function sanitizeDashboardPath(path) {
  return String(path || "").replace(
    /([?&](?:token|password|key|authorization|secret)=)[^&]*/giu,
    "$1[已隐藏]"
  );
}

function recordDashboardIncidentEvent(type, detail) {
  state.dashboardIncidentCounter += 1;
  state.dashboardIncidentEvents.push({
    seq: state.dashboardIncidentCounter,
    time: dashboardIncidentNow(),
    type,
    detail: detail || {},
  });
  if (state.dashboardIncidentEvents.length > 300) {
    state.dashboardIncidentEvents.splice(0, state.dashboardIncidentEvents.length - 300);
  }
}

async function submitDashboardIncident(kind, reason, automatic) {
  if (state.dashboardIncidentSubmitting) return false;
  if (!state.password) return false;
  state.dashboardIncidentSubmitting = true;
  const id = "web-" + Date.now() + "-" + Math.random().toString(16).slice(2, 10);
  const events = state.dashboardIncidentEvents.slice(-200);
  try {
    const response = await fetch(API_BASE + "/dashboard-incidents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dashboard-Password": state.password,
      },
      body: JSON.stringify({
        id,
        kind: kind || "dashboard_error",
        reason: reason || "",
        context: dashboardIncidentContext(),
        events,
      }),
    });
    if (!response.ok) {
      if (!automatic) showToast("网站问题记录上传失败", "error");
      return false;
    }
    if (!automatic) showToast("网站问题已记录，AI可以读取");
    return true;
  } catch (error) {
    if (!automatic) showToast("网站问题记录上传失败：" + error.message, "error");
    return false;
  } finally {
    state.dashboardIncidentSubmitting = false;
  }
}

async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (state.password) headers["X-Dashboard-Password"] = state.password;
  const safePath = sanitizeDashboardPath(path);
  recordDashboardIncidentEvent("request", { method, path: safePath });
  let response;
  try {
    response = await fetch(API_BASE + path, {
      method,
      headers,
      cache: "no-store",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (networkError) {
    recordDashboardIncidentEvent("network_error", { method, path: safePath, message: networkError.message });
    submitDashboardIncident("network_error", method + " " + safePath + "：" + networkError.message, true);
    throw networkError;
  }
  const data = await response.json().catch(() => ({}));
  recordDashboardIncidentEvent("response", { method, path: safePath, status: response.status });
  if (!response.ok) {
    recordDashboardIncidentEvent("api_error", {
      method,
      path: safePath,
      status: response.status,
      error: data.error || "",
      code: data.code || "",
    });
    if (response.status >= 500) {
      submitDashboardIncident(
        "api_error",
        method + " " + safePath + " 返回 " + response.status + "：" + (data.error || data.code || ""),
        true
      );
    }
    if (response.status === 401 && $("appView").hidden === false) logout();
    const error = new Error(data.error || `请求失败 (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function apiBlob(path) {
  const headers = {};
  if (state.password) headers["X-Dashboard-Password"] = state.password;
  const response = await fetch(API_BASE + path, { headers, cache: "no-store" });
  if (!response.ok) {
    if (response.status === 401 && $("appView").hidden === false) logout();
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `图片读取失败 (${response.status})`);
  }
  return response.blob();
}

function clearLibraryObjectUrls() {
  for (const url of state.libraryObjectUrls || []) URL.revokeObjectURL(url);
  state.libraryObjectUrls = [];
}

async function login() {
  const password = $("passwordInput").value;
  $("loginError").textContent = "";
  try {
    const response = await fetch(API_BASE + "/dashboard/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error("密码错误");
    state.password = password;
    $("loginView").hidden = true;
    $("appView").hidden = false;
    await initializeDashboard();
    // 2026-10-08 用户实测：托管没开，D1 读数还在猛涨，一小时的把免费额度吃爆。
  // 原因就是这行——看板每 10 秒无脑刷新，一天 8640 次，每次都要从数据库拉几百行。
  // 现在：① 页面不在前台（切到别的标签/最小化）完全不刷；② 开着也改成 60 秒一次。
  state.refreshTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") refreshVisibleData();
  }, 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshVisibleData();
  });
  } catch (error) {
    $("loginError").textContent = error.message || "登录失败";
  }
}

function logout() {
  state.password = "";
  state.selected = null;
  state.groups = [];
  if (state.refreshTimer) window.clearInterval(state.refreshTimer);
  state.refreshTimer = null;
  $("appView").hidden = true;
  $("loginView").hidden = false;
  $("passwordInput").value = "";
}

async function initializeDashboard() {
  await loadTokens();
  await loadCustomers();
}

async function loadTokens() {
  const data = await api("GET", "/token");
  state.tokens = data.tokens || [];
  const deviceSelect = $("deviceSelect");
  const settingsSelect = $("settingsDeviceSelect");
  const current = deviceSelect.value;
  const currentSettings = settingsSelect ? settingsSelect.value : "";
  const options = state.tokens.map((token) => {
    const label = token.name ? `${token.name} · ${token.token}` : token.token;
    return `<option value="${esc(token.token)}">${esc(label)}</option>`;
  }).join("");
  deviceSelect.innerHTML = '<option value="">全部设备</option>' + options;
  deviceSelect.value = state.tokens.some((token) => token.token === current) ? current : "";
  if (settingsSelect) {
    settingsSelect.innerHTML = '<option value="">请选择设备</option>' + options;
    settingsSelect.value = state.tokens.some((token) => token.token === currentSettings)
      ? currentSettings
      : (state.tokens[0]?.token || "");
  }
}

async function loadCustomers(keepSelection = true) {
  const requestId = ++state.customerRequest;
  const params = new URLSearchParams();
  params.set("token", $("deviceSelect").value || "");
  params.set("platform", $("platformSelect").value || "");
  params.set("q", $("searchInput").value.trim());
  try {
    const data = await api("GET", `/customer-groups?${params.toString()}`);
    if (requestId !== state.customerRequest) return;
    state.groups = data.groups || [];
    if (keepSelection && state.selected) {
      const fresh = state.groups.find((group) => group.id === state.selected.id);
      if (fresh) state.selected = { ...fresh, platforms: fresh.platforms || state.selected.platforms };
      else state.selected = null;
    }
    renderCustomers();
    updateChatHeader();
    $("lastRefresh").textContent = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderCustomers() {
  const host = $("customerList");
  $("customerSummary").textContent = `${state.groups.length} 位客户`;
  if (!state.groups.length) {
    host.innerHTML = '<div class="section-empty">没有匹配的客户<br>可以换设备、平台或搜索词</div>';
    return;
  }
  host.innerHTML = state.groups.map((group) => {
    const active = state.selected?.id === group.id;
    const last = group.last_message;
    const preview = last
      ? `${last.role === "assistant" ? "我：" : ""}${last.content || "[非文字消息]"}`
      : "暂无聊天记录";
    const when = group.last_at ? formatShortTime(group.last_at) : "";
    return `
      <button class="customer ${active ? "active" : ""}" data-group-id="${esc(group.id)}">
        <span class="avatar">${esc(Array.from(group.display_name || "客")[0] || "客")}</span>
        <span class="customer-main">
          <span class="customer-name-row">
            <span class="customer-name">${esc(group.display_name || "未命名客户")}</span>
            ${group.priority_reply ? '<span class="priority-dot" title="优先回复"></span>' : ""}
            ${renderPlatforms(group.platforms)}
          </span>
          <span class="customer-preview">${esc(preview)}</span>
        </span>
        <span class="customer-meta"><span>${esc(when)}</span><span class="count-pill">${Number(group.message_count || 0)}</span></span>
      </button>`;
  }).join("");
  host.querySelectorAll("[data-group-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const group = state.groups.find((item) => item.id === button.dataset.groupId);
      if (group) openCustomer(group);
    });
  });
}

async function openCustomer(group) {
  state.selected = group;
  $("sidebar").classList.remove("mobile-open");
  state.targetAlias = group.aliases?.[0] || null;
  state.messages = [];
  state.messageCursor = 0;
  renderCustomers();
  updateChatHeader();
  $("messages").innerHTML = '<div class="empty-state">读取消息...</div>';
  await refreshMessages(true);
}

function updateChatHeader() {
  const group = state.selected;
  renderProfilePanel(group);
  const title = group?.display_name || "请选择客户";
  $("chatTitle").textContent = title;
  $("chatPlatforms").innerHTML = renderPlatforms(group?.platforms || []);
  $("chatSubtitle").textContent = group
    ? `${state.tokens.find((token) => token.token === group.token)?.name || group.token} · ${group.aliases?.length || 0} 个平台账号`
    : "从左侧选择设备与客户查看完整对话";
  $("aliasStrip").innerHTML = (group?.aliases || []).map((alias) => {
    const active = state.targetAlias?.platform === alias.platform && state.targetAlias?.contact_id === alias.contact_id;
    return `<button class="alias-chip ${active ? "active" : ""}" data-platform="${esc(alias.platform)}" data-contact-id="${esc(alias.contact_id)}">${esc(platformName(alias.platform))} · ${esc(alias.contact_name || alias.contact_id)}</button>`;
  }).join("");
  $("aliasStrip").querySelectorAll("[data-platform]").forEach((button) => {
    button.addEventListener("click", () => {
      state.targetAlias = group.aliases.find((alias) =>
        alias.platform === button.dataset.platform && alias.contact_id === button.dataset.contactId
      ) || null;
      updateChatHeader();
    });
  });

  const hasSelected = Boolean(group);
  $("bindButton").disabled = !hasSelected;
  $("priorityButton").disabled = !hasSelected;
  $("manualInput").disabled = !hasSelected || !state.targetAlias;
  $("manualSendButton").disabled = !hasSelected || !state.targetAlias;
  $("priorityButton").classList.toggle("active", Boolean(group?.priority_reply));
  $("priorityButton").textContent = group?.priority_reply ? "优先回复已开启" : "优先回复";
  $("composerNote").textContent = state.targetAlias
    ? `将发送到 ${platformName(state.targetAlias.platform)} · ${state.targetAlias.contact_name || state.targetAlias.contact_id}`
    : "请选择发送目标平台账号";
}

function renderProfilePanel(group) {
  const name = group?.display_name || "请选择客户";
  const token = group ? (state.tokens.find((item) => item.token === group.token)?.name || group.token) : "未选择设备";
  const alias = state.targetAlias || group?.aliases?.[0] || null;
  $("profileAvatar").textContent = Array.from(name)[0] || "客";
  $("profileName").textContent = name;
  $("profileSubtitle").textContent = group
    ? `${token} · ${alias ? `${platformName(alias.platform)} · ${alias.contact_name || alias.contact_id}` : "未绑定平台账号"}`
    : "选择后查看客户资料";
  $("profileMessageCount").textContent = Number(group?.message_count || 0).toLocaleString("zh-CN");
  $("profilePlatformCount").textContent = String(group?.platforms?.length || 0);
  $("profilePriority").textContent = group?.priority_reply ? "已开启" : "普通";
  $("profilePriority").className = group?.priority_reply ? "status-priority" : "";
  $("profileLastMessage").textContent = group?.last_at ? formatShortTime(group.last_at) : "--";
  renderProfileIdentity(group?.profile);
  renderContactFlags(group);
  renderTakeoverAlerts(group);

  const active = new Set(group?.platforms || []);
  $("profilePlatformLinks").innerHTML = PLATFORMS.map((platform) => {
    const enabled = active.has(platform.id);
    const account = group?.aliases?.find((item) => item.platform === platform.id);
    return `<button class="platform-link ${enabled ? "on" : ""}" ${enabled ? "" : "disabled"} data-profile-platform="${esc(platform.id)}" title="${esc(account?.contact_name || platform.label)}">`
      + `<b>${platform.short}</b>${platform.label}</button>`;
  }).join("");
  $("profilePlatformLinks").querySelectorAll("[data-profile-platform]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!group) return;
      state.targetAlias = group.aliases.find((item) => item.platform === button.dataset.profilePlatform) || null;
      updateChatHeader();
    });
  });
}

// 2026-10-07：把“为什么不回他”摊开给你看，并且能一键改回。
function takeoverKindText(kind) {
  return ({ give: "他给了联系方式", want: "他要联系方式" })[String(kind || "")] || String(kind || "需要人工接管");
}

function contactFlagItems(group) {
  const items = [];
  for (const alias of group?.aliases || []) {
    const base = { alias };
    const who = platformName(alias.platform) +
      (alias.contact_name && alias.contact_name !== group.display_name ? "·" + alias.contact_name : "");
    // 2026-10-07：已婚和“停回”是两回事，恢复的按钮要分开——
    // 只想让停回的人重新能聊，但不想清掉“他已婚”这个事实，就只点【恢复回复】。
    if (String(alias.marital_status || "") === "married") {
      items.push({ ...base, warn: false, label: who + "：已婚不回", action: "married", actionText: "清除已婚标记" });
    }
    if (Number(alias.is_whitelisted ?? 1) === 0) {
      items.push({ ...base, warn: false, label: who + "：已停止回复", action: "muted", actionText: "恢复回复" });
    }
    if (Number(alias.voice_warn_at || 0) > 0 && Number(alias.is_whitelisted ?? 1) !== 0) {
      items.push({ ...base, warn: true, label: who + "：语音/表情已警告过", action: "warned", actionText: "清警告" });
    }
    // 2026-10-07：他发过照片就永不再问——永久记在档案上，这里能看见、也能清掉重来。
    if (Number(alias.his_photo_at || 0) > 0) {
      items.push({ ...base, warn: false, label: who + "：已收到他的照片（不再问他长什么样）", action: "hisPhoto", actionText: "清掉这条记录" });
    }
    if (Number(alias.her_photo_at || 0) > 0) {
      items.push({ ...base, warn: false, label: who + "：已给他看过照片", action: "herPhoto", actionText: "清掉这条记录" });
    }
  }
  return items;
}

function renderContactFlags(group) {
  const host = $("profileFlags");
  if (!host) return;
  const items = contactFlagItems(group);
  if (!group || !items.length) {
    host.innerHTML = '<span class="flag-none">正常回复中</span>';
    return;
  }
  // 每个平台账号一条状态 + 各自对应的“恢复”按钮（已婚 / 停回 / 警告 分别处理）。
  host.innerHTML = items.map((item, index) =>
    `<span class="contact-flag ${item.warn ? "warn" : ""}">${esc(item.label)}</span>`
    + `<button class="flag-restore" data-flag-action="${esc(item.action)}" data-flag-index="${index}">${esc(item.actionText)}</button>`
  ).join("");
  host.querySelectorAll("[data-flag-action]").forEach((button) => {
    button.addEventListener("click", () => restoreContactFlag(button.dataset.flagAction, Number(button.dataset.flagIndex)));
  });
}

// 2026-10-07：三种状态各自恢复，互不牵连——
// 【恢复回复】只解“停回”，不动“他已婚”；【清除已婚标记】只清已婚；【清警告】只清警告时间。
async function restoreContactFlag(kind, index) {
  const group = state.selected;
  if (!group) return;
  const item = contactFlagItems(group)[index];
  if (!item?.alias) return;
  const body = { token: group.token, platform: item.alias.platform, contact_id: item.alias.contact_id };
  let done = "已处理";
  if (kind === "married") { body.marital_status = ""; done = "已清除已婚标记"; }
  else if (kind === "muted") { body.is_whitelisted = 1; body.voice_warn_at = 0; done = "已恢复回复（已婚标记保留）"; }
  else if (kind === "warned") { body.voice_warn_at = 0; done = "已清除警告"; }
  // 2026-10-07：清掉照片记录（清掉之后她就会重新问他长什么样）。
  else if (kind === "hisPhoto") { body.his_photo_at = 0; done = "已清掉：以后会重新问他长什么样"; }
  else if (kind === "herPhoto") { body.her_photo_at = 0; done = "已清掉：给她看过的记录"; }
  try {
    await api("PUT", "/contacts", body);
    showToast(done);
    await loadCustomers();
    const fresh = (state.groups || []).find((entry) => entry.id === group.id) || group;
    state.selected = fresh;
    updateChatHeader();
  } catch (error) {
    showToast("操作失败：" + error.message, "error");
  }
}

async function renderTakeoverAlerts(group) {
  const host = $("takeoverList");
  if (!host) return;
  const countHost = $("takeoverCount");
  if (!group) {
    if (countHost) countHost.textContent = "";
    host.innerHTML = '<div class="flag-none">暂无</div>';
    return;
  }
  try {
    const data = await api("GET", `/takeover-alerts?token=${encodeURIComponent(group.token)}&contact_name=${encodeURIComponent(group.display_name)}`);
    const alerts = data.alerts || [];
    if (countHost) countHost.textContent = alerts.length ? alerts.length + " 条" : "";
    host.innerHTML = alerts.length
      ? alerts.map((item) => `<div class="takeover-item"><b>${esc(takeoverKindText(item.kind))}${item.notified_at ? " · 已发邮件" : " · 邮件未发"}</b><p>${esc(String(item.content || "").slice(0, 60))}</p><span>${esc(formatFullTime(item.created_at))}</span></div>`).join("")
      : '<div class="flag-none">暂无</div>';
  } catch (error) {
    host.innerHTML = '<div class="flag-none">读取失败：' + esc(error.message) + "</div>";
  }
}

function profileText(value, fallback = "未收集") {
  if (Array.isArray(value)) return value.filter(Boolean).join("、") || fallback;
  const text = String(value ?? "").trim();
  return text || fallback;
}

function renderProfileIdentity(profileState) {
  const profile = profileState?.profile || {};
  const basic = profile.basic || {};
  const location = profile.location || {};
  const education = profile.education || {};
  const work = profile.work || {};
  const family = profile.family || {};
  const relationship = profile.relationship || {};
  const preferences = profile.preferences || {};
  const recent = profile.recent || {};
  $("profileBasicName").textContent = profileText(basic.name);
  $("profileLocationCity").textContent = profileText(location.city || location.residence);
  $("profileLocationHometown").textContent = profileText(location.hometown);
  $("profileEducation").textContent = profileText([education.school, education.major].filter(Boolean));
  $("profileWork").textContent = profileText([work.company, work.role, work.industry].filter(Boolean));
  $("profileFamily").textContent = profileText([family.marital_status, family.children, family.notes].filter(Boolean));
  $("profileRelationship").textContent = profileText([relationship.status, relationship.preferences].filter(Boolean));
  $("profileLikes").textContent = profileText(preferences.likes);
  $("profileDislikes").textContent = profileText(preferences.dislikes);
  $("profileRecent").textContent = profileText([...(recent.goals || []), ...(recent.events || [])]);
  $("profileNotes").textContent = profileText(profile.notes);
  $("profileUpdated").textContent = profileState?.updated_at ? `更新于 ${formatShortTime(profileState.updated_at)}` : "明确资料即时更新，复杂资料分批提取";
}

async function refreshMessages(forceBottom = false) {
  const group = state.selected;
  if (!group) return;
  const host = $("messages");
  const nearBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 100;
  const sinceId = forceBottom ? 0 : state.messageCursor;
  try {
    const params = new URLSearchParams({
      token: group.token,
      group_id: group.id,
      limit: "300",
      since_id: String(sinceId || 0),
    });
    const data = await api("GET", `/customer-messages?${params.toString()}`);
    if (state.selected?.id !== group.id) return;
    const incoming = data.messages || [];
    if (sinceId > 0) {
      const byId = new Map(state.messages.map((message) => [String(message.id), message]));
      incoming.forEach((message) => byId.set(String(message.id), message));
      state.messages = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
    } else {
      state.messages = incoming;
    }
    state.messageCursor = Math.max(Number(data.latest_id || 0), ...state.messages.map((message) => Number(message.id || 0)));
    state.selected = {
      ...group,
      ...data.identity,
      profile: data.profile || group.profile,
      platforms: group.platforms || [],
      last_message: group.last_message,
      last_at: group.last_at,
      message_count: group.message_count,
    };
    renderMessages(state.messages);
    if (forceBottom || nearBottom || incoming.some((message) => message.role === "assistant")) host.scrollTop = host.scrollHeight;
    updateChatHeader();
  } catch (error) {
    $("messages").innerHTML = `<div class="empty-state">消息读取失败：${esc(error.message)}</div>`;
  }
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

// 非文字消息（语音/图片/表情/动态）渲染成带说明的标签，运营不用点开就知道对面发了什么。
function messageBody(message) {
  const raw = String(message.content || "").trim();
  const leading = (value) => String(value || "").replace(/^(?:\[[^\]\n]{1,8}\]\s*)+/u, "").trim();
  const chip = (name, text) => ({ chip: name, text: String(text || "").trim() });
  let match;
  // 2026-10-07 方案A：转写单独存，看板把语音显示成“语音 + 转写文字”。
  const storedTranscript = String(message.transcript || "").trim();
  if (storedTranscript && /^\[语音\]$/u.test(raw)) return chip("语音", storedTranscript);
  if ((match = raw.match(/^\[语音(?::([^\]]*))?\]\s*([\s\S]*)$/))) return chip("语音" + (match[1] ? "：" + match[1] : ""), match[2] || storedTranscript);
  if ((match = raw.match(/^\[图片(?::([^\]]*))?\]\s*([\s\S]*)$/))) return chip("图片", leading(match[2]) || match[1] || "");
  if ((match = raw.match(/^\[(?:表情|Soul互动表情)(?::([^\]]*))?\]\s*([\s\S]*)$/))) return chip("表情" + (match[1] ? "：" + match[1] : ""), leading(match[2]));
  if (/^\[(?:对方转发了|你转发了|转发了)/.test(raw)) return chip("动态卡片", raw.slice(0, 80));
  if ((match = raw.match(/^\[([^\]\n]{1,8})\]\s*([\s\S]*)$/))) return chip(match[1], leading(match[2]));
  if (!raw) return chip("未知非文字消息", "");
  return null;
}

function renderMessages(messages) {
  const host = $("messages");
  if (!messages.length) {
    host.innerHTML = '<div class="empty-state">暂无聊天记录</div>';
    return;
  }
  let lastDate = "";
  host.innerHTML = messages.map((message) => {
    const date = new Date((message.created_at || 0) * 1000);
    const dateText = date.toLocaleDateString("zh-CN");
    const separator = dateText !== lastDate ? `<div class="date-separator">${esc(dateText)}</div>` : "";
    lastDate = dateText;
    const side = message.role === "assistant" ? "self" : "peer";
    const body = messageBody(message);
    const bubble = body
      ? `<div class="bubble content-bubble"><span class="content-chip">${esc(body.chip)}</span>${body.text ? `<span class="content-rest">${esc(body.text)}</span>` : ""}</div>`
      : `<div class="bubble">${esc(message.content || "")}</div>`;
    const kind = kindLabel(message.time_kind);
    return `${separator}
      <div class="message-row ${side}">
        <div class="message-block">
          ${bubble}
          <div class="message-meta">
            <span>${esc(formatFullTime(message.created_at))}</span>
            ${kind ? `<span class="kind-label kind-${esc(String(message.time_kind || ""))}">${esc(kind)}</span>` : ""}
            <span class="source-label">${esc(sourceLabel(message.source))}</span>
            <span class="platform-label">${esc(platformName(message.platform))}</span>
          </div>
        </div>
      </div>`;
  }).join("");
}

async function enqueueManualMessage() {
  const group = state.selected;
  const alias = state.targetAlias;
  const content = $("manualInput").value.trim();
  if (!group || !alias || !content) return;
  $("manualSendButton").disabled = true;
  $("actionStatus").textContent = "正在加入优先队列...";
  try {
    await api("POST", "/manual-replies", {
      token: group.token,
      group_id: group.id.startsWith("single:") ? "" : group.id,
      platform: alias.platform,
      contact_id: alias.contact_id,
      contact_name: alias.contact_name,
      content,
    });
    $("manualInput").value = "";
    $("actionStatus").textContent = "已加入最高优先队列";
    showToast("消息已加入优先发送队列");
  } catch (error) {
    $("actionStatus").textContent = `发送失败：${error.message}`;
    showToast(error.message, "error");
  } finally {
    $("manualSendButton").disabled = false;
  }
}

async function togglePriority() {
  const group = state.selected;
  if (!group) return;
  const enabled = !group.priority_reply;
  $("priorityButton").disabled = true;
  $("actionStatus").textContent = "正在更新优先级...";
  try {
    const data = await api("PUT", "/customer-groups/priority", {
      token: group.token,
      group_id: group.id,
      enabled,
    });
    state.selected = {
      ...state.selected,
      ...data.group,
      platforms: group.platforms || [],
      last_message: group.last_message,
      last_at: group.last_at,
      message_count: group.message_count,
    };
    $("actionStatus").textContent = enabled ? "优先回复已开启" : "已恢复普通回复";
    showToast(enabled ? "已开启优先回复" : "已取消优先回复");
    await loadCustomers();
  } catch (error) {
    $("actionStatus").textContent = `更新失败：${error.message}`;
    showToast(error.message, "error");
  } finally {
    $("priorityButton").disabled = false;
    updateChatHeader();
  }
}

async function openBindModal() {
  const group = state.selected;
  if (!group) return;
  $("bindModal").hidden = false;
  $("bindNameInput").value = group.display_name || "";
  $("bindSearchInput").value = "";
  syncBindingSelectionFromGroup(group);
  $("bindHint").textContent = "正在读取该设备的平台联系人...";
  try {
    const data = await api("GET", `/contacts?token=${encodeURIComponent(group.token)}`);
    state.contacts = data.contacts || [];
    $("bindHint").textContent = "选择要归为同一个人的账号。已关联账号会保持勾选。";
    renderBindContacts();
  } catch (error) {
    $("bindHint").textContent = error.message;
  }
}

function renderBindContacts() {
  const group = state.selected;
  const query = $("bindSearchInput").value.trim().toLowerCase();
  const selectedKeys = state.bindingSelection;
  const rows = state.contacts.filter((contact) => {
    if (!query) return true;
    return `${contact.contact_name || ""} ${contact.contact_id || ""} ${platformName(contact.platform)}`.toLowerCase().includes(query);
  });
  if (!rows.length) {
    $("bindList").innerHTML = '<div class="section-empty">没有可关联的平台账号</div>';
    return;
  }
  $("bindList").innerHTML = rows.map((contact) => {
    const key = contactKey(contact.platform, contact.contact_id);
    return `<label class="bind-item">
      <input type="checkbox" data-platform="${esc(contact.platform)}" data-contact-id="${esc(contact.contact_id)}" ${selectedKeys.has(key) ? "checked" : ""}>
      ${renderPlatforms([contact.platform])}
      <span class="bind-name">${esc(contact.contact_name || contact.contact_id)}</span>
      <span class="small-muted">${esc(contact.contact_id)}</span>
    </label>`;
  }).join("");
  $("bindList").querySelectorAll("input[data-platform][data-contact-id]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = contactKey(input.dataset.platform, input.dataset.contactId);
      if (input.checked) state.bindingSelection.add(key);
      else state.bindingSelection.delete(key);
    });
  });
}

async function saveBindings() {
  const group = state.selected;
  if (!group) return;
  const selectedContacts = state.contacts.filter((contact) =>
    state.bindingSelection.has(contactKey(contact.platform, contact.contact_id))
  );
  if (!selectedContacts.length) {
    showToast("至少选择一个平台账号", "error");
    return;
  }
  $("saveBindButton").disabled = true;
  try {
    const data = await api("POST", "/customer-groups/bind", {
      token: group.token,
      group_id: group.id.startsWith("single:") ? "" : group.id,
      display_name: $("bindNameInput").value.trim() || group.display_name,
      replace_aliases: true,
      contacts: selectedContacts.map((contact) => ({
        platform: contact.platform,
        contact_id: contact.contact_id,
        contact_name: contact.contact_name,
      })),
    });
    $("bindModal").hidden = true;
    state.selected = {
      ...group,
      ...data.group,
      platforms: data.group.aliases.map((alias) => alias.platform),
      last_message: group.last_message,
      last_at: group.last_at,
      message_count: group.message_count,
    };
    state.targetAlias = state.selected.aliases?.[0] || null;
    await loadCustomers();
    updateChatHeader();
    showToast("跨平台账号已关联，记忆将合并");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    $("saveBindButton").disabled = false;
  }
}

async function openPersonaModal() {
  $("personaModal").hidden = false;
  $("personaList").innerHTML = '<div class="section-empty">读取中...</div>';
  try {
    const data = await api("GET", "/persona?include_prompt=1");
    const personas = data.personas || [];
    $("personaList").innerHTML = personas.map((persona) => {
      const drawers = persona.drawers || { topics: [], counters: [] };
      const topicItems = drawers.topics || [];
      const counterItems = drawers.counters || [];
      return `
        <div class="persona-card ${persona.is_active ? "active" : ""}">
          <h3>${esc(persona.name)}${persona.is_active ? " · 当前使用" : ""}</h3>
          <p style="font-size:12px;color:var(--muted);">${esc((persona.system_prompt || "").slice(0, 90))}...</p>
          <div class="drawer-section">
            <strong style="font-size:13px;">生活画面与接招抽屉（按需触发，命中才调用）：</strong>
            <div style="margin-top:6px;">
              ${[...topicItems, ...counterItems].map((item, idx) => `
                <div class="drawer-item" data-drawer-idx="${idx}">
                  <div style="font-weight:bold;font-size:12px;display:flex;justify-content:space-between;">
                    <span>🏷️ ${esc(item.name)}</span>
                    <span style="color:var(--muted);font-weight:normal;">触发词: ${esc((item.keywords || []).join(","))}</span>
                  </div>
                  <div style="font-size:12px;color:#333;">${esc(item.content)}</div>
                </div>
              `).join("")}
            </div>
          </div>
          <div class="persona-actions" style="margin-top:10px;">
            ${persona.is_active ? "" : `<button class="primary-button" data-persona-id="${esc(persona.id)}">设为当前使用</button>`}
          </div>
        </div>`;
    }).join("");
    $("personaList").querySelectorAll("[data-persona-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await api("PUT", "/persona/activate", { id: button.dataset.personaId });
          showToast("人设已切换");
          openPersonaModal();
        } catch (error) {
          showToast(error.message, "error");
        }
      });
    });
  } catch (error) {
    $("personaList").innerHTML = `<div class="section-empty">${esc(error.message)}</div>`;
  }
}

async function openTokenModal() {
  $("tokenModal").hidden = false;
  $("tokenList").innerHTML = '<div class="section-empty">读取中...</div>';
  try {
    await loadTokens();
    $("tokenList").innerHTML = `<table><thead><tr><th>设备名称</th><th>设备密钥</th><th>月上限</th><th>已使用</th><th>状态</th><th>最后使用</th><th>额度操作</th></tr></thead><tbody>` +
      state.tokens.map((token) => {
        const lastUsed = token.last_used_at ? new Date(token.last_used_at * 1000).toLocaleString("zh-CN") : "从未";
        const isUnlimited = Number(token.monthly_limit) < 0;
        const limitDisplay = isUnlimited
          ? `<span style="color:var(--brand,#2563eb);font-weight:600;">无限</span>`
          : `¥${Number(token.monthly_limit || 0)}`;
        return `<tr>
          <td>${esc(token.name || "未命名")}</td>
          <td style="font-family:monospace;font-size:12px;">${esc(token.token)}</td>
          <td>${limitDisplay}</td>
          <td>¥${Number(token.spent || 0).toFixed(2)}</td>
          <td>${token.is_active ? "启用" : "停用"}</td>
          <td style="font-size:12px;color:var(--muted);">${esc(lastUsed)}</td>
          <td>
            <div style="display:flex;gap:6px;align-items:center;">
              <button class="ghost-button small-button" data-token-reset="${esc(token.token)}" title="清零本月已用费用">清零已用</button>
              ${isUnlimited
                ? `<button class="ghost-button small-button" data-token-limit="${esc(token.token)}" data-value="30">设为30元</button>`
                : `<button class="primary-button small-button" data-token-limit="${esc(token.token)}" data-value="-1">设为无限</button>`
              }
            </div>
          </td>
        </tr>`;
      }).join("") + `</tbody></table>`;

    $("tokenList").querySelectorAll("[data-token-reset]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const token = btn.dataset.tokenReset;
        try {
          await api("PUT", "/token", { token, reset_spent: true });
          showToast("已清零已使用额度");
          openTokenModal();
        } catch (error) {
          showToast(error.message, "error");
        }
      });
    });

    $("tokenList").querySelectorAll("[data-token-limit]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const token = btn.dataset.tokenLimit;
        const targetLimit = Number(btn.dataset.value);
        try {
          await api("PUT", "/token", { token, monthly_limit: targetLimit });
          showToast(targetLimit < 0 ? "已设为无限额度" : `已设为上限 ¥${targetLimit}`);
          openTokenModal();
        } catch (error) {
          showToast(error.message, "error");
        }
      });
    });
  } catch (error) {
    $("tokenList").innerHTML = `<div class="section-empty">${esc(error.message)}</div>`;
  }
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

function refreshVisibleData() {
  if ($("appView").hidden || document.hidden) return;
  if (currentPage === "session") {
    loadCustomers();
    if (state.selected) refreshMessages();
    loadHumanWaiting();
  }
  if (currentPage === "settings") loadHostingConfig();
}

// 2026-10-09 borrows xiniuzi human-waiting-by-account + takeover_batch
async function loadHumanWaiting() {
  const host = $("waitingList");
  if (!host) return;
  try {
    const token = $("deviceSelect") ? $("deviceSelect").value : "";
    const data = await api("GET", "/human-waiting" + (token ? "?token=" + encodeURIComponent(token) : ""));
    const list = data.waiting || [];
    const countHost = $("waitingCount");
    if (countHost) countHost.textContent = list.length ? list.length + " 人" : "";
    host.innerHTML = list.length
      ? list.map(function (item) {
          var mins = item.waiting_since ? Math.max(1, Math.round((Date.now() / 1000 - item.waiting_since) / 60)) : 0;
          return '<div class="waiting-item"><b>' + esc(item.contact_name || item.contact_id) + '</b>'
            + '<span>' + esc(item.platform) + " 等" + mins + "分钟 By " + esc(item.takeover_by || "") + "</span>"
            + '<button data-t="' + esc(item.token) + '" data-p="' + esc(item.platform) + '" data-c="' + esc(item.contact_id) + '" data-n="' + esc(item.contact_name || "") + '" onclick="releaseBackToAi(this)">放回AI</button></div>';
        }).join("")
      : '<div class="flag-none">暂无等待</div>';
  } catch (error) {
    host.innerHTML = '<div class="flag-none">获取失败</div>';
  }
}

async function setTakeover(mode) {
  if (!state.selected) return;
  var selectedId = state.selected.id;
  var g = (state.groups || []).find(function (x) { return x.id === selectedId; }) || state.selected;
  if (!g || !g.aliases || !g.aliases.length) { showToast("先选一个客户"); return; }
  var token = g.token || ($("deviceSelect") ? $("deviceSelect").value : "");
  var items = g.aliases.map(function (a) { return { token: token, platform: a.platform, contact_id: a.contact_id, contact_name: a.contact_name }; });
  await api("POST", "/takeover", { items: items, mode: mode, by: "dashboard" });
  showToast(mode === "manual" ? "已接管，AI不再回" : "已放回AI");
  loadHumanWaiting();
}

async function loadHostingConfig() {
  var token = $("settingsDeviceSelect") ? $("settingsDeviceSelect").value : "";
  var saveButton = $("hostingSaveBtn");
  var note = $("settingsNote");
  if (!token) {
    if (saveButton) saveButton.disabled = true;
    if (note) note.textContent = "先选一个设备，才能改这些设置。";
    return;
  }
  try {
    var cfg = await api("GET", "/hosting-config?token=" + encodeURIComponent(token));
    if ($("settingsPlatform")) $("settingsPlatform").value = cfg.platform || "soul";
    if ($("hostingEnabled")) $("hostingEnabled").checked = !!cfg.hosting_enabled;
    if ($("monitorEnabled")) $("monitorEnabled").checked = !!cfg.monitor_enabled;
    if ($("weatherEnabled")) $("weatherEnabled").checked = !!cfg.weather_enabled;
    if ($("timeEnabled")) $("timeEnabled").checked = !!cfg.time_enabled;
    if ($("paceInput")) $("paceInput").value = cfg.reply_pace_sec ?? 0;
    if ($("aiHoursEnabled")) $("aiHoursEnabled").checked = !!cfg.ai_hours_enabled;
    if ($("aiStartHour")) $("aiStartHour").value = cfg.ai_start_hour ?? 8;
    if ($("aiEndHour")) $("aiEndHour").value = cfg.ai_end_hour ?? 23;
    if (saveButton) saveButton.disabled = false;
    if (note) note.textContent = "这些开关和手机端共用一份设置。";
  } catch (e) {
    if (saveButton) saveButton.disabled = true;
    if (note) note.textContent = "设置读取失败：" + e.message;
  }
}

var currentPage = "session";

function showPage(name) {
  currentPage = name;
  var nav = $("pageNav");
  if (nav) {
    var btns = nav.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("on", btns[i].dataset.page === name);
    }
  }
  document.querySelectorAll(".page-panel").forEach(function (page) {
    page.classList.toggle("on", page.id === "page-" + name);
  });
  if (name === "library") loadLibrary();
  if (name === "drawers") loadDrawers();
  if (name === "kb") loadKnowledge();
  if (name === "settings") loadSettingsPage();
}

function activePersonaId() {
  if (currentPage === "kb") {
    return ($("knowledgePersona") && $("knowledgePersona").value) || "female_sutang";
  }
  return ($("drawerPersona") && $("drawerPersona").value) || "female_sutang";
}

function loadSettingsPage() {
  loadHostingConfig();
  loadModelRoute();
  loadDashboardIncidents();
}

async function loadDashboardIncidents() {
  var host = $("dashboardIncidentList");
  if (!host) return;
  host.innerHTML = '<div class="flag-none">正在读取网站问题...</div>';
  try {
    var data = await api("GET", "/automation-incidents?source=dashboard&limit=30");
    var incidents = data.incidents || [];
    host.innerHTML = incidents.length ? incidents.map(function (item) {
      var time = item.created_at ? new Date(Number(item.created_at) * 1000).toLocaleString("zh-CN") : "";
      var statusLabel = ({
        new: "新问题",
        processing: "处理中",
        fixed: "已修复",
        verified: "已验证",
      })[item.status] || item.status || "新问题";
      return '<div class="dashboard-incident-item">'
        + "<b>" + esc(item.kind || "网站问题") + "</b>"
        + "<p>" + esc(item.payload_preview || "没有附加说明") + "</p>"
        + "<small>" + esc(time) + " · " + Number(item.event_count || 0) + " 条记录 · " + esc(statusLabel) + "</small>"
        + '<button class="ghost-button small-button" data-incident-view="' + esc(item.id) + '">查看完整过程</button>'
        + "</div>";
    }).join("") : '<div class="flag-none">还没有网站故障记录。</div>';
    host.querySelectorAll("[data-incident-view]").forEach(function (button) {
      button.addEventListener("click", function () {
        openDashboardIncident(button.dataset.incidentView);
      });
    });
  } catch (error) {
    host.innerHTML = '<div class="flag-none">网站问题读取失败：' + esc(error.message) + "</div>";
  }
}

function parseIncidentEvents(payload) {
  if (!payload) return [];
  try {
    var parsed = JSON.parse(payload);
    if (parsed && Array.isArray(parsed.events)) return parsed.events;
    return [parsed];
  } catch (_) {
    return String(payload).split(/\r?\n/u).map(function (line) {
      try { return JSON.parse(line); } catch (_) { return null; }
    }).filter(Boolean);
  }
}

function renderIncidentEvent(event) {
  var title = event.event || event.type || event.action || "记录";
  var detail = event.reason || event.message || event.result || event.detail || "";
  var time = event.time || "";
  if (!time && event.timestampMs) {
    time = new Date(Number(event.timestampMs)).toLocaleString("zh-CN");
  }
  var screenshot = event.screenshotData
    ? '<img alt="故障截图" src="data:image/jpeg;base64,' + event.screenshotData + '">'
    : "";
  return '<div class="incident-event"><b>' + esc(title) + "</b>"
    + (detail ? "<p>" + esc(typeof detail === "object" ? JSON.stringify(detail) : detail) + "</p>" : "")
    + (time ? "<p>" + esc(time) + "</p>" : "")
    + screenshot
    + "</div>";
}

async function openDashboardIncident(id) {
  var modal = $("dashboardIncidentModal");
  var title = $("dashboardIncidentTitle");
  var host = $("dashboardIncidentDetail");
  if (!modal || !title || !host) return;
  state.dashboardIncidentDetailId = id;
  title.textContent = "故障详情 · " + id;
  host.innerHTML = '<div class="flag-none">正在读取完整过程...</div>';
  modal.hidden = false;
  try {
    var data = await api("GET", "/automation-incidents?id=" + encodeURIComponent(id));
    var incident = data.incident || {};
    if ($("dashboardIncidentStatus")) {
      $("dashboardIncidentStatus").value = incident.status || "new";
    }
    var events = parseIncidentEvents(incident.payload);
    host.innerHTML = events.length
      ? events.map(renderIncidentEvent).join("")
      : '<div class="flag-none">这条故障没有可显示的过程记录。</div>';
  } catch (error) {
    host.innerHTML = '<div class="flag-none">故障详情读取失败：' + esc(error.message) + "</div>";
  }
}

async function loadLibrary() {
  var grid = $("libGrid");
  if (!grid) return;
  clearLibraryObjectUrls();
  showLibGroupsView();
  grid.innerHTML = '<div class="empty-panel">正在读取图库...</div>';
  try {
    var data = await api("GET", "/media-library");
    state.libraryGroups = data.groups || [];
    grid.innerHTML = state.libraryGroups.length
      ? state.libraryGroups.map(renderLibraryCard).join("")
      : '<div class="empty-panel">还没有图库分组，先点右上角新建一个。</div>';
    bindLibraryCardEvents(grid);
    grid.querySelectorAll("img[data-media-src]").forEach(loadLibraryThumb);
  } catch (e) {
    grid.innerHTML = '<div class="empty-panel">图库读取失败：' + esc(e.message) + "</div>";
  }
}

function showLibGroupsView() {
  $("libGroupsView").hidden = false;
  $("libDetailView").hidden = true;
}

function showLibDetailView() {
  $("libGroupsView").hidden = true;
  $("libDetailView").hidden = false;
}

function bindLibraryCardEvents(scope) {
  scope.querySelectorAll("[data-lib-upload]").forEach(function (button) {
    button.addEventListener("click", function (e) { e.stopPropagation(); chooseLibraryImage(button.dataset.libUpload); });
  });
  scope.querySelectorAll("[data-lib-edit]").forEach(function (button) {
    button.addEventListener("click", function (e) {
      e.stopPropagation();
      var group = state.libraryGroups.find(function (item) { return item.id === button.dataset.libEdit; });
      if (group) openLibraryGroupModal(group);
    });
  });
  scope.querySelectorAll("[data-lib-toggle]").forEach(function (button) {
    button.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleLibGroup(button.dataset.libToggle, button.dataset.libNext === "1");
    });
  });
  scope.querySelectorAll("[data-lib-enter]").forEach(function (card) {
    card.addEventListener("click", function () { openGroupDetail(card.dataset.libEnter); });
  });
  scope.querySelectorAll("[data-lib-enter-btn]").forEach(function (btn) {
    btn.addEventListener("click", function (e) { e.stopPropagation(); openGroupDetail(btn.dataset.libEnterBtn); });
  });
  scope.querySelectorAll("[data-media-delete]").forEach(function (button) {
    button.addEventListener("click", function (e) { e.stopPropagation(); deleteLibraryAsset(button.dataset.mediaDelete); });
  });
  scope.querySelectorAll("[data-media-preview]").forEach(function (target) {
    target.addEventListener("click", function (e) {
      e.stopPropagation();
      openMediaPreview(target.dataset.mediaPreview, target.dataset.mediaTitle || target.alt);
    });
  });
}

async function openGroupDetail(groupId) {
  showLibDetailView();
  var grid = $("libDetailGrid");
  grid.innerHTML = '<div class="empty-panel">正在读取图片...</div>';
  try {
    var data = await api("GET", "/media-library/groups/" + encodeURIComponent(groupId) + "/assets");
    state.currentGroup = data.group;
    state.currentGroupAssets = data.assets || [];
    $("libDetailName").textContent = data.group.name;
    $("libDetailMeta").textContent = (data.assets || []).length + " 张图片";
    $("libDetailUploadButton").onclick = function () { chooseLibraryImage(groupId); };
    renderGroupDetailGrid();
  } catch (e) {
    grid.innerHTML = '<div class="empty-panel">读取失败：' + esc(e.message) + "</div>";
  }
}

function renderGroupDetailGrid() {
  var grid = $("libDetailGrid");
  var assets = state.currentGroupAssets || [];
  var groups = state.libraryGroups || [];
  if (!assets.length) {
    grid.innerHTML = '<div class="empty-panel">这个分组还没有图片，点右上角上传。</div>';
    return;
  }
  grid.innerHTML = assets.map(function (asset) {
    var groupOptions = groups.filter(function (g) { return g.id !== state.currentGroup.id; })
      .map(function (g) { return '<option value="' + esc(g.id) + '">' + esc(g.name) + "</option>"; }).join("");
    return '<div class="lib-detail-item">'
      + '<div class="lib-detail-img" data-media-preview="' + esc(asset.view_url) + '" data-media-title="' + esc(asset.file_name) + '">'
      + '<img data-media-src="' + esc(asset.view_url) + '" alt="' + esc(asset.file_name) + '" loading="lazy">'
      + "</div>"
      + '<div class="lib-detail-info">'
      + '<div class="lib-detail-name" title="' + esc(asset.file_name) + '">' + esc(asset.file_name) + "</div>"
      + '<div class="lib-detail-actions">'
      + '<button class="ghost-button small-button" data-media-preview="' + esc(asset.view_url) + '" data-media-title="' + esc(asset.file_name) + '">看大图</button>'
      + '<button class="ghost-button small-button danger-text" data-media-delete="' + esc(asset.id) + '">删除</button>'
      + "</div>"
      + '<div class="lib-detail-copy">'
      + '<select class="lib-copy-select" data-copy-asset="' + esc(asset.id) + '">'
      + '<option value="">复制到分组…</option>' + groupOptions
      + "</select>"
      + "</div>"
      + "</div></div>";
  }).join("");
  grid.querySelectorAll("img[data-media-src]").forEach(loadLibraryThumb);
  grid.querySelectorAll("[data-media-delete]").forEach(function (button) {
    button.addEventListener("click", function () { deleteLibraryAsset(button.dataset.mediaDelete); });
  });
  grid.querySelectorAll("[data-media-preview]").forEach(function (el) {
    el.addEventListener("click", function () { openMediaPreview(el.dataset.mediaPreview, el.dataset.mediaTitle); });
  });
  grid.querySelectorAll("[data-copy-asset]").forEach(function (sel) {
    sel.addEventListener("change", function () {
      if (!sel.value) return;
      copyAssetToGroup(sel.dataset.copyAsset, sel.value);
    });
  });
}

async function copyAssetToGroup(assetId, targetGroupId) {
  try {
    await api("POST", "/media-library/copy-asset", { asset_id: assetId, target_group_id: targetGroupId });
    showToast("已复制到目标分组");
  } catch (e) {
    showToast("复制失败：" + e.message, "error");
  }
}

async function toggleLibGroup(id, on) {
  await api("PUT", "/media-library", { id: id, is_active: on });
  showToast(on ? "这组图打开了" : "这组图关掉了");
  await loadLibrary();
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

function renderLibraryCard(group) {
  var samples = group.samples || [];
  var total = Number(group.asset_count || 0);
  var first = samples[0];
  var thumb = first
    ? '<div class="lib-row-thumb"><img data-media-src="' + esc(first.view_url) + '" alt="" loading="lazy"></div>'
    : '<div class="lib-row-thumb lib-row-thumb-empty">无图</div>';
  return '<div class="lib-row" data-lib-enter="' + esc(group.id) + '">'
    + thumb
    + '<div class="lib-row-main">'
    + '<div class="lib-row-title"><b>' + esc(group.name || "未命名分组") + '</b>'
    + '<span class="status-chip ' + (group.is_active ? "on" : "") + '">' + (group.is_active ? "使用中" : "已关闭") + "</span></div>"
    + '<div class="lib-row-desc">' + total + " 张图 · " + esc(keywordText(group.trigger_keywords)) + "</div>"
    + "</div>"
    + '<div class="lib-row-actions">'
    + '<button class="ghost-button small-button" data-lib-upload="' + esc(group.id) + '">上传</button>'
    + '<button class="ghost-button small-button" data-lib-edit="' + esc(group.id) + '">编辑</button>'
    + '<button class="ghost-button small-button" data-lib-toggle="' + esc(group.id) + '" data-lib-next="' + (group.is_active ? "0" : "1") + '">' + (group.is_active ? "停用" : "启用") + "</button>"
    + '<button class="primary-button small-button" data-lib-enter-btn="' + esc(group.id) + '">查看图片</button>'
    + "</div></div>";
}

async function loadLibraryThumb(image) {
  try {
    var blob = await apiBlob(image.dataset.mediaSrc);
    var objectUrl = URL.createObjectURL(blob);
    state.libraryObjectUrls.push(objectUrl);
    image.src = objectUrl;
  } catch (error) {
    image.replaceWith(Object.assign(document.createElement("span"), {
      className: "empty-cover",
      textContent: "图片读取失败",
    }));
  }
}

function openLibraryGroupModal(group) {
  state.editingLibraryGroupId = group?.id || "";
  $("libraryGroupModalTitle").textContent = group ? "编辑分组" : "新建分组";
  $("libGroupName").value = group?.name || "";
  $("libGroupKeywords").value = keywordText(group?.trigger_keywords).replace("还没有设置对方要说的词", "");
  $("libGroupPersona").value = group?.persona_id || "";
  $("libGroupPlatform").value = group?.platform || "";
  $("libraryGroupModal").hidden = false;
  window.setTimeout(function () { $("libGroupName").focus(); }, 0);
}

async function saveLibraryGroup() {
  var name = $("libGroupName").value.trim();
  if (!name) { showToast("先写分组名字", "error"); return; }
  $("saveLibGroupButton").disabled = true;
  try {
    await api("POST", "/media-library/groups", {
      id: state.editingLibraryGroupId || "",
      name: name,
      trigger_keywords: $("libGroupKeywords").value.trim(),
      persona_id: $("libGroupPersona").value,
      platform: $("libGroupPlatform").value,
    });
    $("libraryGroupModal").hidden = true;
    state.editingLibraryGroupId = "";
    showToast("分组已保存");
    await loadLibrary();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    $("saveLibGroupButton").disabled = false;
  }
}

function chooseLibraryImage(groupId) {
  state.uploadGroupId = groupId;
  var input = $("libraryUploadInput");
  input.value = "";
  input.click();
}

async function uploadLibraryImage(file) {
  if (!file || !state.uploadGroupId) return;
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
    showToast("只支持 JPG、PNG、WebP、GIF 图片", "error");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showToast("图片不能超过 8MB", "error");
    return;
  }
  try {
    var dataUrl = await new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("图片读取失败")); };
      reader.readAsDataURL(file);
    });
    await api("POST", "/media-library/upload", {
      group_id: state.uploadGroupId,
      file_name: file.name,
      content_type: file.type,
      data_base64: dataUrl,
    });
    showToast("图片已上传");
    await loadLibrary();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.uploadGroupId = "";
    $("libraryUploadInput").value = "";
  }
}

async function deleteLibraryAsset(assetId) {
  if (!assetId || !window.confirm("这张图要从图库里删掉吗？")) return;
  try {
    await api("DELETE", "/media-library/assets", { id: assetId });
    showToast("图片已删除");
    await loadLibrary();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function openMediaPreview(viewUrl, title) {
  if (state.previewObjectUrl) URL.revokeObjectURL(state.previewObjectUrl);
  state.previewObjectUrl = "";
  $("mediaPreviewTitle").textContent = title || "图片预览";
  $("mediaPreviewImage").removeAttribute("src");
  $("mediaPreviewModal").hidden = false;
  try {
    var blob = await apiBlob(viewUrl);
    state.previewObjectUrl = URL.createObjectURL(blob);
    $("mediaPreviewImage").src = state.previewObjectUrl;
  } catch (error) {
    showToast(error.message, "error");
    $("mediaPreviewModal").hidden = true;
  }
}

function closeMediaPreview() {
  if (state.previewObjectUrl) URL.revokeObjectURL(state.previewObjectUrl);
  state.previewObjectUrl = "";
  $("mediaPreviewImage").removeAttribute("src");
  $("mediaPreviewModal").hidden = true;
}

async function loadDrawers() {
  var sel = $("drawerPersona");
  if (sel && !sel.dataset.bound) {
    sel.dataset.bound = "1";
    sel.addEventListener("change", loadDrawers);
  }
  var pid = sel ? sel.value : "female_sutang";
  try {
    var data = await api("GET", "/agent-overview?persona_id=" + encodeURIComponent(pid));
    state.agentOverview = data;
    if ($("personaNameEditor")) $("personaNameEditor").value = data.persona?.name || "";
    if ($("personaPromptEditor")) $("personaPromptEditor").value = data.persona?.system_prompt || "";
    if ($("agentIdentitySummary")) $("agentIdentitySummary").innerHTML = renderAgentSummary(data.facts || {});
    renderSharedFacts(data.facts || {}, data.shared_version);
    renderPersonaPublication(data);
    if ($("agentConflicts")) $("agentConflicts").innerHTML = renderAgentConflicts(data.conflicts || []);
    if ($("agentPromptOrder")) {
      $("agentPromptOrder").innerHTML = (data.prompt_order || []).map(function (item, index) {
        return '<div class="prompt-order-row"><span>' + (index + 1) + "</span><b>" + esc(item) + "</b></div>";
      }).join("");
    }
    await loadProgramRules();
    await loadAgentRules();
    if ($("drawerCards")) $("drawerCards").innerHTML = renderDrawerList(data.cards || []);
    document.querySelectorAll("[data-drawer-toggle]").forEach(function (input) {
      input.addEventListener("change", function () {
        toggleDrawer(input.dataset.drawerToggle, input.checked);
      });
    });
    document.querySelectorAll("[data-drawer-save]").forEach(function (button) {
      button.addEventListener("click", function () { saveDrawer(button.dataset.drawerSave); });
    });
    document.querySelectorAll("[data-drawer-delete]").forEach(function (button) {
      button.addEventListener("click", function () { deleteDrawerCard(button.dataset.drawerDelete); });
    });
    var n = (data.cards || []).length;
    if ($("drawerCount")) $("drawerCount").textContent = n + " 个";
  } catch (e) {
    if ($("drawerCards")) $("drawerCards").innerHTML = '<div class="empty-panel">人设读取失败：' + esc(e.message) + "</div>";
  }
}

async function loadKnowledge() {
  var sel = $("knowledgePersona");
  if (sel && !sel.dataset.bound) {
    sel.dataset.bound = "1";
    sel.addEventListener("change", loadKnowledge);
  }
  var pid = sel ? sel.value : "female_sutang";
  var host = $("drawerCards");
  if (host) host.innerHTML = '<div class="empty-panel">正在读取知识库...</div>';
  try {
    var data = await api("GET", "/agent-overview?persona_id=" + encodeURIComponent(pid));
    state.agentOverview = data;
    renderKnowledgeCards(data.cards || []);
  } catch (error) {
    if (host) host.innerHTML = '<div class="empty-panel">知识库读取失败：' + esc(error.message) + "</div>";
  }
}

function renderKnowledgeCards(cards) {
  var host = $("drawerCards");
  if (host) host.innerHTML = renderDrawerList(cards);
  bindDrawerCardActions();
  if ($("drawerCount")) $("drawerCount").textContent = (cards || []).length + " 张知识卡";
}

function bindDrawerCardActions() {
  document.querySelectorAll("[data-drawer-toggle]").forEach(function (input) {
    input.onchange = function () { toggleDrawer(input.dataset.drawerToggle, input.checked); };
  });
  document.querySelectorAll("[data-drawer-save]").forEach(function (button) {
    button.onclick = function () { saveDrawer(button.dataset.drawerSave); };
  });
  document.querySelectorAll("[data-drawer-delete]").forEach(function (button) {
    button.onclick = function () { deleteDrawerCard(button.dataset.drawerDelete); };
  });
}

function setSharedFactValue(id, value) {
  var input = $(id);
  if (!input) return;
  input.value = value === null || value === undefined ? "" : String(value);
}

function sharedContactLabel() {
  return ($("drawerPersona") && $("drawerPersona").value) === "female_sutang" ? "豆瓣号" : "QQ号";
}

function renderSharedFacts(facts, version) {
  setSharedFactValue("sharedFactsAgeMode", facts.age_mode || "fixed_age");
  setSharedFactValue("sharedFactsFixedAge", facts.fixed_age ?? "");
  setSharedFactValue("sharedFactsBirthYear", facts.birth_year ?? "");
  setSharedFactValue("sharedFactsMarital", facts.marital_status || "single");
  setSharedFactValue("sharedFactsHasChildren", facts.has_children ? "true" : "false");
  setSharedFactValue("sharedFactsChildrenAge", facts.children_age ?? "");
  setSharedFactValue("sharedFactsQq", facts.contact_qq || "");
  if ($("sharedFactsContactLabel")) $("sharedFactsContactLabel").textContent = sharedContactLabel();
  setSharedFactValue("sharedFactsHometown", facts.hometown || "");
  setSharedFactValue("sharedFactsCurrentCity", facts.current_city || "");
  setSharedFactValue("sharedFactsCurrentDistrict", facts.current_district || "");
  setSharedFactValue("sharedFactsCommonArea", facts.common_area || "");
  setSharedFactValue("sharedFactsWorkCity", facts.work_city || "");
  setSharedFactValue("sharedFactsWorkDistrict", facts.work_district || "");
  setSharedFactValue("sharedFactsLocationPrecision", facts.location_precision || "district");
  setSharedFactValue("sharedFactsProactiveLocation", facts.proactive_location_allowed ? "true" : "false");
  if ($("sharedPersonaVersion")) $("sharedPersonaVersion").textContent = "第 " + Number(version || 1) + " 版";
}

function renderPersonaPublication(data) {
  var published = data.published_snapshot || null;
  if (!$("personaPublishStatus")) return;
  if (!published) {
    $("personaPublishStatus").textContent = "当前内容立即生效";
    return;
  }
  $("personaPublishStatus").textContent = "当前内容立即生效；历史版本仅用于回看";
}

function sharedFactsPayload() {
  var ageMode = $("sharedFactsAgeMode").value === "birth_year" ? "birth_year" : "fixed_age";
  return {
    persona_id: ($("drawerPersona") && $("drawerPersona").value) || "female_sutang",
    expected_version: Number(state.agentOverview?.shared_version || 0),
    age_mode: ageMode,
    fixed_age: ageMode === "fixed_age" ? $("sharedFactsFixedAge").value.trim() : "",
    birth_year: ageMode === "birth_year" ? $("sharedFactsBirthYear").value.trim() : "",
    marital_status: $("sharedFactsMarital").value,
    has_children: $("sharedFactsHasChildren").value === "true",
    children_age: $("sharedFactsHasChildren").value === "true" ? $("sharedFactsChildrenAge").value.trim() : "",
    contact_qq: $("sharedFactsQq").value.trim(),
    hometown: $("sharedFactsHometown").value.trim(),
    current_city: $("sharedFactsCurrentCity").value.trim(),
    current_district: $("sharedFactsCurrentDistrict").value.trim(),
    common_area: $("sharedFactsCommonArea").value.trim(),
    work_city: $("sharedFactsWorkCity").value.trim(),
    work_district: $("sharedFactsWorkDistrict").value.trim(),
    location_precision: $("sharedFactsLocationPrecision").value,
    proactive_location_allowed: $("sharedFactsProactiveLocation").value === "true",
  };
}

async function handleAgentVersionConflict(error) {
  if (!(error?.status === 409 && error?.data?.code === "persona_version_conflict")) return false;
  showToast(error.message || "这套共享人设已经被其他设备改过，请刷新", "error");
  await loadDrawers();
  return true;
}

async function saveSharedFacts() {
  var payload = sharedFactsPayload();
  if (!payload.expected_version) {
    showToast("人设版本还没读到，请刷新页面", "error");
    return;
  }
  $("saveSharedFactsButton").disabled = true;
  $("sharedFactsStatus").textContent = "正在保存共享资料...";
  try {
    var data = await api("PUT", "/persona-facts", payload);
    state.agentOverview.shared_version = data.shared_version;
    $("sharedFactsStatus").textContent = "✓ 已保存，所有设备下一条聊天立即使用";
    showToast("共享人物资料已保存");
    await loadDrawers();
  } catch (error) {
    if (!(await handleAgentVersionConflict(error))) {
      $("sharedFactsStatus").textContent = "✗ 保存失败：" + error.message;
      showToast(error.message, "error");
    }
  } finally {
    $("saveSharedFactsButton").disabled = false;
  }
}

async function runPersonaAudit() {
  var button = $("runPersonaAuditButton");
  if (!button) return;
  button.disabled = true;
  $("personaAuditResult").innerHTML = '<div class="flag-none">正在检查 4 套人设...</div>';
  try {
    var data = await api("GET", "/persona-audit");
    var rows = (data.personas || []).map(function (persona) {
      var items = persona.issues || [];
      return '<div class="conflict-item ' + (items.length ? "warn" : "ok") + '">'
        + '<b>' + esc(persona.name || persona.persona_id) + (items.length ? "：有提醒，请人工确认" : "：通过") + '</b>'
        + (items.length
          ? items.map(function (issue) {
              return '<p>' + esc(issue.source || "检查") + "：" + esc(issue.detail || "") + "</p>";
            }).join("")
          : "<p>正文、资料和卡片没有串到其他人设。</p>")
        + "</div>";
    }).join("");
    $("personaAuditResult").innerHTML = (data.ok
      ? '<div class="isolated-ok">✓ 4 套人设全部通过</div>'
      : '<div class="isolated-warn">共 ' + Number(data.warning_count || 0) + " 条提醒，不会阻止保存，请你自己看上下文确认</div>")
      + rows;
    showToast(data.ok ? "4 套人设隔离检查通过" : "有疑似串词，请人工确认", data.ok ? "success" : "warning");
  } catch (error) {
    $("personaAuditResult").innerHTML = '<div class="empty-panel">检查失败：' + esc(error.message) + "</div>";
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
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

function ensurePlainLanguageRulePanel() {
  var card = $("ruleRulesCard");
  if (!card) return;
  if (!$("ruleTypeGuide")) {
    var overview = $("rulePanelOverview");
    var summaryGrid = overview ? overview.querySelector(".rule-summary-grid") : null;
    if (overview) {
      var guide = document.createElement("div");
      guide.id = "ruleTypeGuide";
      guide.className = "rule-help-strip";
      guide.style.marginTop = "12px";
      guide.innerHTML = '<div class="rule-help-item" style="border-left:4px solid #35b86b"><b>绿色：可直接改文字</b><span>你写什么，下一条聊天就按新文字给大模型。</span></div>'
        + '<div class="rule-help-item" style="border-left:4px solid #4f7cff"><b>蓝色：文字和系统一起管</b><span>文字、范围、排序、开关会生效；原来的硬动作继续由系统执行。</span></div>'
        + '<div class="rule-help-item" style="border-left:4px solid #f59e0b"><b>橙色：系统硬动作</b><span>例如已婚不回、不给联系方式。请用“大白话添加系统动作”，先看翻译再确认。</span></div>';
      if (summaryGrid) summaryGrid.insertAdjacentElement("afterend", guide);
      else overview.prepend(guide);
    }
  }
  if ($("plainLanguageRulePanel")) return;
  var title = card.querySelector(".section-title");
  if (title && title.querySelector("span")) {
    title.querySelector("span").textContent = "绿色可直接改文字；蓝色会改文字并保留系统硬动作；橙色是系统动作，用大白话确认后再执行。";
  }
  var panel = document.createElement("div");
  panel.id = "plainLanguageRulePanel";
  panel.className = "program-rule-block";
  panel.style.margin = "0 0 14px";
  panel.innerHTML = '<div class="program-rule-title"><div>'
    + "<b>用大白话添加系统动作</b>"
    + "<span>你只写一句中文。系统先翻译成明确动作给你看，你确认后才保存。</span>"
    + '</div></div>'
    + '<textarea id="plainLanguageRuleInput" class="program-rule-voice-instruction" placeholder="例如：已婚的人不要回，只对苏棠生效"></textarea>'
    + '<div class="toolbar" style="margin-top:8px"><button class="primary-button small-button" id="translatePlainRuleButton">翻译给我看</button></div>'
    + '<div id="plainLanguageRuleResult" class="program-rule-test-result"></div>';
  if (title) title.insertAdjacentElement("afterend", panel);
  else card.insertBefore(panel, card.firstChild);
  $("translatePlainRuleButton").addEventListener("click", translatePlainLanguageRule);
}

function renderPlainLanguageRuleTranslation() {
  var host = $("plainLanguageRuleResult");
  if (!host) return;
  var result = state.plainRuleTranslation;
  if (!result) {
    host.innerHTML = "";
    return;
  }
  var actionButton = "";
  if (result.mode === "existing_rule") {
    actionButton = '<button class="primary-button small-button" data-apply-plain="existing">确认应用这条系统动作</button>';
  } else if (result.mode === "prompt_rule") {
    actionButton = '<button class="ghost-button small-button" data-apply-plain="prompt">保存成说话规则</button>';
  }
  host.innerHTML = '<div class="program-rule-test-item"><b>' + esc(result.title || "我理解成") + "</b>"
    + "<p>" + esc(result.preview || "") + "</p>"
    + (result.note ? "<small>" + esc(result.note) + "</small>" : "")
    + (actionButton ? '<div class="toolbar" style="margin-top:8px">' + actionButton + "</div>" : "")
    + "</div>";
  host.querySelectorAll("[data-apply-plain]").forEach(function (button) {
    button.addEventListener("click", function () {
      applyPlainLanguageRule(button.dataset.applyPlain);
    });
  });
}

async function translatePlainLanguageRule() {
  var input = $("plainLanguageRuleInput");
  var text = input ? input.value.trim() : "";
  if (!text) {
    showToast("先写一句你想要的规则", "error");
    return;
  }
  $("translatePlainRuleButton").disabled = true;
  $("plainLanguageRuleResult").innerHTML = '<div class="flag-none">正在翻译...</div>';
  try {
    var data = await api("POST", "/agent-rules/translate", { text: text });
    state.plainRuleText = text;
    state.plainRuleTranslation = data.translation || null;
    renderPlainLanguageRuleTranslation();
  } catch (error) {
    $("plainLanguageRuleResult").innerHTML = '<div class="flag-none">翻译失败：' + esc(error.message) + "</div>";
  } finally {
    $("translatePlainRuleButton").disabled = false;
  }
}

async function applyPlainLanguageRule(mode) {
  var result = state.plainRuleTranslation;
  if (!result) return;
  try {
    if (mode === "existing") {
      await api("PUT", "/agent-rules", { id: result.rule_id, ...(result.patch || {}) });
      showToast("系统动作已更新，下一条聊天生效");
    } else if (mode === "prompt" && result.prompt_rule) {
      await api("POST", "/agent-rules", result.prompt_rule);
      showToast("说话规则已保存，下一条聊天生效");
    }
    state.plainRuleTranslation = null;
    state.plainRuleText = "";
    if ($("plainLanguageRuleInput")) $("plainLanguageRuleInput").value = "";
    renderPlainLanguageRuleTranslation();
    await loadAgentRules();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderStickerMeaningRows(meanings) {
  var host = $("stickerMeaningRows");
  if (!host) return;
  host.innerHTML = "";
  var entries = Object.entries(meanings || {});
  entries.forEach(function (entry) {
    addStickerMeaningRow(entry[0], entry[1]);
  });
  if (!entries.length) addStickerMeaningRow("", "");
}

function addStickerMeaningRow(name, meaning) {
  var host = $("stickerMeaningRows");
  if (!host) return;
  var row = document.createElement("div");
  row.className = "sticker-meaning-row";
  row.innerHTML = '<input class="sticker-meaning-name" placeholder="表情名字">'
    + '<input class="sticker-meaning-value" placeholder="它代表的意思">'
    + '<button class="icon-button danger-button" type="button" title="删除这一行">×</button>';
  row.querySelector(".sticker-meaning-name").value = name || "";
  row.querySelector(".sticker-meaning-value").value = meaning || "";
  row.querySelector("button").addEventListener("click", function () {
    row.remove();
    if (!$("stickerMeaningRows").children.length) addStickerMeaningRow("", "");
  });
  host.appendChild(row);
}

function updateProgramVoiceFields() {
  var mode = $("programVoiceMode") ? $("programVoiceMode").value : "redirect";
  var fixed = $("programVoiceFixedReply");
  if (fixed) {
    fixed.disabled = mode !== "fixed_reply";
    fixed.placeholder = mode === "fixed_reply"
      ? "例如：在呢 你打字跟我说嘛"
      : "只有选择“固定回一句”时才使用";
  }
}

function renderProgramRules() {
  var rules = state.programRules || {};
  if ($("programSafetyBoundaryEnabled")) {
    $("programSafetyBoundaryEnabled").checked = rules.safetyBoundary?.enabled !== false;
  }
  if ($("programSafetyBoundary")) {
    $("programSafetyBoundary").value = rules.safetyBoundary?.text || "";
  }
  if ($("programPlatformNoticeEnabled")) {
    $("programPlatformNoticeEnabled").checked = rules.platformNotice?.enabled !== false;
  }
  if ($("programPlatformNoticeMarkers")) {
    $("programPlatformNoticeMarkers").value = (rules.platformNotice?.markers || []).join("\n");
  }
  if ($("programVoiceEnabled")) $("programVoiceEnabled").checked = rules.untranscribedVoice?.enabled !== false;
  if ($("programVoiceMode")) $("programVoiceMode").value = rules.untranscribedVoice?.mode || "redirect";
  if ($("programVoiceFixedReply")) $("programVoiceFixedReply").value = rules.untranscribedVoice?.fixedReply || "";
  if ($("programVoiceInstruction")) $("programVoiceInstruction").value = rules.untranscribedVoice?.redirectInstruction || "";
  if ($("programStickerEnabled")) $("programStickerEnabled").checked = rules.sticker?.enabled !== false;
  if ($("programStickerInstruction")) $("programStickerInstruction").value = rules.sticker?.instruction || "";
  renderStickerMeaningRows(rules.sticker?.meanings || {});
  updateProgramVoiceFields();
}

async function loadProgramRules() {
  try {
    var data = await api("GET", "/program-rules");
    state.programRules = data.rules || {};
    renderProgramRules();
    if ($("programRulesStatus")) {
      $("programRulesStatus").textContent = data.customized ? "已保存，会生效" : "默认内容，会生效";
    }
    renderRuleCenterSummary();
  } catch (error) {
    if ($("programRulesStatus")) $("programRulesStatus").textContent = "读取失败";
    showToast("程序规则读取失败：" + error.message, "error");
  }
}

function collectProgramRules() {
  var meanings = {};
  document.querySelectorAll("#stickerMeaningRows .sticker-meaning-row").forEach(function (row) {
    var name = row.querySelector(".sticker-meaning-name").value.trim();
    var meaning = row.querySelector(".sticker-meaning-value").value.trim();
    if (name && meaning && !Object.prototype.hasOwnProperty.call(meanings, name)) {
      meanings[name] = meaning;
    }
  });
  return {
    safetyBoundary: {
      enabled: $("programSafetyBoundaryEnabled").checked,
      text: $("programSafetyBoundary").value.trim(),
    },
    platformNotice: {
      enabled: $("programPlatformNoticeEnabled").checked,
      markers: $("programPlatformNoticeMarkers").value
        .split(/\r?\n/u)
        .map(function (item) { return item.trim(); })
        .filter(Boolean),
    },
    untranscribedVoice: {
      enabled: $("programVoiceEnabled").checked,
      mode: $("programVoiceMode").value,
      fixedReply: $("programVoiceFixedReply").value.trim(),
      redirectInstruction: $("programVoiceInstruction").value.trim(),
    },
    sticker: {
      enabled: $("programStickerEnabled").checked,
      instruction: $("programStickerInstruction").value.trim(),
      meanings: meanings,
    },
  };
}

async function saveProgramRuleSettings() {
  var rules = collectProgramRules();
  if (rules.untranscribedVoice.mode === "fixed_reply" && !rules.untranscribedVoice.fixedReply) {
    showToast("选了固定回一句，就要先写回复内容", "error");
    return;
  }
  $("saveProgramRulesButton").disabled = true;
  if ($("programRulesStatus")) $("programRulesStatus").textContent = "正在保存...";
  try {
    var data = await api("PUT", "/program-rules", { rules: rules });
    state.programRules = data.rules || rules;
    renderProgramRules();
    renderRuleCenterSummary();
    if ($("programRulesStatus")) $("programRulesStatus").textContent = "已保存，下一条聊天生效";
    showToast("程序规则已保存");
  } catch (error) {
    if ($("programRulesStatus")) $("programRulesStatus").textContent = "保存失败";
    showToast(error.message, "error");
  } finally {
    $("saveProgramRulesButton").disabled = false;
  }
}

async function runProgramRuleTest() {
  var content = $("programRuleTestInput").value.trim();
  if (!content) {
    showToast("先输入一条测试内容", "error");
    return;
  }
  $("runProgramRuleTestButton").disabled = true;
  $("programRuleTestResult").innerHTML = '<div class="flag-none">正在检查...</div>';
  try {
    var data = await api("POST", "/program-rules/test", {
      content: content,
      rules: collectProgramRules(),
    });
    var voiceAction = ({
      ignore: "直接跳过，不回",
      redirect: "照常聊别的，不提听不清",
      fixed_reply: "固定回一句",
      disabled: "程序规则已关闭",
    })[data.untranscribed_voice_action] || "不适用";
    $("programRuleTestResult").innerHTML = [
      '<div class="program-rule-test-item"><b>平台提示和系统通知</b><p>'
        + (data.platform_notice ? "会被程序先丢掉，不会送给模型。" : "不是平台提示，会按客户内容处理。")
        + "</p></div>",
      '<div class="program-rule-test-item"><b>没有转出文字的语音</b><p>'
        + (data.untranscribed_voice ? "识别为无转写语音。处理方式：" + esc(voiceAction) : "不适用。")
        + "</p></div>",
      '<div class="program-rule-test-item"><b>交给模型前的内容</b><p>'
        + esc(data.transformed_content || "") + "</p></div>",
    ].join("");
  } catch (error) {
    $("programRuleTestResult").innerHTML = '<div class="flag-none">检查失败：' + esc(error.message) + "</div>";
  } finally {
    $("runProgramRuleTestButton").disabled = false;
  }
}

async function loadAgentRules() {
  var data = await api("GET", "/agent-rules");
  state.agentRules = data.rules || [];
  state.agentRuleConflicts = data.conflicts || [];
  state.agentRuleSummary = data.summary || {
    total: state.agentRuleConflicts.length,
    errors: 0,
    warnings: 0,
    info: 0,
    muted: 0,
  };
  renderRuleCenterSummary();
  renderAgentRuleConflicts();
  ensurePlainLanguageRulePanel();
  renderAgentRules();
  renderPlainLanguageRuleTranslation();
  showRuleTab(state.ruleCenterTab || "overview");
}

function filteredAgentRules() {
  var query = $("legacyRuleSearch") ? $("legacyRuleSearch").value.trim().toLowerCase() : "";
  var gate = $("agentRuleGateFilter") ? $("agentRuleGateFilter").value : "";
  var status = $("agentRuleStatusFilter") ? $("agentRuleStatusFilter").value : "";
  var conflictFilter = $("agentRuleConflictFilter") ? $("agentRuleConflictFilter").value : "";
  return state.agentRules.filter(function (item) {
    if (gate && item.gate !== gate) return false;
    if (status === "enabled" && item.enabled === false) return false;
    if (status === "disabled" && item.enabled !== false) return false;
    if (conflictFilter && conflictWorstLevel(item) !== conflictFilter) return false;
    if (!query) return true;
    return [
      item.title,
      item.detail,
      item.gate,
      item.persona_id,
      item.source,
      ruleTopicLabel(item),
    ].join(" ").toLowerCase().includes(query);
  });
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

function conflictsForRule(item) {
  var key = ruleKey(item);
  return state.agentRuleConflicts.filter(function (conflict) {
    return (conflict.rule_ids || []).includes(key);
  });
}

function conflictWorstLevel(item) {
  var rank = { error: 4, warn: 3, info: 2, muted: 1 };
  return conflictsForRule(item).reduce(function (worst, conflict) {
    return rank[conflict.level] > rank[worst] ? conflict.level : worst;
  }, "");
}

function conflictLevelLabel(level) {
  return ({ error: "会打架", warn: "范围重叠", info: "重复或相近", muted: "已停用提醒" })[level] || "提醒";
}

function renderRuleCenterSummary() {
  var enabled = state.agentRules.filter(function (item) { return item.enabled !== false; }).length;
  var disabled = state.agentRules.length - enabled;
  var summary = state.agentRuleSummary || {};
  if ($("ruleSummaryActive")) $("ruleSummaryActive").textContent = enabled;
  if ($("ruleSummaryDisabled")) $("ruleSummaryDisabled").textContent = disabled;
  if ($("ruleSummaryErrors")) $("ruleSummaryErrors").textContent = Number(summary.errors || 0);
  if ($("ruleSummaryWarnings")) $("ruleSummaryWarnings").textContent = Number(summary.warnings || 0);
  if ($("ruleNavOverviewCount")) $("ruleNavOverviewCount").textContent = enabled + " 条";
  if ($("ruleNavRulesCount")) $("ruleNavRulesCount").textContent = state.agentRules.length + " 条";
  if ($("ruleNavConflictCount")) {
    $("ruleNavConflictCount").textContent = Number(summary.errors || 0) + Number(summary.warnings || 0) + " 个";
  }
  if ($("ruleNavPersonaCount")) {
    $("ruleNavPersonaCount").textContent = Number(state.agentOverview?.cards?.length || 0) + " 张";
  }
  if ($("ruleNavExecutionCount")) {
    $("ruleNavExecutionCount").textContent = state.programRules?.customized ? "已设置" : "默认";
  }
}

function renderAgentRuleConflicts() {
  var host = $("agentRuleConflictList");
  if (!host) return;
  var level = $("ruleConflictLevelFilter") ? $("ruleConflictLevelFilter").value : "";
  var list = state.agentRuleConflicts.filter(function (item) {
    return !level || item.level === level;
  });
  if ($("ruleConflictCount")) $("ruleConflictCount").textContent = state.agentRuleConflicts.length + " 个提醒";
  host.innerHTML = list.length ? list.map(function (conflict) {
    var titles = (conflict.rule_titles || []).map(function (title) {
      return '<span class="rule-badge">' + esc(title) + "</span>";
    }).join("");
    return '<article class="rule-conflict ' + esc(conflict.level || "info") + '">'
      + "<div>"
      + '<div class="rule-badge-row"><span class="rule-badge ' + esc(conflict.level || "info") + '">' + esc(conflictLevelLabel(conflict.level)) + "</span>"
      + '<span class="rule-badge">' + esc(conflict.topic || "同一个话题") + "</span></div>"
      + "<h4>" + esc(conflict.title) + "</h4>"
      + "<p>" + esc(conflict.detail) + "</p>"
      + '<div class="rule-badge-row" style="margin-top:8px">' + titles + "</div>"
      + "<small>建议：" + esc(conflict.suggestion || "检查后保留你要的结果。") + "</small>"
      + '<div class="rule-conflict-actions">'
      + (conflict.rule_ids || []).map(function (id) {
          return '<button class="ghost-button small-button" data-conflict-edit="' + esc(id) + '">查看并修改</button>';
        }).join("")
      + "</div></div></article>";
  }).join("") : '<div class="rule-empty">没有符合当前筛选的冲突。</div>';
  host.querySelectorAll("[data-conflict-edit]").forEach(function (button) {
    button.addEventListener("click", function () {
      var rule = state.agentRules.find(function (item) { return ruleKey(item) === button.dataset.conflictEdit; });
      if (rule) openAgentRuleModal(rule.id);
    });
  });
}

function renderAgentRules() {
  var host = $("legacyAgentRules");
  if (!host) return;
  var list = filteredAgentRules();
  if ($("legacyRuleCount")) $("legacyRuleCount").textContent = state.agentRules.length + " 条";
  if (!list.length) {
    host.innerHTML = '<div class="rule-empty">没有匹配的规则。换个筛选条件，或者新增一条规则。</div>';
    return;
  }
  var groups = new Map();
  list.forEach(function (item) {
    var topic = ruleTopicLabel(item);
    if (!groups.has(topic)) groups.set(topic, []);
    groups.get(topic).push(item);
  });
  host.innerHTML = [...groups.entries()].map(function (entry) {
    var topic = entry[0];
    var items = entry[1];
    return '<div class="rule-topic-group"><div class="rule-topic-title"><span>' + esc(topic) + "</span></div>"
      + '<div class="rule-list-grid">' + items.map(function (item) {
        var level = conflictWorstLevel(item);
        var conflicts = conflictsForRule(item);
        var summary = String(item.detail || "").split(/[。！？!?]/u)[0].trim().slice(0, 48);
        return '<article class="rule-card ' + (item.enabled ? "" : "off") + (level ? " conflict-" + level : "") + '">'
          + '<div class="rule-card-head"><div><h4>' + esc(item.title) + '</h4><p>' + esc(summary || item.detail) + "</p>"
          + '<details class="rule-details"><summary>展开规则全文</summary><p>' + esc(item.detail) + "</p></details></div>"
          + '<span class="rule-badge ' + (item.enabled ? "on" : "off") + '">' + (item.enabled ? "正在生效" : "已停用") + "</span></div>"
          + '<div class="rule-badge-row">'
          + '<span class="rule-badge">' + esc(rulePersonaLabel(item.persona_id)) + "</span>"
          + '<span class="rule-badge">' + esc(ruleGateLabel(item.gate)) + "</span>"
          + '<span class="rule-badge ' + (item.edit_mode === "text" ? "on" : item.edit_mode === "system_action" ? "warn" : "info") + '">' + esc(item.edit_mode_label || "规则") + "</span>"
          + '<span class="rule-badge">优先级 ' + Number(item.priority || 50) + "</span>"
          + (conflicts.length ? '<span class="rule-badge ' + esc(level) + '">' + conflicts.length + " 个冲突提醒</span>" : "")
          + "</div>"
          + (item.edit_mode_help ? '<small class="small-muted">' + esc(item.edit_mode_help) + "</small>" : "")
          + '<div class="rule-card-actions">'
          + '<button class="ghost-button small-button" data-rule-edit="' + esc(item.id) + '">编辑</button>'
          + '<button class="ghost-button small-button" data-rule-toggle="' + esc(item.id) + '" data-rule-enabled="' + (item.enabled ? "1" : "0") + '">' + (item.enabled ? "停用" : "启用") + "</button>"
          + '<button class="ghost-button small-button danger-text" data-rule-delete="' + esc(item.id) + '">删除</button>'
          + (conflicts.length
            ? '<button class="primary-button small-button" data-rule-impact="' + esc(item.id) + '">看冲突</button>'
            : '<span class="rule-badge">无冲突</span>')
          + "</div></article>";
      }).join("") + "</div></div>";
  }).join("");
  host.querySelectorAll("[data-rule-edit]").forEach(function (button) {
    button.addEventListener("click", function () { openAgentRuleModal(button.dataset.ruleEdit); });
  });
  host.querySelectorAll("[data-rule-toggle]").forEach(function (button) {
    button.addEventListener("click", function () {
      updateAgentRule(button.dataset.ruleToggle, { enabled: button.dataset.ruleEnabled !== "1" });
    });
  });
  host.querySelectorAll("[data-rule-delete]").forEach(function (button) {
    button.addEventListener("click", function () { deleteAgentRule(button.dataset.ruleDelete); });
  });
  host.querySelectorAll("[data-rule-impact]").forEach(function (button) {
    button.addEventListener("click", function () {
      var rule = state.agentRules.find(function (item) { return item.id === button.dataset.ruleImpact; });
      if (!rule) return;
      state.ruleCenterTab = "conflicts";
      var level = conflictWorstLevel(rule);
      if ($("ruleConflictLevelFilter")) $("ruleConflictLevelFilter").value = level || "";
      renderAgentRuleConflicts();
      showRuleTab("conflicts");
      showToast(conflictsForRule(rule).length ? "已定位到相关冲突" : "这条规则暂时没有冲突");
    });
  });
}

function showRuleTab(tab) {
  state.ruleCenterTab = tab || "overview";
  document.querySelectorAll("[data-rule-tab]").forEach(function (button) {
    button.classList.toggle("on", button.dataset.ruleTab === state.ruleCenterTab);
  });
  var panels = {
    overview: ["rulePanelOverview", "ruleOverviewGrid", "rulePromptOrderCard", "ruleAgentTestCard"],
    rules: ["ruleRulesCard"],
    conflicts: ["ruleConflictCard"],
    persona: ["ruleSharedFactsCard", "rulePersonaEditorCard", "personaAuditCard"],
    execution: ["ruleExecutionCard"],
  };
  var visible = new Set(panels[state.ruleCenterTab] || panels.overview);
  [
    "rulePanelOverview", "ruleOverviewGrid", "rulePromptOrderCard", "ruleAgentTestCard",
    "ruleRulesCard", "ruleConflictCard", "ruleSharedFactsCard", "rulePersonaEditorCard",
    "personaAuditCard", "ruleExecutionCard",
  ].forEach(function (id) {
    var element = $(id);
    if (!element) return;
    element.hidden = !visible.has(id);
    element.classList.toggle("on", visible.has(id));
  });
  var page = $("page-drawers");
  if (page) page.scrollTop = 0;
}

function ensureAgentRuleEditHelp(rule) {
  var modal = $("agentRuleModal");
  if (!modal) return;
  var help = $("agentRuleEditHelp");
  if (!help) {
    help = document.createElement("div");
    help.id = "agentRuleEditHelp";
    help.className = "small-muted";
    help.style.padding = "10px 14px 0";
    var head = modal.querySelector(".modal-head");
    if (head) head.insertAdjacentElement("afterend", help);
    else modal.querySelector(".modal")?.prepend(help);
  }
  if (!rule) {
    help.innerHTML = "<b>新增规则：</b>如果你要的是“已婚不回、不给联系方式、不主动发照片”这类系统动作，请先用上一页的大白话翻译入口，确认后再保存。";
    return;
  }
  help.innerHTML = "<b>" + esc(rule.edit_mode_label || "规则") + "：</b>" + esc(rule.edit_mode_help || "")
    + " 保存后下一条聊天立即生效。";
}

function openAgentRuleModal(id) {
  var rule = state.agentRules.find(function (item) { return item.id === id; }) || null;
  state.editingAgentRuleId = rule ? rule.id : "";
  $("agentRuleModalTitle").textContent = rule ? "编辑规则" : "新增规则";
  $("agentRuleName").value = rule ? rule.title : "";
  $("agentRuleGate").value = rule ? rule.gate : "prompt";
  $("agentRulePriority").value = rule ? rule.priority : 50;
  $("agentRulePersona").value = rule ? (rule.persona_id || "") : "";
  $("agentRuleEnabled").value = rule && !rule.enabled ? "false" : "true";
  $("agentRuleDetail").value = rule ? rule.detail : "";
  ensureAgentRuleEditHelp(rule);
  $("agentRuleModal").hidden = false;
  window.setTimeout(function () { $("agentRuleName").focus(); }, 0);
}

async function saveAgentRule() {
  var id = state.editingAgentRuleId;
  var payload = {
    title: $("agentRuleName").value.trim(),
    gate: $("agentRuleGate").value,
    priority: Number($("agentRulePriority").value) || 50,
    persona_id: $("agentRulePersona").value,
    enabled: $("agentRuleEnabled").value === "true",
    detail: $("agentRuleDetail").value.trim(),
  };
  if (!payload.title || !payload.detail) {
    showToast("先写规则名字和内容", "error");
    return;
  }
  $("saveAgentRuleButton").disabled = true;
  try {
    if (id) await api("PUT", "/agent-rules", { id: id, ...payload });
    else await api("POST", "/agent-rules", payload);
    $("agentRuleModal").hidden = true;
    showToast(id ? "规则已更新" : "规则已新增");
    await loadAgentRules();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    $("saveAgentRuleButton").disabled = false;
  }
}

async function updateAgentRule(id, patch) {
  try {
    await api("PUT", "/agent-rules", { id: id, ...patch });
    await loadAgentRules();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteAgentRule(id) {
  if (!id || !window.confirm("确定停用或删除这条规则吗？")) return;
  try {
    await api("DELETE", "/agent-rules", { id: id });
    showToast("规则已处理");
    await loadAgentRules();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function factText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("、") || "未设置";
  var text = String(value ?? "").trim();
  return text || "未设置";
}

function renderAgentSummary(facts) {
  var rows = [
    ["年龄", facts.fixed_age ? facts.fixed_age + " 岁" : (facts.birth_year ? facts.birth_year + " 年出生" : "未设置")],
    ["婚姻", ({ single: "未婚", married: "已婚", divorced: "离异" })[facts.marital_status] || "未设置"],
    ["孩子", facts.has_children ? ((facts.children_age ?? "") + " 岁") : "没有孩子"],
    ["老家", factText(facts.hometown)],
    ["现居", factText([facts.current_city, facts.current_district].filter(Boolean))],
    ["工作", factText([facts.work_city, facts.work_district].filter(Boolean))],
    [sharedContactLabel(), factText(facts.contact_qq)],
    ["位置主动提", facts.proactive_location_allowed ? "允许" : "不允许"],
  ];
  return rows.map(function (row) {
    return '<div class="agent-summary-row"><span>' + esc(row[0]) + "</span><b>" + esc(row[1]) + "</b></div>";
  }).join("");
}

function renderAgentConflicts(list) {
  if (!list.length) return '<div class="flag-none">没有发现明显冲突</div>';
  return list.map(function (item) {
    return '<div class="conflict-item ' + esc(item.level || "") + '"><b>' + esc(item.title) + "</b><p>" + esc(item.detail) + "</p></div>";
  }).join("");
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

function renderDrawerList(list) {
  if (!list || !list.length) return '<div class="empty-panel">还没有卡片</div>';
  return list.map(function (drawer) {
    var activation = drawer.activation === "always" ? "always" : "keyword";
    var replyMode = drawer.replyMode === "exact" ? "exact" : "guide";
    return '<article class="drawer-card ' + (drawer.enabled ? "" : "off") + '" data-drawer-card="' + esc(drawer.id) + '">'
      + '<div class="drawer-card-head">'
      + '<input data-drawer-name="' + esc(drawer.id) + '" value="' + esc(drawer.name || "") + '" aria-label="抽屉名字">'
      + '<label class="switch"><input type="checkbox" data-drawer-toggle="' + esc(drawer.id) + '" ' + (drawer.enabled ? "checked" : "") + '>开着</label>'
      + "</div>"
      + '<div class="drawer-meta-grid">'
      + '<label class="drawer-field">类型<select data-drawer-kind="' + esc(drawer.id) + '">' + drawerKindOptions(drawer.kind) + "</select></label>"
      + '<label class="drawer-field">生效<select data-drawer-activation="' + esc(drawer.id) + '">'
      + '<option value="keyword" ' + (activation === "keyword" ? "selected" : "") + '>命中才用</option>'
      + '<option value="always" ' + (activation === "always" ? "selected" : "") + '>一直生效</option>'
      + "</select></label>"
      + '<label class="drawer-field">优先级<input data-drawer-priority="' + esc(drawer.id) + '" type="number" min="-100" max="100" value="' + Number(drawer.priority || 0) + '"></label>'
      + "</div>"
      + '<label class="drawer-field">触发词（命中才用时填写，用逗号分隔）'
      + '<input data-drawer-keywords="' + esc(drawer.id) + '" value="' + esc((drawer.keywords || []).join(", ")) + '">'
      + "</label>"
      + '<label class="drawer-field">说话方式'
      + '<select data-drawer-reply-mode="' + esc(drawer.id) + '">'
      + '<option value="guide" ' + (replyMode === "guide" ? "selected" : "") + '>参考表达，允许自然改写</option>'
      + '<option value="exact" ' + (replyMode === "exact" ? "selected" : "") + '>优先按原文说，尽量不改写</option>'
      + "</select></label>"
      + '<label class="drawer-field">里面的话'
      + '<textarea data-drawer-content="' + esc(drawer.id) + '">' + esc(drawer.content || "") + "</textarea>"
      + "</label>"
      + '<div class="drawer-card-footer"><span class="small-muted">' + esc(drawerKindLabel(drawer.kind)) + " · " + (activation === "always" ? "一直生效" : "命中生效") + "</span>"
      + '<div class="drawer-card-footer-actions">'
      + '<button class="ghost-button small-button danger-text" data-drawer-delete="' + esc(drawer.id) + '">删除</button>'
      + '<button class="primary-button small-button" data-drawer-save="' + esc(drawer.id) + '">保存修改</button></div></div>'
      + "</article>";
  }).join("");
}

async function saveDrawer(id) {
  var pid = activePersonaId();
  var name = document.querySelector('[data-drawer-name="' + CSS.escape(id) + '"]');
  var keywords = document.querySelector('[data-drawer-keywords="' + CSS.escape(id) + '"]');
  var content = document.querySelector('[data-drawer-content="' + CSS.escape(id) + '"]');
  var kind = document.querySelector('[data-drawer-kind="' + CSS.escape(id) + '"]');
  var activation = document.querySelector('[data-drawer-activation="' + CSS.escape(id) + '"]');
  var replyMode = document.querySelector('[data-drawer-reply-mode="' + CSS.escape(id) + '"]');
  var priority = document.querySelector('[data-drawer-priority="' + CSS.escape(id) + '"]');
  if (!name || !keywords || !content || !kind || !activation || !replyMode || !priority) return;
  try {
    await api("PUT", "/drawers", {
      persona_id: pid,
      id: id,
      name: name.value.trim(),
      keywords: keywords.value,
      content: content.value.trim(),
      kind: kind.value,
      activation: activation.value,
      replyMode: replyMode.value,
      priority: Number(priority.value) || 0,
      expected_version: Number(state.agentOverview?.shared_version || 0),
    });
    showToast("卡片已保存，下一条聊天立即生效");
    await loadDrawers();
  } catch (error) {
    if (!(await handleAgentVersionConflict(error))) showToast(error.message, "error");
  }
}

async function toggleDrawer(id, on) {
  var pid = activePersonaId();
  try {
    await api("PUT", "/drawers", {
      persona_id: pid,
      id: id,
      enabled: on,
      expected_version: Number(state.agentOverview?.shared_version || 0),
    });
    showToast((on ? "这张卡片已打开" : "这张卡片已关掉") + "，下一条聊天立即生效");
    await loadDrawers();
  } catch (error) {
    if (!(await handleAgentVersionConflict(error))) showToast(error.message, "error");
  }
}

async function deleteDrawerCard(id) {
  if (!id || !window.confirm("这张自定义卡片要删掉吗？")) return;
  var pid = activePersonaId();
  try {
    await api("DELETE", "/drawers/cards", {
      persona_id: pid,
      id: id,
      expected_version: Number(state.agentOverview?.shared_version || 0),
    });
    showToast("卡片已删除，下一条聊天立即生效");
    await loadDrawers();
  } catch (error) {
    if (!(await handleAgentVersionConflict(error))) showToast(error.message, "error");
  }
}

function openAgentCardModal() {
  $("agentCardName").value = "";
  $("agentCardKind").value = "lore";
  $("agentCardActivation").value = "always";
  $("agentCardReplyMode").value = "guide";
  $("agentCardPriority").value = "0";
  $("agentCardKeywords").value = "";
  $("agentCardContent").value = "";
  $("agentCardModal").hidden = false;
  window.setTimeout(function () { $("agentCardName").focus(); }, 0);
}

async function saveAgentCard() {
  var pid = activePersonaId();
  var payload = {
    persona_id: pid,
    name: $("agentCardName").value.trim(),
    kind: $("agentCardKind").value,
    activation: $("agentCardActivation").value,
    replyMode: $("agentCardReplyMode").value,
    priority: Number($("agentCardPriority").value) || 0,
    keywords: $("agentCardKeywords").value,
    content: $("agentCardContent").value.trim(),
    expected_version: Number(state.agentOverview?.shared_version || 0),
  };
  if (!payload.name || !payload.content) {
    showToast("先写卡片名字和内容", "error");
    return;
  }
  $("saveAgentCardButton").disabled = true;
  try {
    await api("POST", "/drawers/cards", payload);
    $("agentCardModal").hidden = true;
    showToast("卡片已保存，下一条聊天立即生效");
    await loadDrawers();
  } catch (error) {
    if (!(await handleAgentVersionConflict(error))) showToast(error.message, "error");
  } finally {
    $("saveAgentCardButton").disabled = false;
  }
}

async function savePersonaPrompt() {
  var pid = activePersonaId();
  var prompt = $("personaPromptEditor").value.trim();
  var name = $("personaNameEditor").value.trim();
  if (!name) {
    showToast("人设名字不能为空", "error");
    return;
  }
  if (!prompt) {
    showToast("人设正文不能为空", "error");
    return;
  }
  var persona = state.agentOverview?.persona || {};
  $("savePersonaPromptButton").disabled = true;
  $("personaPromptStatus").textContent = "正在保存...";
  try {
    await api("PUT", "/persona", {
      id: pid,
      name: name,
      system_prompt: prompt,
      is_active: persona.is_active ? 1 : 0,
      expected_version: Number(state.agentOverview?.shared_version || 0),
    });
    $("personaPromptStatus").textContent = "✓ 已保存，下一条聊天立即生效";
    showToast("人设正文已保存");
    await loadDrawers();
  } catch (error) {
    if (!(await handleAgentVersionConflict(error))) {
      $("personaPromptStatus").textContent = "✗ 保存失败：" + error.message;
      showToast(error.message, "error");
    }
  } finally {
    $("savePersonaPromptButton").disabled = false;
  }
}

async function runAgentPreviewTest() {
  var pid = activePersonaId();
  var questions = $("agentTestQuestions").value.split("\n").map(function (line) {
    return line.trim();
  }).filter(Boolean).slice(0, 5);
  if (!questions.length) {
    showToast("先写要测试的问题", "error");
    return;
  }
  $("runAgentTestButton").disabled = true;
  $("agentTestResults").innerHTML = '<div class="flag-none">两边模型正在试聊，请稍等...</div>';
  try {
    var data = await api("POST", "/agent-overview/test", { persona_id: pid, questions: questions });
    $("agentTestResults").innerHTML = (data.results || []).map(function (item) {
      return '<div class="agent-test-question"><b>问：' + esc(item.question) + "</b>"
        + '<div class="agent-test-columns">'
        + renderAgentPreviewAnswer("线路 A", item.line_a)
        + renderAgentPreviewAnswer("线路 B", item.line_b)
        + "</div></div>";
    }).join("") || '<div class="flag-none">没有返回结果</div>';
  } catch (error) {
    $("agentTestResults").innerHTML = '<div class="flag-none">试聊失败：' + esc(error.message) + "</div>";
    showToast(error.message, "error");
  } finally {
    $("runAgentTestButton").disabled = false;
  }
}

function renderAgentPreviewAnswer(label, result) {
  if (!result || !result.ok) {
    return '<div class="agent-test-column failed"><span>' + esc(label) + '</span><p>失败：'
      + esc(result?.error || "没有返回") + "</p></div>";
  }
  return '<div class="agent-test-column"><span>' + esc(label) + "</span><p>" + esc(result.reply || "") + "</p></div>";
}

async function loadModelRoute() {
  var token = $("settingsDeviceSelect") ? $("settingsDeviceSelect").value : "";
  var a = $("lineA");
  var b = $("lineB");
  if (!token) {
    if (a) { a.checked = true; a.disabled = true; }
    if (b) { b.checked = false; b.disabled = true; }
    return;
  }
  try {
    var data = await api("GET", "/model-route?token=" + encodeURIComponent(token));
    var line = data.line === "b" ? "b" : "a";
    if (a) { a.checked = line === "a"; a.disabled = false; }
    if (b) { b.checked = line === "b"; b.disabled = false; }
  } catch (e) {
    if (a) a.disabled = true;
    if (b) b.disabled = true;
  }
}

async function setModelRoute(line) {
  var token = $("settingsDeviceSelect") ? $("settingsDeviceSelect").value : "";
  if (!token) { showToast("先选设备", "error"); loadModelRoute(); return; }
  await api("PUT", "/model-route", { token: token, line: line });
  showToast(line === "b" ? "已切到线路B" : "已切到线路A");
  loadModelRoute();
}

async function saveHostingConfig() {
  var token = $("settingsDeviceSelect") ? $("settingsDeviceSelect").value : "";
  if (!token) { showToast("先选设备"); return; }
  var body = { token: token };
  if ($("settingsPlatform")) body.platform = $("settingsPlatform").value;
  if ($("hostingEnabled")) body.hosting_enabled = $("hostingEnabled").checked;
  if ($("monitorEnabled")) body.monitor_enabled = $("monitorEnabled").checked;
  if ($("weatherEnabled")) body.weather_enabled = $("weatherEnabled").checked;
  if ($("timeEnabled")) body.time_enabled = $("timeEnabled").checked;
  if ($("paceInput")) body.reply_pace_sec = Math.max(0, Math.min(300, Number($("paceInput").value) || 0));
  if ($("aiHoursEnabled")) body.ai_hours_enabled = $("aiHoursEnabled").checked;
  if ($("aiStartHour")) body.ai_start_hour = Math.max(0, Math.min(23, Number($("aiStartHour").value) || 0));
  if ($("aiEndHour")) body.ai_end_hour = Math.max(0, Math.min(23, Number($("aiEndHour").value) || 0));
  await api("PUT", "/hosting-config", body);
  showToast("设置已保存，手机下次同步会生效");
}

async function releaseBackToAi(btn) {
  var d = btn.dataset;
  await api("POST", "/takeover", { items: [{ token: d.t, platform: d.p, contact_id: d.c, contact_name: d.n }], mode: "ai", by: "dashboard" });
  showToast("已放回AI");
  loadHumanWaiting();
  loadCustomers(false);
}

let searchTimer = null;
$("loginButton").addEventListener("click", login);
$("passwordInput").addEventListener("keydown", (event) => { if (event.key === "Enter") login(); });
$("logoutButton").addEventListener("click", logout);
$("mobileSidebarButton").addEventListener("click", () => $("sidebar").classList.toggle("mobile-open"));
$("mobileProfileButton").addEventListener("click", () => $("profilePanel").classList.toggle("mobile-open"));
$("refreshButton").addEventListener("click", () => { loadCustomers(); if (state.selected) refreshMessages(); });
$("deviceSelect").addEventListener("change", () => { state.selected = null; loadCustomers(false); });
$("settingsDeviceSelect").addEventListener("change", () => {
  loadHostingConfig();
  loadModelRoute();
});
$("platformSelect").addEventListener("change", () => { state.selected = null; loadCustomers(false); });
$("searchInput").addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => loadCustomers(false), 260);
});
$("manualSendButton").addEventListener("click", enqueueManualMessage);
$("manualInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    enqueueManualMessage();
  }
});
$("priorityButton").addEventListener("click", togglePriority);
$("bindButton").addEventListener("click", openBindModal);
$("saveBindButton").addEventListener("click", saveBindings);
$("bindSearchInput").addEventListener("input", renderBindContacts);
$("personaButton").addEventListener("click", () => showPage("drawers"));
$("settingsPersonaButton").addEventListener("click", () => showPage("drawers"));
$("tokenButton").addEventListener("click", openTokenModal);
$("createLibGroupButton").addEventListener("click", () => openLibraryGroupModal(null));
$("libBackButton").addEventListener("click", () => { showLibGroupsView(); loadLibrary(); });
$("saveLibGroupButton").addEventListener("click", saveLibraryGroup);
$("libraryUploadInput").addEventListener("change", (event) => uploadLibraryImage(event.target.files?.[0]));
$("createAgentCardButton").addEventListener("click", openAgentCardModal);
$("saveAgentCardButton").addEventListener("click", saveAgentCard);
$("createAgentRuleButton").addEventListener("click", function () { openAgentRuleModal(""); });
$("saveAgentRuleButton").addEventListener("click", saveAgentRule);
$("saveSharedFactsButton").addEventListener("click", saveSharedFacts);
$("runPersonaAuditButton").addEventListener("click", runPersonaAudit);
$("savePersonaPromptButton").addEventListener("click", savePersonaPrompt);
$("runAgentTestButton").addEventListener("click", runAgentPreviewTest);
$("saveProgramRulesButton").addEventListener("click", saveProgramRuleSettings);
document.querySelectorAll("[data-rule-tab]").forEach(function (button) {
  button.addEventListener("click", function () { showRuleTab(button.dataset.ruleTab); });
});
if ($("ruleConflictLevelFilter")) {
  $("ruleConflictLevelFilter").addEventListener("change", renderAgentRuleConflicts);
}
if ($("refreshAgentRulesConflictButton")) {
  $("refreshAgentRulesConflictButton").addEventListener("click", async function () {
    await loadAgentRules();
    showToast("规则冲突检查已刷新");
  });
}
if ($("agentRuleStatusFilter")) {
  $("agentRuleStatusFilter").addEventListener("change", renderAgentRules);
}
if ($("agentRuleConflictFilter")) {
  $("agentRuleConflictFilter").addEventListener("change", renderAgentRules);
}
if ($("ruleCenterSearch")) {
  $("ruleCenterSearch").addEventListener("input", function () {
    var value = this.value;
    if ($("legacyRuleSearch")) $("legacyRuleSearch").value = value;
    if (value) showRuleTab("rules");
    renderAgentRules();
  });
}
$("deleteProgramSafetyBoundaryButton").addEventListener("click", async function () {
  if (!window.confirm("确定删除“我的安全底线”吗？下一条聊天会立即不再使用这段内容。")) return;
  $("programSafetyBoundary").value = "";
  $("programSafetyBoundaryEnabled").checked = false;
  await saveProgramRuleSettings();
});
$("deleteProgramPlatformNoticeButton").addEventListener("click", async function () {
  if (!window.confirm("确定删除“平台提示和系统通知”规则吗？")) return;
  $("programPlatformNoticeEnabled").checked = false;
  $("programPlatformNoticeMarkers").value = "";
  await saveProgramRuleSettings();
});
$("deleteProgramVoiceButton").addEventListener("click", async function () {
  if (!window.confirm("确定删除“没有转出文字的语音”规则吗？")) return;
  $("programVoiceEnabled").checked = false;
  $("programVoiceFixedReply").value = "";
  $("programVoiceInstruction").value = "";
  await saveProgramRuleSettings();
});
$("deleteProgramStickerButton").addEventListener("click", async function () {
  if (!window.confirm("确定删除“互动表情和表情包”规则吗？")) return;
  $("programStickerEnabled").checked = false;
  $("programStickerInstruction").value = "";
  renderStickerMeaningRows({});
  await saveProgramRuleSettings();
});
$("addStickerMeaningButton").addEventListener("click", function () { addStickerMeaningRow("", ""); });
$("programVoiceMode").addEventListener("change", updateProgramVoiceFields);
$("runProgramRuleTestButton").addEventListener("click", runProgramRuleTest);
$("legacyRuleSearch").addEventListener("input", renderAgentRules);
$("agentRuleGateFilter").addEventListener("change", renderAgentRules);
$("dashboardFeedbackButton").addEventListener("click", function () {
  var reason = window.prompt("刚才网站哪里有问题？可以简单写一句。", "");
  if (reason === null) return;
  submitDashboardIncident("manual_feedback", reason.trim() || "用户手动反馈", false);
});
$("refreshDashboardIncidentsButton").addEventListener("click", loadDashboardIncidents);
$("runReplayCasesButton").addEventListener("click", async function () {
  this.disabled = true;
  try {
    var result = await api("POST", "/replay-cases/run", {});
    showToast(
      result.failed
        ? "回放完成：" + result.passed + "/" + result.total + " 通过，有失败案例"
        : "回放完成：" + result.passed + "/" + result.total + " 全部通过",
      result.failed ? "warning" : "success"
    );
  } catch (error) {
    showToast("回放执行失败：" + error.message, "error");
  } finally {
    this.disabled = false;
  }
});
$("createDashboardReplayButton").addEventListener("click", async function () {
  var incidentId = state.dashboardIncidentDetailId;
  if (!incidentId) return;
  this.disabled = true;
  try {
    var result = await api("POST", "/replay-cases/from-incident", {
      incident_id: incidentId,
    });
    showToast(result.replay_case?.id ? "回放测试已生成" : "回放测试已存在");
  } catch (error) {
    showToast("生成回放测试失败：" + error.message, "error");
  } finally {
    this.disabled = false;
  }
});
$("saveDashboardIncidentStatusButton").addEventListener("click", async function () {
  var incidentId = state.dashboardIncidentDetailId;
  var status = $("dashboardIncidentStatus").value;
  if (!incidentId) return;
  this.disabled = true;
  try {
    await api("PUT", "/automation-incidents", {
      id: incidentId,
      status: status,
    });
    showToast("故障状态已更新");
    loadDashboardIncidents();
  } catch (error) {
    showToast("状态更新失败：" + error.message, "error");
  } finally {
    this.disabled = false;
  }
});
window.addEventListener("error", function (event) {
  var message = event.message || "页面脚本报错";
  recordDashboardIncidentEvent("javascript_error", {
    message: message,
    source: event.filename || "",
    line: event.lineno || 0,
    column: event.colno || 0,
  });
  submitDashboardIncident("javascript_error", message, true);
});
window.addEventListener("unhandledrejection", function (event) {
  var reason = event.reason;
  var message = reason && reason.message ? reason.message : String(reason || "未处理的异步错误");
  recordDashboardIncidentEvent("unhandled_rejection", { message: message });
  submitDashboardIncident("unhandled_rejection", message, true);
});
document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.close === "mediaPreviewModal") closeMediaPreview();
    else $(button.dataset.close).hidden = true;
  });
});
document.querySelectorAll(".modal-layer").forEach((layer) => {
  layer.addEventListener("click", (event) => {
    if (event.target !== layer) return;
    if (layer.id === "mediaPreviewModal") closeMediaPreview();
    else layer.hidden = true;
  });
});
