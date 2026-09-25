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
  toast.className = `toast ${type === "error" ? "error" : ""}`;
  toast.textContent = message;
  $("toastStack").appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (state.password) headers["X-Dashboard-Password"] = state.password;
  const response = await fetch(API_BASE + path, {
    method,
    headers,
    cache: "no-store",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && $("appView").hidden === false) logout();
    throw new Error(data.error || `请求失败 (${response.status})`);
  }
  return data;
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
    state.refreshTimer = window.setInterval(refreshVisibleData, 10000);
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
  const select = $("deviceSelect");
  const current = select.value;
  select.innerHTML = '<option value="">全部设备</option>' + state.tokens.map((token) => {
    const label = token.name ? `${token.name} · ${token.token}` : token.token;
    return `<option value="${esc(token.token)}">${esc(label)}</option>`;
  }).join("");
  select.value = state.tokens.some((token) => token.token === current) ? current : "";
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
  $("profileUpdated").textContent = profileState?.updated_at ? `更新于 ${formatShortTime(profileState.updated_at)}` : "每40条消息批量提取";
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
    return `${separator}
      <div class="message-row ${side}">
        <div class="message-block">
          <div class="bubble">${esc(message.content || "[非文字消息]")}</div>
          <div class="message-meta">
            <span>${esc(formatFullTime(message.created_at))}</span>
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
    const data = await api("GET", "/persona");
    const personas = data.personas || [];
    $("personaList").innerHTML = personas.map((persona) => `
      <div class="persona-card ${persona.is_active ? "active" : ""}">
        <h3>${esc(persona.name)}${persona.is_active ? " · 当前使用" : ""}</h3>
        <p>${esc((persona.system_prompt || "").slice(0, 160))}</p>
        ${persona.is_active ? "" : `<div class="persona-actions"><button class="primary-button" data-persona-id="${esc(persona.id)}">启用</button></div>`}
      </div>`).join("");
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
    $("tokenList").innerHTML = `<table><thead><tr><th>设备名称</th><th>设备密钥</th><th>月上限</th><th>已使用</th><th>状态</th><th>最后使用</th></tr></thead><tbody>` +
      state.tokens.map((token) => {
        const lastUsed = token.last_used_at ? new Date(token.last_used_at * 1000).toLocaleString("zh-CN") : "从未";
        return `<tr><td>${esc(token.name || "未命名")}</td><td>${esc(token.token)}</td><td>¥${Number(token.monthly_limit || 0)}</td><td>¥${Number(token.spent || 0).toFixed(2)}</td><td>${token.is_active ? "启用" : "停用"}</td><td>${esc(lastUsed)}</td></tr>`;
      }).join("") + `</tbody></table>`;
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
  loadCustomers();
  if (state.selected) refreshMessages();
}

let searchTimer = null;
$("loginButton").addEventListener("click", login);
$("passwordInput").addEventListener("keydown", (event) => { if (event.key === "Enter") login(); });
$("logoutButton").addEventListener("click", logout);
$("mobileSidebarButton").addEventListener("click", () => $("sidebar").classList.toggle("mobile-open"));
$("refreshButton").addEventListener("click", () => { loadCustomers(); if (state.selected) refreshMessages(); });
$("deviceSelect").addEventListener("change", () => { state.selected = null; loadCustomers(false); });
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
$("personaButton").addEventListener("click", openPersonaModal);
$("tokenButton").addEventListener("click", openTokenModal);
document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => { $(button.dataset.close).hidden = true; });
});
document.querySelectorAll(".modal-layer").forEach((layer) => {
  layer.addEventListener("click", (event) => { if (event.target === layer) layer.hidden = true; });
});
