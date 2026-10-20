"use strict";

/**
 * ---------------------------------------------------------------------------
 * 开发者开关（改版兜底）
 * ---------------------------------------------------------------------------
 * USE_BACKUP_API = false  → 模式一：由用户浏览器会话请求 Google HTML，再解析。
 * USE_BACKUP_API = true   → 模式二：走 SerpApi / ValueSERP 官方 JSON，不解析网页。
 *
 * 将 SERP_API_KEY 填入对应服务商的密钥后，再把 USE_BACKUP_API 设为 true。
 */
const USE_BACKUP_API = false;
const SERP_API_KEY = "";
/** @type {"serpapi" | "valueserp"} */
const SERP_PROVIDER = "serpapi";

const DAILY_LIMIT = 15;
const ACCEPT_LANGUAGE = "zh-CN,zh;q=0.9,en;q=0.8";

/** SHA-256("GASE-UNLOCK-2026")，激活码本身不明文存放 */
const ACTIVATION_HASH =
  "05de50c4dea63186447c42e4cdafc0ef258fbebc8414b3a0ebe3cab721d4f40a";

const STORAGE = {
  quotaDate: "quotaDate",
  quotaUsed: "quotaUsed",
  unlocked: "proUnlocked",
};

const OFFSCREEN_URL = "offscreen.html";
const OFFSCREEN_REASON = "DOM_PARSER";

chrome.runtime.onInstalled.addListener(() => {
  console.info("[划词搜索] installed", { USE_BACKUP_API, provider: SERP_PROVIDER });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type === "OFFSCREEN_PARSE") return;
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error("[划词搜索]", error);
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : "未知错误",
      });
    });
  return true;
});

async function handleMessage(message) {
  switch (message && message.type) {
    case "GET_STATUS":
      return getStatus();
    case "ACTIVATE":
      return activateCode(String(message.code || ""));
    case "SEARCH":
      return runSearch(String(message.query || "").trim());
    default:
      return { ok: false, error: "未知消息类型" };
  }
}

/**
 * 模式路由：备份 API 或 Google HTML。
 * 请求使用当前扩展对 google.com 的 host 权限，并带上用户已有会话（credentials: include）。
 * 不伪造 User-Agent / Client Hints，也不改写 Referer。
 */
async function runSearch(query) {
  if (!query) {
    return { ok: false, error: "请先选中要搜索的文本" };
  }

  const status = await peekQuota();
  if (!status.unlocked && status.remaining <= 0) {
    return {
      ok: false,
      needActivate: true,
      error: "今日高级搜索次数已用完",
      quota: status,
    };
  }

  try {
    const payload = USE_BACKUP_API
      ? await fetchViaBackupApi(query)
      : await fetchGoogleSearch(query);
    const quota = await consumeQuota();

    return {
      ok: true,
      query,
      source: payload.source,
      aiText: payload.aiText,
      results: payload.results,
      quota,
    };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : "搜索失败",
      quota: await peekQuota(),
    };
  }
}

/**
 * 模式一：请求 Google 搜索页 HTML，交由 offscreen 文档用 DOMParser 解析。
 * MV3 service worker 没有 DOM，因此解析必须放在 offscreen。
 */
async function fetchGoogleSearch(query) {
  const url =
    "https://www.google.com/search?q=" +
    encodeURIComponent(query) +
    "&hl=zh-CN&lr=lang_zh-CN";

  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": ACCEPT_LANGUAGE,
    },
  });

  if (!response.ok) {
    throw new Error("Google 搜索请求失败（HTTP " + response.status + "）");
  }

  const html = await response.text();
  const parsed = await parseHtmlOffscreen(html);

  if (parsed.blocked) {
    throw new Error(
      parsed.blockReason ||
        "Google 返回了验证或同意页。可在浏览器打开 google.com 完成验证，或将 USE_BACKUP_API 设为 true 并填写 SERP_API_KEY。"
    );
  }

  const aiText = parsed.aiText || composeSummary(parsed.results, query);
  const results = (parsed.results || []).slice(0, 3);

  if (!aiText && results.length === 0) {
    throw new Error("未能从搜索页提取到结果，页面结构可能已变化。");
  }

  return { source: "google-html", aiText, results };
}

/**
 * 模式二：专业 SERP JSON。开发者打开 USE_BACKUP_API 并填写密钥后走此分支。
 */
async function fetchViaBackupApi(query) {
  if (!SERP_API_KEY) {
    throw new Error("已启用备份 API，但 SERP_API_KEY 为空。");
  }

  if (SERP_PROVIDER === "valueserp") {
    return fetchValueSerp(query);
  }
  return fetchSerpApi(query);
}

async function fetchSerpApi(query) {
  const url =
    "https://serpapi.com/search.json?" +
    new URLSearchParams({
      engine: "google",
      q: query,
      hl: "zh-CN",
      gl: "cn",
      api_key: SERP_API_KEY,
    }).toString();

  const data = await fetchJson(url);
  if (data.error) {
    throw new Error(String(data.error));
  }

  return {
    source: "serpapi",
    aiText: extractStructuredAnswer(data, query),
    results: normalizeOrganic(data.organic_results),
  };
}

async function fetchValueSerp(query) {
  const url =
    "https://api.valueserp.com/search?" +
    new URLSearchParams({
      q: query,
      hl: "zh-CN",
      gl: "cn",
      api_key: SERP_API_KEY,
    }).toString();

  const data = await fetchJson(url);
  if (data.request_info && data.request_info.success === false) {
    throw new Error(data.request_info.message || "ValueSERP 请求失败");
  }

  return {
    source: "valueserp",
    aiText: extractStructuredAnswer(data, query),
    results: normalizeOrganic(data.organic_results),
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", "Accept-Language": ACCEPT_LANGUAGE },
  });
  if (!response.ok) {
    throw new Error("聚合接口 HTTP " + response.status);
  }
  return response.json();
}

/**
 * 优先读取 ai_overview / answer_box，否则用前 3 条有机结果拼一段摘要。
 */
function extractStructuredAnswer(data, query) {
  const fromAi = flattenAiOverview(data.ai_overview);
  if (fromAi) return fromAi;

  const box = data.answer_box;
  if (box) {
    const parts = [
      box.title,
      box.answer,
      box.snippet,
      box.definition,
      Array.isArray(box.list) ? box.list.join("\n") : "",
    ].filter(Boolean);
    if (parts.length) return uniqueJoin(parts);
  }

  const kg = data.knowledge_graph;
  if (kg && (kg.description || kg.title)) {
    return uniqueJoin([kg.title, kg.type, kg.description]);
  }

  return composeSummary(normalizeOrganic(data.organic_results), query);
}

function flattenAiOverview(ai) {
  if (!ai) return "";
  if (typeof ai === "string") return ai.trim();
  if (ai.snippet) return String(ai.snippet).trim();

  const blocks = ai.text_blocks || ai.blocks || [];
  const lines = [];
  for (const block of blocks) {
    if (!block) continue;
    if (block.snippet) lines.push(block.snippet);
    if (block.paragraph) lines.push(block.paragraph);
    if (block.title && block.snippet !== block.title) lines.push(block.title);
    if (Array.isArray(block.list)) {
      for (const item of block.list) {
        const text =
          typeof item === "string"
            ? item
            : item.snippet || item.title || item.answer || "";
        if (text) lines.push("• " + text);
      }
    }
  }
  return uniqueJoin(lines);
}

function normalizeOrganic(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 3).map((item) => ({
    title: item.title || item.name || "",
    snippet: item.snippet || item.description || "",
    url: item.link || item.url || "",
  }));
}

function composeSummary(results, query) {
  const items = (results || []).filter((r) => r && (r.title || r.snippet));
  if (!items.length) return "";
  const chunks = items.map((r, i) => {
    const head = r.title || "结果 " + (i + 1);
    return r.snippet ? head + "：" + r.snippet : head;
  });
  return "关于「" + query + "」的检索摘要：\n\n" + chunks.join("\n\n");
}

function uniqueJoin(parts) {
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const text = String(part || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out.join("\n\n");
}

async function parseHtmlOffscreen(html) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ type: "OFFSCREEN_PARSE", html });
}

async function ensureOffscreen() {
  if (await offscreenExists()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [OFFSCREEN_REASON],
    justification: "在 MV3 中用 DOMParser 解析 Google 搜索页 HTML",
  });
}

async function offscreenExists() {
  if (chrome.offscreen.hasDocument) {
    return chrome.offscreen.hasDocument();
  }
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  return contexts && contexts.length > 0;
}

async function getStatus() {
  const quota = await peekQuota();
  return { ok: true, quota, useBackupApi: USE_BACKUP_API };
}

async function peekQuota() {
  const unlocked = await isUnlocked();
  if (unlocked) {
    return {
      unlocked: true,
      limit: DAILY_LIMIT,
      used: 0,
      remaining: -1,
    };
  }
  const state = await readQuotaState();
  return {
    unlocked: false,
    limit: DAILY_LIMIT,
    used: state.used,
    remaining: Math.max(0, DAILY_LIMIT - state.used),
  };
}

async function consumeQuota() {
  if (await isUnlocked()) {
    return { ok: true, unlocked: true, remaining: -1, limit: DAILY_LIMIT, used: 0 };
  }
  const state = await readQuotaState();
  if (state.used >= DAILY_LIMIT) {
    return {
      ok: false,
      unlocked: false,
      remaining: 0,
      limit: DAILY_LIMIT,
      used: state.used,
    };
  }
  const used = state.used + 1;
  await chrome.storage.local.set({
    [STORAGE.quotaDate]: state.today,
    [STORAGE.quotaUsed]: used,
  });
  return {
    ok: true,
    unlocked: false,
    remaining: DAILY_LIMIT - used,
    limit: DAILY_LIMIT,
    used,
  };
}

async function readQuotaState() {
  const today = localDateKey();
  const data = await chrome.storage.local.get([
    STORAGE.quotaDate,
    STORAGE.quotaUsed,
  ]);
  if (data[STORAGE.quotaDate] !== today) {
    return { today, used: 0 };
  }
  return { today, used: Number(data[STORAGE.quotaUsed] || 0) };
}

function localDateKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

async function isUnlocked() {
  const data = await chrome.storage.local.get(STORAGE.unlocked);
  return Boolean(data[STORAGE.unlocked]);
}

async function activateCode(code) {
  const normalized = code.trim().toUpperCase();
  if (!normalized) {
    return { ok: false, error: "请输入激活码" };
  }
  const hash = await sha256Hex(normalized);
  if (hash !== ACTIVATION_HASH) {
    return { ok: false, error: "激活码无效" };
  }
  await chrome.storage.local.set({ [STORAGE.unlocked]: true });
  return { ok: true, quota: await peekQuota() };
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
