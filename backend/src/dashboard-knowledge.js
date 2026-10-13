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
    autoResizeDrawerTextareas();
    window.requestAnimationFrame(autoResizeDrawerTextareas);
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

function autoResizeDrawerTextareas() {
  document.querySelectorAll("[data-drawer-content]").forEach(function (el) {
    el.style.height = "auto";
    el.style.height = Math.max(80, el.scrollHeight + 4) + "px";
  });
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
  autoResizeDrawerTextareas();
  window.requestAnimationFrame(autoResizeDrawerTextareas);
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
