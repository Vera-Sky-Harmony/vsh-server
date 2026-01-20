// index.js (FULL REPLACE)
"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const line = require("@line/bot-sdk");

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  ADMIN_TOKEN,
  BASE_URL,
  ASSIGNED_FLP_POOL,
} = process.env;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  throw new Error("Missing CHANNEL_ACCESS_TOKEN / CHANNEL_SECRET in env.");
}
if (!ADMIN_TOKEN) {
  throw new Error("Missing ADMIN_TOKEN in env.");
}

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const config = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET,
};
const client = new line.Client(config);

// ---- simple file store (for test) ----
const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
  if (!fs.existsSync(STATE_FILE)) {
    const init = {
      poolText: (ASSIGNED_FLP_POOL || "").trim(),
      assigned: {}, // userId -> flp
      consumed: {}, // userId -> flp (future)
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(init, null, 2), "utf-8");
  }
}

function loadState() {
  ensureStore();
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
}

function saveState(state) {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

function parsePool(text) {
  return (text || "")
    .split(/\r?\n|,|\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function computeCounts(state) {
  const pool = parsePool(state.poolText);
  const assignedVals = new Set(Object.values(state.assigned || {}));
  const consumedVals = new Set(Object.values(state.consumed || {}));
  const used = new Set([...assignedVals, ...consumedVals]);

  const unused = pool.filter((n) => !used.has(n));
  return {
    total: pool.length,
    assigned: assignedVals.size,
    consumed: consumedVals.size,
    unused: unused.length,
    unusedList: unused,
  };
}

// ---- health ----
app.get("/", (req, res) => {
  res.status(200).send("vsh-server ok");
});
app.get("/health", (req, res) => res.json({ ok: true, base: BASE_URL || null }));

// ---- LINE webhook ----
app.post("/callback", line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    for (const event of events) {
      // ★ userId を必ずログに出す（これが目的）
      console.log("LINE EVENT:", JSON.stringify(event));

      // ここではまだ自動配信ロジックは触らない（テスト用のログ確保）
      // 必要なら後で follow/postback/message で分岐実装します
    }
    res.status(200).end();
  } catch (e) {
    console.error("Webhook error:", e);
    res.status(500).end();
  }
});

// ---- Admin UI ----
function checkAdminToken(req) {
  const t = req.query.token || req.headers["x-admin-token"];
  return t && t === ADMIN_TOKEN;
}

app.get("/admin", (req, res) => {
  if (!checkAdminToken(req)) return res.status(401).send("Unauthorized");

  const state = loadState();
  const c = computeCounts(state);

  const html = `
  <!doctype html><html><head><meta charset="utf-8"><title>VSH Admin</title>
  <style>body{font-family:system-ui,Segoe UI,Arial;margin:20px} textarea{width:420px;height:220px} .box{max-width:720px}</style>
  </head><body>
    <div class="box">
      <h2>VSH Admin</h2>
      <p><b>unused:</b> ${c.unused}　<b>assigned:</b> ${c.assigned}　<b>consumed:</b> ${c.consumed}　<b>total:</b> ${c.total}</p>
      <p style="color:#666">ASSIGNED_FLP_POOL（次世代用FLP）の入力欄（1行1件、貼り付けOK）</p>

      <form method="POST" action="/admin/pool?token=${encodeURIComponent(ADMIN_TOKEN)}">
        <textarea name="poolText">${(state.poolText || "").replace(/</g, "&lt;")}</textarea><br/>
        <button type="submit">保存する</button>
      </form>

      <h3>状態（先頭）</h3>
      <pre>${JSON.stringify({ assigned: state.assigned, consumed: state.consumed, updatedAt: state.updatedAt }, null, 2).slice(0, 2000)}</pre>

      <form method="POST" action="/admin/reset?token=${encodeURIComponent(ADMIN_TOKEN)}" onsubmit="return confirm('resetしますか？');">
        <button type="submit" style="background:#c00;color:#fff;border:none;padding:8px 12px">割当状態をリセット</button>
      </form>
    </div>
  </body></html>`;
  res.status(200).send(html);
});

app.post("/admin/pool", (req, res) => {
  if (!checkAdminToken(req)) return res.status(401).send("Unauthorized");
  const state = loadState();
  state.poolText = (req.body.poolText || "").trim();
  saveState(state);
  res.redirect(`/admin?token=${encodeURIComponent(ADMIN_TOKEN)}`);
});

app.post("/admin/reset", (req, res) => {
  if (!checkAdminToken(req)) return res.status(401).send("Unauthorized");
  const state = loadState();
  state.assigned = {};
  state.consumed = {};
  saveState(state);
  res.redirect(`/admin?token=${encodeURIComponent(ADMIN_TOKEN)}`);
});

// ---- start ----
const port = process.env.PORT || 10000;
app.listen(port, () => console.log("Server running on", port));

