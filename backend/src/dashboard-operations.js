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
