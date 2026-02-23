// ===== VSH 実運用 最終安定版 =====
const express = require("express");
const line = require("@line/bot-sdk");
const path = require("path");

const app = express();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);

// 静的ページ公開（pagesフォルダ）
app.use("/ページ", express.static(path.join(__dirname, "pages")));

// Webhook
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

  // ともだち追加 → Day0
  if (event.type === "follow") {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "▼Day0はこちら\nhttps://vsh-server.onrender.com/ページ/day0.html"
    });
  }

  // テキスト以外は無視
  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const text = event.message.text.trim();

  // 登録完了 → Day7-3
  if (text.includes("登録完了")) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text:
        "登録を受け付けました。\n\nFOREVERにFBO登録が確認されましたら\nVera.Sky.Harmonyシステムを譲渡します。\n\n▼確認ページ\nhttps://vsh-server.onrender.com/ページ/day7-3.html"
    });
  }

  return null;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("VSH 最終安定版 起動");
});
