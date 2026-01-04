import express from "express";
import * as line from "@line/bot-sdk";

const app = express();
const PORT = process.env.PORT || 3000;

// ====== LINE 設定（Renderの環境変数）======
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};

if (!config.channelSecret || !config.channelAccessToken) {
  console.error("Missing env vars: CHANNEL_SECRET / CHANNEL_ACCESS_TOKEN");
}

// 新SDK（@line/bot-sdk v9系）の Messaging API クライアント
const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

// ====== メモリ保存（最初はこれでOK）======
// userId ごとに状態を保持（サーバー再起動で消えます）
const userStates = new Map();
// 例：{ step: "name"|"flp"|"image"|"done", name:"", flp:"", imageMessageId:"", updatedAt: 1234567890 }

const STEP = {
  NONE: "none",
  NAME: "name",
  FLP: "flp",
  IMAGE: "image",
  DONE: "done",
};

// ====== 便利関数 ======
function getState(userId) {
  if (!userStates.has(userId)) {
    userStates.set(userId, {
      step: STEP.NONE,
      name: "",
      flp: "",
      imageMessageId: "",
      updatedAt: Date.now(),
    });
  }
  return userStates.get(userId);
}

function setStep(state, step) {
  state.step = step;
  state.updatedAt = Date.now();
}

function resetState(state) {
  state.step = STEP.NONE;
  state.name = "";
  state.flp = "";
  state.imageMessageId = "";
  state.updatedAt = Date.now();
}

function looksLikeName(text) {
  // 厳密でなくてOK（最初は緩め）
  // 1〜30文字でOK、数字だけは除外
  if (!text) return false;
  if (/^\d+$/u.test(text)) return false;
  return text.length >= 1 && text.length <= 30;
}

function normalizeFLP(text) {
  // 全角→半角などの厳密は後回し。まず数字抽出でOK
  const digits = (text || "").replace(/[^\d]/g, "");
  return digits;
}

function isValidFLPNumber(flpDigits) {
  // FLP番号の桁数が確定していない場合に備え、まずは「6〜12桁」くらいを許容
  // 必要なら後で「必ず9桁」などに変更できます
  return flpDigits.length >= 6 && flpDigits.length <= 12;
}

async function reply(replyToken, text) {
  return client.replyMessage({
    replyToken,
    messages: [{ type: "text", text }],
  });
}

// ====== ルーティング ======
app.get("/", (req, res) => {
  res.send("Vera Sky Harmony Server is running");
});

// Webhook（署名検証あり）
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    console.log("Webhook received:", JSON.stringify(req.body));
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).end();
  }
});

// ====== 登録フロー本体 ======
async function handleEvent(event) {
  // userId が取れないイベントはスキップ
  const userId = event?.source?.userId;
  if (!userId) return;

  // フォローイベント（友だち追加）など
  if (event.type === "follow") {
    const state = getState(userId);
    resetState(state);
    return reply(
      event.replyToken,
      "ようこそ Vera.Sky.Harmony へ！\n「登録」と送ると、登録の受付を開始します。"
    );
  }

  // メッセージ以外は基本スキップ（必要なら後で拡張）
  if (event.type !== "message") return;

  const state = getState(userId);

  // ===== 画像（スクショ）受信 =====
  if (event.message.type === "image") {
    if (state.step !== STEP.IMAGE) {
      // まだ画像の段階ではない
      return reply(
        event.replyToken,
        "画像ありがとうございます。\nただいま画像を受け取る段階ではありません。\n先に「登録」と送るか、案内に従ってください。"
      );
    }

    // 画像は message.id を保存（画像そのものは後で取得可能）
    state.imageMessageId = event.message.id;
    setStep(state, STEP.DONE);

    // ここで「紹介者通知」へつなげる（次フェーズで実装）
    return reply(
      event.replyToken,
      "購入スクショを受け取りました。\nこれで【氏名・FLP番号・スクショ】の3点が揃いました。\n紹介者確認後、VSHを譲渡します。"
    );
  }

  // ===== テキスト受信 =====
  if (event.message.type === "text") {
    const text = (event.message.text || "").trim();

    // --- 共通コマンド（いつでも効く）---
    if (text === "キャンセル" || text === "中止" || text === "やめる") {
      resetState(state);
      return reply(event.replyToken, "受付を中止しました。\n再開する場合は「登録」と送ってください。");
    }

    if (text === "状況" || text === "ステータス") {
      const stepLabel =
        state.step === STEP.NONE ? "未開始" :
        state.step === STEP.NAME ? "氏名待ち" :
        state.step === STEP.FLP ? "FLP番号待ち" :
        state.step === STEP.IMAGE ? "スクショ待ち" :
        state.step === STEP.DONE ? "完了" : "不明";
      return reply(
        event.replyToken,
        `現在の状況：${stepLabel}\n` +
        (state.name ? `氏名：${state.name}\n` : "") +
        (state.flp ? `FLP番号：${state.flp}\n` : "") +
        (state.imageMessageId ? `スクショ：受信済\n` : "")
      );
    }

    if (text === "ヘルプ") {
      return reply(
        event.replyToken,
        "使い方：\n" +
        "・登録開始：登録\n" +
        "・途中中止：キャンセル\n" +
        "・現在状況：状況\n"
      );
    }

    // --- フロー開始 ---
    if (text === "登録") {
      resetState(state);
      setStep(state, STEP.NAME);
      return reply(event.replyToken, "登録を開始します。\nまず【氏名】を送ってください。");
    }

    // --- ステップ別処理 ---
    if (state.step === STEP.NONE) {
      // まだ開始していない人には案内
      return reply(event.replyToken, "「登録」と送ると、登録の受付を開始します。");
    }

    if (state.step === STEP.NAME) {
      if (!looksLikeName(text)) {
        return reply(event.replyToken, "氏名を確認できませんでした。\n例）山田 太郎\nもう一度【氏名】を送ってください。");
      }
      state.name = text;
      setStep(state, STEP.FLP);
      return reply(event.replyToken, "ありがとうございます。\n次に【FLP番号】を送ってください。");
    }

    if (state.step === STEP.FLP) {
      const flpDigits = normalizeFLP(text);
      if (!isValidFLPNumber(flpDigits)) {
        return reply(event.replyToken, "FLP番号を確認できませんでした。\n数字で【FLP番号】を送ってください。");
      }
      state.flp = flpDigits;
      setStep(state, STEP.IMAGE);
      return reply(
        event.replyToken,
        "ありがとうございます。\n最後に【購入画面のスクリーンショット】を送ってください。"
      );
    }

    if (state.step === STEP.IMAGE) {
      // 画像待ちなのにテキストが来た場合
      return reply(
        event.replyToken,
        "いまは【購入画面のスクリーンショット】を送ってください。\n（画像として送信してください）"
      );
    }

    if (state.step === STEP.DONE) {
      return reply(
        event.replyToken,
        "登録情報は受け取り済みです。\n紹介者確認後、VSHを譲渡します。"
      );
    }
  }

  // その他タイプ（スタンプ等）
  return reply(event.replyToken, "ありがとうございます。\nテキストまたは画像で送ってください。");
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

