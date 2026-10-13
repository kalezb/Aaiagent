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
document.addEventListener("input", function (e) {
  if (e.target && e.target.matches && e.target.matches("[data-drawer-content]")) {
    e.target.style.height = "auto";
    e.target.style.height = Math.max(80, e.target.scrollHeight + 4) + "px";
  }
});
window.addEventListener("resize", autoResizeDrawerTextareas);
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


// ===== 现代看板交互增强 =====
function initModernInteractions() {
  // 1. 折叠客户资料卡
  const layout = $("sessionLayout") || document.querySelector(".session-layout");
  const toggleBtn = $("toggleProfileBtn");
  const closeBtn = $("closeProfileBtn");
  if (toggleBtn && layout) {
    toggleBtn.addEventListener("click", () => {
      layout.classList.toggle("profile-collapsed");
    });
  }
  if (closeBtn && layout) {
    closeBtn.addEventListener("click", () => {
      layout.classList.add("profile-collapsed");
    });
  }

  // 2. 快捷消息发送（Enter 发送，Ctrl+Enter 换行）
  const manualInput = $("manualInput");
  if (manualInput) {
    manualInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        const sendBtn = $("manualSendButton");
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
        }
      }
    });
  }

  // 3. 客户快捷状态筛选药丸与顶部 KPI 指标联动
  const qfContainer = $("customerQuickFilter");
  if (qfContainer) {
    qfContainer.querySelectorAll(".filter-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        qfContainer.querySelectorAll(".filter-pill").forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
        state.customerQuickFilter = btn.dataset.filter || "all";
        // 同步高亮顶部微型 KPI 卡片
        const kpiContainer = $("sessionKpiStrip");
        if (kpiContainer) {
          kpiContainer.querySelectorAll(".kpi-card").forEach((c) => {
            c.classList.toggle("active", c.dataset.kpi === state.customerQuickFilter);
          });
        }
        renderCustomers();
      });
    });
  }

  // 3.1 顶部微型 KPI 状态卡片点击联动
  const kpiStripContainer = $("sessionKpiStrip");
  if (kpiStripContainer) {
    kpiStripContainer.querySelectorAll(".kpi-card").forEach((card) => {
      card.addEventListener("click", () => {
        const kpi = card.dataset.kpi || "all";
        const qfBtn = $("customerQuickFilter")?.querySelector(`[data-filter="${kpi}"]`);
        if (qfBtn) {
          qfBtn.click();
        } else {
          state.customerQuickFilter = kpi;
          kpiStripContainer.querySelectorAll(".kpi-card").forEach((c) => c.classList.remove("active"));
          card.classList.add("active");
          renderCustomers();
        }
      });
    });
  }

  // 4. 快捷填入常用表情
  const paletteContainer = $("stickerPaletteChips");
  if (paletteContainer) {
    paletteContainer.querySelectorAll(".palette-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.name;
        const meaning = btn.dataset.meaning;
        if (!name) return;
        const addBtn = $("addStickerMeaningButton");
        if (addBtn) addBtn.click();
        const list = $("stickerMeaningRows");
        if (list && list.lastElementChild) {
          const inputs = list.lastElementChild.querySelectorAll("input");
          if (inputs.length >= 2) {
            inputs[0].value = name;
            inputs[1].value = meaning || "";
            showToast(`已添加表情「${name}」`);
            showFloatingSaveBar();
          }
        }
      });
    });
  }

  // 5. 规则中心悬浮保存栏
  const saveBtn = $("saveAllChangesBtn");
  const discardBtn = $("discardAllChangesBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      if ($("saveProgramRulesButton")) $("saveProgramRulesButton").click();
      if ($("savePersonaPromptButton")) $("savePersonaPromptButton").click();
      if ($("saveSharedFactsButton")) $("saveSharedFactsButton").click();
      hideFloatingSaveBar();
      showToast("所有规则修改已保存并生效！");
    });
  }
  if (discardBtn) {
    discardBtn.addEventListener("click", () => {
      loadDrawers();
      hideFloatingSaveBar();
      showToast("已放弃未保存的改动");
    });
  }
  const drawersPage = $("page-drawers");
  if (drawersPage) {
    drawersPage.addEventListener("input", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") {
        showFloatingSaveBar();
      }
    });
  }
}

function showFloatingSaveBar() {
  const bar = $("floatingSaveBar");
  if (bar) bar.hidden = false;
}

function hideFloatingSaveBar() {
  const bar = $("floatingSaveBar");
  if (bar) bar.hidden = true;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initModernInteractions);
} else {
  initModernInteractions();
}
