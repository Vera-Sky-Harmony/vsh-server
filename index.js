import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { middleware, Client } from "@line/bot-sdk";

/* ===== ESM用 __dirname生成 ===== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ===== LINE設定 ===== */
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const app = express();

/* ===== 静的HTML配信（Day0〜Day7用）===== */
app.use(express.static(__dirname));

/* ===== LINEクライアント ===== */
const client = new Client(config);

/* ===== 3点フロー状態管理 ===== */
const threePointsState = new Map();

/* ===== Webhook ===== */
app.post("/webhook", middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error("Webhook Error:", err);
    res.status(500).end();
  }
});

/* ===== イベント処理 ===== */
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const userId = event.source.userId;
  const text = event.message.text;

  /* ===== VSH_START ===== */
  if (text === "VSH_START") {
    threePointsState.set(userId, { step: 1 });

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "① 氏名を入力してください",
    });
  }

  /* ===== 3点フロー ===== */
  const state = threePointsState.get(userId);

  if (!state) return null;

  // ① 氏名
  if (state.step === 1) {
    state.name = text;
    state.step = 2;
    threePointsState.set(userId, state);

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "② あなたのFLP番号を入力してください",
    });
  }

  // ② FLP番号
  if (state.step === 2) {
    state.flp = text;
    state.step = 3;
    threePointsState.set(userId, state);

    return client.replyMessage(event.replyToken, [
      {
        type: "image",
        originalContentUrl:
          "https://res.cloudinary.com/dxegzwukb/image/upload/v1769679233/Day7-1_dpjx3u.png",
        previewImageUrl:
          "https://res.cloudinary.com/dxegzwukb/image/upload/v1769679233/Day7-1_dpjx3u.png",
      },
      {
        type: "text",
        text:
          "登録を受け付けました。\n" +
          "FLPのシステムへの登録完了が確認できるまで\n" +
          "数日お待ちください。\n" +
          "確認でき次第VSHを譲渡いたします。",
      },
    ]);
  }

  return null;
}

/* ===== サーバー起動 ===== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("VSH 完全版 起動");
});
