// src/index.js
import express from "express";
import { middleware, Client } from "@line/bot-sdk";
import crypto from "crypto";

// =========================
// Env
// =========================
const PORT = process.env.PORT || 10000;

const CHANNEL_SECRET = process.env.CHANNEL_SECRET || "";
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const BASE_URL = process.env.BASE_URL || ""; // 例: https://vsh-server.onrender.com

if (!CHANNEL_SECRET) console.warn("⚠️ CHANNEL_SECRET が未設定です");
if (!CHANNEL_ACCESS_TOKEN) console.warn("⚠️ CHANNEL_ACCESS_TOKEN が未設定です");

const lineConfig = {
  channelSecret: CHANNEL_SECRET,
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
};

const client = new Client(lineConfig);
const app = express();

// 重要：/callback より前に express.json() を app.use しないこと！！
// 署名検証が壊れます（SignatureValidationFailed の原因）

// =========================
// In-memory store
// （Renderは再起動で消える可能性あり：まずは動作確認優先）
// =========================
const state = {
  pool: [],            // 例: [361799161, ...] 30件
  assignedByUser: {},  // userId -> { flp, assignedAt }
  consumed: new Set(), // flp を消費済みにする場合に使用（今回は自動消費はしない）
};

// =========================
// Helpers
// =========================
function nowISO() {
  return new Date().toISOString();
}

function counts() {
  const assignedCount = Object.keys(state.assignedByUser).length;
  const consumedCount = state.consumed.size;
  const unusedCount = Math.max(state.pool.length - assignedCount - consumedCount, 0);
  return { unused: unusedCount, assigned: assignedCount, consumed: consumedCount };
}

function getNextUnusedFlp() {
  // poolの先頭から、まだ誰にも割当されてない & consumedでもない番号を探す
  const assignedFlps = new Set(Object.values(state.assignedByUser).map(v => String(v.flp)));
  for (const flp of state.pool) {
    const s = String(flp).trim();
    if (!assignedFlps.has(s) && !state.consumed.has(s)) return s;
  }
  return null;
}

function getUserIdFromEvent(ev) {
  // 可能な限り userId を取る
  return ev?.source?.userId || null;
}

async function replyText(replyToken, text) {
  if (!replyToken) return;
  await client.replyMessage(replyToken, { type: "text", text });
}

// =========================
// Admin UI (超簡易)
// =========================
function adminHtml() {
  const { unused, assigned, consumed } = counts();
  const assignedList = Object.entries(state.assignedByUser)
    .map(([uid, v], idx) => `${String(idx + 1).padStart(2, "0")}. ${v.flp}  [assigned]  to:${uid.slice(0, 6)}…  at:${v.assignedAt}`)
    .join("\n");

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>VSH Admin</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; padding:24px; max-width:900px; margin:0 auto;}
  .pill{display:inline-block; padding:8px 12px; border:1px solid #ddd; border-radius:999px; margin-right:8px;}
  textarea{width:100%; height:260px; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono"; font-size:14px;}
  pre{background:#f7f7f7; padding:12px; border-radius:12px; overflow:auto;}
  button{padding:10px 14px; border-radius:10px; border:1px solid #ddd; background:#111; color:#fff; cursor:pointer;}
  .muted{color:#666; font-size:13px;}
</style>
</head>
<body>
  <h1>VSH Admin</h1>
  <div>
    <span class="pill">unused: <b>${unused}</b></span>
    <span class="pill">assigned: <b>${assigned}</b></span>
    <span class="pill">consumed: <b>${consumed}</b></span>
  </div>

  <p class="muted">assignedFlp を改行区切りで貼り付け → 保存（上から30件のみ有効）</p>
  <form method="post" action="/admin/pool?token=${encodeURIComponent(ADMIN_TOKEN)}">
    <textarea name="pool" placeholder="例) 123456789&#10;234567890&#10;...">${state.pool.join("\n")}</textarea>
    <div style="margin-top:10px;">
      <button type="submit">保存する</button>
    </div>
  </form>

  <h3 style="margin-top:24px;">状態一覧（先頭）</h3>
  <pre>${assignedList || "(assigned なし)"}</pre>

  <p class="muted">URL: ${BASE_URL ? `${BASE_URL}/admin?token=...` : "BASE_URL 未設定"}</p>
</body>
</html>`;
}

// admin認証
function requireAdmin(req, res, next) {
  const t = req.query.token || "";
  if (!ADMIN_TOKEN || t !== ADMIN_TOKEN) {
    res.status(401).send("ADMIN_TOKEN not set / invalid");
    return;
  }
  next();
}

// admin routes（ここは json/body 必要なので個別に付与）
app.get("/admin", requireAdmin, (req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(adminHtml());
});

app.post(
  "/admin/pool",
  requireAdmin,
  express.urlencoded({ extended: false }),
  (req, res) => {
    const raw = (req.body?.pool || "").toString();
    const lines = raw
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 30);

    state.pool = lines;
    // poolを更新したら、consumedセットの整合性は今回は触らない（必要なら後で）
    res.redirect(`/admin?token=${encodeURIComponent(ADMIN_TOKEN)}`);
  }
);

// health
app.get("/", (req, res) => {
  res.status(200).send("ok");
});

// =========================
// LINE Webhook
// =========================
app.post("/callback", middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body?.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch (e) {
    console.error("handle webhook error:", e);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  // テキスト or ポストバックに対応
  const userId = getUserIdFromEvent(event);
  const replyToken = event.replyToken;

  // 1) 「登録希望」→ 即 割当
  const isRegisterHope =
    (event.type === "message" &&
      event.message?.type === "text" &&
      normalize(event.message.text) === "登録希望") ||
    (event.type === "postback" && normalize(event.postback?.data) === "register");

  if (isRegisterHope) {
    if (!userId) {
      await replyText(replyToken, "ユーザーIDが取得できませんでした。もう一度お試しください。");
      return;
    }

    // すでに割当済みなら同じ番号を返す
    const already = state.assignedByUser[userId];
    if (already?.flp) {
      await replyText(
        replyToken,
        `【あなたのFLP番号（割当済み）】\n${already.flp}\n\nこの番号を使って登録を進めてください。\n次に「3点をLINEで返信する」へ進み、\n①氏名 ②あなたのFLP番号 ③購入画面スクショ を送ってください。`
      );
      return;
    }

    // 未割当なら先頭から割当
    const flp = getNextUnusedFlp();
    if (!flp) {
      await replyText(replyToken, "申し訳ありません。現在、割り当て可能なFLP番号がありません。紹介者へご連絡ください。");
      return;
    }

    state.assignedByUser[userId] = { flp, assignedAt: nowISO() };

    await replyText(
      replyToken,
      `【あなたのFLP番号（自動割当）】\n${flp}\n\nこの番号を使って登録を進めてください。\n次に「3点をLINEで返信する」へ進み、\n①氏名 ②あなたのFLP番号 ③購入画面スクショ を送ってください。`
    );
    return;
  }

  // 2) 「3点をLINEで返信する」→ 手順案内（割当はしない）
  const isThreePoints =
    (event.type === "message" &&
      event.message?.type === "text" &&
      normalize(event.message.text) === "3点をlineで返信する") ||
    (event.type === "postback" && normalize(event.postback?.data) === "three_points");

  if (isThreePoints) {
    await replyText(
      replyToken,
      `【登録受付を開始します】\n① 氏名 を入力してください\n\n② あなたのFLP番号 を入力してください\n\n③ 最後に【購入画面のスクリーンショット】を画像で送ってください`
    );
    return;
  }

  // その他は無反応（必要ならログだけ）
  return;
}

function normalize(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/　+/g, "");
}

// =========================
// Start
// =========================
app.listen(PORT, () => {
  const { unused, assigned, consumed } = counts();
  console.log(`VSH server listening on ${PORT}`);
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`ADMIN_TOKEN=${ADMIN_TOKEN ? "有" : "無"}`);
  console.log(`CHANNEL_SECRET=${CHANNEL_SECRET ? "有" : "無"}`);
  console.log(`CHANNEL_ACCESS_TOKEN=${CHANNEL_ACCESS_TOKEN ? "有" : "無"}`);
  console.log(`プール:未使用=${unused} 割り当て=${assigned} 消費=${consumed}`);
  if (BASE_URL) console.log(`Admin: ${BASE_URL}/admin?token=...`);
  console.log(`Webhook: ${BASE_URL ? `${BASE_URL}/callback` : "/callback"}`);
});
