import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

/**
 * =========================
 * ENV (Render > Environment)
 * =========================
 * CHANNEL_ACCESS_TOKEN
 * CHANNEL_SECRET
 *
 * INTRODUCER_NAME         例: 細井信孝
 * INTRODUCER_FLP          例: 203145165
 *
 * ADMIN_NOTIFY_USER_ID    例: Uxxxxxxxxxxxxxxxxxxxx  (紹介者AのuserId)
 * ADMIN_TOKEN             例: 任意の長い文字列
 *
 * FBO_GUIDE_URL           例: https://sites.google.com/view/vsh-official
 *
 * （任意）ASSIGNED_FLP_TIMEOUT_DAYS  例: 10
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

// raw body for signature verification
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
    res.status(200).send("OK"); // LINEには200を返す（再送抑止）
  }
});

// simple health check
app.get("/", (req, res) => res.send("VSH server is running"));

// =========================
// In-memory store (テスト用)
// 本番はDB推奨（Render再起動で消える）
// =========================
let flpUnused = []; // 未使用 assignedFlp のプール（順番に割当）
let flpAssigned = new Map(); // userId -> { flp, assignedAt }
let flpConsumed = new Map(); // userId -> { flp, consumedAt } 3点返信完了後
// ===================================

// Admin UI (simple)
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
  <span class="small">※ assignedは「登録希望」で割当済み（${TIMEOUT_DAYS}日で無効化されunusedへ戻る）</span>
</div>

<div class="card">
  <b>30件入力（改行でOK）</b>
  <form method="POST" action="/admin/pool?token=${encodeURIComponent(token)}">
    <textarea name="pool" placeholder="1行に1件ずつFLP番号を貼り付け（30行まとめ貼り付けOK）"></textarea>
    <p class="small">※ ここに入れた値はunusedプールに追加されます（重複は自動除外）</p>
    <button type="submit">追加する</button>
  </form>
</div>

<div class="card">
  <b>未使用プール（先頭10件プレビュー）</b>
  <pre>${escapeHtml(unusedPreview || "(empty)")}</pre>
</div>

<div class="card">
  <b>割当中（最大20件表示）</b>
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

  const existing = new Set([...flpUnused, ...Array.from(flpAssigned.values()).map(v => v.flp), ...Array.from(flpConsumed.values()).map(v => v.flp)]);
  let added = 0;
  for (const flp of lines) {
    if (!existing.has(flp)) {
      flpUnused.push(flp);
      existing.add(flp);
      added++;
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

// =========================
// LINE client
// =========================
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

// =========================
// Webhook handling
// =========================
async function handleWebhook(body) {
  const events = body.events || [];
  cleanupExpiredAssignments();

  for (const ev of events) {
    // 1) message(text)
    if (ev.type === "message" && ev.message?.type === "text") {
      const userId = ev.source?.userId;
      const text = (ev.message.text || "").trim();

      // ログ（Renderログで追える）
      console.log("[MSG]", { userId, text });

      if (!userId) continue;

      // --- Day7-1 表示（任意：キーワード応答を使うなら不要）
      if (text.toLowerCase() === "day7-1") {
        // ここは「応答メッセージ」に任せても良いので何もしない
        continue;
      }

      // --- 登録希望トリガー（ボタンが何を送ってきても拾う）
      // 旧：登録希望 / 新：day7-2 などブレても許容
      if (text === "登録希望" || text.toLowerCase() === "day7-2") {
        await onRegisterIntent(userId);
        continue;
      }

      // --- 3点返信フロー開始（任意のトリガー）
      if (text === "登録" || text === "3点返信" || text.toLowerCase() === "start") {
        await startThreePointsFlow(userId);
        continue;
      }

      // 3点入力ステート（簡易版）
      await handleThreePointsConversation(userId, text);
      continue;
    }

    // 2) message(image) → スクショ受信
    if (ev.type === "message" && ev.message?.type === "image") {
      const userId = ev.source?.userId;
      if (!userId) continue;
      console.log("[IMG]", { userId, messageId: ev.message.id });
      await handleScreenshot(userId, ev.message.id);
      continue;
    }

    // その他は無視
  }
}

// =========================
// Day7 core functions (③〜⑧)
// =========================

// ③ 登録希望 → ④ A通知 → ⑤ Bへ3点+URL → ⑧ unused減算(=割当消費ではなく、割当発生時にunused→assignedへ移す)
async function onRegisterIntent(userId) {
  // ⑤の「あなたのFLP番号」を割り当てる（来た順 1→30）
  const assigned = assignFlpToUser(userId);

  // Aへ④通知
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

  // Bへ⑤（3点）＋登録手順URL送付
  if (!assigned) {
    await safeReplyOrPush(userId, [
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
    ? `\n\n【フォーエバービジネスオーナー（FBO）登録手順】\n${FBO_GUIDE_URL}`
    : "";

  await safeReplyOrPush(userId, [
    {
      type: "text",
      text:
        "あなたが登録するのに必要な3点をお送りします。\n\n" +
        `① 紹介者の氏名：${INTRODUCER_NAME}\n` +
        `② 紹介者FLP番号：${INTRODUCER_FLP}\n` +
        `③ あなたのFLP番号：${assigned}\n\n` +
        "下段の「登録手順」を参考に登録してください。\n" +
        "登録が終わりましたら、青い画像の「3点をLINEで返信する」をタップして、案内に従って送信してください。" +
        guideUrlText,
    },
  ]);
}

// ⑥〜⑦の会話（簡易ステート）
const threePointsState = new Map(); // userId -> { step, name, flp, screenshotId }

async function startThreePointsFlow(userId) {
  threePointsState.set(userId, { step: 1, name: "", flp: "", screenshotId: "" });
  await safeReplyOrPush(userId, [
    { type: "text", text: "【3点返信を開始します】\n① 氏名 を入力してください" },
  ]);
}

async function handleThreePointsConversation(userId, text) {
  const st = threePointsState.get(userId);
  if (!st) return;

  if (st.step === 1) {
    st.name = text;
    st.step = 2;
    await safeReplyOrPush(userId, [
      { type: "text", text: "ありがとうございます。\n② あなたのFLP番号 を入力してください" },
    ]);
    return;
  }

  if (st.step === 2) {
    st.flp = text;
    st.step = 3;
    await safeReplyOrPush(userId, [
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

  // ⑦ Aへ3点送信（Bの割当FLPも添付）
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

  // ⑧ 在庫処理：assignedを消費（assigned→consumedへ移す）
  if (flpAssigned.has(userId)) {
    const v = flpAssigned.get(userId);
    flpAssigned.delete(userId);
    flpConsumed.set(userId, { flp: v.flp, consumedAt: Date.now() });
  }

  await safeReplyOrPush(userId, [
    {
      type: "text",
      text:
        "画像を受け取りました。ありがとうございます。\n" +
        "【登録情報が揃いました】\n" +
        "紹介者が確認後、次の案内を行います。",
    },
  ]);
}

// =========================
// FLP pool logic (来た順 1→30、10日で戻す)
// =========================
function assignFlpToUser(userId) {
  // 既に割当済みなら同じ値を返す（重複消費防止）
  if (flpAssigned.has(userId)) return flpAssigned.get(userId).flp;

  // 未使用が空なら割当できない
  if (flpUnused.length === 0) return null;

  const flp = flpUnused.shift(); // 先頭から割当（来た順）
  flpAssigned.set(userId, { flp, assignedAt: Date.now() });
  return flp;
}

function cleanupExpiredAssignments() {
  const now = Date.now();
  for (const [uid, v] of flpAssigned.entries()) {
    if (now - v.assignedAt > TIMEOUT_MS) {
      // 10日経過しても3点返信が来ない → 無効化してunusedへ戻す
      flpAssigned.delete(uid);
      // 既にunusedやconsumedに同じ値が存在しない場合のみ戻す
      if (!flpUnused.includes(v.flp)) flpUnused.push(v.flp);
      // Aへ通知（任意）
      safePush(ADMIN_NOTIFY_USER_ID, [
        {
          type: "text",
          text:
            `【期限切れ】3点返信が${TIMEOUT_DAYS}日以内に届かなかったため、割当FLPをunusedへ戻しました。\n` +
            `userId: ${uid}\n割当FLP: ${v.flp}`,
        },
      ]).catch(() => {});
    }
  }
}

// =========================
// helpers
// =========================
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

async function safeReplyOrPush(userId, messages) {
  // replyTokenが必要だが、ここでは簡略化のためpushを使用
  // ※本番はreplyToken対応も可能
  return safePush(userId, messages);
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
