// index.js (ESM / Full replacement)
// Render / Node 18+ / Express + LINE Messaging API

import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as line from "@line/bot-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------- ENV --------------------
const PORT = process.env.PORT || 10000;

const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;
const OA_LINE_ID = process.env.OA_LINE_ID || ""; // optional
const BASE_URL = process.env.BASE_URL || ""; // optional

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ""; // must be set for /admin
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || ""; // admin push notify target (optional but recommended)

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error("Missing CHANNEL_ACCESS_TOKEN or CHANNEL_SECRET");
  process.exit(1);
}
if (!ADMIN_TOKEN) {
  console.warn("ADMIN_TOKEN is not set (admin page will show error).");
}

const lineConfig = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET,
};
const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
});

// -------------------- Simple JSON DB (Render: use /tmp) --------------------
const DB_PATH = process.env.DB_PATH || "/tmp/vsh_db.json";

function loadDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      pool: [], // unused FLP list
      assigned: {}, // userId -> { flp, assignedAt }
      consumed: {}, // userId -> { flp, name, userFlp, imageMessageId, consumedAt }
      state: {}, // userId -> { step, tempName, tempUserFlp }
    };
  }
}
function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}
let db = loadDB();

// -------------------- Helpers --------------------
function nowISO() {
  return new Date().toISOString();
}

function normalizeText(s) {
  return (s || "").trim().replace(/\s+/g, "");
}

function getCounts() {
  const unused = db.pool.length;
  const assigned = Object.keys(db.assigned).length;
  const consumed = Object.keys(db.consumed).length;
  return { unused, assigned, consumed };
}

function assignNextFlpToUser(userId) {
  // idempotent: if already assigned or consumed, return same flp
  if (db.consumed[userId]?.flp) return db.consumed[userId].flp;
  if (db.assigned[userId]?.flp) return db.assigned[userId].flp;

  if (db.pool.length === 0) return null;

  const flp = db.pool.shift(); // FIFO
  db.assigned[userId] = { flp, assignedAt: nowISO() };
  saveDB(db);
  return flp;
}

function ensureAssigned(userId) {
  return db.assigned[userId]?.flp || db.consumed[userId]?.flp || null;
}

function setState(userId, step, extra = {}) {
  db.state[userId] = { step, ...extra, updatedAt: nowISO() };
  saveDB(db);
}
function clearState(userId) {
  delete db.state[userId];
  saveDB(db);
}

async function replyText(replyToken, text) {
  await client.replyMessage({
    replyToken,
    messages: [{ type: "text", text }],
  });
}

async function pushAdmin(text) {
  if (!ADMIN_USER_ID) return;
  try {
    await client.pushMessage({
      to: ADMIN_USER_ID,
      messages: [{ type: "text", text }],
    });
  } catch (e) {
    console.error("pushAdmin failed:", e?.message || e);
  }
}

// -------------------- Express --------------------
const app = express();

app.get("/", (req, res) => {
  const counts = getCounts();
  res.status(200).send(
    `VSH server running\nunused=${counts.unused} assigned=${counts.assigned} consumed=${counts.consumed}\n`
  );
});

// LINE webhook must use raw body for signature verification.
// line.middleware handles it.
app.post("/callback", line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events || [];
    for (const ev of events) {
      await handleEvent(ev);
    }
    res.status(200).end();
  } catch (e) {
    console.error("Webhook error:", e?.message || e);
    res.status(500).end();
  }
});

// -------------------- Admin (simple HTML) --------------------
app.get("/admin", (req, res) => {
  const token = req.query.token || "";
  if (!ADMIN_TOKEN) return res.status(500).send("ADMIN_TOKEN not set");
  if (token !== ADMIN_TOKEN) return res.status(403).send("Forbidden");

  const counts = getCounts();
  const example = `例）123456789\n234567890\n...`;
  const html = `
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>VSH Admin</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans JP",sans-serif;margin:20px;}
  .card{max-width:720px;border:1px solid #ddd;border-radius:12px;padding:16px;}
  .badges span{display:inline-block;margin-right:8px;padding:6px 10px;border:1px solid #ddd;border-radius:999px;background:#fafafa;}
  textarea{width:100%;height:180px;border:1px solid #ccc;border-radius:10px;padding:10px;font-size:14px;}
  button{margin-top:10px;padding:10px 14px;border:0;border-radius:10px;background:#111;color:#fff;cursor:pointer;}
  small{color:#666;}
  pre{white-space:pre-wrap;background:#f7f7f7;border:1px solid #eee;border-radius:10px;padding:10px;}
</style>
</head>
<body>
  <div class="card">
    <h1>VSH Admin</h1>
    <div class="badges">
      <span>unused: <b>${counts.unused}</b></span>
      <span>assigned: <b>${counts.assigned}</b></span>
      <span>consumed: <b>${counts.consumed}</b></span>
    </div>

    <p style="margin-top:14px;">
      <b>assignedFlp</b> を改行区切りで貼り付け → 保存（上から30件のみ有効）
      <br/><small>※ここに貼ったものが「未使用プール(unused)」になります。割当は「登録希望」時に先頭から順に行われます。</small>
    </p>

    <textarea id="flp" placeholder="${example}"></textarea>
    <button onclick="save()">保存する</button>

    <h3 style="margin-top:18px;">状態（先頭）</h3>
    <pre id="status">loading...</pre>
    <small>URL: ${BASE_URL || ""}</small>
  </div>

<script>
async function refresh(){
  const r = await fetch('/admin/status?token=${encodeURIComponent(token)}');
  const j = await r.json();
  document.querySelector('#status').textContent = JSON.stringify(j, null, 2);
}
async function save(){
  const text = document.querySelector('#flp').value || '';
  const r = await fetch('/admin/assignedFlp?token=${encodeURIComponent(token)}', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ text })
  });
  const j = await r.json();
  await refresh();
  alert('保存しました。unused=' + j.unused);
}
refresh();
</script>
</body>
</html>
`;
  res.status(200).send(html);
});

app.get("/admin/status", (req, res) => {
  const token = req.query.token || "";
  if (!ADMIN_TOKEN) return res.status(500).json({ error: "ADMIN_TOKEN not set" });
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: "Forbidden" });

  const counts = getCounts();

  // show first 30 pool items and first 30 assigned summary
  const poolHead = db.pool.slice(0, 30);
  const assignedList = Object.entries(db.assigned)
    .slice(0, 30)
    .map(([userId, v]) => ({ userId, flp: v.flp, assignedAt: v.assignedAt }));

  res.json({
    counts,
    poolHead,
    assignedHead: assignedList,
  });
});

app.post("/admin/assignedFlp", express.json(), (req, res) => {
  const token = req.query.token || "";
  if (!ADMIN_TOKEN) return res.status(500).json({ error: "ADMIN_TOKEN not set" });
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: "Forbidden" });

  const text = (req.body?.text || "").toString();
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  // keep only digits (optional) - but allow any string as ID if needed
  const cleaned = lines
    .map((s) => s.replace(/[^\d]/g, "")) // digits only
    .filter((s) => s.length > 0);

  // Only top 30 valid
  db.pool = cleaned.slice(0, 30);
  saveDB(db);

  const counts = getCounts();
  res.json({ ok: true, ...counts });
});

// -------------------- LINE Event handler --------------------
async function handleEvent(ev) {
  // Only handle user (not group/room) in this project
  const userId = ev.source?.userId;
  if (!userId) return;

  // 1) Postback (from richmenu/richmessage button if set as postback)
  if (ev.type === "postback") {
    const data = ev.postback?.data || "";
    const norm = normalizeText(data);

    if (norm.includes("登録希望") || norm.includes("register_wish")) {
      return handleRegisterWish(userId, ev.replyToken);
    }
    if (norm.includes("3点をLINEで返信する") || norm.includes("three_points")) {
      return handleThreePointsStart(userId, ev.replyToken);
    }
    // Unknown postback
    return;
  }

  // 2) Message text
  if (ev.type === "message" && ev.message?.type === "text") {
    const textRaw = ev.message.text || "";
    const text = normalizeText(textRaw);

    if (text === "登録希望") {
      return handleRegisterWish(userId, ev.replyToken);
    }
    if (text === "3点をLINEで返信する") {
      return handleThreePointsStart(userId, ev.replyToken);
    }

    // Step flow
    const st = db.state[userId]?.step || "idle";
    if (st === "awaiting_name") {
      db.state[userId].tempName = textRaw.trim();
      setState(userId, "awaiting_userflp", { tempName: db.state[userId].tempName });
      const assignedFlp = ensureAssigned(userId);
      return replyText(
        ev.replyToken,
        `ありがとうございます。\n（あなたのFLP番号：${assignedFlp}）\n\n② FLP番号（あなたご本人の番号）を入力してください。`
      );
    }

    if (st === "awaiting_userflp") {
      db.state[userId].tempUserFlp = textRaw.trim();
      setState(userId, "awaiting_receipt", {
        tempName: db.state[userId].tempName,
        tempUserFlp: db.state[userId].tempUserFlp,
      });
      const assignedFlp = ensureAssigned(userId);
      return replyText(
        ev.replyToken,
        `ありがとうございます。\n（あなたのFLP番号：${assignedFlp}）\n\n③ 最後に【購入画面のスクリーンショット】を画像で送ってください。`
      );
    }

    // Otherwise ignore
    return;
  }

  // 3) Message image (receipt)
  if (ev.type === "message" && ev.message?.type === "image") {
    const st = db.state[userId]?.step || "idle";
    if (st !== "awaiting_receipt") {
      // If user sent image without flow, guide
      return replyText(
        ev.replyToken,
        `画像を受け取りました。\n先に「登録希望」→「3点をLINEで返信する」の順で進めてください。`
      );
    }

    const assignedFlp = ensureAssigned(userId);
    const name = db.state[userId]?.tempName || "";
    const userFlp = db.state[userId]?.tempUserFlp || "";
    const imageMessageId = ev.message.id;

    // move to consumed
    db.consumed[userId] = {
      flp: assignedFlp,
      name,
      userFlp,
      imageMessageId,
      consumedAt: nowISO(),
    };
    // remove from assigned (optional) — counts: assigned decreases, consumed increases
    delete db.assigned[userId];
    clearState(userId);
    saveDB(db);

    // user reply
    await replyText(
      ev.replyToken,
      `画像を受け取りました。ありがとうございます。\n\n【登録情報を確認中です】\n紹介者へご連絡ください。`
    );

    // admin notify
    await pushAdmin(
      `【3点受領】\n氏名: ${name}\n本人FLP: ${userFlp}\n割当FLP(あなたのFLP): ${assignedFlp}\n画像messageId: ${imageMessageId}\nuserId: ${userId}`
    );
    return;
  }

  // Other events ignored
}

// -------------------- Actions --------------------
async function handleRegisterWish(userId, replyToken) {
  const assignedFlp = assignNextFlpToUser(userId);

  if (!assignedFlp) {
    return replyText(
      replyToken,
      `現在、あなたのFLP番号（割当）が不足しています。\n紹介者へご連絡ください。`
    );
  }

  // Start flow at name input (so user can proceed right away)
  setState(userId, "awaiting_name");

  return replyText(
    replyToken,
    `【登録受付を開始します】\nあなたのFLP番号：${assignedFlp}\n\n① 氏名 を入力してください`
  );
}

async function handleThreePointsStart(userId, replyToken) {
  const assignedFlp = ensureAssigned(userId);

  if (!assignedFlp) {
    return replyText(
      replyToken,
      `先に「登録希望」を押して、あなたのFLP番号（割当）を受け取ってください。`
    );
  }

  // If already in progress, keep state. Otherwise start.
  const step = db.state[userId]?.step || "idle";
  if (step === "idle") setState(userId, "awaiting_name");

  return replyText(
    replyToken,
    `【3点返信を開始します】\n（あなたのFLP番号：${assignedFlp}）\n\n① 氏名 を入力してください`
  );
}

// -------------------- Start --------------------
app.listen(PORT, () => {
  const counts = getCounts();
  console.log(`10000で動作するサーバー`);
  console.log(`サービスは稼働中です`);
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`ADMIN_TOKEN=${ADMIN_TOKEN ? "set" : "not set"}`);
  console.log(`ADMIN_USER_ID=${ADMIN_USER_ID ? "set" : "not set"}`);
  console.log(`unused=${counts.unused} assigned=${counts.assigned} consumed=${counts.consumed}`);
});

