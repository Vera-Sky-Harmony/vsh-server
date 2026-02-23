// ===== VSH 実運用 最小安定版 =====
require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");
const path = require("path");

const app = express();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);

// ---- 静的ページ公開（Day0〜Day7-3）----
app.use("/ページ", express.static(path.join(__dirname, "pages")));

// ---- Webhook ----
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  const userText = event.message.text.trim();

  // ===== 登録完了検知 =====
  if (userText.includes("登録完了")) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text:
        "登録を受け付けました。\n\nFOREVERにFBO登録が確認されましたら\nVera.Sky.Harmonyシステムを譲渡します。\n\n▼確認ページ\nhttps://vsh-server.onrender.com/ページ/day7-3.html",
    });
  }

  // ===== Day0起動ワード（壊さない）=====
  if (userText.includes("スタート") || userText.includes("開始")) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text:
        "▼Day0はこちら\nhttps://vsh-server.onrender.com/ページ/day0.html",
    });
  }

  return Promise.resolve(null);
}

// ---- サーバー起動 ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("VSH 実運用版 起動中...");
});
