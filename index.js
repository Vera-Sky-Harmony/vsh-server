import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

/**
 * ENV
 * CHANNEL_ACCESS_TOKEN
 * CHANNEL_SECRET
 * INTRODUCER_NAME
 * INTRODUCER_FLP
 * ADMIN_NOTIFY_USER_ID
 * ADMIN_TOKEN
 * FBO_GUIDE_URL (optional)
 * ASSIGNED_FLP_TIMEOUT_DAYS (optional)
 * PORT (Render)
 */

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  INTRODUCER_NAME,
  INTRODUCER_FLP,
  ADMIN_NOTIFY_USER_ID,
  ADMIN_TOKEN,
  FBO_GUIDE_URL,
  ASSIGNED_FLP_TIMEOUT_DAYS,
  PORT,
} = process.env;

function must(v, name) {
  if (!v) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
}

must(CHANNEL_ACCESS_TOKEN, "CHANNEL_ACCESS_TOKEN");
must(CHANNEL_SECRET, "CHANNEL_SECRET");
must(INTRODUCER_NAME, "INTRODUCER_NAME");
must(INTRODUCER_FLP, "INTRODUCER_FLP");
must(ADMIN_NOTIFY_USER_ID, "ADMIN_NOTIFY_USER_ID");
must(ADMIN_TOKEN, "ADMIN_TOKEN");

const TIMEOUT_DAYS = Number(ASSIGNED_FLP_TIMEOUT_DAYS || "10");
const TIMEOUT_MS = TIMEOUT_DAYS * 24 * 60 * 60 * 1000;

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

// ========= In-memory store (テスト用) =========
let flpUnused = []; // 未使用プール（先頭から割当）
let flpAssigned = new Map(); // userId -> { flp, assignedAt }
let flpConsumed = new Map(); // userId -> { flp, consumedAt }
// ============================================

// ===== Webhook (raw body for signature) =====
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    if (!verifyLineSignature(req)) {
      return res.status(401).send("Bad signature");
    }
    const body = JSON.parse(req.body.toString("utf8"));
    await handleWebhook(body);
    res.status(200).send("OK");
  } catch (e) {
    console.error("Webhook error:", e);
    res.status(200).send("OK");
  }
});

app.get("/", (_req, res) => res.send("VSH server is running"));

// ===== Admin =====
app.get("/admin", (req, res) => {
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(403).send("Forbidden");

  cleanupExpiredAssignments();

  const unusedCount = flpUnused.length;
  const assignedCount = flpAssigned.size;
  const consumedCount = flpConsumed.size;

  const unusedPreview = flpUnused.slice(0, 10).join("\n");
  const assignedList = Array.from(flpAssigned.entries())
    .slice(0, 20)
    .map(([uid, v]) => `${uid} => ${v.flp} (${new Date(v.assignedAt).toLocaleString()})`)
    .join("\n");

  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>VSH Admin</title>
<style>
body{font-family:system-ui,sans-serif;padding:16px;line-height:1.4}
textarea{width:100%;height:200px}
pre{background:#f6f6f6;padding:12px;overflow:auto}
.card{border:1px solid #ddd;padding:12px;margin:12px 0;border-radius:8px}
.small{color:#555;font-size:12px}
button{padding:10px 14px}
</style></head>
<body>
<h2>VSH Admin</h2>

<div class="card">
<b>Counts</b><br>
unused: <b>${unusedCount}</b> / assigned: <b>${assignedCount}</b> / consumed: <b>${consumedCount}</b><br>
<span class="small">※ assignedは「登録希望」で割当済み（${TIMEOUT_DAYS}日でunusedへ戻ります）</span>
</div>

<div class="card">
<b>FLPプール入力（改行でOK）</b>
<form method="POST" action="/admin/pool?token=${encodeURIComponent(token)}">
<textarea name="pool" placeholder="1行に1件ずつFLP番号を貼り付け（まとめ貼り付けOK）"></textarea>
<p class="small">※重複は自動除外</p>
<button type="submit">追加する</button>
</form>
</div>

<div class="card">
<b>未使用プール（先頭10件）</b>
<pre>${escapeHtml(unusedPreview || "(empty)")}</pre>
</div>

<div class="card">
<b>割当中（最大20件）</b>
<pre>${escapeHtml(assignedList || "(none)")}</pre>
</div>

<div class="card">
<b>操作</b><br>
<form method="POST" action="/admin/reset?token=${encodeURIComponent(token)}">
<button type="submit" onclick="return confirm('全部リセットしますか？')">リセット（テスト用）</button>
</form>
</div>
</body></html>`);
});

app.post("/admin/pool", express.urlencoded({ extended: false }), (req, res) => {
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(403).send("Forbidden");

  const raw = (req.body.pool || "").toString();
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const existing = new Set([
    ...flpUnused,
    ...Array.from(flpAssigned.values()).map(v => v.flp),
    ...Array.from(flpConsumed.values()).map(v => v.flp),
  ]);

  for (const flp of lines) {
    if (!existing.has(flp)) {
      flpUnused.push(flp);
      existing.add(flp);
    }
  }
  res.redirect(`/admin?token=${encodeURIComponent(token)}`);
});

app.post("/admin/reset", express.urlencoded({ extended: false }), (req, res) => {
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(403).send("Forbidden");
  flpUnused = [];
  flpAssigned.clear();
  flpConsumed.clear();
  res.redirect(`/admin?token=${encodeURIComponent(token)}`);
});

// ========= 3点返信ステート =========
const threePointsState = new Map(); // userId -> { step, name, flp }

async function handleWebhook(body) {
  cleanupExpiredAssignments();

  for (const ev of body.events || []) {
    const userId = ev.source?.userId;
    const replyToken = ev.replyToken;

    if (!userId) continue;

    // text
    if (ev.type === "message" && ev.message?.type === "text") {
      const text = (ev.message.text || "").trim();
      console.log("[MSG]", { userId, text });

      // 登録希望（Day7-1のボタンは「登録希望」を送る想定）
      if (text === "登録希望") {
        await onRegisterIntent(userId, replyToken);
        continue;
      }

      // 3点返信開始（Day7-2ボタンは「3点返信開始」を送る想定）
      if (text === "3点返信開始") {
        await startThreePointsFlow(userId, replyToken);
        continue;
      }

      // 会話継続
      await handleThreePointsConversation(userId, text, replyToken);
      continue;
    }

    // image
    if (ev.type === "message" && ev.message?.type === "image") {
      console.log("[IMG]", { userId, messageId: ev.message.id });
      await handleScreenshot(userId, ev.message.id, replyToken);
      continue;
    }
  }
}

// ===== Day7 ③〜⑧ =====
async function onRegisterIntent(userId, replyToken) {
  const assigned = assignFlpToUser(userId);

  // Aへ④通知
  await safePush(ADMIN_NOTIFY_USER_ID, [
    {
      type: "text",
      text:
        `【登録希望 受信】\n` +
        `userId: ${userId}\n` +
        (assigned ? `割当FLP（あなたのFLP番号）: ${assigned}\n` : `割当FLP: （未割当：unusedが空）\n`) +
        `※Bへ自動返信を送信しました`,
    },
  ]);

  if (!assigned) {
    await safeReplyOrPush(userId, replyToken, [
      {
        type: "text",
        text:
          "（登録希望を受け付けました）\n" +
          "ただいま準備中です。\n\n" +
          "「あなたのFLP番号」の未使用プールが空です。\n" +
          "紹介者へご連絡ください。",
      },
    ]);
    return;
  }

  const guideUrlText = FBO_GUIDE_URL ? `\n\n【FBO登録手順】\n${FBO_GUIDE_URL}` : "";

  // ⑤ Bへ3点情報（テキスト）
  await safeReplyOrPush(userId, replyToken, [
    {
      type: "text",
      text:
        "あなたが登録するのに必要な3点をお送りします。\n\n" +
        `① 紹介者の氏名：${INTRODUCER_NAME}\n` +
        `② 紹介者FLP番号：${INTRODUCER_FLP}\n` +
        `③ あなたのFLP番号：${assigned}\n\n` +
        "登録が終わりましたら、下のボタン「3点をLINEで返信する」を押して、案内に従って送信してください。" +
        guideUrlText,
    },
    buildDay7_2ButtonFlex(), // ★ここで“青ボタン相当”を必ず出す
  ]);
}

// Day7-2 相当（Flexボタン）
function buildDay7_2ButtonFlex() {
  return {
    type: "flex",
    altText: "3点をLINEで返信する",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "Vera.Sky Harmony", weight: "bold", size: "lg" },
          { type: "text", text: "登録完了後、3点を返信してください。", wrap: true },
          {
            type: "button",
            style: "primary",
            action: { type: "message", label: "3点をLINEで返信する", text: "3点返信開始" },
          },
        ],
      },
    },
  };
}

// ⑥〜⑦ 会話
async function startThreePointsFlow(userId, replyToken) {
  threePointsState.set(userId, { step: 1, name: "", flp: "" });
  await safeReplyOrPush(userId, replyToken, [
    { type: "text", text: "【3点返信を開始します】\n① 氏名 を入力してください" },
  ]);
}

async function handleThreePointsConversation(userId, text, replyToken) {
  const st = threePointsState.get(userId);
  if (!st) return;

  if (st.step === 1) {
    st.name = text;
    st.step = 2;
    await safeReplyOrPush(userId, replyToken, [
      { type: "text", text: "ありがとうございます。\n② あなたのFLP番号 を入力してください" },
    ]);
    return;
  }

  if (st.step === 2) {
    st.flp = text;
    st.step = 3;
    await safeReplyOrPush(userId, replyToken, [
      { type: "text", text: "③ 最後に【購入画面のスクリーンショット】を画像で送ってください" },
    ]);
    return;
  }
}

// ⑦スクショ受信→Aへ送る＋⑧在庫消費
async function handleScreenshot(userId, messageId, replyToken) {
  const st = threePointsState.get(userId);
  if (!st || st.step !== 3) return;

  threePointsState.delete(userId);

  const assigned = flpAssigned.get(userId)?.flp || "(未割当)";

  await safePush(ADMIN_NOTIFY_USER_ID, [
    {
      type: "text",
      text:
        "【登録情報が揃いました】\n" +
        `・氏名：${st.name}\n` +
        `・あなたのFLP番号：${st.flp}\n` +
        `・割当FLP（あなたのFLP番号/発行元）：${assigned}\n` +
        `・スクショID：${messageId}\n` +
        `・userId：${userId}\n`,
    },
  ]);

  // ⑧ assigned -> consumed
  if (flpAssigned.has(userId)) {
    const v = flpAssigned.get(userId);
    flpAssigned.delete(userId);
    flpConsumed.set(userId, { flp: v.flp, consumedAt: Date.now() });
  }

  await safeReplyOrPush(userId, replyToken, [
    {
      type: "text",
      text:
        "画像を受け取りました。ありがとうございます。\n" +
        "【登録情報が揃いました】\n" +
        "紹介者が確認後、次の案内を行います。",
    },
  ]);
}

// ===== pool logic =====
function assignFlpToUser(userId) {
  if (flpAssigned.has(userId)) return flpAssigned.get(userId).flp;
  if (flpUnused.length === 0) return null;

  const flp = flpUnused.shift();
  flpAssigned.set(userId, { flp, assignedAt: Date.now() });
  return flp;
}

function cleanupExpiredAssignments() {
  const now = Date.now();
  for (const [uid, v] of flpAssigned.entries()) {
    if (now - v.assignedAt > TIMEOUT_MS) {
      flpAssigned.delete(uid);
      if (!flpUnused.includes(v.flp)) flpUnused.push(v.flp);

      safePush(ADMIN_NOTIFY_USER_ID, [
        {
          type: "text",
          text:
            `【期限切れ】${TIMEOUT_DAYS}日以内に3点返信が届かなかったため、割当FLPをunusedへ戻しました。\n` +
            `userId: ${uid}\n割当FLP: ${v.flp}`,
        },
      ]).catch(() => {});
    }
  }
}

// ===== helpers =====
function verifyLineSignature(req) {
  const signature = req.headers["x-line-signature"];
  if (!signature) return false;
  const hash = crypto.createHmac("sha256", CHANNEL_SECRET).update(req.body).digest("base64");
  return hash === signature;
}

async function safePush(to, messages) {
  try {
    await client.pushMessage(to, messages);
  } catch (e) {
    console.error("pushMessage failed:", e?.originalError?.response?.data || e);
  }
}

async function safeReplyOrPush(userId, replyToken, messages) {
  try {
    if (replyToken) {
      await client.replyMessage(replyToken, messages);
    } else {
      await client.pushMessage(userId, messages);
    }
  } catch (e) {
    console.error("reply/push failed:", e?.originalError?.response?.data || e);
    try {
      await client.pushMessage(userId, messages);
    } catch (_) {}
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

app.listen(Number(PORT || 10000), () => {
  console.log("VSH server listening on port", PORT || 10000);
});
