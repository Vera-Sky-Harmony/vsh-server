/**
 * VSH server (Render) - index.js 全面差し替え版（暫定：紹介者固定 / Day7完成テスト用）
 *
 * ✅ この版でできること（今回のAプラン）
 * 1) 「登録希望」を押した瞬間に、最初の1回だけ登録者へ以下を自動送信
 *    - ①紹介者氏名（固定）
 *    - ②紹介者FLP番号（固定）
 *    - ③あなたのFLP番号（assignedFlp：プールから先着順に割当）
 *    - ＋ FBO登録手順URL
 * 2) 「3点をLINEで返信する」または「登録」で、氏名→FLP番号→スクショ の受付フロー（簡易）を実行
 *
 * ⚠️ 現時点（あなたの回答：NO）なので「誰の紹介か（世代連鎖）」判定は未実装です。
 *    まずDay7完成確認テストを確実に通すため、紹介者は固定（細井信孝 / 203145165）で動かします。
 *
 * -----------------------------
 * 【Render 環境変数に必須で入れるもの】
 * CHANNEL_ACCESS_TOKEN = (LINE Developersの長期チャネルアクセストークン)
 * CHANNEL_SECRET       = (LINE Developersのチャネルシークレット)
 *
 * 【このテスト版で使う（固定紹介者）】
 * INTRODUCER_NAME = 細井信孝
 * INTRODUCER_FLP  = 203145165
 * FBO_GUIDE_URL   = https://（あなたのVHS/登録手順ページURL）
 *
 * 【assignedFlp のプール（30件）】
 * ASSIGNED_FLP_POOL = 1行1件で貼り付け（改行区切り）
 * 例：
 * 123456789
 * 234567891
 * ...
 *
 * （任意）
 * ADMIN_NOTIFY_USER_ID = （紹介者AのLINE userId：通知を受けたい場合だけ）
 *
 * -----------------------------
 * 使い方（LINE側）
 * Day7のボタンは「アクションタイプ：テキスト」で
 *   - 登録希望
 *   - 3点をLINEで返信する
 * を送るように設定してください。
 */

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import line from "@line/bot-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== 必須ENV ======
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;

// ====== 固定紹介者（暫定） ======
const INTRODUCER_NAME = process.env.INTRODUCER_NAME || "細井信孝";
const INTRODUCER_FLP = process.env.INTRODUCER_FLP || "203145165";

// ====== 登録手順URL ======
const FBO_GUIDE_URL = process.env.FBO_GUIDE_URL || "";

// ====== 任意：紹介者へ通知したい場合（AのuserId） ======
const ADMIN_NOTIFY_USER_ID = process.env.ADMIN_NOTIFY_USER_ID || "";

// ====== assignedFlp プール（改行区切り） ======
const ASSIGNED_FLP_POOL_RAW = process.env.ASSIGNED_FLP_POOL || "";

// データ永続（Renderは環境によっては再起動で消えることがあります。テスト用途ならOK）
const DATA_FILE = path.join(__dirname, "vsh_data.json");

// ====== LINE SDK ======
if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error("Missing required env: CHANNEL_ACCESS_TOKEN / CHANNEL_SECRET");
}

const config = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET,
};

const client = new line.Client(config);

// ====== データ構造 ======
// data = {
//   unusedFlp: [ ... ],               // 未使用プール
//   assignedByUser: { [userId]: { flp, assignedAt } },  // ユーザーに割当済
//   sentIntroOnce: { [userId]: true }, // 「登録希望」への3点送信済フラグ
//   regFlow: { [userId]: { step, name, flp, screenshotId, startedAt } } // 3点返信フロー状態
// }

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      return sanitizeData(parsed);
    }
  } catch (e) {
    console.error("loadData error:", e);
  }
  // 初期化
  const initialPool = parseFlpPool(ASSIGNED_FLP_POOL_RAW);
  const fresh = {
    unusedFlp: initialPool,
    assignedByUser: {},
    sentIntroOnce: {},
    regFlow: {},
  };
  saveData(fresh);
  return fresh;
}

function sanitizeData(d) {
  return {
    unusedFlp: Array.isArray(d.unusedFlp) ? d.unusedFlp : [],
    assignedByUser: d.assignedByUser && typeof d.assignedByUser === "object" ? d.assignedByUser : {},
    sentIntroOnce: d.sentIntroOnce && typeof d.sentIntroOnce === "object" ? d.sentIntroOnce : {},
    regFlow: d.regFlow && typeof d.regFlow === "object" ? d.regFlow : {},
  };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("saveData error:", e);
  }
}

function parseFlpPool(raw) {
  // 改行区切りを想定（空行除去）
  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return lines;
}

function nowISO() {
  return new Date().toISOString();
}

function daysBetween(isoA, isoB) {
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

// ====== assignedFlp 割当（先着順） ======
function ensureAssignedFlp(data, userId) {
  // 既に割当済ならそれを返す
  if (data.assignedByUser[userId]?.flp) {
    return { ok: true, flp: data.assignedByUser[userId].flp, reused: true };
  }

  // 未使用プールから1つ取る
  const next = data.unusedFlp.shift();
  if (!next) {
    return { ok: false, reason: "NO_POOL" };
  }

  data.assignedByUser[userId] = { flp: next, assignedAt: nowISO() };
  saveData(data);
  return { ok: true, flp: next, reused: false };
}

// ====== 10日ルール（今回は“最低限”だけ実装：登録完了が来ない場合は回収できる） ======
// 今回の1時間タスクでは必須ではないので「手動で呼べる関数」として置いておきます。
// 将来：毎日バッチなどで回すのが理想。
function reclaimExpiredAssignedFlp(data) {
  const today = nowISO();
  const expiredUsers = [];
  for (const [userId, rec] of Object.entries(data.assignedByUser)) {
    const assignedAt = rec.assignedAt;
    const d = daysBetween(assignedAt, today);
    // 10日以上経過 かつ 3点返信フローが完了していない場合に回収
    const flow = data.regFlow[userId];
    const completed = flow && flow.step === "DONE";
    if (d >= 10 && !completed) {
      expiredUsers.push(userId);
      // 回収：unusedに戻す
      data.unusedFlp.push(rec.flp);
      delete data.assignedByUser[userId];
      // 送信済フラグは残してもよいが、今回はリセットして再割当可能にする
      delete data.sentIntroOnce[userId];
      delete data.regFlow[userId];
    }
  }
  if (expiredUsers.length > 0) saveData(data);
  return expiredUsers.length;
}

// ====== 返信テンプレ ======
function buildIntroMessage(assignedFlp) {
  const lines = [];
  lines.push("（登録希望を受け付けました）");
  lines.push("");
  lines.push("あなたが登録するのに必要な3点をお送りします。");
  lines.push(`① 紹介者の氏名：${INTRODUCER_NAME}`);
  lines.push(`② 紹介者FLP番号：${INTRODUCER_FLP}`);
  lines.push(`③ あなたのFLP番号：${assignedFlp}`);
  lines.push("");
  if (FBO_GUIDE_URL) {
    lines.push("下段に表示された「登録手順」を参考に登録してください。");
    lines.push("フォーエバービジネスオーナー（FBO）登録手順：");
    lines.push(FBO_GUIDE_URL);
    lines.push("");
  } else {
    lines.push("※登録手順URL（FBO_GUIDE_URL）が未設定です。Renderの環境変数に設定してください。");
    lines.push("");
  }
  lines.push("登録が終わりましたら、上の画面（青色）の「3点をLINEで返信する」をタップし、案内に従ってください。");
  return lines.join("\n");
}

function buildAlreadySentMessage(assignedFlp) {
  return [
    "（登録希望は既に受け付け済みです）",
    "",
    "必要な3点は既に送信しています。",
    `③ あなたのFLP番号：${assignedFlp}`,
    "",
    "登録完了後は「3点をLINEで返信する」をタップして、案内に従ってください。",
  ].join("\n");
}

function buildPoolEmptyAlert() {
  return [
    "現在、受付準備中です。",
    "紹介者へご連絡ください。",
    "",
    "（理由）あなたのFLP番号（assignedFlp）の未使用プールが不足しています。",
    "紹介者が管理画面で30件分のFLP番号を入力後、再度「登録希望」を押してください。",
  ].join("\n");
}

// ====== 登録フロー（3点返信） ======
function startRegFlow(data, userId) {
  data.regFlow[userId] = {
    step: "WAIT_NAME",
    name: "",
    flp: "",
    screenshotId: "",
    startedAt: nowISO(),
  };
  saveData(data);
}

function setRegFlowStep(data, userId, patch) {
  const cur = data.regFlow[userId] || {};
  data.regFlow[userId] = { ...cur, ...patch };
  saveData(data);
}

function buildRegStartMessage() {
  return [
    "【登録受付を開始します】",
    "① 氏名 を入力してください",
  ].join("\n");
}

function buildAskFlpMessage() {
  return [
    "ありがとうございます。",
    "② FLP番号 を入力してください",
  ].join("\n");
}

function buildAskScreenshotMessage() {
  return [
    "③ 最後に【購入画面のスクリーンショット】を画像で送ってください。",
  ].join("\n");
}

function buildRegCompletedMessage(name, flp, screenshotId, userId) {
  return [
    "画像を受け取りました。ありがとうございます。",
    "【登録情報が揃いました】",
    "・氏名",
    "・FLP番号",
    "・購入画面スクリーンショット",
    "",
    "紹介者が確認後、VSHを譲渡します。",
    "",
    "【登録完了】",
    `氏名：${name}`,
    `FLP：${flp}`,
    `スクショID：${screenshotId}`,
    `userId：${userId}`,
  ].join("\n");
}

// ====== Express ======
const app = express();

// Health check
app.get("/", (req, res) => {
  res.status(200).send("VSH server is running.");
});

// Debug: pool/status（簡易：ブラウザで確認用）
app.get("/debug/status", (req, res) => {
  const data = loadData();
  res.json({
    unusedCount: data.unusedFlp.length,
    assignedCount: Object.keys(data.assignedByUser).length,
    sentIntroOnceCount: Object.keys(data.sentIntroOnce).length,
  });
});

// Webhook endpoint
app.post("/callback", line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error("callback error:", err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  // userIdを扱えるイベントのみ
  const userId = event?.source?.userId;
  if (!userId) return;

  // 1) テキストメッセージ
  if (event.type === "message" && event.message.type === "text") {
    const text = (event.message.text || "").trim();

    // （任意）管理：期限回収コマンド（テスト用）
    if (text === "VSH_RECLAIM_10DAYS") {
      const data = loadData();
      const reclaimed = reclaimExpiredAssignedFlp(data);
      return client.replyMessage(event.replyToken, [{
        type: "text",
        text: `回収処理を実行しました。回収件数：${reclaimed}`,
      }]);
    }

    // A) Day7：登録希望
    if (text === "登録希望") {
      return onRegisterHope(event, userId);
    }

    // B) 3点返信フロー開始（ボタン or テキスト）
    if (text === "3点をLINEで返信する" || text === "登録") {
      const data = loadData();
      startRegFlow(data, userId);
      return client.replyMessage(event.replyToken, [{
        type: "text",
        text: buildRegStartMessage(),
      }]);
    }

    // C) 登録フロー中の入力受付
    const data = loadData();
    const flow = data.regFlow[userId];

    if (flow && flow.step === "WAIT_NAME") {
      setRegFlowStep(data, userId, { step: "WAIT_FLP", name: text });
      return client.replyMessage(event.replyToken, [{
        type: "text",
        text: buildAskFlpMessage(),
      }]);
    }

    if (flow && flow.step === "WAIT_FLP") {
      setRegFlowStep(data, userId, { step: "WAIT_SCREENSHOT", flp: text });
      return client.replyMessage(event.replyToken, [{
        type: "text",
        text: buildAskScreenshotMessage(),
      }]);
    }

    // それ以外：ガイド
    return client.replyMessage(event.replyToken, [{
      type: "text",
      text: [
        "案内に従ってください。",
        "・Day7の「登録希望」を押すと、3点＋登録手順URLが送られます。",
        "・登録後は「3点をLINEで返信する」を押すか「登録」と送って受付を開始します。",
      ].join("\n"),
    }]);
  }

  // 2) 画像（購入スクショ）受信
  if (event.type === "message" && event.message.type === "image") {
    const data = loadData();
    const flow = data.regFlow[userId];
    if (flow && flow.step === "WAIT_SCREENSHOT") {
      const screenshotId = event.message.id || "";
      setRegFlowStep(data, userId, {
        step: "DONE",
        screenshotId,
      });

      const name = flow.name || "(未入力)";
      const flp = flow.flp || "(未入力)";

      // 紹介者へ通知（任意）
      if (ADMIN_NOTIFY_USER_ID) {
        try {
          await client.pushMessage(ADMIN_NOTIFY_USER_ID, [{
            type: "text",
            text: [
              "【登録状況受信】",
              `氏名：${name}`,
              `FLP：${flp}`,
              `スクショID：${screenshotId}`,
              `userId：${userId}`,
            ].join("\n"),
          }]);
        } catch (e) {
          console.error("push to admin failed:", e);
        }
      }

      return client.replyMessage(event.replyToken, [{
        type: "text",
        text: buildRegCompletedMessage(name, flp, screenshotId, userId),
      }]);
    }

    // フロー外で画像が来た場合
    return client.replyMessage(event.replyToken, [{
      type: "text",
      text: "画像を受信しました。登録手続き中の場合は「登録」と送ってから、案内に従ってスクショを送ってください。",
    }]);
  }

  // その他イベントは無視
  return;
}

// ====== 「登録希望」処理：3点＋URLを最初の1回だけ送る ======
async function onRegisterHope(event, userId) {
  const data = loadData();

  // assignedFlpを確保
  const assigned = ensureAssignedFlp(data, userId);
  if (!assigned.ok) {
    // プールなし
    // （紹介者へアラートも可能）
    if (ADMIN_NOTIFY_USER_ID) {
      try {
        await client.pushMessage(ADMIN_NOTIFY_USER_ID, [{
          type: "text",
          text: [
            "【アラート】assignedFlpプール不足",
            `userId：${userId}`,
            "登録希望が押されましたが、未使用プールが空です。",
          ].join("\n"),
        }]);
      } catch (e) {
        console.error("push admin alert failed:", e);
      }
    }

    return client.replyMessage(event.replyToken, [{
      type: "text",
      text: buildPoolEmptyAlert(),
    }]);
  }

  const assignedFlp = assigned.flp;

  // 既に送ったことがあるか？
  const already = !!data.sentIntroOnce[userId];

  if (!already) {
    // 初回：3点＋URL送信（返信）
    data.sentIntroOnce[userId] = true;
    saveData(data);

    // 紹介者へ「登録希望」通知（任意）
    if (ADMIN_NOTIFY_USER_ID) {
      try {
        await client.pushMessage(ADMIN_NOTIFY_USER_ID, [{
          type: "text",
          text: [
            "【登録希望 受信】",
            `userId：${userId}`,
            `割当FLP（あなたのFLP番号）：${assignedFlp}`,
          ].join("\n"),
        }]);
      } catch (e) {
        console.error("push admin register-hope failed:", e);
      }
    }

    return client.replyMessage(event.replyToken, [{
      type: "text",
      text: buildIntroMessage(assignedFlp),
    }]);
  }

  // 2回目以降：再送しない（必要なら割当番号だけ見せる）
  return client.replyMessage(event.replyToken, [{
    type: "text",
    text: buildAlreadySentMessage(assignedFlp),
  }]);
}

// ====== start server ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`VSH server listening on port ${PORT}`);
});

