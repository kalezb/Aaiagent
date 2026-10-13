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
