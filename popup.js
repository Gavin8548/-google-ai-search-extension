"use strict";

const statusEl = document.querySelector(".status");
const errorEl = document.getElementById("error");
const codeEl = document.getElementById("code");

function renderQuota(quota) {
  if (!quota) {
    statusEl.textContent = "无法读取额度";
    return;
  }
  if (quota.unlocked) {
    statusEl.textContent = "已解锁，不限制每日次数";
    return;
  }
  statusEl.textContent = "今日剩余 " + quota.remaining + "/" + quota.limit + " 次";
}

chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
  renderQuota(response && response.quota);
});

document.getElementById("unlock").addEventListener("click", () => {
  errorEl.textContent = "";
  chrome.runtime.sendMessage({ type: "ACTIVATE", code: codeEl.value }, (response) => {
    if (!response || !response.ok) {
      errorEl.textContent = (response && response.error) || "激活失败";
      return;
    }
    renderQuota(response.quota);
  });
});
