(() => {
  const params = new URLSearchParams(window.location.search);
  const requestedTheme = params.get("theme") || "sky";
  const allowedThemes = new Set(["sky"]);
  const theme = allowedThemes.has(requestedTheme) ? requestedTheme : "sky";
  document.body.dataset.theme = theme;

  document.querySelectorAll("[data-preview-link]").forEach((link) => {
    const active = link.dataset.previewLink === theme;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
  });

  const hostingButton = document.querySelector("[data-hosting-toggle]");
  const hostingSubtitle = document.querySelector("[data-hosting-subtitle]");
  const hostingButtonLabel = document.querySelector("[data-hosting-button-label]");
  const hostingButtonNote = document.querySelector("[data-hosting-button-note]");
  const hostingHero = document.querySelector("[data-hosting-hero]");
  const modeButtons = [...document.querySelectorAll("[data-mode]")];
  const modeHint = document.querySelector("[data-mode-hint]");
  const modeNote = document.querySelector("[data-mode-note]");
  const connectionText = document.querySelector("[data-connection-text]");
  const platformButtons = [...document.querySelectorAll("[data-platform]")];
  const hostingPlatform = document.querySelector("[data-hosting-platform]");
  const personaSelect = document.querySelector("[data-persona-select]");
  const personaAvatar = document.querySelector("[data-persona-avatar]");
  const personaName = document.querySelector("[data-persona-name]");
  const personaTag = document.querySelector("[data-persona-tag]");
  const saveAddressButton = document.querySelector("[data-save-address]");
  const toast = document.querySelector("[data-toast]");
  const platformNames = {
    soul: "Soul",
    qq: "QQ",
    momo: "陌陌",
    lianxin: "连信"
  };

  const modeCopy = {
    full: {
      title: "全自动托管已开启",
      subtitle: "自动扫描未读消息、生成回复、发送后继续下一位。",
      buttonNote: "再次点击可关闭托管",
      note: "全自动：读取未读消息，发送回复，然后返回消息列表继续扫描。"
    },
    semi: {
      title: "半自动托管已开启",
      subtitle: "自动生成内容并填入聊天框，由你确认后发送。",
      buttonNote: "再次点击可关闭托管",
      note: "半自动：只生成回复并填入聊天框，不会自动发送。"
    },
    monitor: {
      title: "仅记录模式已开启",
      subtitle: "只同步当前聊天内容，不点击、不滑动、不发送。",
      buttonNote: "再次点击可关闭托管",
      note: "仅记录：只同步你当前打开的聊天记录，不执行任何界面操作。"
    }
  };

  const personaProfiles = {
    xingmu: { name: "星暮", avatar: "星", tag: "女客服 · 自然亲切" },
    wanqing: { name: "晚晴", avatar: "晚", tag: "女客服 · 柔和耐心" },
    ajie: { name: "阿杰", avatar: "杰", tag: "男客服 · 爽快直接" },
    zichuan: { name: "子川", avatar: "川", tag: "男客服 · 沉稳简洁" }
  };

  let hosting = false;
  let mode = "full";
  let selectedPlatform = platformNames[params.get("platform")] ? params.get("platform") : "soul";
  let selectedPersona = personaProfiles[params.get("persona")] ? params.get("persona") : "xingmu";

  const requestedHosting = params.get("hosting") === "on";
  hosting = requestedHosting;

  const requestedMode = params.get("mode");
  if (requestedMode && modeCopy[requestedMode]) mode = requestedMode;


  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function renderHosting() {
    const copy = modeCopy[mode];
    const connected = true;

    hostingButton?.classList.toggle("active", hosting);
    hostingButton?.setAttribute("aria-pressed", String(hosting));
    hostingHero?.classList.toggle("active", hosting && connected);
    hostingHero?.classList.toggle("disconnected", false);

    if (hostingSubtitle) {
      hostingSubtitle.textContent = hosting
        ? copy.subtitle
        : "先选择下方托管方式，再开启 AI 托管。";
    }
    if (hostingButtonLabel) {
      hostingButtonLabel.textContent = hosting ? "已开启 AI 托管" : "请开启 AI 托管";
    }
    if (hostingButtonNote) {
      hostingButtonNote.textContent = hosting
        ? copy.buttonNote
        : "点击这一整块即可开启";
    }
    if (connectionText) {
      connectionText.textContent = hosting
        ? `${platformNames[selectedPlatform]} 托管运行中`
        : `${platformNames[selectedPlatform]} 已选择`;
    }

    if (modeHint) {
      modeHint.textContent = hosting ? "可随时切换" : "先选模式，再开托管";
    }
  }

  function renderMode() {
    modeButtons.forEach((button) => {
      const selected = button.dataset.mode === mode;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    if (modeNote) modeNote.textContent = modeCopy[mode].note;
    renderHosting();
  }

  function renderPersona() {
    const profile = personaProfiles[selectedPersona];
    if (personaSelect) personaSelect.value = selectedPersona;
    if (personaAvatar) personaAvatar.textContent = profile.avatar;
    if (personaName) personaName.textContent = profile.name;
    if (personaTag) personaTag.textContent = profile.tag;
  }

  function renderPlatform() {
    platformButtons.forEach((button) => {
      const selected = button.dataset.platform === selectedPlatform;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
      const state = button.querySelector("small");
      if (state) state.textContent = selected ? "已选择" : "点击选择";
    });
    if (hostingPlatform) hostingPlatform.textContent = `${platformNames[selectedPlatform]} · 消息自动接待`;
    renderHosting();
  }

  function setSwitchState(button, enabled) {
    button.setAttribute("aria-pressed", String(enabled));
    button.querySelector(".toggle")?.classList.toggle("on", enabled);
    const state = button.querySelector(".row-state");
    if (state) state.textContent = enabled ? "已开启" : "已关闭";
  }

  hostingButton?.addEventListener("click", () => {
    hosting = !hosting;
    renderHosting();
    showToast(hosting ? "AI 托管已开启" : "AI 托管已关闭，当前不会操作手机");
  });

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      mode = button.dataset.mode;
      renderMode();
      const modeName = button.querySelector("strong")?.textContent || "托管方式";
      showToast(hosting ? `已切换到${modeName}` : `已选择${modeName}，开启托管后生效`);
    });
  });

  document.querySelectorAll("[data-switch-row]").forEach((button) => {
    button.addEventListener("click", () => {
      const enabled = button.getAttribute("aria-pressed") !== "true";
      setSwitchState(button, enabled);
      const label = button.querySelector("strong")?.textContent || "设置";
      showToast(`${label}${enabled ? "已开启" : "已关闭"}`);
    });
  });

  personaSelect?.addEventListener("change", () => {
    selectedPersona = personaSelect.value;
    renderPersona();
    showToast(`当前客服已切换为${personaProfiles[selectedPersona].name}`);
  });

  platformButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedPlatform = button.dataset.platform;
      renderPlatform();
      showToast(`已选择${platformNames[selectedPlatform]}`);
    });
  });

  saveAddressButton?.addEventListener("click", () => {
    const homeAddress = document.querySelector("#home-address")?.value.trim();
    const workAddress = document.querySelector("#work-address")?.value.trim();
    if (!homeAddress || !workAddress) {
      showToast("家庭地址和工作地址都不能为空");
      return;
    }
    showToast("地址已保存，后续可以随时修改");
  });

  renderMode();
  renderPersona();
  renderPlatform();
  document.documentElement.dataset.previewReady = "true";

  if (window.lucide) {
    window.lucide.createIcons({
      attrs: {
        "stroke-width": 1.8
      }
    });
  }
})();
