import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

/**
 * ===== 必須 ENV =====
 * CHANNEL_ACCESS_TOKEN
 * CHANNEL_SECRET
 * INTRODUCER_NAME         例: 細井信孝
 * INTRODUCER_FLP          例: 203145165
 * ADMIN_NOTIFY_USER_ID    例: Uxxxxxxxxxxxxxxxxxxxx （紹介者AのuserId）
 * ADMIN_TOKEN             例: 任意の長い文字列
 * DAY7_2_IMAGE_URL        例: https://res.cloudinary.com/.../day7-2.png
 * FLP_OFFICIAL_URL        例: https://www.flpj.co.jp
 * ENTRY_GUIDE_URL         例: https://sites.google.com/view/vsh-entry-guide/ホーム
 *
 * ===== 任意 =====
 * ASSIGNED_FLP_TIMEOUT_DAYS 例: 10
 * PORT（Renderが自動で入れることが多い）
 */

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  INTRODUCER_NAME,
  INTRODUCER_FLP,
  ADMIN_NOTIFY_USER_ID,
  ADMIN_TOKEN,
  DAY7_2_IMAGE_URL,
  FLP_OFFICIAL_URL,
  ENTRY_GUIDE_URL,
  ASSIGNED_FLP_TIMEOUT_DAYS,
  PORT,
} = process.env;

function must(v, name) {
  if (!v) {
    console.error(`Missing ENV: ${name}`);
    process.exit(1);
  }
  return v;
}

must(CHANNEL_ACCESS_TOKEN, "CHANNEL_ACCESS_TOKEN");
must(CHANNEL_SECRET, "CHANNEL_SECRET");
must(INTRODUCER_NAME, "INTRODUCER_NAME");
must(INTRODUCER_FLP, "INTRODUCER_FLP");
must(ADMIN_NOTIFY_USER_ID, "ADMIN_NOTIFY_USER_ID");
must(ADMIN_TOKEN, "ADMIN_TOKEN");
must(DAY7_2_IMAGE_URL, "DAY7_2_IMAGE_URL");
must(FLP_OFFICIAL_URL, "FLP_OFFICIAL_URL");
must(ENTRY_GUIDE_URL, "ENTRY_GUIDE_URL");

const TIMEOUT_DAYS = Number(ASSIGNED_FLP_TIMEOUT_DAYS || "10");
const TIMEOUT_MS = TIMEOUT_DAYS * 24 * 60 * 60 * 1000;

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/**
 * ==========
 * データ（テスト用：メモリ）
 * ※Render再起動で消えます。本番はDB推奨
 * ==========
 */
let flpUnused = []; // 未使用（30件）プール
let flpAssigned = new Map(); // userId -> { flp, assignedAt }
let flpConsumed = new Map(); // userId -> { flp, consumedAt }

/**
 * 3点返信ステート
 * userId -> { step: 1|2|3, name, flp }
 */
const threePointsState = new Map();

/**
 * ==========
 * Health
 * ==========
 */
app.get("/", (_req, res) => res.send("VSH server is running"));

/**
 * ==========
 * Admin
 * ==========
 */
app.get("/admin", (req, res) => {
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(403).send("Forbidden");

  cleanupExpiredAssignments();

  const unusedCount = flpUnused.length;
  const assignedCount = flpAssigned.size;
  const consumedCount = flpConsumed.size;

  const unusedPreview = flpUnused.slice(0, 20).join("\n");
  const assignedList = Array.from(flpAssigned.entries())
    .slice(0, 50)
    .map(
      ([uid, v]) =>
        `${uid} => ${v.flp} (${new Date(v.assignedAt).toLocaleString()})`
    )
    .join("\n");

  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>VSH Admin</title>
<style>
body{font-family:system-ui, sans-serif; padding:16px; line-height:1.5}
textarea{width:100%; height:220px}
pre{background:#f6f6f6; padding:12px; overflow:auto}
.card{border:1px solid #ddd; padding:12px; margin:12px 0; border-radius:10px}
.small{color:#555; font-size:12px}
button{padding:10px 14px; border-radius:10px; border:1px solid #bbb; cursor:pointer}
</style></head>
<body>
<h2>VSH Admin</h2>

<div class="card">
  <b>Counts</b><br>
  unused: <b>${unusedCount}</b> / assigned: <b>${assignedCount}</b> / consumed: <b>${consumedCount}</b><br>
  <div class="small">※ assignedは「登録希望」で割当済み。${TIMEOUT_DAYS}日で期限切れ→unusedへ戻ります。</div>
</div>

<div class="card">
  <b>FLP番号を投入（1行1件・まとめ貼り付けOK）</b>
  <form method="POST" action="/admin/pool?token=${encodeURIComponent(token)}">
    <textarea name="pool" placeholder="例：\\n123...\\n456...\\n（30行まとめ貼り付けOK）"></textarea>
    <div class="small">※ 重複は自動で除外します。</div>
    <button type="submit">unusedへ追加</button>
  </form>
</div>

<div class="card">
  <b>unused（先頭20件）</b>
  <pre>${escapeHtml(unusedPreview || "(empty)")}</pre>
</div>

<div class="card">
  <b>assigned（最大50件）</b>
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

/**
 * ==========
 * Webhook（署名検証のため raw）
 * ==========
 */
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
    // LINEには200を返す（再送を抑止）
    res.status(200).send("OK");
  }
});

/**
 * ==========
 * Webhook 本体
 * ==========
 */
async function handleWebhook(body) {
  const events = body.events || [];
  cleanupExpiredAssignments();

  for (const ev of events) {
    if (!ev?.source?.userId) continue;
    const userId = ev.source.userId;

    // テキスト受信
    if (ev.type === "message" && ev.message?.type === "text") {
      const text = (ev.message.text || "").trim();

      console.log("[MSG]", { userId, text });

      // ① Day7-1 黄色の「登録希望」トリガー
      if (text === "登録希望") {
        await onRegisterIntent(userId);
        continue;
      }

      // ② 青（Day7-2相当）ボタンが送るトリガー
      if (text === "3点返信開始") {
        await startThreePointsFlow(userId);
        continue;
      }

      // ③ 3点入力会話（氏名/FLP番号）
      await handleThreePointsConversation(userId, text);
      continue;
    }

    // 画像（スクショ）受信
    if (ev.type === "message" && ev.message?.type === "image") {
      console.log("[IMG]", { userId, messageId: ev.message.id });
      await handleScreenshot(userId, ev.message.id);
      continue;
    }
  }
}

/**
 * ==========
 * Day7 コア
 * ==========
 * 登録希望 → A通知 / プール割当 / Bへ送信（青+説明+URL+手順書URL）
 */
async function onRegisterIntent(userId) {
  // ② VSH Admin unused -1（unused→assigned）
  const assignedFlp = assignFlpToUser(userId);

  // ① Aへ通知（まずは確実に「登録希望」を飛ばす）
  await safePush(ADMIN_NOTIFY_USER_ID, [
    {
      type: "text",
      text:
        `【登録希望 受信】\n` +
        `userId: ${userId}\n` +
        (assignedFlp
          ? `割当（あなたのFLP番号）: ${assignedFlp}\n`
          : `割当: 失敗（unusedが空）\n`) +
        `※Bへ返信送信を実行`,
    },
  ]);

  // unusedが空ならBへ警告
  if (!assignedFlp) {
    await safePush(userId, [
      {
        type: "text",
        text:
          "（登録希望を受け付けました）\n\n" +
          "現在、受付準備中です。紹介者へご連絡ください。\n" +
          "※「あなたのFLP番号」未使用プールが空です。",
      },
    ]);
    return;
  }

  // ③ Bへ自動送信（青画像＝Flex＋ボタン）
  const messages = [];

  // 青画像：画像＋「3点をLINEで返信する」ボタン（押すと "3点返信開始" を送る）
  messages.push(buildDay7BlueFlex());

  // 登録説明文（あなたの文面を“実運用向けに読みやすく整形”）
  messages.push({
    type: "text",
    text:
      "🌟1週間ありがとうございました！\n" +
      "あなたが登録すると、この✨Vera.Sky.Harmony✨があなたにプレゼントされます。\n" +
      "AIが「紹介・登録・教育・拡散」をすべて代行し、あなたのもとに健康と繁栄の輪が広がります🌿\n\n" +
      "下の【登録希望】ボタンを押すと、登録に必要な3点（紹介者氏名・紹介者FLP番号・あなたのFLP番号）をお送りします。\n\n" +
      "【登録】はFLP公式サイトから行います。\n" +
      `${FLP_OFFICIAL_URL}\n\n` +
      "左上メニュー → 下段「会員登録」からFBO登録申請を行い、\n" +
      "登録セット：「登録らくらく３本入アロエベラジュース１L」（12,420円・0.575CC）を購入して完了です。\n" +
      "🔐クーリングオフ制度がありますので、安心して登録してください。",
  });

  // 3点（紹介者情報＋あなたのFLP番号）を送る
  messages.push({
    type: "text",
    text:
      "あなたが登録するのに必要な3点をお送りします。\n\n" +
      `① 紹介者氏名：${INTRODUCER_NAME}\n` +
      `② 紹介者FLP番号：${INTRODUCER_FLP}\n` +
      `③ あなたのFLP番号：${assignedFlp}\n\n` +
      "登録が終わりましたら、上の青いボタン【3点をLINEで返信する】を押して、案内に従って送信してください。",
  });

  // 登録手順書URL（タイトル＋URLのみ）
  messages.push({
    type: "text",
    text:
      "📘 登録手順書（タップして確認）\n" +
      `${ENTRY_GUIDE_URL}\n\n` +
      "※手順書は今後、ここに追記・更新していけば自動で最新になります。",
  });

  await safePush(userId, messages);
}

/**
 * 青画像（Day7-2）を「URL化」ではなく、
 * “LINE内で押せるボタン” にして確実に3点フローを開始するFlex
 */
function buildDay7BlueFlex() {
  return {
    type: "flex",
    altText: "3点をLINEで返信する",
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url: DAY7_2_IMAGE_URL,
        size: "full",
        aspectMode: "cover",
        aspectRatio: "20:13",
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "登録が終わったら、ここから3点返信を開始します",
            wrap: true,
            size: "sm",
          },
          {
            type: "button",
            style: "primary",
            action: {
              type: "message",
              label: "3点をLINEで返信する",
              text: "3点返信開始",
            },
          },
        ],
      },
    },
  };
}

/**
 * ==========
 * 3点返信フロー
 * ==========
 */
async function startThreePointsFlow(userId) {
  threePointsState.set(userId, { step: 1, name: "", flp: "" });
  await safePush(userId, [
    { type: "text", text: "【3点返信を開始します】\n① 氏名 を入力してください" },
  ]);
}

async function handleThreePointsConversation(userId, text) {
  const st = threePointsState.get(userId);
  if (!st) return;

  if (st.step === 1) {
    st.name = text;
    st.step = 2;
    await safePush(userId, [
      { type: "text", text: "ありがとうございます。\n② あなたのFLP番号 を入力してください" },
    ]);
    return;
  }

  if (st.step === 2) {
    st.flp = text;
    st.step = 3;
    await safePush(userId, [
      { type: "text", text: "③ 最後に【購入画面のスクリーンショット】を画像で送ってください" },
    ]);
    return;
  }

  // step3 は画像待ち
}

async function handleScreenshot(userId, messageId) {
  const st = threePointsState.get(userId);
  if (!st || st.step !== 3) return;

  threePointsState.delete(userId);

  // Aへ 3点送信（⑦）
  const assigned = flpAssigned.get(userId)?.flp || "(未割当)";
  await safePush(ADMIN_NOTIFY_USER_ID, [
    {
      type: "text",
      text:
        "【登録情報が揃いました】\n" +
        `・氏名：${st.name}\n` +
        `・あなたのFLP番号：${st.flp}\n` +
        `・割当（あなたのFLP番号/発行元）：${assigned}\n` +
        `・スクショID：${messageId}\n` +
        `・userId：${userId}`,
    },
  ]);

  // ⑧ 在庫：assigned → consumed（3点返信完了で消費確定）
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
        "紹介者が確認後、次の案内を行います。",
    },
  ]);
}

/**
 * ==========
 * プール割当（来た順 1→30）
 * ==========
 */
function assignFlpToUser(userId) {
  // 既に割当済みなら同じ値
  if (flpAssigned.has(userId)) return flpAssigned.get(userId).flp;

  // unused が空
  if (flpUnused.length === 0) return null;

  const flp = flpUnused.shift();
  flpAssigned.set(userId, { flp, assignedAt: Date.now() });
  return flp;
}

/**
 * ==========
 * 期限切れ（10日）で unused に戻す
 * ==========
 */
function cleanupExpiredAssignments() {
  const now = Date.now();
  for (const [uid, v] of flpAssigned.entries()) {
    if (now - v.assignedAt > TIMEOUT_MS) {
      flpAssigned.delete(uid);
      if (!flpUnused.includes(v.flp)) flpUnused.push(v.flp);

      // Aへ通知（失敗してもOK）
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

/**
 * ==========
 * 署名検証
 * ==========
 */
function verifyLineSignature(req) {
  const signature = req.headers["x-line-signature"];
  if (!signature) return false;

  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(req.body)
    .digest("base64");

  return hash === signature;
}

/**
 * ==========
 * helper
 * ==========
 */
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
