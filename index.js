// ================================
// Vera Sky Harmony index.js
// 完全版（全面差し替え用）
// ================================

const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(express.json());

// ===== 環境変数 =====
const {
  CHANNEL_SECRET,
  CHANNEL_ACCESS_TOKEN,
  ADMIN_USER_ID,
  INTRODUCER_NAME,
  INTRODUCER_FLP,
  FBO_GUIDE_URL,
} = process.env;

// ===== LINE署名検証 =====
function verifySignature(req) {
  const signature = req.headers["x-line-signature"];
  const body = JSON.stringify(req.body);

  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");

  return hash === signature;
}

// ===== LINE送信 =====
async function replyMessage(replyToken, messages) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    { replyToken, messages },
    {
      headers: {
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

async function pushMessage(to, messages) {
  await axios.post(
    "https://api.line.me/v2/bot/message/push",
    { to, messages },
    {
      headers: {
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ===== Webhook =====
app.post("/callback", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).send("Invalid signature");
  }

  const event = req.body.events[0];
  if (!event || event.type !== "message") {
    return res.sendStatus(200);
  }

  const userId = event.source.userId;
  const replyToken = event.replyToken;

  // ===== テキスト受信 =====
  if (event.message.type === "text") {
    const text = event.message.text.trim();

    // ===============================
    // ① 登録希望
    // ===============================
    if (text === "登録希望") {
      // 紹介者へ通知
      await pushMessage(ADMIN_USER_ID, [
        {
          type: "text",
          text: `【登録希望受信】\nユーザーID:\n${userId}`,
        },
      ]);

      // 新規登録者へ3点＋URL送信
      await replyMessage(replyToken, [
        {
          type: "text",
          text:
            "【登録に必要な3点】\n\n" +
            `① 紹介者氏名：${INTRODUCER_NAME}\n` +
            `② 紹介者FLP番号：${INTRODUCER_FLP}\n` +
            "③ あなたのFLP番号：\n（この番号を使って登録してください）",
        },
        {
          type: "text",
          text:
            "▼ フォーエバー ビジネスオーナー（FBO）登録手順はこちら\n" +
            FBO_GUIDE_URL,
        },
      ]);

      return res.sendStatus(200);
    }

    // ===============================
    // ② 3点をLINEで返信する
    // ===============================
    if (text === "3点をLINEで返信する") {
      await replyMessage(replyToken, [
        {
          type: "text",
          text:
            "以下の3点を、この順でLINEに送信してください。\n\n" +
            "① 氏名（テキスト）\n" +
            "② FLP番号（テキスト）\n" +
            "③ 購入画面のスクリーンショット（画像）",
        },
      ]);
      return res.sendStatus(200);
    }

    // ===============================
    // その他テキスト → 紹介者へ転送
    // ===============================
    await pushMessage(ADMIN_USER_ID, [
      {
        type: "text",
        text: `【登録者メッセージ】\n${text}`,
      },
    ]);

    return res.sendStatus(200);
  }

  // ===== 画像受信 =====
  if (event.message.type === "image") {
    await pushMessage(ADMIN_USER_ID, [
      {
        type: "text",
        text: "【購入スクリーンショットを受信しました】",
      },
    ]);
    return res.sendStatus(200);
  }

  res.sendStatus(200);
});

// ===== サーバー起動 =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`VSHサーバー起動中 : ${PORT}`);
});
