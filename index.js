import express from "express";
import line from "@line/bot-sdk";

const app = express();
const PORT = process.env.PORT || 3000;

// LINE SDK 設定（Renderの環境変数から読む）
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};

// ここが重要：line.middleware が署名検証もやってくれる
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).end();
  }
});

// 動作確認用
app.get("/", (req, res) => {
  res.send("Vera Sky Harmony Server is running");
});

const client = new line.Client(config);

// 自動返信ロジック（まずは「オウム返し」）
async function handleEvent(event) {
  // 返信できるのは message の text のみ（まずはこれでOK）
  if (event.type !== "message") return null;
  if (event.message.type !== "text") return null;

  const userText = event.message.text;

  // 例：固定メッセージ + オウム返し
  const replyText = `メッセージありがとうございます。\n「${userText}」ですね。`;

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: replyText,
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
