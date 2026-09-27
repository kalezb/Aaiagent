(() => {
  const params = new URLSearchParams(window.location.search);
  const theme = params.get("theme") || "obsidian";
  const allowedThemes = new Set(["obsidian", "mist", "jade"]);
  document.body.dataset.theme = allowedThemes.has(theme) ? theme : "obsidian";

  const hostingButton = document.querySelector("[data-hosting-toggle]");
  const hostingTitle = document.querySelector("[data-hosting-title]");
  const hostingSubtitle = document.querySelector("[data-hosting-subtitle]");
  const hostingHero = document.querySelector("[data-hosting-hero]");
  const modeButtons = [...document.querySelectorAll("[data-mode]")];
  const modeNote = document.querySelector("[data-mode-note]");
  const connectionText = document.querySelector("[data-connection-text]");
  const toast = document.querySelector("[data-toast]");
  const clock = document.querySelector("[data-clock]");

  const modeCopy = {
    full: {
      title: "全自动托管",
      subtitle: "自动读取并回复，处理完继续下一位",
      note: "自动读消息、生成回复、发送并返回列表。"
    },
    semi: {
      title: "半自动托管",
      subtitle: "自动生成内容，由你确认后发送",
      note: "只把建议内容填入聊天框，不会自动发送。"
    },
    monitor: {
      title: "仅记录",
      subtitle: "只读当前聊天，不点、不滑、不发送",
      note: "仅同步你当前打开的聊天记录，不操作任何界面。"
    }
  };

  let hosting = false;
  let mode = "full";
  const preferredMode = params.get("mode");
  if (preferredMode && modeCopy[preferredMode]) mode = preferredMode;

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function renderHosting() {
    if (!hostingButton || !hostingTitle || !hostingSubtitle || !hostingHero) return;
    hostingButton.classList.toggle("active", hosting);
    hostingButton.setAttribute("aria-pressed", String(hosting));
    hostingHero.classList.toggle("active", hosting);
    hostingTitle.textContent = hosting ? "已开启 AI 托管" : "开启 AI 托管";
    hostingSubtitle.textContent = hosting
      ? modeCopy[mode].subtitle
      : "开启后将按所选模式运行";
    if (connectionText) {
      connectionText.textContent = hosting ? "正在运行" : "平台已连接";
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

  hostingButton?.addEventListener("click", () => {
    hosting = !hosting;
    renderHosting();
    showToast(hosting ? "AI 托管已开启" : "AI 托管已关闭");
  });

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      mode = button.dataset.mode;
      renderMode();
      showToast(`已切换到${button.querySelector("strong")?.textContent || "托管模式"}`);
    });
  });

  document.querySelectorAll("[data-switch]").forEach((button) => {
    button.addEventListener("click", () => {
      const enabled = !button.classList.contains("on");
      button.classList.toggle("on", enabled);
      button.setAttribute("aria-pressed", String(enabled));
      const label = button.closest(".permission-row")?.querySelector("strong")?.textContent;
      showToast(`${label || "权限"}已${enabled ? "开启" : "关闭"}`);
    });
  });

  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-nav]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
    });
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => showToast(button.dataset.action));
  });

  function renderClock() {
    if (!clock) return;
    const now = new Date();
    clock.textContent = now.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }

  renderMode();
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
