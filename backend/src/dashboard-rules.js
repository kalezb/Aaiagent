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

function renderDrawerList(list) {
  if (!list || !list.length) return '<div class="empty-panel">还没有卡片</div>';
  return list.map(function (drawer) {
    var activation = drawer.activation === "always" ? "always" : "keyword";
    var replyMode = drawer.replyMode === "exact" ? "exact" : "guide";
    return '<article class="drawer-card ' + (drawer.enabled ? "" : "off") + '" data-drawer-card="' + esc(drawer.id) + '">'
      + '<div class="drawer-card-head">'
      + '<div class="drawer-title-wrap">'
      + '<span class="drawer-card-icon">🗂️</span>'
      + '<input data-drawer-name="' + esc(drawer.id) + '" value="' + esc(drawer.name || "") + '" placeholder="卡片名称" aria-label="抽屉名字">'
      + '</div>'
      + '<div class="drawer-status-wrap">'
      + '<span class="status-chip ' + (drawer.enabled ? "on" : "") + '">' + (drawer.enabled ? "启用" : "禁用") + '</span>'
      + '<label class="switch"><input type="checkbox" data-drawer-toggle="' + esc(drawer.id) + '" ' + (drawer.enabled ? "checked" : "") + '></label>'
      + '</div>'
      + '</div>'
      + '<div class="drawer-meta-grid">'
      + '<label class="drawer-field">类型<select data-drawer-kind="' + esc(drawer.id) + '">' + drawerKindOptions(drawer.kind) + "</select></label>"
      + '<label class="drawer-field">生效<select data-drawer-activation="' + esc(drawer.id) + '">'
      + '<option value="keyword" ' + (activation === "keyword" ? "selected" : "") + '>命中才用</option>'
      + '<option value="always" ' + (activation === "always" ? "selected" : "") + '>一直生效</option>'
      + "</select></label>"
      + '<label class="drawer-field">优先级<input data-drawer-priority="' + esc(drawer.id) + '" type="number" min="-100" max="100" value="' + Number(drawer.priority || 0) + '"></label>'
      + "</div>"
      + '<label class="drawer-field">触发词（命中才用时填写，用逗号分隔）'
      + '<input data-drawer-keywords="' + esc(drawer.id) + '" value="' + esc((drawer.keywords || []).join(", ")) + '" placeholder="例如：早餐, 早上好, 起床">'
      + "</label>"
      + '<label class="drawer-field">说话方式'
      + '<select data-drawer-reply-mode="' + esc(drawer.id) + '">'
      + '<option value="guide" ' + (replyMode === "guide" ? "selected" : "") + '>参考表达，允许自然改写</option>'
      + '<option value="exact" ' + (replyMode === "exact" ? "selected" : "") + '>优先按原文说，尽量不改写</option>'
      + "</select></label>"
      + '<label class="drawer-field">里面的话'
      + '<textarea data-drawer-content="' + esc(drawer.id) + '" placeholder="写下遇到对应情况时，模型该说的话或人设素材...">' + esc(drawer.content || "") + "</textarea>"
      + "</label>"
      + '<div class="drawer-card-footer"><span class="small-muted">' + esc(drawerKindLabel(drawer.kind)) + " · " + (activation === "always" ? "一直生效" : "命中生效") + " · 优先级 " + Number(drawer.priority || 0) + "</span>"
      + '<div class="drawer-card-footer-actions">'
      + '<button class="danger-button small-button" data-drawer-delete="' + esc(drawer.id) + '">删除</button>'
      + '<button class="btn-action-blue small-button" data-drawer-save="' + esc(drawer.id) + '">保存修改</button></div></div>'
      + "</article>";
  }).join("");
}

async function reloadCurrentCards() {
  if (currentPage === "kb") {
    await loadKnowledge();
  } else {
    await loadDrawers();
  }
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
    await reloadCurrentCards();
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
    await reloadCurrentCards();
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
    await reloadCurrentCards();
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
    await reloadCurrentCards();
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
