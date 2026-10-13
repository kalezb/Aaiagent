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
