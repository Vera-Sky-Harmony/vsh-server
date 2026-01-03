import express from "express";
import { Client } from "@line/bot-sdk";

const app = express();
const PORT = process.env.PORT || 3000;

// LINE設定
const client = new Client({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
});

// JSON受信
app.use(express.json());

// 動作確認用
app.get("/", (req, res) => {
  res.send("Vera Sky Harmony Server is running");
});

// Webhook
app.post("/webhook", async (req, res) => {
  console.log("Webhook received:", JSON.stringify(req.body, null, 2));

  const events = req.body.events;

  if (!events || events.length === 0) {
    return res.status(200).send("No events");
  }

  for (const event of events) {
    // テキストメッセージのみ処理
    if (event.type === "message" && event.message.type === "text") {
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: "こんにちは。Vera Sky Harmonyです✨\nメッセージありがとうございます。",
      });
    }
  }

  res.status(200).send("OK");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
