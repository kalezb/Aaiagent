const {
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
} = window.DashboardUtils;

const API_BASE = "/api";

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

function syncBindingSelectionFromGroup(group) {
  state.bindingSelection = new Set((group?.aliases || []).map((alias) => contactKey(alias.platform, alias.contact_id)));
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
