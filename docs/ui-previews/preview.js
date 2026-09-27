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
  const modeGroup = document.querySelector("[data-mode-group]");
  const modeButtons = [...document.querySelectorAll("[data-mode]")];
  const modeHint = document.querySelector("[data-mode-hint]");
  const modeNote = document.querySelector("[data-mode-note]");
  const connectionText = document.querySelector("[data-connection-text]");
  const platformToggle = document.querySelector('[data-platform="soul"]');
  const platformState = document.querySelector("[data-platform-state]");
  const personaButtons = [...document.querySelectorAll("[data-persona]")];
  const saveAddressButton = document.querySelector("[data-save-address]");
  const toast = document.querySelector("[data-toast]");
  const clocks = [...document.querySelectorAll("[data-clock]")];

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

  const personaNames = {
    xingmu: "星暮",
    wanqing: "晚晴",
    ajie: "阿杰",
    zichuan: "子川"
  };

  let hosting = false;
  let mode = "full";
  let platformConnected = true;
  let selectedPersona = "xingmu";

  const requestedHosting = params.get("hosting") === "on";
  hosting = requestedHosting;

  const requestedMode = params.get("mode");
  if (requestedMode && modeCopy[requestedMode]) mode = requestedMode;

  const requestedPersona = params.get("persona");
  if (requestedPersona && personaNames[requestedPersona]) selectedPersona = requestedPersona;

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function renderHosting() {
    const copy = modeCopy[mode];
    const connected = platformConnected;

    hostingButton?.classList.toggle("active", hosting);
    hostingButton?.setAttribute("aria-pressed", String(hosting));
    hostingHero?.classList.toggle("active", hosting && connected);
    hostingHero?.classList.toggle("disconnected", !connected);

    if (hostingSubtitle) {
      hostingSubtitle.textContent = hosting
        ? copy.subtitle
        : "开启后才会开始扫描消息，关闭时不会操作手机。";
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
      connectionText.textContent = !connected
        ? "平台未连接"
        : hosting
          ? "托管运行中"
          : "平台已连接";
    }

    const locked = !hosting || !connected;
    modeGroup?.classList.toggle("mode-grid--locked", locked);
    if (modeHint) {
      modeHint.textContent = !connected
        ? "连接平台后可选择"
        : hosting
          ? "点击切换"
          : "开启后可选择";
    }

    modeButtons.forEach((button) => {
      button.setAttribute("aria-disabled", String(locked));
    });
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
    personaButtons.forEach((button) => {
      const selected = button.dataset.persona === selectedPersona;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
  }

  function setSwitchState(button, enabled) {
    button.setAttribute("aria-pressed", String(enabled));
    button.querySelector(".toggle")?.classList.toggle("on", enabled);
    const state = button.querySelector(".row-state");
    if (state) state.textContent = enabled ? "已开启" : "已关闭";
  }

  hostingButton?.addEventListener("click", () => {
    if (!platformConnected) {
      showToast("请先连接 Soul 后再开启托管");
      return;
    }
    hosting = !hosting;
    renderHosting();
    showToast(hosting ? "AI 托管已开启" : "AI 托管已关闭，当前不会操作手机");
  });

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!hosting || !platformConnected) {
        showToast("请先开启 AI 托管再选择处理方式");
        return;
      }
      mode = button.dataset.mode;
      renderMode();
      showToast(`已切换到${button.querySelector("strong")?.textContent || "托管方式"}`);
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

  personaButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (!platformConnected) {
        showToast("平台未连接，暂时不能切换人设");
        return;
      }
      selectedPersona = button.dataset.persona;
      renderPersona();
      showToast(`当前客服已切换为${personaNames[selectedPersona]}`);
    });
  });

  platformToggle?.addEventListener("click", () => {
    platformConnected = !platformConnected;
    platformToggle.setAttribute("aria-pressed", String(platformConnected));
    platformToggle.classList.toggle("off", !platformConnected);
    if (platformState) platformState.textContent = platformConnected ? "已连接" : "点击连接";
    if (!platformConnected) hosting = false;
    renderHosting();
    showToast(platformConnected ? "Soul 已连接" : "Soul 已断开");
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

  function renderClock() {
    const time = new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
    clocks.forEach((clock) => {
      clock.textContent = time;
    });
  }

  renderMode();
  renderPersona();
  renderClock();
  window.setInterval(renderClock, 30_000);

  if (window.lucide) {
    window.lucide.createIcons({
      attrs: {
        "stroke-width": 1.8
      }
    });
  }
})();
