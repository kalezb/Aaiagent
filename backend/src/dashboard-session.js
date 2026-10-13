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
  const allGroups = state.groups || [];

  // 更新顶部 KPI 指标（融合旗舰风）
  const unreadCount = allGroups.filter((g) => g.has_unread || (g.last_message?.role === "user")).length;
  const waitingCount = allGroups.filter((g) => g.mode === "manual" || g.priority_reply).length;
  const priorityCount = allGroups.filter((g) => g.priority_reply || (g.profile?.facts?.婚姻 === "已婚")).length;
  const deviceCount = state.tokens?.length || 1;
  if ($("kpiDeviceCount")) $("kpiDeviceCount").textContent = `${deviceCount} 台`;
  if ($("kpiUnreadCount")) $("kpiUnreadCount").textContent = `${unreadCount} 条`;
  if ($("kpiWaitingCount")) $("kpiWaitingCount").textContent = `${waitingCount} 人`;
  if ($("kpiPriorityCount")) $("kpiPriorityCount").textContent = `${priorityCount} 人`;

  let list = allGroups;
  const qf = state.customerQuickFilter || "all";
  if (qf === "unread") {
    list = list.filter((g) => g.has_unread || (g.last_message?.role === "user"));
  } else if (qf === "priority") {
    list = list.filter((g) => g.priority_reply || (g.profile?.facts?.婚姻 === "已婚"));
  } else if (qf === "waiting") {
    list = list.filter((g) => g.mode === "manual" || g.priority_reply);
  }
  $("customerSummary").textContent = `${list.length} 位客户`;
  if (!list.length) {
    host.innerHTML = '<div class="section-empty">没有匹配的客户<br>可以换设备、平台或搜索词</div>';
    return;
  }
  host.innerHTML = list.map((group) => {
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
  renderContactFlags(group);
  renderTakeoverAlerts(group);

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

// 2026-10-07：把“为什么不回他”摊开给你看，并且能一键改回。
function takeoverKindText(kind) {
  return ({ give: "他给了联系方式", want: "他要联系方式" })[String(kind || "")] || String(kind || "需要人工接管");
}

function contactFlagItems(group) {
  const items = [];
  for (const alias of group?.aliases || []) {
    const base = { alias };
    const who = platformName(alias.platform) +
      (alias.contact_name && alias.contact_name !== group.display_name ? "·" + alias.contact_name : "");
    // 2026-10-07：已婚和“停回”是两回事，恢复的按钮要分开——
    // 只想让停回的人重新能聊，但不想清掉“他已婚”这个事实，就只点【恢复回复】。
    if (String(alias.marital_status || "") === "married") {
      items.push({ ...base, warn: false, label: who + "：已婚不回", action: "married", actionText: "清除已婚标记" });
    }
    if (Number(alias.is_whitelisted ?? 1) === 0) {
      items.push({ ...base, warn: false, label: who + "：已停止回复", action: "muted", actionText: "恢复回复" });
    }
    if (Number(alias.voice_warn_at || 0) > 0 && Number(alias.is_whitelisted ?? 1) !== 0) {
      items.push({ ...base, warn: true, label: who + "：语音/表情已警告过", action: "warned", actionText: "清警告" });
    }
    // 2026-10-07：他发过照片就永不再问——永久记在档案上，这里能看见、也能清掉重来。
    if (Number(alias.his_photo_at || 0) > 0) {
      items.push({ ...base, warn: false, label: who + "：已收到他的照片（不再问他长什么样）", action: "hisPhoto", actionText: "清掉这条记录" });
    }
    if (Number(alias.her_photo_at || 0) > 0) {
      items.push({ ...base, warn: false, label: who + "：已给他看过照片", action: "herPhoto", actionText: "清掉这条记录" });
    }
  }
  return items;
}

function renderContactFlags(group) {
  const host = $("profileFlags");
  if (!host) return;
  const items = contactFlagItems(group);
  if (!group || !items.length) {
    host.innerHTML = '<span class="flag-none">正常回复中</span>';
    return;
  }
  // 每个平台账号一条状态 + 各自对应的“恢复”按钮（已婚 / 停回 / 警告 分别处理）。
  host.innerHTML = items.map((item, index) =>
    `<span class="contact-flag ${item.warn ? "warn" : ""}">${esc(item.label)}</span>`
    + `<button class="flag-restore" data-flag-action="${esc(item.action)}" data-flag-index="${index}">${esc(item.actionText)}</button>`
  ).join("");
  host.querySelectorAll("[data-flag-action]").forEach((button) => {
    button.addEventListener("click", () => restoreContactFlag(button.dataset.flagAction, Number(button.dataset.flagIndex)));
  });
}

// 2026-10-07：三种状态各自恢复，互不牵连——
// 【恢复回复】只解“停回”，不动“他已婚”；【清除已婚标记】只清已婚；【清警告】只清警告时间。
async function restoreContactFlag(kind, index) {
  const group = state.selected;
  if (!group) return;
  const item = contactFlagItems(group)[index];
  if (!item?.alias) return;
  const body = { token: group.token, platform: item.alias.platform, contact_id: item.alias.contact_id };
  let done = "已处理";
  if (kind === "married") { body.marital_status = ""; done = "已清除已婚标记"; }
  else if (kind === "muted") { body.is_whitelisted = 1; body.voice_warn_at = 0; done = "已恢复回复（已婚标记保留）"; }
  else if (kind === "warned") { body.voice_warn_at = 0; done = "已清除警告"; }
  // 2026-10-07：清掉照片记录（清掉之后她就会重新问他长什么样）。
  else if (kind === "hisPhoto") { body.his_photo_at = 0; done = "已清掉：以后会重新问他长什么样"; }
  else if (kind === "herPhoto") { body.her_photo_at = 0; done = "已清掉：给她看过的记录"; }
  try {
    await api("PUT", "/contacts", body);
    showToast(done);
    await loadCustomers();
    const fresh = (state.groups || []).find((entry) => entry.id === group.id) || group;
    state.selected = fresh;
    updateChatHeader();
  } catch (error) {
    showToast("操作失败：" + error.message, "error");
  }
}

async function renderTakeoverAlerts(group) {
  const host = $("takeoverList");
  if (!host) return;
  const countHost = $("takeoverCount");
  if (!group) {
    if (countHost) countHost.textContent = "";
    host.innerHTML = '<div class="flag-none">暂无</div>';
    return;
  }
  try {
    const data = await api("GET", `/takeover-alerts?token=${encodeURIComponent(group.token)}&contact_name=${encodeURIComponent(group.display_name)}`);
    const alerts = data.alerts || [];
    if (countHost) countHost.textContent = alerts.length ? alerts.length + " 条" : "";
    host.innerHTML = alerts.length
      ? alerts.map((item) => `<div class="takeover-item"><b>${esc(takeoverKindText(item.kind))}${item.notified_at ? " · 已发邮件" : " · 邮件未发"}</b><p>${esc(String(item.content || "").slice(0, 60))}</p><span>${esc(formatFullTime(item.created_at))}</span></div>`).join("")
      : '<div class="flag-none">暂无</div>';
  } catch (error) {
    host.innerHTML = '<div class="flag-none">读取失败：' + esc(error.message) + "</div>";
  }
}

function profileText(value, fallback = "未收集") {
  if (Array.isArray(value)) return value.filter(Boolean).join("、") || fallback;
  const text = String(value ?? "").trim();
  return text || fallback;
}

function renderProfileIdentity(profileState) {
  state.currentProfileState = profileState;
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
  $("profileUpdated").textContent = profileState?.updated_at ? `已更新 ${formatShortTime(profileState.updated_at)}` : "点击文字可直接修改";
  attachProfileInlineEditors();
}

function attachProfileInlineEditors() {
  document.querySelectorAll(".field-value.editable").forEach((elem) => {
    elem.onclick = (e) => {
      e.stopPropagation();
      if (elem.querySelector("input")) return;
      const currentText = elem.textContent === "未收集" ? "" : elem.textContent.trim();
      const section = elem.dataset.section;
      const field = elem.dataset.field;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "inline-edit-input";
      input.value = currentText;
      elem.textContent = "";
      elem.appendChild(input);
      input.focus();
      input.select();

      let committed = false;
      async function commit() {
        if (committed) return;
        committed = true;
        const val = input.value.trim();
        elem.textContent = val || "未收集";
        if (val !== currentText) {
          await saveProfileField(section, field, val);
        }
      }

      input.onblur = commit;
      input.onkeydown = (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          commit();
        } else if (ev.key === "Escape") {
          committed = true;
          elem.textContent = currentText || "未收集";
        }
      };
    };
  });
}

async function saveProfileField(section, field, value) {
  const group = state.selected;
  if (!group) return;
  const patch = {};
  if (section === "notes") {
    patch.notes = value ? [value] : [];
  } else if (section === "likes") {
    patch.preferences = { likes: value ? value.split(/[,，、 ]+/).filter(Boolean) : [] };
  } else if (section === "dislikes") {
    patch.preferences = { dislikes: value ? value.split(/[,，、 ]+/).filter(Boolean) : [] };
  } else if (section === "recent") {
    patch.recent = { goals: value ? [value] : [] };
  } else if (section === "basic") {
    patch.basic = { [field]: value };
  } else if (section === "location") {
    patch.location = { [field]: value };
  } else if (section === "education") {
    patch.education = { [field]: value };
  } else if (section === "work") {
    patch.work = { [field]: value };
  } else if (section === "family") {
    patch.family = { [field]: value };
  } else if (section === "relationship") {
    patch.relationship = { [field]: value };
  } else {
    patch[section] = { [field]: value };
  }
  try {
    const res = await api("POST", "/customer-profile", {
      token: group.token,
      group_id: group.id,
      profile: patch,
    });
    if (res && res.success) {
      showToast("客户资料已保存");
      if (state.currentProfileState) {
        state.currentProfileState.profile = res.profile;
        renderProfileIdentity(state.currentProfileState);
      }
    }
  } catch (err) {
    showToast("保存失败：" + err.message, "error");
  }
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

// 非文字消息（语音/图片/表情/动态）渲染成带说明的标签，运营不用点开就知道对面发了什么。
function messageBody(message) {
  const raw = String(message.content || "").trim();
  const leading = (value) => String(value || "").replace(/^(?:\[[^\]\n]{1,8}\]\s*)+/u, "").trim();
  const chip = (name, text) => ({ chip: name, text: String(text || "").trim() });
  let match;
  // 2026-10-07 方案A：转写单独存，看板把语音显示成“语音 + 转写文字”。
  const storedTranscript = String(message.transcript || "").trim();
  if (storedTranscript && /^\[语音\]$/u.test(raw)) return chip("语音", storedTranscript);
  if ((match = raw.match(/^\[语音(?::([^\]]*))?\]\s*([\s\S]*)$/))) return chip("语音" + (match[1] ? "：" + match[1] : ""), match[2] || storedTranscript);
  if ((match = raw.match(/^\[图片(?::([^\]]*))?\]\s*([\s\S]*)$/))) return chip("图片", leading(match[2]) || match[1] || "");
  if ((match = raw.match(/^\[(?:表情|Soul互动表情)(?::([^\]]*))?\]\s*([\s\S]*)$/))) return chip("表情" + (match[1] ? "：" + match[1] : ""), leading(match[2]));
  if (/^\[(?:对方转发了|你转发了|转发了)/.test(raw)) return chip("动态卡片", raw.slice(0, 80));
  if ((match = raw.match(/^\[([^\]\n]{1,8})\]\s*([\s\S]*)$/))) return chip(match[1], leading(match[2]));
  if (!raw) return chip("未知非文字消息", "");
  return null;
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
    const body = messageBody(message);
    const bubble = body
      ? `<div class="bubble content-bubble"><span class="content-chip">${esc(body.chip)}</span>${body.text ? `<span class="content-rest">${esc(body.text)}</span>` : ""}</div>`
      : `<div class="bubble">${esc(message.content || "")}</div>`;
    const kind = kindLabel(message.time_kind);
    return `${separator}
      <div class="message-row ${side}">
        <div class="message-block">
          ${bubble}
          <div class="message-meta">
            <span>${esc(formatFullTime(message.created_at))}</span>
            ${kind ? `<span class="kind-label kind-${esc(String(message.time_kind || ""))}">${esc(kind)}</span>` : ""}
            <span class="source-label ${message.role === "assistant" ? (message.source === "manual" ? "source-manual" : "source-ai") : "source-user"}">${esc(message.role === "assistant" ? (message.source === "manual" ? "人工回复" : "AI 自动") : "客户发来")}</span>
            <span class="platform-label pf-${esc(String(message.platform || '').toLowerCase())}">${esc(platformName(message.platform))}</span>
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
    const data = await api("GET", "/persona?include_prompt=1");
    const personas = data.personas || [];
    $("personaList").innerHTML = personas.map((persona) => {
      const drawers = persona.drawers || { topics: [], counters: [] };
      const topicItems = drawers.topics || [];
      const counterItems = drawers.counters || [];
      return `
        <div class="persona-card ${persona.is_active ? "active" : ""}">
          <h3>${esc(persona.name)}${persona.is_active ? " · 当前使用" : ""}</h3>
          <p style="font-size:12px;color:var(--muted);">${esc((persona.system_prompt || "").slice(0, 90))}...</p>
          <div class="drawer-section">
            <strong style="font-size:13px;">生活画面与接招抽屉（按需触发，命中才调用）：</strong>
            <div style="margin-top:6px;">
              ${[...topicItems, ...counterItems].map((item, idx) => `
                <div class="drawer-item" data-drawer-idx="${idx}">
                  <div style="font-weight:bold;font-size:12px;display:flex;justify-content:space-between;">
                    <span>🏷️ ${esc(item.name)}</span>
                    <span style="color:var(--muted);font-weight:normal;">触发词: ${esc((item.keywords || []).join(","))}</span>
                  </div>
                  <div style="font-size:12px;color:#333;">${esc(item.content)}</div>
                </div>
              `).join("")}
            </div>
          </div>
          <div class="persona-actions" style="margin-top:10px;">
            ${persona.is_active ? "" : `<button class="primary-button" data-persona-id="${esc(persona.id)}">设为当前使用</button>`}
          </div>
        </div>`;
    }).join("");
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
    $("tokenList").innerHTML = `<table><thead><tr><th>设备名称</th><th>设备密钥</th><th>月上限</th><th>已使用</th><th>状态</th><th>最后使用</th><th>额度操作</th></tr></thead><tbody>` +
      state.tokens.map((token) => {
        const lastUsed = token.last_used_at ? new Date(token.last_used_at * 1000).toLocaleString("zh-CN") : "从未";
        const isUnlimited = Number(token.monthly_limit) < 0;
        const limitDisplay = isUnlimited
          ? `<span style="color:var(--brand,#2563eb);font-weight:600;">无限</span>`
          : `¥${Number(token.monthly_limit || 0)}`;
        return `<tr>
          <td>${esc(token.name || "未命名")}</td>
          <td style="font-family:monospace;font-size:12px;">${esc(token.token)}</td>
          <td>${limitDisplay}</td>
          <td>¥${Number(token.spent || 0).toFixed(2)}</td>
          <td>${token.is_active ? "启用" : "停用"}</td>
          <td style="font-size:12px;color:var(--muted);">${esc(lastUsed)}</td>
          <td>
            <div style="display:flex;gap:6px;align-items:center;">
              <button class="ghost-button small-button" data-token-reset="${esc(token.token)}" title="清零本月已用费用">清零已用</button>
              ${isUnlimited
                ? `<button class="ghost-button small-button" data-token-limit="${esc(token.token)}" data-value="30">设为30元</button>`
                : `<button class="primary-button small-button" data-token-limit="${esc(token.token)}" data-value="-1">设为无限</button>`
              }
            </div>
          </td>
        </tr>`;
      }).join("") + `</tbody></table>`;

    $("tokenList").querySelectorAll("[data-token-reset]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const token = btn.dataset.tokenReset;
        try {
          await api("PUT", "/token", { token, reset_spent: true });
          showToast("已清零已使用额度");
          openTokenModal();
        } catch (error) {
          showToast(error.message, "error");
        }
      });
    });

    $("tokenList").querySelectorAll("[data-token-limit]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const token = btn.dataset.tokenLimit;
        const targetLimit = Number(btn.dataset.value);
        try {
          await api("PUT", "/token", { token, monthly_limit: targetLimit });
          showToast(targetLimit < 0 ? "已设为无限额度" : `已设为上限 ¥${targetLimit}`);
          openTokenModal();
        } catch (error) {
          showToast(error.message, "error");
        }
      });
    });
  } catch (error) {
    $("tokenList").innerHTML = `<div class="section-empty">${esc(error.message)}</div>`;
  }
}

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
