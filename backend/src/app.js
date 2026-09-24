// Dashboard App - AI托管助手管理面板
var API_BASE = "/api";
var dashboardPassword = "";
var isLoggedIn = false;

async function login() {
  var pw = document.getElementById("passwordInput").value;
  var error = document.getElementById("loginError");
  error.style.display = "none";
  try {
    var response = await fetch(API_BASE + "/dashboard/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw })
    });
    var result = await response.json();
    if (!response.ok || !result.success) throw new Error("invalid password");
    dashboardPassword = pw;
    isLoggedIn = true;
    document.getElementById("loginView").style.display = "none";
    document.getElementById("appView").style.display = "block";
    loadOverview();
  } catch (_) {
    error.style.display = "block";
  }
}

function logout() {
  isLoggedIn = false;
  dashboardPassword = "";
  document.getElementById("loginView").style.display = "flex";
  document.getElementById("appView").style.display = "none";
  document.getElementById("passwordInput").value = "";
}

function showToast(msg, type) {
  var c = document.getElementById("toastContainer");
  var el = document.createElement("div");
  el.className = "toast toast-" + (type || "success");
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(function() { el.remove(); }, 3000);
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach(function(t) { t.classList.remove("active"); });
  document.querySelectorAll("[id^=tab]").forEach(function(p) { if (p.id.startsWith("tab")) p.style.display = "none"; });
  event.target.classList.add("active");
  document.getElementById("tab" + name.charAt(0).toUpperCase() + name.slice(1)).style.display = "block";
  if (name === "overview") loadOverview();
  if (name === "history") loadHistory();
  if (name === "contacts") loadContacts();
  if (name === "personas") loadPersonas();
  if (name === "tokens") loadTokens();
}

async function api(method, path, body) {
  var headers = { "Content-Type": "application/json" };
  if (dashboardPassword) headers["X-Dashboard-Password"] = dashboardPassword;
  var opts = { method: method, headers: headers };
  if (body) opts.body = JSON.stringify(body);
  var resp = await fetch(API_BASE + path, opts);
  return resp.json();
}

// ===== OVERVIEW =====
async function loadOverview() {
  var tokens = await api("GET", "/token");
  var personas = await api("GET", "/persona");
  var contacts = await api("GET", "/contacts?token=");

  var activeTokens = (tokens.tokens || []).filter(function(t) { return t.is_active; }).length;
  var activePersona = (personas.personas || []).find(function(p) { return p.is_active; });
  var whitelist = (contacts.contacts || []).filter(function(c) { return c.is_whitelisted; }).length;

  var html = '<div class="stat-card"><div class="num">' + activeTokens + '</div><div class="label">活跃设备</div></div>';
  html += '<div class="stat-card"><div class="num">' + whitelist + '</div><div class="label">白名单联系人</div></div>';
  html += '<div class="stat-card"><div class="num">' + (activePersona ? activePersona.name : "无") + '</div><div class="label">当前人设</div></div>';
  html += '<div class="stat-card"><div class="num">4</div><div class="label">支持平台</div></div>';
  document.getElementById("statsGrid").innerHTML = html;

  // Recent replies
  var history = await api("GET", "/chat/history?token=&limit=10");
  var recents = (history.history || []).filter(function(h) { return h.role === "assistant"; }).slice(0, 10);
  if (recents.length === 0) {
    document.getElementById("recentReplies").innerHTML = '<div class="empty">暂无回复记录</div>';
    return;
  }
  var rh = '<table><tr><th>时间</th><th>平台</th><th>联系人</th><th>回复内容</th></tr>';
  recents.forEach(function(r) {
    var d = new Date(r.created_at * 1000);
    rh += '<tr><td>' + d.toLocaleString("zh-CN") + '</td><td>' + r.platform + '</td><td>' + r.contact_name + '</td><td>' + (r.content || "").substring(0, 60) + '</td></tr>';
  });
  rh += '</table>';
  document.getElementById("recentReplies").innerHTML = rh;
}

// ===== HISTORY =====
async function loadHistory() {
  var token = document.getElementById("filterToken").value || "";
  var platform = document.getElementById("filterPlatform").value || "";
  var contact = document.getElementById("filterContact").value || "";
  var params = "token=" + encodeURIComponent(token) + "&limit=50";
  if (platform) params += "&platform=" + platform;
  if (contact) params += "&contact_id=" + encodeURIComponent(contact);
  var data = await api("GET", "/chat/history?" + params);
  var list = data.history || [];
  if (list.length === 0) {
    document.getElementById("historyTable").innerHTML = '<div class="empty">暂无聊天记录</div>';
    return;
  }
  var h = '<table><tr><th>时间</th><th>设备</th><th>平台</th><th>联系人</th><th>角色</th><th>内容</th></tr>';
  list.forEach(function(r) {
    var d = new Date(r.created_at * 1000);
    var roleBadge = r.role === "assistant" ? '<span class="badge badge-green">AI</span>' : '<span class="badge badge-gray">用户</span>';
    h += '<tr><td>' + d.toLocaleString("zh-CN") + '</td><td>' + (r.token || "").substring(0, 12) + '</td><td>' + r.platform + '</td><td>' + r.contact_name + '</td><td>' + roleBadge + '</td><td>' + (r.content || "").substring(0, 80) + '</td></tr>';
  });
  h += '</table>';
  document.getElementById("historyTable").innerHTML = h;
}

// ===== CONTACTS =====
async function loadContacts() {
  var token = document.getElementById("contactFilterToken").value || "";
  var platform = document.getElementById("contactFilterPlatform").value || "";
  var params = "token=" + encodeURIComponent(token);
  if (platform) params += "&platform=" + platform;
  var data = await api("GET", "/contacts?" + params);
  var list = data.contacts || [];
  if (list.length === 0) {
    document.getElementById("contactsTable").innerHTML = '<div class="empty">暂无联系人</div>';
    return;
  }
  var h = '<table><tr><th>平台</th><th>联系人ID</th><th>昵称</th><th>白名单</th><th>备注</th><th>操作</th></tr>';
  list.forEach(function(c) {
    var badge = c.is_whitelisted ? '<span class="badge badge-green">是</span>' : '<span class="badge badge-gray">否</span>';
    h += '<tr><td>' + c.platform + '</td><td>' + c.contact_id + '</td><td>' + c.contact_name + '</td><td>' + badge + '</td><td>' + (c.notes || "") + '</td><td><button class="btn btn-sm ' + (c.is_whitelisted ? 'btn-danger' : 'btn-primary') + '" onclick="toggleWhitelist(\'' + c.platform + '\',\'' + c.contact_id + '\',' + c.is_whitelisted + ')">' + (c.is_whitelisted ? '移除' : '加入') + '</button></td></tr>';
  });
  h += '</table>';
  document.getElementById("contactsTable").innerHTML = h;
}

async function toggleWhitelist(platform, contactId, current) {
  await api("POST", "/contacts", { token: "", platform: platform, contact_id: contactId, contact_name: "", is_whitelisted: current ? 0 : 1 });
  showToast(current ? "已移除白名单" : "已加入白名单");
  loadContacts();
}

// ===== PERSONAS =====
async function loadPersonas() {
  var data = await api("GET", "/persona");
  var list = data.personas || [];
  if (list.length === 0) {
    document.getElementById("personasList").innerHTML = '<div class="empty">暂无人设</div>';
    return;
  }
  var h = "";
  list.forEach(function(p) {
    h += '<div class="persona-card' + (p.is_active ? ' active' : '') + '">';
    h += '<h3>' + p.name + (p.is_active ? ' ✅ 当前使用' : '') + '</h3>';
    h += '<p>' + (p.system_prompt || "").substring(0, 120) + '...</p>';
    h += '<div class="persona-actions">';
    if (!p.is_active) h += '<button class="btn btn-sm btn-primary" onclick="activatePersona(\'' + p.id + '\')">启用</button>';
    h += '<button class="btn btn-sm btn-danger" onclick="deletePersona(\'' + p.id + '\')">删除</button>';
    h += '</div></div>';
  });
  document.getElementById("personasList").innerHTML = h;
}

async function activatePersona(id) {
  await api("PUT", "/persona", { token: "", id: id, name: "", system_prompt: "", is_active: 1 });
  showToast("人设已切换");
  loadPersonas();
  loadOverview();
}

async function deletePersona(id) {
  if (!confirm("确定删除？")) return;
  await api("DELETE", "/persona", { id: id });
  showToast("已删除");
  loadPersonas();
}

function addPersona() {
  var id = prompt("人设ID（英文）：");
  if (!id) return;
  var name = prompt("显示名称：");
  if (!name) return;
  var prompt = prompt("系统提示词：");
  if (!prompt) return;
  api("PUT", "/persona", { token: "", id: id, name: name, system_prompt: prompt, is_active: 0 }).then(function() {
    showToast("人设已创建");
    loadPersonas();
  });
}

// ===== TOKENS =====
async function loadTokens() {
  var data = await api("GET", "/token");
  var list = data.tokens || [];
  if (list.length === 0) {
    document.getElementById("tokensTable").innerHTML = '<div class="empty">暂无设备密钥</div>';
    return;
  }
  var h = '<table><tr><th>密钥</th><th>名称</th><th>月度上限</th><th>已花费</th><th>状态</th><th>最后使用</th><th>操作</th></tr>';
  list.forEach(function(t) {
    var status = t.is_active ? '<span class="badge badge-green">启用</span>' : '<span class="badge badge-gray">停用</span>';
    var lastUsed = t.last_used_at ? new Date(t.last_used_at * 1000).toLocaleString("zh-CN") : "从未";
    h += '<tr><td>' + t.token.substring(0, 20) + '...</td><td>' + (t.name || "") + '</td><td>¥' + t.monthly_limit + '</td><td>¥' + (t.spent || 0).toFixed(2) + '</td><td>' + status + '</td><td>' + lastUsed + '</td><td><button class="btn btn-sm ' + (t.is_active ? 'btn-danger' : 'btn-primary') + '" onclick="toggleToken(\'' + t.token + '\',' + t.is_active + ')">' + (t.is_active ? '停用' : '启用') + '</button></td></tr>';
  });
  h += '</table>';
  document.getElementById("tokensTable").innerHTML = h;
}

async function toggleToken(token, current) {
  await api("PUT", "/token", { token: token, is_active: current ? 0 : 1 });
  showToast(current ? "已停用" : "已启用");
  loadTokens();
}

// Init
document.getElementById("passwordInput").addEventListener("keydown", function(e) { if (e.key === "Enter") login(); });
