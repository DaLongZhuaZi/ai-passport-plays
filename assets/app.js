// AI Passport 玩法库 — 前端逻辑
// 1) 从 GitHub 仓库读取 manifest.json 并渲染玩法卡片
// 2) 通过 Web Serial + esptool-js 把固件刷入设备（只写 0x10000 的 factory 应用区）
import { ESPLoader, Transport } from "./vendor/esptool-js.js";

const REPO = "DaLongZhuaZi/ai-passport-plays";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main/`;

const $ = (sel) => document.querySelector(sel);
const playsEl = $("#plays");
const serialSupported = "serial" in navigator;

if (!serialSupported) $("#env-warning").hidden = false;

// ---------- 工具 ----------
function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + " MB";
  return Math.round(bytes / 1024) + " KB";
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bufToBinaryString(u8) {
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < u8.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return out;
}

function bstrToU8(str) {
  const u8 = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) u8[i] = str.charCodeAt(i) & 0xff;
  return u8;
}

// MD5（用于刷机后的设备端校验比对；标准算法实现）
function md5Hex(u8) {
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

  const bitLen = u8.length * 8;
  const paddedLen = (((u8.length + 8) >> 6) + 1) << 6;
  const msg = new Uint8Array(paddedLen);
  msg.set(u8);
  msg[u8.length] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(paddedLen - 8, bitLen >>> 0, true);
  dv.setUint32(paddedLen - 4, Math.floor(bitLen / 4294967296) >>> 0, true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;

  for (let off = 0; off < paddedLen; off += 64) {
    const M = new Array(16);
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      const tmp = D;
      D = C;
      C = B;
      B = (B + rotl((A + F + K[i] + M[g]) >>> 0, S[i])) >>> 0;
      A = tmp;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  out.setUint32(0, a0, true); out.setUint32(4, b0, true);
  out.setUint32(8, c0, true); out.setUint32(12, d0, true);
  return [...new Uint8Array(out.buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- 加载玩法库 ----------
let manifestBase = "./";
async function loadManifest() {
  const candidates = ["manifest.json", RAW_BASE + "manifest.json"];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) continue;
      const data = await res.json();
      manifestBase = url.slice(0, url.length - "manifest.json".length);
      return data;
    } catch (e) { /* try next */ }
  }
  throw new Error("无法读取 manifest.json");
}

function resolveUrl(path) {
  if (/^https?:\/\//.test(path)) return path;
  return manifestBase + path;
}

function renderPlays(manifest) {
  playsEl.innerHTML = "";
  for (const play of manifest.plays) {
    const card = document.createElement("article");
    card.className = "play-card";
    const tags = (play.tags || []).map((t) => `<span class="tag">${t}</span>`).join("");
    card.innerHTML = `
      <img class="play-cover" src="${resolveUrl(play.cover)}" alt="${play.name} 封面" loading="lazy">
      <div class="play-body">
        <div class="play-head">
          <h3 class="play-name"></h3>
          <span class="play-version">v${play.version}</span>
        </div>
        <p class="play-desc"></p>
        <div class="play-tags">${tags}</div>
        <div class="play-meta">
          <span>作者 ${play.author}</span>
          <span>大小 ${fmtSize(play.size)}</span>
          <a href="${play.source}" target="_blank" rel="noopener">来源 ↗</a>
        </div>
        <button class="btn primary install-btn">安装到设备</button>
        <div class="play-download">
          <a class="dl-link">⬇ 下载固件 .bin</a>
          <span class="dl-hint">手动刷机地址 0x10000</span>
        </div>
      </div>`;
    card.querySelector(".play-name").textContent = play.name;
    card.querySelector(".play-desc").textContent = play.description;
    const dl = card.querySelector(".dl-link");
    dl.href = resolveUrl(play.firmware);
    dl.setAttribute("download", `${play.id}-v${play.version}.bin`);
    const btn = card.querySelector(".install-btn");
    if (!serialSupported) {
      btn.disabled = true;
      btn.textContent = "当前浏览器不支持安装";
    }
    btn.addEventListener("click", () => openInstall(play));
    playsEl.appendChild(card);
  }
}

// ---------- 安装流程 ----------
const modal = $("#install-modal");
const logEl = $("#flash-log");
const btnConnect = $("#btn-connect");
const btnFlash = $("#btn-flash");
const btnDone = $("#btn-done");
const progressRow = $("#progress-row");
const progressBar = $("#flash-progress");
const progressText = $("#progress-text");

let currentPlay = null;
let transport = null;
let loader = null;
let connected = false;
let flashing = false;

function log(msg) {
  logEl.textContent += msg + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}
const terminal = {
  clean() { logEl.textContent = ""; },
  writeLine(data) { log(data); },
  write(data) { logEl.textContent += data; logEl.scrollTop = logEl.scrollHeight; },
};

function openInstall(play) {
  currentPlay = play;
  $("#modal-title").textContent = `安装：${play.name} v${play.version}`;
  terminal.clean();
  log("准备就绪。先按上面的步骤让设备进入下载模式，再点「连接设备」。");
  btnConnect.disabled = false;
  btnFlash.disabled = true;
  btnDone.hidden = true;
  progressRow.hidden = true;
  progressBar.value = 0;
  progressText.textContent = "0%";
  modal.hidden = false;
}

async function closeInstall() {
  if (flashing) return;
  if (transport) {
    try { await transport.disconnect(); } catch (e) { /* ignore */ }
    transport = null; loader = null; connected = false;
  }
  modal.hidden = true;
}

$("#modal-close").addEventListener("click", closeInstall);
btnDone.addEventListener("click", closeInstall);

btnConnect.addEventListener("click", async () => {
  if (!serialSupported) return;
  btnConnect.disabled = true;
  try {
    log("请选择串口设备…");
    const port = await navigator.serial.requestPort();
    transport = new Transport(port, false);
    loader = new ESPLoader({
      transport,
      baudrate: 921600,
      romBaudrate: 115200,
      terminal,
      enableTracing: false,
    });
    log("正在连接设备（USB 复位同步）…");
    const chip = await loader.main("usb_reset");
    connected = true;
    const chipName = (chip && chip.CHIP_NAME) || "ESP32-C3";
    log(`已连接：${chipName}`);
    if (!/ESP32-C3/i.test(chipName)) {
      log(`⚠️ 注意：检测到的芯片是 ${chipName}，本玩法库只适用于 ESP32-C3 的 AI Passport，请确认设备无误再安装。`);
    }
    btnFlash.disabled = false;
  } catch (e) {
    log(`连接失败：${e && e.message ? e.message : e}`);
    log("排查：确认已按住 UP 键开机进入下载模式；换一根可传数据的线；关掉其他占用串口的软件后重试。");
    btnConnect.disabled = false;
    if (transport) { try { await transport.disconnect(); } catch (_) {} transport = null; loader = null; }
  }
});

btnFlash.addEventListener("click", async () => {
  if (!connected || !loader || !currentPlay) return;
  flashing = true;
  btnFlash.disabled = true;
  btnConnect.disabled = true;
  progressRow.hidden = false;
  try {
    const fwUrl = resolveUrl(currentPlay.firmware);
    log(`正在下载固件（${fmtSize(currentPlay.size)}）…`);
    const res = await fetch(fwUrl);
    if (!res.ok) throw new Error(`固件下载失败 HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const digest = await sha256Hex(buf);
    if (digest !== currentPlay.sha256) {
      throw new Error("固件 SHA-256 校验不通过，已中止安装（文件可能不完整，请刷新页面重试）");
    }
    log("固件校验通过，开始写入设备（只写入 0x10000 应用区）…");
    const data = bufToBinaryString(new Uint8Array(buf));
    await loader.writeFlash({
      fileArray: [{ data, address: currentPlay.address || 0x10000 }],
      flashSize: "keep",
      flashMode: "keep",
      flashFreq: "keep",
      eraseAll: false,
      compress: true,
      reportProgress: (_idx, written, total) => {
        const pct = total > 0 ? Math.round((written / total) * 100) : 0;
        progressBar.value = pct;
        progressText.textContent = pct + "%";
      },
      calculateMD5Hash: (image) => md5Hex(bstrToU8(image)),
    });
    log("写入完成，设备端 MD5 校验已由刷机库执行。");
    progressBar.value = 100;
    progressText.textContent = "100%";
    await loader.after("hard_reset");
    log("✅ 安装完成，设备已重启。松开按键后如果还停在下载模式，拔线重新开机即可进入新玩法。");
    log("想装回官方玩法：关机后长按 UP 开机进入 Recovery，用 FoloToy 小程序安装即可。");
    btnDone.hidden = false;
  } catch (e) {
    log(`❌ 安装失败：${e && e.message ? e.message : e}`);
    log("设备不会变砖：关机后长按 UP 开机可进 Recovery 恢复，或重新连接再装一次。");
    btnFlash.disabled = false;
  } finally {
    flashing = false;
    if (transport) { try { await transport.disconnect(); } catch (_) {} }
    connected = false;
    btnConnect.disabled = false;
  }
});

// ---------- 启动 ----------
loadManifest()
  .then((manifest) => renderPlays(manifest))
  .catch((e) => {
    playsEl.innerHTML = `<p class="loading">玩法库读取失败：${e.message}。请检查网络后刷新页面。</p>`;
  });
