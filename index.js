import express from "express";
import * as line from "@line/bot-sdk";

const app = express();
const PORT = process.env.PORT || 3000;

const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

// ヘルスチェック
app.get("/", (req, res) => {
  res.send("Vera Sky Harmony Server is running");
});

// LINE Webhook
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

async function handleEvent(event) {
  // メッセージ以外（フォロー、アンフォロー等）は無視
  if (event.type !== "message") return;

  // テキスト以外（スタンプ、画像等）は固定文で返す
  if (event.message.type !== "text") {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text: "ありがとうございます。テキストで送ってくださいね。" }],
    });
  }

  const userText = event.message.text;

  // ここが「自動返信の本体」：まずは固定文＋オウム返し
  const replyText =
    `こんにちは。Vera Sky Harmonyです。\n` +
    `受け取りました：${userText}`;

  return client.replyMessage({
    replyToken: event.replyToken,
    messages: [{ type: "text", text: replyText }],
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
