"use strict";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "OFFSCREEN_PARSE") return;
  try {
    sendResponse(parseGoogleHtml(String(message.html || "")));
  } catch (error) {
    sendResponse({
      blocked: true,
      blockReason: error && error.message ? error.message : "解析失败",
      aiText: "",
      results: [],
    });
  }
  return true;
});

function parseGoogleHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocked = detectBlocked(doc, html);
  if (blocked) {
    return { blocked: true, blockReason: blocked, aiText: "", results: [] };
  }

  stripNoise(doc);
  const aiText = extractAiOverview(doc);
  const results = extractOrganicResults(doc);
  return { blocked: false, aiText, results };
}

function detectBlocked(doc, html) {
  const href = (doc.location && doc.location.href) || "";
  const title = (doc.title || "").toLowerCase();
  const sample = html.slice(0, 4000).toLowerCase();

  if (/\/sorry\//.test(href) || /unusual traffic|非正常流量|our systems have detected/.test(sample)) {
    return "搜索页被流量验证拦截";
  }
  if (title.includes("before you continue") || sample.includes("consent.google.com")) {
    return "需要先在浏览器中完成 Google 同意页";
  }
  if (doc.querySelector("#captcha-form, recaptcha, #recaptcha")) {
    return "搜索页出现验证码";
  }
  return "";
}

function stripNoise(doc) {
  doc.querySelectorAll("script, style, noscript, svg, iframe").forEach((el) => el.remove());
}

/**
 * 多选择器兜底：Google AI Overviews 容器类名经常改，按特征逐级尝试。
 */
function extractAiOverview(doc) {
  const selectors = [
    "[data-attrid='WAIyAb']",
    "div.M8OgIe",
    "div.hdzaWe",
    "div.d4wtkb",
    "div.LT6XE",
    "block-component",
    ".VkpGBb",
    "div[jsname='ZWmz7']",
    "div.f5cPye",
    "[aria-label*='AI 概览']",
    "[aria-label*='AI Overview']",
    "[aria-label*='AI overview']",
  ];

  for (const selector of selectors) {
    const node = doc.querySelector(selector);
    const text = visibleText(node);
    if (text && text.length >= 40) return text;
  }

  const flagged = [...doc.querySelectorAll("div, section")].find((el) => {
    const label = (
      (el.getAttribute("aria-label") || "") +
      " " +
      (el.getAttribute("data-attrid") || "")
    ).toLowerCase();
    return label.includes("ai overview") || label.includes("ai 概览") || label.includes("waiyab");
  });
  const flaggedText = visibleText(flagged);
  if (flaggedText && flaggedText.length >= 40) return flaggedText;

  return "";
}

function extractOrganicResults(doc) {
  const results = [];
  const seen = new Set();
  const cards = doc.querySelectorAll("div.tF2Cxc, div.g, div.MjjYud, div[data-sokoban-container]");

  cards.forEach((card) => {
    if (results.length >= 3) return;
    const heading = card.querySelector("h3");
    if (!heading) return;
    const title = heading.textContent.trim();
    if (!title || seen.has(title)) return;

    const link =
      (heading.closest("a") && heading.closest("a").href) ||
      (card.querySelector("a[href]") && card.querySelector("a[href]").href) ||
      "";
    if (isGoogleInternal(link)) return;

    const snippetNode = card.querySelector(".VwiC3b, .IsZvec, [data-snf], .aCOpRe, .yXK7lf");
    const snippet = visibleText(snippetNode) || fallbackSnippet(card, title);

    seen.add(title);
    results.push({ title, snippet, url: sanitizeUrl(link) });
  });

  return results;
}

function fallbackSnippet(card, title) {
  const text = visibleText(card).replace(title, "").trim();
  return text.slice(0, 240);
}

function visibleText(node) {
  if (!node) return "";
  const text = (node.innerText || node.textContent || "").replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  return text.replace(/\n{3,}/g, "\n\n");
}

function isGoogleInternal(url) {
  if (!url) return true;
  try {
    const host = new URL(url, "https://www.google.com").hostname;
    return host === "www.google.com" || host === "google.com" || host.endsWith(".google.com");
  } catch (_e) {
    return true;
  }
}

function sanitizeUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url, "https://www.google.com");
    if (parsed.pathname === "/url") {
      return parsed.searchParams.get("q") || parsed.searchParams.get("url") || parsed.toString();
    }
    return parsed.toString();
  } catch (_e) {
    return url;
  }
}
