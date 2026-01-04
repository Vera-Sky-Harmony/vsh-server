import express from "express";
import { Client, middleware } from "@line/bot-sdk";

/**
 * 必須（RenderのEnvironment Variablesに設定済みのはず）
 * - CHANNEL_SECRET
 * - CHANNEL_ACCESS_TOKEN
 */
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

if (!CHANNEL_SECRET || !CHANNEL_ACCESS_TOKEN) {
  console.error("❌ Environment Variables are missing.");
  console.error("Please set CHANNEL_SECRET and CHANNEL_ACCESS_TOKEN on Render.");
}

const config = {
  channelSecret: CHANNEL_SECRET,
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
};

const client = new Client(config);

const app = express();
const PORT = process.env.PORT || 10000;

/**
 * 登録フローの状態（簡易版：メモリ保存）
 * ※Render無料枠は再起動/再デプロイでリセットされます（今はこれでOK）
 */
const STEP = {
  NONE: "none",
  NAME: "name",
  FLP: "flp",
  IMAGE: "image",
  DONE: "done",
};

// userIdごとの状態を保持
const userState = new Map();

function getState(userId) {
  if (!userState.has(userId)) {
    userState.set(userId, {
      step: STEP.NONE,
      name: "",
      flp: "",
      imageMessageId: "",
      updatedAt: Date.now(),
    });
  }
  return userState.get(userId);
}

function resetState(state) {
  state.step = STEP.NONE;
  state.name = "";
  state.flp = "";
  state.imageMessageId = "";
  state.updatedAt = Date.now();
}

function setStep(state, step) {
  state.step = step;
  state.updatedAt = Date.now();
}

function splitLines(text) {
  return (text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isRegisterCommand(line) {
  // 「登録」「登録希望」「登録します」など先頭が登録ならOK
  return /^登録/u.test(line);
}

function looksLikeName(text) {
  // 簡易チェック：数字だけはNG、1文字はNG
  if (!text) return false;
  if (text.length < 2) return false;
  if (/^\d+$/.test(text)) return false;
  return true;
}

function normalizeFLP(text) {
  // 数字だけ抽出
  return (text || "").replace(/[^\d]/g, "");
}

function isValidFLPNumber(flp) {
  // FLP番号の桁数は運用により違うため、まずは「8桁以上」をOKに
  // 必要なら 9桁固定等に変更できます
  return /^\d{8,}$/.test(flp);
}

async function reply(replyToken, messageText) {
  return client.replyMessage(replyToken, {
    type: "text",
    text: messageText,
  });
}

/**
 * ヘルスチェック（ブラウザでアクセスすると表示）
 */
app.get("/", (req, res) => {
  res.send("Vera Sky Harmony Server is running");
});

/**
 * LINE Webhook
 * middleware(config) が署名検証してくれます
 */
app.post("/webhook", middleware(config), async (req, res) => {
  // まず200を返す（LINE側のタイムアウト回避）
  res.status(200).send("OK");

  try {
    // 全体ログ（必要最小限）
    console.log("Webhook received:", {
      destination: req.body?.destination,
      eventsCount: Array.isArray(req.body?.events) ? req.body.events.length : 0,
    });

    const events = req.body.events || [];
    for (const event of events) {
      await handleEvent(event);
    }
  } catch (err) {
    console.error("❌ Webhook error:", err);
  }
});

async function handleEvent(event) {
  // イベントの最低限ログ
  console.log("Event:", {
    type: event.type,
    messageType: event.message?.type,
    userId: event.source?.userId,
  });

  // 返信できるイベントだけ処理
  if (event.type !== "message" || !event.replyToken) return;

  const userId = event.source?.userId;
  if (!userId) return;

  const state = getState(userId);

  // 画像メッセージ
  if (event.message.type === "image") {
    if (state.step !== STEP.IMAGE) {
      return reply(
        event.replyToken,
        "画像ありがとうございます。ただいま画像を受け取る段階ではありません。\n先に「登録」と送るか、案内に従ってください。"
      );
    }

    state.imageMessageId = event.message.id;
    setStep(state, STEP.DONE);

    console.log("✅ Image received:", { userId, imageMessageId: state.imageMessageId });

    return reply(
      event.replyToken,
      "画像を受け取りました。ありがとうございます。\n【登録情報が揃いました】\n・氏名\n・FLP番号\n・購入画面スクリーンショット\n\n紹介者が確認後、VSHを譲渡します。"
    );
  }

  // テキストメッセージ
  if (event.message.type === "text") {
    const rawText = (event.message.text || "").trim();
    const lines = splitLines(rawText);

    // ログ（ここが重要：実際にどう届いているか）
    console.log("Text received:", { userId, rawText, lines });

    let replyText = "";

    for (const lineText of lines) {
      // --- いつでも効く共通コマンド ---
      if (lineText === "キャンセル" || lineText === "中止" || lineText === "やめる") {
        resetState(state);
        replyText =
          "受付を中止しました。\n再開する場合は「登録」と送ってください。";
        continue;
      }

      if (lineText === "状況" || lineText === "ステータス") {
        const stepLabel =
          state.step === STEP.NONE ? "未開始" :
          state.step === STEP.NAME ? "氏名待ち" :
          state.step === STEP.FLP ? "FLP番号待ち" :
          state.step === STEP.IMAGE ? "スクショ待ち" :
          state.step === STEP.DONE ? "完了" : "不明";

        replyText =
          `現在の状況：${stepLabel}\n` +
          (state.name ? `氏名：${state.name}\n` : "") +
          (state.flp ? `FLP番号：${state.flp}\n` : "") +
          (state.imageMessageId ? "スクショ：受信済\n" : "");
        continue;
      }

      if (lineText === "ヘルプ") {
        replyText =
          "使い方：\n" +
          "①「登録」と送信（登録希望でもOK）\n" +
          "② 氏名を送信\n" +
          "③ FLP番号を送信\n" +
          "④ 購入画面スクリーンショット（画像）を送信\n\n" +
          "・中止：キャンセル\n" +
          "・状況確認：状況";
        continue;
      }

      // --- 登録コマンド（先頭が登録ならOK）---
      if (isRegisterCommand(lineText)) {
        resetState(state);
        setStep(state, STEP.NAME);
        replyText = "登録の受付を開始します。\nまず【氏名】を送ってください。";
        continue;
      }

      // --- ステップ別処理 ---
      if (state.step === STEP.NONE) {
        replyText = "「登録」と送ると、登録の受付を開始します。（登録希望でもOK）";
        continue;
      }

      if (state.step === STEP.NAME) {
        if (!looksLikeName(lineText)) {
          replyText =
            "氏名を確認できませんでした。\n例）細井 信孝\nもう一度【氏名】を送ってください。";
          continue;
        }
        state.name = lineText;
        setStep(state, STEP.FLP);
        replyText = "ありがとうございます。\n次に【FLP番号】を送ってください。";
        continue;
      }

      if (state.step === STEP.FLP) {
        const flpDigits = normalizeFLP(lineText);
        if (!isValidFLPNumber(flpDigits)) {
          replyText =
            "FLP番号を確認できませんでした。\n数字で【FLP番号】を送ってください。\n例）203145165";
          continue;
        }
        state.flp = flpDigits;
        setStep(state, STEP.IMAGE);
        replyText =
          "ありがとうございます。\n最後に【購入画面のスクリーンショット】を画像で送ってください。";
        continue;
      }

      if (state.step === STEP.IMAGE) {
        replyText =
          "いまは【購入画面のスクリーンショット】を画像として送ってください。";
        continue;
      }

      if (state.step === STEP.DONE) {
        replyText =
          "登録情報は受け取り済みです。\n紹介者確認後、VSHを譲渡します。";
        continue;
      }
    }

    if (!replyText) {
      replyText = "ありがとうございます。\n「登録」と送ると受付を開始します。";
    }

    return reply(event.replyToken, replyText);
  }

  // その他（スタンプ等）
  return reply(event.replyToken, "ありがとうございます。テキストか画像で送ってください。");
}

// Renderで起動
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ Primary URL: https://vsh-server.onrender.com`);
});

