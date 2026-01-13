// index.js (ESM / type: module 対応)
// 修正点：@line/bot-sdk を default import しない（ESMでは default export が無い）
//        -> import { Client, middleware } from "@line/bot-sdk";

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client, middleware } from "@line/bot-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== ENV ======
const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  BASE_URL,
  ADMIN_TOKEN,
  ADMIN_USER_ID,
  INTRODUCER_NAME = "細井信孝",
  INTRODUCER_FLP = "203145165",
} = process.env;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error("Missing CHANNEL_ACCESS_TOKEN or CHANNEL_SECRET");
}

const config = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET,
};
const client = new Client(config);

// ====== Storage (JSON file) ======
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          pool: [], // [{ flp, status: "unused"|"assigned"|"consumed", assignedTo, assignedAt, consumedAt }]
          users: {}, // userId -> { introducerName, introducerFlp, assignedFlp, requestedAt, step, name, flp, receiptImageId, completedAt }
        },
        null,
        2
      ),
      "utf-8"
    );
  }
}
ensureDataDir();

function loadStore() {
  ensureDataDir();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}
function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
}

// ====== Helpers ======
const DAY_MS = 24 * 60 * 60 * 1000;
const RECLAIM_DAYS = 10;

function nowISO() {
  return new Date().toISOString();
}

function mask(s) {
  if (!s) return "";
  if (s.length <= 6) return "***";
  return s.slice(0, 3) + "***" + s.slice(-3);
}

function normalizeText(t) {
  return (t || "").trim();
}

function getUnusedCount(store) {
  return store.pool.filter((x) => x.status === "unused").length;
}

function reclaimExpiredAssigned(store) {
  const limit = Date.now() - RECLAIM_DAYS * DAY_MS;
  let reclaimed = 0;

  for (const item of store.pool) {
    if (item.status === "assigned" && item.assignedAt) {
      const at = new Date(item.assignedAt).getTime();
      if (!Number.isNaN(at) && at < limit) {
        const u = store.users[item.assignedTo];
        const completed = u?.completedAt;
        if (!completed) {
          item.status = "unused";
          item.assignedTo = null;
          item.assignedAt = null;
          reclaimed++;
        }
      }
    }
  }
  return reclaimed;
}

function allocateAssignedFlp(store, userId) {
  reclaimExpiredAssigned(store);

  const existing = store.pool.find(
    (x) => x.status === "assigned" && x.assignedTo === userId
  );
  if (existing) return existing.flp;

  const next = store.pool.find((x) => x.status === "unused");
  if (!next) return null;

  next.status = "assigned";
  next.assignedTo = userId;
  next.assignedAt = nowISO();
  return next.flp;
}

async function notifyAdmin(text) {
  if (!ADMIN_USER_ID) return;
  try {
    await client.pushMessage(ADMIN_USER_ID, { type: "text", text });
  } catch (e) {
    console.error("notifyAdmin failed:", e?.message || e);
  }
}

async function replyText(replyToken, text) {
  try {
    await client.replyMessage(replyToken, { type: "text", text });
  } catch (e) {
    console.error("replyText failed:", e?.message || e);
  }
}

// ====== Express ======
const app = express();
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Health
app.get("/", (req, res) => res.type("text").send("VSH server is running."));
app.get("/health", (req, res) => res.json({ ok: true, time: nowISO() }));

// ====== Admin UI ======
app.get("/admin", (req, res) => {
  if (!ADMIN_TOKEN) return res.status(500).type("text").send("ADMIN_TOKEN not set");
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(403).type("text").send("Forbidden");

  const store = loadStore();
  reclaimExpiredAssigned(store);
  saveStore(store);

  const unused = getUnusedCount(store);
  const assigned = store.pool.filter((x) => x.status === "assigned").length;
  const consumed = store.pool.filter((x) => x.status === "consumed").length;

  const html = `<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>VSH Admin</title>
<style>
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:24px;line-height:1.5}
.card{max-width:900px;margin:auto;border:1px solid #ddd;border-radius:12px;padding:16px 18px;box-shadow:0 2px 10px rgba(0,0,0,.03)}
h1{margin:0 0 10px}
small{color:#555}
textarea{width:100%;min-height:260px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;padding:10px;border-radius:10px;border:1px solid #ccc}
button{padding:10px 14px;border:0;border-radius:10px;background:#111;color:#fff;font-weight:700;cursor:pointer}
.badge{display:inline-block;background:#f4f4f4;border:1px solid #e2e2e2;border-radius:999px;padding:4px 10px;margin-right:8px}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace}
</style></head><body>
<div class="card">
  <h1>VSH Admin</h1>
  <div>
    <span class="badge">unused: <b class="mono">${unused}</b></span>
    <span class="badge">assigned: <b class="mono">${assigned}</b></span>
    <span class="badge">consumed: <b class="mono">${consumed}</b></span>
  </div>

  <p><small>assignedFlp を改行区切りで貼り付け → 保存（上から30件のみ有効）</small></p>
  <form method="POST" action="/admin/pool?token=${encodeURIComponent(ADMIN_TOKEN)}">
    <textarea name="assignedFlp" placeholder="例）123456789&#10;234567890&#10;...">${store.pool
      .map((x) => x.flp)
      .join("\n")}</textarea>
    <div style="margin-top:12px"><button type="submit">保存する</button></div>
  </form>

  <hr style="margin:18px 0; border:none; border-top:1px solid #eee"/>
  <h3>状態一覧（先頭）</h3>
  <pre>${store.pool
    .slice(0, 40)
    .map(
      (x, i) =>
        `${String(i + 1).padStart(2, "0")}. ${x.flp}  [${x.status}]  to=${
          x.assignedTo ? mask(x.assignedTo) : "-"
        }  at=${x.assignedAt || "-"}`
    )
    .join("\n")}</pre>

  <p><small>URL：<span class="mono">${(BASE_URL || "").replace(/\/$/, "")}/admin?token=...</span></small></p>
</div></body></html>`;

  res.type("html").send(html);
});

app.post("/admin/pool", (req, res) => {
  if (!ADMIN_TOKEN) return res.status(500).type("text").send("ADMIN_TOKEN not set");
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(403).type("text").send("Forbidden");

  const raw = (req.body.assignedFlp || "").toString();
  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const uniq = [];
  const seen = new Set();
  for (const v of lines) {
    if (!seen.has(v)) {
      seen.add(v);
      uniq.push(v);
    }
    if (uniq.length >= 30) break;
  }

  const store = loadStore();
  store.pool = uniq.map((flp) => ({
    flp,
    status: "unused",
    assignedTo: null,
    assignedAt: null,
    consumedAt: null,
  }));
  saveStore(store);
  res.redirect(`/admin?token=${encodeURIComponent(ADMIN_TOKEN)}`);
});

// ====== LINE Webhook ======
app.post("/webhook", middleware(config), async (req, res) => {
  try {
    const store = loadStore();
    const reclaimed = reclaimExpiredAssigned(store);
    if (reclaimed > 0) saveStore(store);

    const events = req.body.events || [];
    await Promise.all(events.map((ev) => handleEvent(ev)));
    res.sendStatus(200);
  } catch (e) {
    console.error("webhook error:", e?.message || e);
    res.sendStatus(500);
  }
});

// ====== Core Logic ======
async function handleEvent(event) {
  if (event.type !== "message") return;
  const userId = event.source?.userId;
  if (!userId) return;

  const store = loadStore();
  store.users[userId] ||= {
    introducerName: INTRODUCER_NAME,
    introducerFlp: INTRODUCER_FLP,
    assignedFlp: null,
    requestedAt: null,
    step: null, // "await_name" | "await_flp" | "await_receipt"
    name: null,
    flp: null,
    receiptImageId: null,
    completedAt: null,
  };

  // 画像
  if (event.message.type === "image") {
    const u = store.users[userId];
    if (u.step === "await_receipt") {
      u.receiptImageId = event.message.id;
      u.completedAt = nowISO();
      u.step = null;

      const item = store.pool.find(
        (x) => x.status === "assigned" && x.assignedTo === userId
      );
      if (item) {
        item.status = "consumed";
        item.consumedAt = nowISO();
      }

      saveStore(store);

      await replyText(
        event.replyToken,
        "画像を受け取りました。ありがとうございます。\n\n【登録情報】\n・氏名：" +
          (u.name || "（未入力）") +
          "\n・FLP番号：" +
          (u.flp || "（未入力）") +
          "\n・購入スクショ：受領\n\n紹介者へ通知しました。"
      );

      await notifyAdmin(
        `【3点受領】\nuserId=${userId}\n氏名=${u.name || "未入力"}\nFLP=${u.flp || "未入力"}\n購入スクショID=${u.receiptImageId}\nassignedFlp=${u.assignedFlp || "未割当"}`
      );
      return;
    }

    await replyText(
      event.replyToken,
      "画像を受け取りました。必要な場合は「3点をLINEで返信する」から案内に従って送ってください。"
    );
    return;
  }

  // テキスト
  if (event.message.type !== "text") return;
  const text = normalizeText(event.message.text);
  const u = store.users[userId];

  // ステップ処理（3点返信）
  if (u.step === "await_name") {
    u.name = text;
    u.step = "await_flp";
    saveStore(store);
    await replyText(event.replyToken, "ありがとうございます。\n② FLP番号 を入力してください");
    return;
  }
  if (u.step === "await_flp") {
    u.flp = text;
    u.step = "await_receipt";
    saveStore(store);
    await replyText(
      event.replyToken,
      "ありがとうございます。\n③ 最後に【購入画面のスクリーンショット】を画像で送ってください。"
    );
    return;
  }

  // ボタン押下テキスト
  if (text === "3点をLINEで返信する") {
    u.step = "await_name";
    saveStore(store);
    await replyText(event.replyToken, "【登録受付を開始します】\n① 氏名 を入力してください");
    return;
  }

  if (text === "登録希望") {
    const unusedCount = getUnusedCount(store);
    if (unusedCount < 30) {
      saveStore(store);
      await replyText(event.replyToken, "現在、受付準備中です。紹介者へご連絡ください。");
      await notifyAdmin(
        `【要対応】assignedFlp の未使用が30件未満です（unused=${unusedCount}）。/admin から30件入力してください。`
      );
      return;
    }

    const assigned = allocateAssignedFlp(store, userId);
    u.assignedFlp = assigned;
    u.requestedAt = nowISO();

    const introName = u.introducerName || INTRODUCER_NAME;
    const introFlp = u.introducerFlp || INTRODUCER_FLP;

    const missing = [];
    if (!introName) missing.push("①紹介者氏名");
    if (!introFlp) missing.push("②紹介者FLP番号");
    if (!assigned) missing.push("③あなたのFLP番号(assignedFlp)");

    saveStore(store);

    if (missing.length > 0) {
      await replyText(event.replyToken, "現在、受付準備中です。紹介者へご連絡ください。");
      await notifyAdmin(`【アラート】登録希望が来ましたが情報不足：${missing.join(" / ")}\nuserId=${userId}`);
      return;
    }

    const msg =
      "あなたが登録するのに必要な3点をお送りします。\n" +
      `① 紹介者の氏名：${introName}\n` +
      `② 紹介者FLP番号：${introFlp}\n` +
      `③ あなたのFLP番号：${assigned}\n\n` +
      "下段に表示された「登録手順」を参考に登録してください。\n" +
      "登録が終わりましたら、青い画像の「3点をLINEで返信する」をタップして登録状況を送信してください。";

    await replyText(event.replyToken, msg);
    await notifyAdmin(`【登録希望】\nuserId=${userId}\nassignedFlp=${assigned}\nunused残=${getUnusedCount(store)}`);
    return;
  }

  await replyText(event.replyToken, "案内に従ってください。\n・登録希望\n・3点をLINEで返信する");
}

// ====== Start ======
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Server running on ${port}`);
  console.log(`BASE_URL=${BASE_URL || "(not set)"}`);
  console.log(`ADMIN_TOKEN=${ADMIN_TOKEN ? "(set)" : "(not set)"}`);
  console.log(`ADMIN_USER_ID=${ADMIN_USER_ID ? mask(ADMIN_USER_ID) : "(not set)"}`);
});
