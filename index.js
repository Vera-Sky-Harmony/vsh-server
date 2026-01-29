import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

/**
 * ENV (Render > Environment)
 * CHANNEL_ACCESS_TOKEN
 * CHANNEL_SECRET
 * INTRODUCER_NAME
 * INTRODUCER_FLP
 * ADMIN_NOTIFY_USER_ID   (紹介者AのuserId)
 * ADMIN_TOKEN
 * FBO_GUIDE_URL          (任意)
 * ASSIGNED_FLP_TIMEOUT_DAYS (任意 / default 10)
 * PORT (Renderが自動付与)
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

/** =========================
 * In-memory store (テスト用)
 * Render再起動で消えます（今はOK）
 * ========================= */
let flpUnused = [];
let flpAssigned = new Map(); // userId -> { flp, assignedAt }
let flpConsumed = new Map(); // userId -> { flp, consumedAt }
const threePointsState = new Map(); // userId -> { step, name, flp, screenshotId }

/** =========================
 * Webhook
 * ========================= */
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
    // LINE再送抑止
    res.status(200).send("OK");
  }
});

app.get("/", (req, res) => res.send("VSH server is running"));

/** =========================
 * Admin
 * ========================= */
app.get("/admin", (req, res) => {
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(403).send("Forbidden");

  cleanupExpiredAssignments();

  const unusedCount = flpUnused.length;
  const assignedCount = flpAssigned.size;
  const consumedCount = flpConsumed.size;

  const unusedPreview = flpUnused.slice(0, 10).join("\n");
  const assignedList = Array.from(flpAssigned.entries())
    .slice(0, 30)
    .map(([uid, v]) => `${uid} => ${v.flp} (${new Date(v.assignedAt).toLocaleString()})`)
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
  <span class="small">assignedは「登録希望」で割当済み（${TIMEOUT_DAYS}日でunusedへ戻る）</span>
</div>

<div class="card">
  <b>FLPプール投入（改行でOK）</b>
  <form method="POST" action="/admin/pool?token=${encodeURIComponent(token)}">
    <textarea name="pool" placeholder="1行に1件ずつFLP番号を貼り付け"></textarea>
    <p class="small">重複は自動除外</p>
    <button type="submit">追加する</button>
  </form>
</div>

<div class="card">
  <b>未使用プール（先頭10件）</b>
  <pre>${escapeHtml(unusedPreview || "(empty)")}</pre>
</div>

<div class="card">
  <b>割当中（最大30件）</b>
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

/** =========================
 * Webhook handler
 * ========================= */
async function handleWebhook(body) {
  const events = body.events || [];
  cleanupExpiredAssignments();

  for (const ev of events) {
    const userId = ev.source?.userId;

    // 受信ログ（重要：ここで textRaw が改行混在しても追える）
    if (ev.type === "message") {
      console.log("[EVENT]", {
        type: ev.type,
        msgType: ev.message?.type,
        userId,
        textRaw: ev.message?.text,
      });
    }

    if (!userId) continue;

    // text
    if (ev.type === "message" && ev.message?.type === "text") {
      const replyToken = ev.replyToken;
      const textRaw = (ev.message.text || "").toString();

      // 正規化：改行/タブ/全角スペースも潰して判定
      const text = normalizeText(textRaw);

      // ③ 登録希望トリガー：
      // - 登録希望（Day7-1）
      // - day7-2（混入してくるケース対策）
      // - 「登録希望\nDay7-2」等も normalize で拾う
      if (isRegisterIntent(textRaw, text)) {
        await onRegisterIntent(userId, replyToken);
        continue;
      }

      // ⑥ 3点返信開始（Day7-2）
      if (isThreePointsStart(textRaw, text)) {
        await startThreePointsFlow(userId, replyToken);
        continue;
      }

      // 3点会話中
      await handleThreePointsConversation(userId, replyToken, textRaw);
      continue;
    }

    // image (スクショ)
    if (ev.type === "message" && ev.message?.type === "image") {
      const replyToken = ev.replyToken;
      await handleScreenshot(userId, replyToken, ev.message.id);
      continue;
    }
  }
}

/** =========================
 * 判定（ここが今回の肝）
 * ========================= */
function normalizeText(s) {
  return String(s)
    .replace(/\u3000/g, " ") // 全角スペース→半角
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isRegisterIntent(textRaw, textNorm) {
  // rawに「登録希望」が含まれていたら最優先で登録希望
  if (String(textRaw).includes("登録希望")) return true;

  // 旧テストで「day7-2」が混入するケースがあるので救済
  if (textNorm === "day7-2") return true;

  // 「登録希望 day7-2」など混在も救済
  if (textNorm.includes("登録希望")) return true;

  return false;
}

function isThreePointsStart(textRaw, textNorm) {
  // 正式トリガー
  if (String(textRaw).includes("3点返信開始")) return true;
  if (textNorm.includes("3点返信開始")) return true;

  // 念のため旧トリガーも許容（保険）
  if (textNorm === "3点返信") return true;
  if (textNorm === "start") return true;

  return false;
}

/** =========================
 * ③〜⑤：登録希望
 * ========================= */
async function onRegisterIntent(userId, replyToken) {
  const assigned = assignFlpToUser(userId);

  // ④ Aへ通知（必ず詳細で送る）
  await safePush(ADMIN_NOTIFY_USER_ID, [
    {
      type: "text",
      text:
        `【登録希望 受信】\n` +
        `userId: ${userId}\n` +
        (assigned ? `割当FLP（あなたのFLP番号）：${assigned}\n` : `割当FLP：未割当（unusedが空）\n`) +
        `（Bへ自動返信を送信）`,
    },
  ]);

  // ⑤ Bへ3点 + 手順URL
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

  await safeReplyOrPush(userId, replyToken, [
    {
      type: "text",
      text:
        "あなたが登録するのに必要な3点をお送りします。\n\n" +
        `① 紹介者の氏名：${INTRODUCER_NAME}\n` +
        `② 紹介者FLP番号：${INTRODUCER_FLP}\n` +
        `③ あなたのFLP番号：${assigned}\n\n` +
        "登録が終わりましたら、青い画像の「3点をLINEで返信する」をタップして、案内に従って送信してください。" +
        guideUrlText,
    },
  ]);
}

/** =========================
 * ⑥〜⑦：3点返信フロー
 * ========================= */
async function startThreePointsFlow(userId, replyToken) {
  threePointsState.set(userId, { step: 1, name: "", flp: "", screenshotId: "" });

  await safeReplyOrPush(userId, replyToken, [
    { type: "text", text: "【3点返信を開始します】\n① 氏名 を入力してください" },
  ]);
}

async function handleThreePointsConversation(userId, replyToken, textRaw) {
  const st = threePointsState.get(userId);
  if (!st) return;

  const text = String(textRaw || "").trim();

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

  // step3 は画像待ち
}

async function handleScreenshot(userId, replyToken, messageId) {
  const st = threePointsState.get(userId);
  if (!st || st.step !== 3) {
    // 3点開始前に画像が来た場合の案内
    await safeReplyOrPush(userId, replyToken, [
      { type: "text", text: "スクリーンショットを受信しました。\n先に「3点返信開始」を押して、案内どおりに送信してください。" },
    ]);
    return;
  }

  st.screenshotId = messageId;
  threePointsState.delete(userId);

  // ⑦ Aへ3点送信
  const assigned = flpAssigned.get(userId)?.flp || "(未割当)";
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

  // ⑧ 在庫処理：assigned → consumed
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

/** =========================
 * FLP pool
 * ========================= */
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

/** =========================
 * helpers
 * ========================= */
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
      return;
    }
  } catch (e) {
    console.error("replyMessage failed (fallback to push):", e?.originalError?.response?.data || e);
  }
  await safePush(userId, messages);
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
