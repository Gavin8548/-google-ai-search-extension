"use strict";

(function () {
  if (window.__gaseInjected) return;
  window.__gaseInjected = true;

  const HOST_ID = "gase-root-host";
  let host;
  let shadow;
  let panel;
  let aiBody;
  let webBody;
  let quotaEl;
  let activeTab = "ai";
  let currentQuery = "";
  let drag = null;
  let lastSelection = "";

  const css = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "PingFang SC", "Noto Sans SC", system-ui, sans-serif; }
    .chip {
      position: fixed; z-index: 2147483646;
      display: none; align-items: center; gap: 6px;
      padding: 6px 10px; border: none; border-radius: 999px;
      background: #1a73e8; color: #fff; font-size: 12px; cursor: pointer;
      box-shadow: 0 8px 24px rgba(26,115,232,.35);
    }
    .chip:hover { background: #1558b0; }
    .panel {
      position: fixed; z-index: 2147483647;
      width: 380px; max-width: calc(100vw - 24px);
      display: none; flex-direction: column;
      background: #fff; color: #202124;
      border-radius: 16px; overflow: hidden;
      box-shadow: 0 16px 48px rgba(32,33,36,.22);
      border: 1px solid #e0e3e7;
    }
    .header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 12px; background: #1a73e8; color: #fff; cursor: move; user-select: none;
    }
    .title { font-size: 13px; font-weight: 650; letter-spacing: .02em; }
    .close {
      border: none; background: transparent; color: #fff; font-size: 18px;
      width: 28px; height: 28px; border-radius: 8px; cursor: pointer;
    }
    .close:hover { background: rgba(255,255,255,.16); }
    .tabs { display: flex; background: #f8f9fa; border-bottom: 1px solid #e0e3e7; }
    .tab {
      flex: 1; border: none; background: transparent; padding: 10px 8px;
      font-size: 13px; color: #5f6368; cursor: pointer; position: relative;
    }
    .tab.active { color: #1a73e8; font-weight: 650; }
    .tab.active::after {
      content: ""; position: absolute; left: 18%; right: 18%; bottom: 0;
      height: 2px; background: #1a73e8; border-radius: 2px 2px 0 0;
    }
    .bodies { min-height: 180px; max-height: 360px; overflow: auto; padding: 14px; }
    .pane { display: none; }
    .pane.active { display: block; }
    .ai-text { font-size: 13.5px; line-height: 1.7; white-space: pre-wrap; color: #202124; }
    .ai-text.fade { animation: gaseFade .35s ease; }
    @keyframes gaseFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .muted { color: #80868b; font-size: 13px; }
    .result { padding: 10px 0; border-bottom: 1px solid #f1f3f4; }
    .result:last-child { border-bottom: none; }
    .result a { color: #1a73e8; font-weight: 650; font-size: 13.5px; text-decoration: none; }
    .result a:hover { text-decoration: underline; }
    .snippet { margin-top: 4px; color: #5f6368; font-size: 12.5px; line-height: 1.55; }
    .footer {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 12px; font-size: 11px; color: #80868b; background: #fafafa;
      border-top: 1px solid #e0e3e7;
    }
    .modal {
      display: none; position: absolute; inset: 0; background: rgba(32,33,36,.45);
      align-items: center; justify-content: center; padding: 16px;
    }
    .modal.show { display: flex; }
    .dialog {
      width: 100%; background: #fff; border-radius: 12px; padding: 16px;
      box-shadow: 0 12px 32px rgba(0,0,0,.2);
    }
    .dialog h3 { margin: 0 0 8px; font-size: 15px; }
    .dialog p { margin: 0 0 12px; font-size: 12.5px; color: #5f6368; line-height: 1.5; }
    .dialog input {
      width: 100%; padding: 8px 10px; border: 1px solid #dadce0; border-radius: 8px;
      font-size: 13px; outline: none;
    }
    .dialog input:focus { border-color: #1a73e8; }
    .row { display: flex; gap: 8px; margin-top: 12px; }
    .btn {
      flex: 1; border: none; border-radius: 8px; padding: 8px; cursor: pointer; font-size: 13px;
    }
    .btn.primary { background: #1a73e8; color: #fff; }
    .btn.ghost { background: #f1f3f4; color: #202124; }
    .error { color: #d93025; font-size: 12px; margin-top: 8px; min-height: 16px; }
  `;

  function ensureUi() {
    if (host && document.documentElement.contains(host)) return;
    host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = HOST_ID;
      document.documentElement.appendChild(host);
    }
    shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>${css}</style>
      <button class="chip" type="button">划词搜索</button>
      <div class="panel" role="dialog" aria-label="划词搜索">
        <div class="header">
          <div class="title">划词搜索</div>
          <button class="close" type="button" title="关闭">×</button>
        </div>
        <div class="tabs">
          <button class="tab active" data-tab="ai" type="button">AI 释义</button>
          <button class="tab" data-tab="web" type="button">网页搜索</button>
        </div>
        <div class="bodies">
          <div class="pane active" data-pane="ai"><div class="ai-text muted">选中文本后开始搜索…</div></div>
          <div class="pane" data-pane="web"><div class="muted">等待搜索结果…</div></div>
        </div>
        <div class="footer">
          <span class="quota">今日额度加载中…</span>
          <span>可拖拽标题栏</span>
        </div>
        <div class="modal">
          <div class="dialog">
            <h3>解锁高级额度</h3>
            <p>免费版每天 15 次高级搜索。输入激活码后取消当日次数限制。</p>
            <input class="code" type="text" placeholder="请输入激活码" />
            <div class="error"></div>
            <div class="row">
              <button class="btn ghost cancel" type="button">取消</button>
              <button class="btn primary unlock" type="button">解锁</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const chip = shadow.querySelector(".chip");
    panel = shadow.querySelector(".panel");
    aiBody = shadow.querySelector('[data-pane="ai"]');
    webBody = shadow.querySelector('[data-pane="web"]');
    quotaEl = shadow.querySelector(".quota");

    chip.addEventListener("click", () => {
      chip.style.display = "none";
      openPanel(lastSelection);
    });
    shadow.querySelector(".close").addEventListener("click", closePanel);
    shadow.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    });
    shadow.querySelector(".cancel").addEventListener("click", () => toggleModal(false));
    shadow.querySelector(".unlock").addEventListener("click", submitActivation);

    const header = shadow.querySelector(".header");
    header.addEventListener("mousedown", startDrag);
    window.addEventListener("mousemove", onDrag);
    window.addEventListener("mouseup", endDrag);

    refreshStatus();
  }

  function startDrag(event) {
    if (event.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    drag = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
    };
    event.preventDefault();
  }

  function onDrag(event) {
    if (!drag) return;
    const x = Math.min(window.innerWidth - 80, Math.max(8, event.clientX - drag.dx));
    const y = Math.min(window.innerHeight - 40, Math.max(8, event.clientY - drag.dy));
    panel.style.left = x + "px";
    panel.style.top = y + "px";
    panel.style.right = "auto";
  }

  function endDrag() {
    drag = null;
  }

  function showChip() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      hideChip();
      return;
    }
    const text = sel.toString().trim();
    if (!text || text.length > 500) {
      hideChip();
      return;
    }
    lastSelection = text;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const chip = shadow.querySelector(".chip");
    chip.style.display = "flex";
    chip.style.left = Math.max(8, rect.left) + "px";
    chip.style.top = Math.max(8, rect.bottom + 8) + "px";
  }

  function hideChip() {
    const chip = shadow.querySelector(".chip");
    if (chip) chip.style.display = "none";
  }

  function openPanel(query) {
    currentQuery = query;
    panel.style.display = "flex";
    if (!panel.style.left) {
      panel.style.left = Math.max(24, window.innerWidth - 420) + "px";
      panel.style.top = "80px";
    }
    switchTab("ai");
    search(query);
  }

  function closePanel() {
    panel.style.display = "none";
    toggleModal(false);
  }

  function switchTab(tab) {
    activeTab = tab;
    shadow.querySelectorAll(".tab").forEach((el) => {
      el.classList.toggle("active", el.dataset.tab === tab);
    });
    shadow.querySelectorAll(".pane").forEach((el) => {
      el.classList.toggle("active", el.dataset.pane === tab);
    });
  }

  async function search(query) {
    aiBody.innerHTML = `<div class="ai-text muted">正在检索「${escapeHtml(query)}」…</div>`;
    webBody.innerHTML = `<div class="muted">正在拉取网页结果…</div>`;
    const response = await send({ type: "SEARCH", query });
    if (!response || !response.ok) {
      if (response && response.needActivate) {
        renderQuota(response.quota);
        toggleModal(true);
        aiBody.innerHTML = `<div class="muted">今日 15 次高级额度已用完，请激活后继续。</div>`;
        webBody.innerHTML = `<div class="muted">额度已用完。</div>`;
        return;
      }
      const err = (response && response.error) || "搜索失败";
      aiBody.innerHTML = `<div class="muted">${escapeHtml(err)}</div>`;
      webBody.innerHTML = `<div class="muted">${escapeHtml(err)}</div>`;
      renderQuota(response && response.quota);
      return;
    }

    renderQuota(response.quota);
    renderWeb(response.results || []);
    await renderAi(response.aiText || composeLocal(response.results || [], query));
  }

  function composeLocal(results, query) {
    if (!results.length) return "没有可用摘要。";
    return "关于「" + query + "」：\n\n" + results.map((r) => r.title + (r.snippet ? "：" + r.snippet : "")).join("\n\n");
  }

  async function renderAi(text) {
    const el = document.createElement("div");
    el.className = "ai-text fade";
    aiBody.innerHTML = "";
    aiBody.appendChild(el);
    const chunk = text.length > 480 ? 2 : 1;
    const delay = text.length > 480 ? 6 : 12;
    el.textContent = "";
    for (let i = 0; i < text.length; i += chunk) {
      el.textContent += text.slice(i, i + chunk);
      await sleep(delay);
      if (currentQuery && el.isConnected === false) return;
    }
  }

  function renderWeb(results) {
    if (!results.length) {
      webBody.innerHTML = `<div class="muted">没有解析到网页结果。</div>`;
      return;
    }
    webBody.innerHTML = results
      .map((item) => {
        const href = escapeAttr(item.url || "#");
        const title = escapeHtml(item.title || "未命名结果");
        const snippet = escapeHtml(item.snippet || "");
        return `<article class="result"><a href="${href}" target="_blank" rel="noopener noreferrer">${title}</a><div class="snippet">${snippet}</div></article>`;
      })
      .join("");
  }

  function renderQuota(quota) {
    if (!quotaEl) return;
    if (!quota) {
      quotaEl.textContent = "额度未知";
      return;
    }
    if (quota.unlocked) {
      quotaEl.textContent = "已解锁 · 不限次数";
      return;
    }
    quotaEl.textContent = "今日剩余 " + quota.remaining + "/" + quota.limit;
  }

  function toggleModal(show) {
    shadow.querySelector(".modal").classList.toggle("show", show);
    if (show) {
      shadow.querySelector(".code").value = "";
      shadow.querySelector(".error").textContent = "";
      shadow.querySelector(".code").focus();
    }
  }

  async function submitActivation() {
    const code = shadow.querySelector(".code").value;
    const result = await send({ type: "ACTIVATE", code });
    if (!result || !result.ok) {
      shadow.querySelector(".error").textContent = (result && result.error) || "激活失败";
      return;
    }
    toggleModal(false);
    renderQuota(result.quota);
    if (currentQuery) search(currentQuery);
  }

  async function refreshStatus() {
    const status = await send({ type: "GET_STATUS" });
    if (status && status.quota) renderQuota(status.quota);
  }

  function send(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response);
        });
      } catch (error) {
        resolve({ ok: false, error: error.message });
      }
    });
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/'/g, "&#39;");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  document.addEventListener("mouseup", () => {
    ensureUi();
    setTimeout(showChip, 10);
  });
  document.addEventListener("mousedown", (event) => {
    if (host && event.composedPath().includes(host)) return;
    hideChip();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanel();
  });

  ensureUi();
})();
