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
