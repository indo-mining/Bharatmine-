"use strict";

/*
=========================================================
 BHARATMINE - TELEGRAM MINI APP
 Frontend Script
=========================================================
*/

const tg = window.Telegram && window.Telegram.WebApp
  ? window.Telegram.WebApp
  : null;

if (tg) {
  tg.ready();
  tg.expand();
}

/* ======================================================
   GLOBAL STATE
====================================================== */

let currentUser = null;
let miningTimer = null;
let miningRemaining = 0;
let loading = false;

/* ======================================================
   TELEGRAM AUTHENTICATION
====================================================== */

function getTelegramInitData() {
  if (!tg) {
    return "";
  }

  return tg.initData || "";
}

function isTelegramApp() {
  return !!(
    tg &&
    tg.initData &&
    tg.initData.length > 0
  );
}

/* ======================================================
   API REQUEST
====================================================== */

async function api(url, options = {}) {

  const initData = getTelegramInitData();

  const headers = {
    ...(options.headers || {})
  };

  /*
   IMPORTANT:
   server.js expects:
   x-telegram-init-data
  */

  headers["x-telegram-init-data"] = initData;

  if (
    options.body &&
    !headers["Content-Type"]
  ) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {

    const message =
      data.error ||
      `Request failed (${response.status})`;

    throw new Error(message);
  }

  return data;
}

/* ======================================================
   SAFE ELEMENT
====================================================== */

function $(id) {
  return document.getElementById(id);
}

/* ======================================================
   TOAST
====================================================== */

function showToast(message) {

  let toast = $("bharatmine-toast");

  if (!toast) {

    toast = document.createElement("div");

    toast.id = "bharatmine-toast";

    toast.style.position = "fixed";
    toast.style.left = "50%";
    toast.style.bottom = "80px";
    toast.style.transform = "translateX(-50%)";
    toast.style.zIndex = "99999";
    toast.style.padding = "12px 18px";
    toast.style.borderRadius = "12px";
    toast.style.background = "#111";
    toast.style.color = "#fff";
    toast.style.fontSize = "14px";
    toast.style.maxWidth = "90%";
    toast.style.textAlign = "center";
    toast.style.boxShadow =
      "0 8px 30px rgba(0,0,0,.25)";

    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.display = "block";

  clearTimeout(toast._timer);

  toast._timer = setTimeout(() => {
    toast.style.display = "none";
  }, 3000);
}

/* ======================================================
   FORMAT NUMBER
====================================================== */

function formatNumber(value) {

  const number = Number(value || 0);

  if (!Number.isFinite(number)) {
    return "0";
  }

  return number.toLocaleString(
    "en-IN",
    {
      maximumFractionDigits: 8
    }
  );
}

/* ======================================================
   FORMAT TIME
====================================================== */

function formatTime(seconds) {

  seconds = Math.max(
    0,
    Math.floor(Number(seconds || 0))
  );

  const hours =
    Math.floor(seconds / 3600);

  const minutes =
    Math.floor(
      (seconds % 3600) / 60
    );

  const secs =
    seconds % 60;

  return (
    String(hours).padStart(2, "0") +
    ":" +
    String(minutes).padStart(2, "0") +
    ":" +
    String(secs).padStart(2, "0")
  );
}

/* ======================================================
   UPDATE BALANCE
====================================================== */

function updateBalance(balance) {

  const value =
    formatNumber(balance);

  const elements = [
    "balance",
    "user-balance",
    "balanceValue",
    "bhmBalance"
  ];

  elements.forEach(id => {

    const element = $(id);

    if (element) {
      element.textContent = value;
    }

  });
}

/* ======================================================
   UPDATE USER
====================================================== */

function updateUser(user) {

  if (!user) {
    return;
  }

  currentUser = user;

  updateBalance(user.balance);

  const username =
    user.username
      ? `@${user.username}`
      : user.first_name || "BharatMine User";

  const nameElements = [
    "username",
    "user-name",
    "userName",
    "profileName"
  ];

  nameElements.forEach(id => {

    const element = $(id);

    if (element) {
      element.textContent = username;
    }

  });

  const firstName =
    user.first_name ||
    "Miner";

  const greetingElements = [
    "firstName",
    "first-name",
    "welcomeName"
  ];

  greetingElements.forEach(id => {

    const element = $(id);

    if (element) {
      element.textContent = firstName;
    }

  });
}

/* ======================================================
   UPDATE MINING UI
====================================================== */

function updateMiningUI(data) {

  if (!data) {
    return;
  }

  const mining =
    !!data.mining;

  const remaining =
    Number(
      data.remaining_seconds || 0
    );

  miningRemaining = remaining;

  const statusElements = [
    "miningStatus",
    "mining-status",
    "miningText"
  ];

  statusElements.forEach(id => {

    const element = $(id);

    if (!element) {
      return;
    }

    if (mining) {
      element.textContent =
        "Mining is active";
    } else {
      element.textContent =
        "Mining is ready";
    }

  });

  const timerElements = [
    "miningTimer",
    "mining-timer",
    "timer"
  ];

  timerElements.forEach(id => {

    const element = $(id);

    if (!element) {
      return;
    }

    element.textContent =
      mining
        ? formatTime(remaining)
        : "00:00:00";

  });

  const buttons = [
    "startMining",
    "start-mining",
    "miningButton"
  ];

  buttons.forEach(id => {

    const button = $(id);

    if (!button) {
      return;
    }

    if (mining) {

      button.disabled = true;

      button.textContent =
        "Mining Active";

    } else {

      button.disabled = false;

      button.textContent =
        "Start Mining";
    }

  });

  if (mining) {
    startLocalMiningTimer();
  } else {
    stopLocalMiningTimer();
  }
}

/* ======================================================
   LOCAL MINING TIMER
====================================================== */

function startLocalMiningTimer() {

  if (miningTimer) {
    return;
  }

  miningTimer = setInterval(() => {

    if (miningRemaining <= 0) {

      stopLocalMiningTimer();

      loadMe();

      return;
    }

    miningRemaining--;

    const timerElements = [
      "miningTimer",
      "mining-timer",
      "timer"
    ];

    timerElements.forEach(id => {

      const element = $(id);

      if (element) {
        element.textContent =
          formatTime(miningRemaining);
      }

    });

  }, 1000);
}

function stopLocalMiningTimer() {

  if (miningTimer) {

    clearInterval(
      miningTimer
    );

    miningTimer = null;
  }
}

/* ======================================================
   LOAD USER
====================================================== */

async function loadMe() {

  try {

    if (!isTelegramApp()) {

      showToast(
        "Please open BharatMine inside Telegram."
      );

      console.error(
        "Telegram authentication data missing."
      );

      return;
    }

    const data =
      await api("/api/me");

    if (!data) {
      return;
    }

    updateUser(data);

    updateMiningUI(
      data.mining_status
    );

    updateTasks(
      data.claimed_tasks || []
    );

    updateReferrals(
      data.referrals || {}
    );

  } catch (error) {

    console.error(
      "LOAD USER ERROR:",
      error
    );

    showToast(
      error.message ||
      "Unable to load BharatMine"
    );
  }
}

/* ======================================================
   START MINING
====================================================== */

async function startMining() {

  if (loading) {
    return;
  }

  if (!isTelegramApp()) {

    showToast(
      "Open BharatMine from Telegram."
    );

    return;
  }

  loading = true;

  try {

    const data =
      await api(
        "/api/mining/start",
        {
          method: "POST"
        }
      );

    if (data.mining) {

      miningRemaining =
        Number(
          data.remaining_seconds ||
          data.duration_seconds ||
          86400
        );

      updateMiningUI({
        mining: true,
        remaining_seconds:
          miningRemaining
      });

      showToast(
        data.alreadyMining
          ? "Mining is already active."
          : "Mining started successfully!"
      );

    }

    await loadMe();

  } catch (error) {

    console.error(
      "START MINING ERROR:",
      error
    );

    showToast(
      error.message ||
      "Unable to start mining"
    );

  } finally {

    loading = false;
  }
}

/* ======================================================
   MINING STATUS
====================================================== */

async function loadMiningStatus() {

  try {

    const data =
      await api(
        "/api/mining/status"
      );

    if (data.balance !== undefined) {
      updateBalance(
        data.balance
      );
    }

    updateMiningUI(data);

    if (data.completed) {

      showToast(
        `Mining completed! +${formatNumber(data.reward)} BHM`
      );
    }

  } catch (error) {

    console.error(
      "MINING STATUS ERROR:",
      error
    );
  }
}

/* ======================================================
   TASKS
====================================================== */

let tasksData = {};

async function loadTasks() {

  try {

    const data =
      await api("/api/tasks");

    tasksData = data || {};

    renderTasks();

  } catch (error) {

    console.error(
      "TASKS ERROR:",
      error
    );
  }
}

function updateTasks(claimed) {

  const claimedSet =
    new Set(claimed || []);

  document
    .querySelectorAll("[data-task-id]")
    .forEach(element => {

      const taskId =
        element.dataset.taskId;

      if (
        claimedSet.has(taskId)
      ) {

        element.classList.add(
          "claimed"
        );

        const button =
          element.querySelector(
            "button"
          );

        if (button) {

          button.disabled = true;

          button.textContent =
            "Claimed";
        }
      }

    });
}

function renderTasks() {

  const container =
    $("tasks");

  if (!container) {
    return;
  }

  const claimed =
    new Set(
      currentUser?.claimed_tasks ||
      []
    );

  container.innerHTML = "";

  Object.entries(tasksData)
    .forEach(([id, task]) => {

      if (id === "daily") {
        return;
      }

      const wrapper =
        document.createElement("div");

      wrapper.className =
        "task-item";

      wrapper.dataset.taskId =
        id;

      const title =
        document.createElement("div");

      title.textContent =
        task.title || id;

      const reward =
        document.createElement("span");

      reward.textContent =
        `+${formatNumber(task.reward)} BHM`;

      const button =
        document.createElement("button");

      button.textContent =
        claimed.has(id)
          ? "Claimed"
          : "Claim";

      button.disabled =
        claimed.has(id);

      if (task.url) {

        button.addEventListener(
          "click",
          () => {

            openTelegramLink(
              task.url
            );

            setTimeout(
              () => claimTask(id),
              1500
            );

          }
        );

      } else {

        button.addEventListener(
          "click",
          () => claimTask(id)
        );
      }

      wrapper.appendChild(title);
      wrapper.appendChild(reward);
      wrapper.appendChild(button);

      container.appendChild(wrapper);

    });
}

/* ======================================================
   CLAIM TASK
====================================================== */

async function claimTask(taskId) {

  try {

    const data =
      await api(
        `/api/tasks/${encodeURIComponent(taskId)}/claim`,
        {
          method: "POST"
        }
      );

    showToast(
      `Task complete! +${formatNumber(data.reward)} BHM`
    );

    await loadMe();

  } catch (error) {

    console.error(
      "CLAIM TASK ERROR:",
      error
    );

    showToast(
      error.message ||
      "Unable to claim task"
    );
  }
}

/* ======================================================
   DAILY
====================================================== */

async function loadDaily() {

  try {

    const data =
      await api("/api/daily");

    const status =
      $("dailyStatus");

    if (status) {

      status.textContent =
        data.claimed
          ? "Claimed today"
          : "Available today";
    }

  } catch (error) {

    console.error(
      "DAILY ERROR:",
      error
    );
  }
}

async function claimDailyCode() {

  const input =
    $("dailyCode") ||
    $("daily-code") ||
    $("code");

  if (!input) {

    showToast(
      "Daily code input not found."
    );

    return;
  }

  const code =
    String(input.value || "")
      .trim()
      .toUpperCase();

  if (!code) {

    showToast(
      "Enter today's code."
    );

    return;
  }

  try {

    const data =
      await api(
        "/api/daily/claim",
        {
          method: "POST",
          body: JSON.stringify({
            code
          })
        }
      );

    showToast(
      `Daily reward! +${formatNumber(data.reward)} BHM`
    );

    input.value = "";

    await loadMe();
    await loadDaily();

  } catch (error) {

    console.error(
      "DAILY CLAIM ERROR:",
      error
    );

    showToast(
      error.message ||
      "Invalid daily code"
    );
  }
}

/* ======================================================
   REFERRALS
====================================================== */

function updateReferrals(data) {

  if (!data) {
    return;
  }

  const count =
    Number(data.count || 0);

  const countElements = [
    "referralCount",
    "referral-count",
    "referrals"
  ];

  countElements.forEach(id => {

    const element = $(id);

    if (element) {
      element.textContent =
        String(count);
    }

  });

  const link =
    data.referral_link;

  const linkInput =
    $("referralLink") ||
    $("referral-link");

  if (
    linkInput &&
    link
  ) {
    linkInput.value = link;
  }
}

async function loadReferrals() {

  try {

    const data =
      await api("/api/referrals");

    updateReferrals(data);

    renderReferralList(
      data.referrals || []
    );

  } catch (error) {

    console.error(
      "REFERRALS ERROR:",
      error
    );
  }
}

function renderReferralList(list) {

  const container =
    $("referralList") ||
    $("referral-list");

  if (!container) {
    return;
  }

  container.innerHTML = "";

  if (!list.length) {

    container.textContent =
      "No referrals yet.";

    return;
  }

  list.forEach(item => {

    const row =
      document.createElement("div");

    row.className =
      "referral-item";

    const name =
      item.username
        ? `@${item.username}`
        : item.first_name ||
          "BharatMine User";

    row.textContent =
      name;

    container.appendChild(row);

  });
}

/* ======================================================
   COPY REFERRAL LINK
====================================================== */

async function copyReferralLink() {

  const input =
    $("referralLink") ||
    $("referral-link");

  const link =
    input?.value ||
    currentUser?.referrals?.referral_link ||
    "";

  if (!link) {

    showToast(
      "Referral link not available."
    );

    return;
  }

  try {

    await navigator.clipboard.writeText(
      link
    );

    showToast(
      "Referral link copied!"
    );

  } catch {

    if (input) {

      input.select();

      document.execCommand(
        "copy"
      );

      showToast(
        "Referral link copied!"
      );
    }
  }
}

/* ======================================================
   TELEGRAM SHARE
====================================================== */

function shareReferral() {

  const link =
    currentUser?.referrals?.referral_link ||
    "";

  if (!link) {

    showToast(
      "Referral link not available."
    );

    return;
  }

  const text =
    "Join BharatMine and start mining BHM!";

  const shareUrl =
    "https://t.me/share/url" +
    "?url=" +
    encodeURIComponent(link) +
    "&text=" +
    encodeURIComponent(text);

  openTelegramLink(
    shareUrl
  );
}

/* ======================================================
   OPEN LINKS
====================================================== */

function openTelegramLink(url) {

  if (!url) {
    return;
  }

  try {

    if (
      tg &&
      typeof tg.openTelegramLink ===
        "function" &&
      url.includes("t.me/")
    ) {

      tg.openTelegramLink(url);

      return;
    }

  } catch (error) {

    console.error(
      "Telegram link error:",
      error
    );
  }

  window.open(
    url,
    "_blank",
    "noopener,noreferrer"
  );
}

/* ======================================================
   LEADERBOARD
====================================================== */

async function loadLeaderboard() {

  try {

    const data =
      await api(
        "/api/leaderboard"
      );

    renderLeaderboard(
      Array.isArray(data)
        ? data
        : []
    );

  } catch (error) {

    console.error(
      "LEADERBOARD ERROR:",
      error
    );
  }
}

function renderLeaderboard(list) {

  const container =
    $("leaderboard");

  if (!container) {
    return;
  }

  container.innerHTML = "";

  list.forEach(
    (item, index) => {

      const row =
        document.createElement("div");

      row.className =
        "leaderboard-item";

      const name =
        item.username
          ? `@${item.username}`
          : item.first_name ||
            "Miner";

      row.textContent =
        `${index + 1}. ${name} — ${formatNumber(item.balance)} BHM`;

      container.appendChild(row);
    }
  );
}

/* ======================================================
   ECONOMY POOLS
====================================================== */

async function loadEconomyPools() {

  try {

    const data =
      await api(
        "/api/economy/pools"
      );

    console.log(
      "Economy pools:",
      data
    );

  } catch (error) {

    console.error(
      "ECONOMY ERROR:",
      error
    );
  }
}

/* ======================================================
   EVENT HELPERS
====================================================== */

function bindClick(id, handler) {

  const element = $(id);

  if (
    element &&
    typeof handler === "function"
  ) {

    element.addEventListener(
      "click",
      handler
    );
  }
}

/* ======================================================
   APP INIT
====================================================== */

async function initBharatMine() {

  console.log(
    "BharatMine starting..."
  );

  if (!isTelegramApp()) {

    console.warn(
      "Telegram authentication data missing."
    );

    /*
     Do not block the whole page.
     This allows the UI to open in browser,
     but API calls requiring Telegram auth
     will correctly fail.
    */

  } else {

    console.log(
      "Telegram authentication detected."
    );
  }

  bindClick(
    "startMining",
    startMining
  );

  bindClick(
    "start-mining",
    startMining
  );

  bindClick(
    "miningButton",
    startMining
  );

  bindClick(
    "claimDaily",
    claimDailyCode
  );

  bindClick(
    "claim-daily",
    claimDailyCode
  );

  bindClick(
    "copyReferral",
    copyReferralLink
  );

  bindClick(
    "copy-referral",
    copyReferralLink
  );

  bindClick(
    "shareReferral",
    shareReferral
  );

  bindClick(
    "share-referral",
    shareReferral
  );

  /*
   Load public data first
  */

  await loadTasks();
  await loadLeaderboard();

  /*
   Authenticated data
  */

  if (isTelegramApp()) {

    await loadMe();
    await loadDaily();
    await loadReferrals();
  }

  /*
   Refresh mining status every minute
  */

  setInterval(
    () => {

      if (isTelegramApp()) {
        loadMiningStatus();
      }

    },
    60000
  );

  console.log(
    "BharatMine ready."
  );
}

/* ======================================================
   DOM READY
====================================================== */

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    initBharatMine
  );

} else {

  initBharatMine();
}
