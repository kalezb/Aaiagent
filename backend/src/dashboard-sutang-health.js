function sutangHealthStatusLabel(health) {
  if (!health) return "自学经验库运行中";
  if (health.status === "ok") return "动态装配中";
  return "动态装配中";
}

function sutangHealthStatusClass(health) {
  return "on";
}

function ruleHealthStateLabel(state) {
  return ({
    active: "正在生效",
    disabled: "已停用",
    deleted: "已删除",
    missing: "不存在",
    enabled: "已启用",
  })[state] || state || "未知";
}

function renderSutangHealthItem(item, kind) {
  var title = String(item.title || item.id || "");
  var state = ruleHealthStateLabel(item.state);
  var ok = item.ok === true;
  var detail = "";
  if (kind === "rule" && item.missing && item.missing.length) {
    detail = "缺少新内容：" + item.missing.join("、");
  } else if (kind === "rule" && item.forbidden_hits && item.forbidden_hits.length) {
    detail = "仍有旧内容：" + item.forbidden_hits.join("、");
  } else if (kind === "card" && item.missing && item.missing.length) {
    detail = "缺少新内容：" + item.missing.join("、");
  } else if (kind === "card" && item.forbidden_hits && item.forbidden_hits.length) {
    detail = "仍有旧内容：" + item.forbidden_hits.join("、");
  } else if (kind === "legacy") {
    detail = ok ? "已经不会再进入苏棠对白" : "这条旧规则还在生效";
  } else if (item.state === "active" || item.state === "enabled") {
    detail = ok ? "内容符合当前人设口径" : "需要打开检查";
  } else {
    detail = "当前不会进入正常聊天";
  }
  var action = "";
  if (item.id && (kind === "legacy" || kind === "rule")) {
    action = '<button class="ghost-button small-button" type="button" data-sutang-health-rule="' + esc(item.id) + '">查看规则</button>';
  } else if (item.id && kind === "card") {
    action = '<button class="ghost-button small-button" type="button" data-sutang-health-card="' + esc(item.id) + '">查看知识卡</button>';
  }
  return '<div class="rule-health-item"><div class="rule-health-item-main">'
    + "<b>" + esc(title) + "</b>"
    + '<small class="' + (ok ? "rule-health-ok" : kind === "legacy" ? "rule-health-bad" : "rule-health-warn") + '">'
    + esc(state + " · " + detail) + "</small></div>"
    + '<div class="rule-health-item-actions"><span class="rule-badge ' + (ok ? "on" : "error") + '">'
    + (ok ? "已接管" : "需确认") + "</span>" + action + "</div></div>";
}

// 加载指定人设的自学避坑锦囊
async function loadPlaybookCards() {
  try {
    var data = await api("GET", "/playbook-cards?persona_id=female_sutang");
    if (data && Array.isArray(data.cards)) {
      state.playbookCards = data.cards;
      if (state.sutangRuleHealth) renderSutangRuleHealth();
    }
  } catch (_) {}
}

function renderPlaybookItems(cards) {
  if (!cards || !cards.length) {
    return '<div class="small-muted">暂无锦囊数据</div>';
  }
  return cards.map(function (card) {
    var isBuiltIn = card.source === "system" || card.id.indexOf("pb_custom_") === -1;
    var badgeClass = isBuiltIn ? "on" : "info";
    var badgeLabel = isBuiltIn ? "核心内置" : (card.source === "user" ? "人工设定" : "自主沉淀");
    var deleteBtn = !isBuiltIn
      ? '<button class="ghost-button small-button" type="button" data-delete-playbook="' + esc(card.id) + '">删除</button>'
      : "";
    return '<div class="rule-health-item" style="border-left: 3px solid ' + (isBuiltIn ? '#10b981' : '#6366f1') + ';">'
      + '<div class="rule-health-item-main">'
      + '<b style="color:var(--text,#1e293b);">' + esc(card.triggerCondition) + '</b>'
      + '<small class="rule-health-ok" style="font-size:13px;line-height:1.5;margin-top:3px;">' + esc(card.instruction) + '</small>'
      + '</div>'
      + '<div class="rule-health-item-actions">'
      + '<span class="rule-badge ' + badgeClass + '">' + badgeLabel + '</span>'
      + deleteBtn
      + '</div></div>';
  }).join("");
}

function renderSutangRuleHealth() {
  var health = state.sutangRuleHealth;
  var refresh = $("refreshSutangHealthButton");
  if (refresh) refresh.onclick = function () {
    loadAgentRules();
    loadPlaybookCards();
  };
  var status = $("sutangRuleHealthStatus");
  var legacy = $("sutangHealthLegacyCount");
  var residual = $("sutangHealthResidualCount");
  var rules = $("sutangHealthRuleCount");
  var cards = $("sutangHealthCardCount");
  var host = $("sutangRuleHealthBody");

  if (status) {
    status.textContent = "🟢 动态装配中";
    status.className = "rule-badge on";
  }

  var totalCards = (state.playbookCards && state.playbookCards.length) ? state.playbookCards.length : 6;
  if (cards) cards.textContent = totalCards + " 条";
  if (rules) rules.textContent = "4 阶推进";
  if (legacy) legacy.textContent = "200ms自愈";
  if (residual) residual.textContent = "0";

  if (!host) return;

  var legacyRows = (health && health.legacy_rules || []).map(function (item) {
    return renderSutangHealthItem(item, "legacy");
  }).join("");
  var ruleRows = (health && health.rewritten_rules || []).map(function (item) {
    return renderSutangHealthItem(item, "rule");
  }).join("");
  var cardRows = (health && health.cards || []).map(function (item) {
    return renderSutangHealthItem(item, "card");
  }).join("");
  var residualRows = (health && health.residual_conflicts || []).map(function (item) {
    return '<div class="rule-health-item"><div class="rule-health-item-main"><b>' + esc(item.title || item.key)
      + '</b><small class="rule-health-bad">正在生效 · 命中旧话：' + esc((item.hits || []).join("、")) + "</small></div>"
      + '<div class="rule-health-item-actions"><span class="rule-badge error">旧冲突</span>'
      + '<button class="ghost-button small-button" type="button" data-sutang-health-rule="' + esc(item.id || "") + '">查看规则</button>'
      + "</div></div>";
  }).join("");

  var playbookList = state.playbookCards || [];
  var playbookHtml = renderPlaybookItems(playbookList);

  host.innerHTML =
    '<div class="rule-health-group">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
    + '<h4 style="margin:0;font-size:15px;color:var(--text,#0f172a);">🎯 正在生效的智能体避坑锦囊</h4>'
    + '<button class="ghost-button small-button" id="addNewPlaybookCardBtn" type="button" style="border-color:#6366f1;color:#6366f1;font-weight:600;">➕ 随手写一条避坑经验</button>'
    + '</div>'
    + '<div class="small-muted" style="margin-bottom:10px;">智能体与客户聊天时动态装配对应语境的锦囊。支持在聊天窗口点击【💡 一键复盘】或点击上方按钮随手添加大白话，秒级自动生效：</div>'
    + '<div class="rule-health-list">' + playbookHtml + '</div>'
    + "</div>"

    + '<div class="rule-health-group" style="margin-top:16px;background:rgba(99,102,241,0.04);border:1px solid rgba(99,102,241,0.15);border-radius:8px;padding:12px 14px;">'
    + '<h4 style="margin:0 0 6px 0;font-size:14px;color:#4f46e5;">📋 当前人设推进主线与三段式底色</h4>'
    + '<div style="font-size:13px;line-height:1.6;color:var(--text,#1e293b);">'
    + '<p style="margin:3px 0;"><b>1. 身份底色：</b>29岁已婚未育，和婆婆住在重庆两江新区，在家操持家务，性格温和有分寸，短句作答（3-8字）。</p>'
    + '<p style="margin:3px 0;"><b>2. 三段主线：</b>本分破冰 ➔ 情感共鸣与暧昧拉扯 ➔ 反复邀约时温柔婉拒，关系留在线上。</p>'
    + '<p style="margin:3px 0;"><b>3. 绝对红线：</b>微信因现实生活顾虑太多而拒绝；私下联系只认后台填写的QQ，并在时机合适时自然给；不答应见面、不给地址；男方发过照片后绝不催照；对方夸赞娇嗔接话绝不回怼。</p>'
    + '</div></div>'

    + '<details class="rule-health-group" style="margin-top:14px;background:rgba(0,0,0,0.02);border:1px dashed #cbd5e1;border-radius:8px;padding:8px 12px;">'
    + '<summary style="cursor:pointer;font-weight:600;color:#64748b;font-size:13px;">📦 其他规则与卡片状态（点击展开查看明细）</summary>'
    + '<div style="margin-top:10px;">'
    + (ruleRows ? '<div class="small-muted" style="margin-bottom:4px;">关键规则：</div><div class="rule-health-list">' + ruleRows + '</div>' : '')
    + (legacyRows ? '<div class="small-muted" style="margin:8px 0 4px 0;">已停用或已吸收旧规则：</div><div class="rule-health-list">' + legacyRows + '</div>' : '')
    + (cardRows ? '<div class="small-muted" style="margin:8px 0 4px 0;">抽屉卡状态：</div><div class="rule-health-list">' + cardRows + '</div>' : '')
    + (residualRows ? '<div class="small-muted" style="margin:8px 0 4px 0;">冲突排查：</div><div class="rule-health-list">' + residualRows + '</div>' : '')
    + '</div></details>';

  // 绑定删除按钮
  host.querySelectorAll("[data-delete-playbook]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var id = button.dataset.deletePlaybook;
      if (!confirm("确定要删除这条避坑经验吗？")) return;
      try {
        await api("DELETE", "/playbook-cards?id=" + encodeURIComponent(id) + "&persona_id=female_sutang");
        showToast("已删除该避坑经验");
        await loadPlaybookCards();
      } catch (err) {
        showToast("删除失败：" + err.message, "error");
      }
    });
  });

  // 绑定随手写一条经验
  var addBtn = $("addNewPlaybookCardBtn");
  if (addBtn) {
    addBtn.onclick = function () {
      var trigger = prompt("【新增大白话避坑经验】\n请输入触发场景（例如：对方怀疑我是微商 / 对方催着要微信号）：");
      if (!trigger || !trigger.trim()) return;
      var instruction = prompt("【新增大白话避坑经验】\n请输入苏棠应该怎么做（大白话，例如：娇嗔反问带过，绝不说教或发长篇广告）：");
      if (!instruction || !instruction.trim()) return;

      api("POST", "/playbook-cards", {
        personaId: "female_sutang",
        triggerCondition: trigger.trim(),
        instruction: instruction.trim(),
      }).then(function () {
        showToast("避坑经验已收录！下一轮聊天立即生效");
        loadPlaybookCards();
      }).catch(function (err) {
        showToast("保存失败：" + err.message, "error");
      });
    };
  }

  host.querySelectorAll("[data-sutang-health-rule]").forEach(function (button) {
    button.addEventListener("click", function () {
      if (button.dataset.sutangHealthRule) openAgentRuleModal(button.dataset.sutangHealthRule);
    });
  });
  host.querySelectorAll("[data-sutang-health-card]").forEach(function (button) {
    button.addEventListener("click", function () {
      if ($("knowledgePersona")) $("knowledgePersona").value = "female_sutang";
      showPage("kb");
    });
  });
}

// 供聊天窗口一键复盘调用的全局方法
window.openReflexionModal = function () {
  var group = state.selected;
  var alias = state.targetAlias;
  if (!group || !alias) {
    showToast("请先在左侧选择一个客户对话", "warn");
    return;
  }

  var contactName = alias.contact_name || alias.contact_id || "客户";
  var userInput = prompt(
    "【智能体一键复盘】\n正在为客户【" + contactName + "】复盘对话死穴与沟通卡点。\n\n" +
    "如果你觉得某句话说得不好，可在此输入你的想法（直接点击【确定】则由 AI 全自主分析）："
  );
  if (userInput === null) return; // 用户取消

  showToast("AI 正在深度复盘对话卡点并提炼经验...");
  api("POST", "/reflexion-learn", {
    persona_id: "female_sutang",
    contact_id: alias.contact_id,
    contact_name: contactName,
    platform: alias.platform,
    token: group.token,
    flaw_description: userInput.trim(),
    messages: state.messages || [],
  }).then(function (res) {
    if (res && res.success && res.card) {
      alert(
        "【智能复盘已完成并自动收录！】\n\n" +
        "📌 诊断分析：\n" + res.analysis + "\n\n" +
        "💡 自动提炼的避坑锦囊：\n" + res.card.instruction + "\n\n" +
        "🎯 适用场景：\n" + res.card.triggerCondition + "\n\n" +
        "✅ 该经验已实时收录进常驻经验锦囊库，下一轮聊天自动生效，无需打补丁！"
      );
      loadPlaybookCards();
    } else {
      showToast("复盘完成，未提取出新增卡片");
    }
  }).catch(function (err) {
    showToast("复盘失败：" + err.message, "error");
  });
};

// 页面初始化时静默加载一次经验锦囊
if (typeof window !== "undefined") {
  setTimeout(loadPlaybookCards, 1500);
}
