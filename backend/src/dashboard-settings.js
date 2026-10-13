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
