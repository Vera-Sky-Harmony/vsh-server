import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

/**
 * ENV (Render > Environment)
 * CHANNEL_ACCESS_TOKEN
 * CHANNEL_SECRET
 *
 * INTRODUCER_NAME
 * INTRODUCER_FLP
 *
 * ADMIN_NOTIFY_USER_ID
 * ADMIN_TOKEN
 *
 * FBO_GUIDE_URL (任意)
 * ASSIGNED_FLP_TIMEOUT_DAYS (任意)
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

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error("Missing CHANNEL_ACCESS_TOKEN or CHANNEL_SECRET");
  process.exit(1);
}
if (!INTRODUCER_NAME || !INTRODUCER_FLP) {
  console.error("Missing INTRODUCER_NAME or INTRODUCER_FLP");
  process.exit(1);
}
if (!ADMIN_NOTIFY_USER_ID) {
  console.error("Missing ADMIN_NOTIFY_USER_ID (紹介者AのuserId)");
  process.exit(1);
}
if (!ADMIN_TOKEN) {
  console.error("Missing ADMIN_TOKEN");
  process.exit(1);
}

const TIMEOUT_DAYS = Number(ASSIGNED_FLP_TIMEOUT_DAYS || "10");
const TIMEOUT_MS = TIMEOUT_DAYS * 24 * 60 * 60 * 1000;

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

// ===== In-memory store（テスト用：Render再起動で消えます） =====
let flpUnused = [];
let flpAssigned = new Map(); // userId -> { flp, assignedAt }
let flpConsumed = new Map(); // userId -> { flp, consumedAt }

// 3点入力ステート
const threePointsState = new Map(); // userId -> { step, name, flp, screenshotId }

// ===== Webhook（署名検証のため raw body） =====
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    if (!verifyLineSignature(req)) {
      res.status(401).send("Bad signature");
      return;
    }
    const body = JSON.parse(req.body.toString("utf8"));
    await handleWebhook(body);
    res.status(200).send("OK");
  } catch (e) {
    console.error("Webhook error:", e);
    res.status(200).send("OK");
  }
});

app.get("/", (req, res) => res.send("VSH server is running"));

// ===== Admin UI =====
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
    .map(
      ([uid, v]) =>
        `${uid} => ${v.flp} (${new Date(v.assignedAt).toLocaleString()})`
    )
    .join("\n");

  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>VSH Admin</title>
<style>
body{font-family:system-ui, sans-serif; padding:16px; line-height:1.4}
textarea{width:100%; height:200px}
pre{background:#f6f6f6; padding:12px; overflow:auto}
.card{border:1px solid #ddd; padding:12px; margin:12px 0; border-radius:8px}
.small{color:#555; font-size:12px}
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
    <textarea name="pool" placeholder="1行に1件ずつFLP番号（まとめ貼り付けOK）"></textarea>
    <p class="small">※ unusedプールへ追加（重複は除外）</p>
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
  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const existing = new Set([
    ...flpUnused,
    ...Array.from(flpAssigned.values()).map((v) => v.flp),
    ...Array.from(flpConsumed.values()).map((v) => v.flp),
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
  threePointsState.clear();
  res.redirect(`/admin?token=${encodeURIComponent(token)}`);
});

// ===== Webhook core =====
async function handleWebhook(body) {
  const events = body.events || [];
  cleanupExpiredAssignments();

  for (const ev of events) {
    // テキスト
    if (ev.type === "message" && ev.message?.type === "text") {
      const userId = ev.source?.userId;
      if (!userId) continue;

      const rawText = (ev.message.text || "").trim();
      const text = normalize(rawText);

      console.log("[MSG]", { userId, rawText, text });

      // ③ 登録希望（改行混入も吸収）
      if (text.includes("登録希望") || text.includes("day7-2")) {
        await onRegisterIntent(userId);
        continue;
      }

      // ⑥ 3点返信開始（あなたの設定「3点返信開始」を必ず拾う）
      if (
        text.includes("3点返信開始") ||
        text.includes("3点返信") ||
        text.includes("start")
      ) {
        await startThreePointsFlow(userId);
        continue;
      }

      // 3点会話の続き
      await handleThreePointsConversation(userId, rawText);
      continue;
    }

    // 画像（スクショ）
    if (ev.type === "message" && ev.message?.type === "image") {
      const userId = ev.source?.userId;
      if (!userId) continue;
      console.log("[IMG]", { userId, messageId: ev.message.id });
      await handleScreenshot(userId, ev.message.id);
      continue;
    }
  }
}

function normalize(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/\r/g, "")
    .replace(/\s+/g, " "); // 改行/連続空白を1つに
}

// ===== ③〜⑧ =====
async function onRegisterIntent(userId) {
  const assigned = assignFlpToUser(userId);

  // ④ Aへ通知
  await safePush(ADMIN_NOTIFY_USER_ID, [
    {
      type: "text",
      text:
        `【登録希望 受信】\n` +
        `userId: ${userId}\n` +
        (assigned
          ? `割当FLP（あなたのFLP番号）: ${assigned}\n`
          : `割当FLP: （未割当：unusedが空）\n`) +
        `※Bへ自動返信を送信しました`,
    },
  ]);

  // ⑤ Bへ3点
  if (!assigned) {
    await safePush(userId, [
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

  const guideUrlText = FBO_GUIDE_URL
    ? `\n\n【FBO登録手順】\n${FBO_GUIDE_URL}`
    : "";

  await safePush(userId, [
    {
      type: "text",
      text:
        "あなたが登録するのに必要な3点をお送りします。\n\n" +
        `① 紹介者の氏名：${INTRODUCER_NAME}\n` +
        `② 紹介者FLP番号：${INTRODUCER_FLP}\n` +
        `③ あなたのFLP番号：${assigned}\n\n` +
        "登録が終わりましたら、青い画像の「3点をLINEで返信する」をタップしてください。\n" +
        "※もし画像が表示されない場合は、このトークで「3点返信開始」と送ってください（ボタンと同じ動作です）。" +
        guideUrlText,
    },
  ]);
}

// ⑥〜⑦
async function startThreePointsFlow(userId) {
  threePointsState.set(userId, { step: 1, name: "", flp: "", screenshotId: "" });
  await safePush(userId, [
    { type: "text", text: "【3点返信を開始します】\n① 氏名 を入力してください" },
  ]);
}

async function handleThreePointsConversation(userId, text) {
  const st = threePointsState.get(userId);
  if (!st) return;

  if (st.step === 1) {
    st.name = String(text).trim();
    st.step = 2;
    await safePush(userId, [
      { type: "text", text: "ありがとうございます。\n② あなたのFLP番号 を入力してください" },
    ]);
    return;
  }

  if (st.step === 2) {
    st.flp = String(text).trim();
    st.step = 3;
    await safePush(userId, [
      { type: "text", text: "③ 最後に【購入画面のスクリーンショット】を画像で送ってください" },
    ]);
    return;
  }
  // step3は画像待ち
}

async function handleScreenshot(userId, messageId) {
  const st = threePointsState.get(userId);
  if (!st || st.step !== 3) return;

  st.screenshotId = messageId;
  threePointsState.delete(userId);

  const assigned = flpAssigned.get(userId)?.flp || "(未割当)";

  // ⑦ Aへ3点送信
  await safePush(ADMIN_NOTIFY_USER_ID, [
    {
      type: "text",
      text:
        "【登録情報が揃いました】\n" +
        `・氏名：${st.name}\n` +
        `・あなたのFLP番号：${st.flp}\n` +
        `・割当FLP（あなたのFLP番号/発行元）：${assigned}\n` +
        `・スクショID：${st.screenshotId}\n` +
        `・userId：${userId}\n`,
    },
  ]);

  // ⑧ 在庫処理：assigned→consumed
  if (flpAssigned.has(userId)) {
    const v = flpAssigned.get(userId);
    flpAssigned.delete(userId);
    flpConsumed.set(userId, { flp: v.flp, consumedAt: Date.now() });
  }

  await safePush(userId, [
    {
      type: "text",
      text:
        "画像を受け取りました。ありがとうございます。\n" +
        "【登録情報が揃いました】\n" +
        "紹介者が確認後、次の案内を行います。",
    },
  ]);
}

// ===== FLP pool =====
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
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(req.body)
    .digest("base64");
  return hash === signature;
}

async function safePush(to, messages) {
  try {
    await client.pushMessage(to, messages);
  } catch (e) {
    console.error("pushMessage failed:", e?.originalError?.response?.data || e);
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
