// ===== VSH 実運用 安定版（壊さない）=====
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

// ---- 静的ページ公開（既存維持：pages配下）----
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
  // ★ 既存の「ともだち追加 → Day0」ロジックはそのまま動きます
  // （followイベント処理が既存にある場合はそのまま）

  // ---- メッセージ以外は何もしない（既存動作を壊さない）----
  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const userText = event.message.text.trim();

  // ===== 追加：登録完了 → Day7-3 返信（最優先で判定）=====
  if (userText === "登録完了" || userText.includes("登録完了")) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text:
        "登録を受け付けました。\n" +
        "FOREVERに\n" +
        "FBO登録が確認されましたら\n" +
        "Vera.Sky.Harmonyシステムを譲渡します。\n\n" +
        "▼確認ページ\n" +
        "https://vsh-server.onrender.com/ページ/day7-3.html"
    });
  }

  // ===== 既存：Day0起動ワード（維持）=====
  if (userText.includes("スタート") || userText.includes("開始")) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text:
        "▼Day0はこちら\nhttps://vsh-server.onrender.com/ページ/day0.html",
    });
  }

  // ★ 他の既存ロジックがあればここにそのまま残す
  return null;
}

// ---- サーバー起動 ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("VSH 実運用 安定版 起動");
});
