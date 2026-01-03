import express from "express";
import { Client } from "@line/bot-sdk";

const app = express();
app.use(express.json());

const client = new Client({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
});

const PORT = process.env.PORT || 3000;

// 動作確認用
app.get("/", (req, res) => {
  res.send("Vera Sky Harmony Server is running");
});

// LINE Webhook
app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events;

    for (const event of events) {
      if (event.type === "message" && event.message.type === "text") {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "こんにちは。Vera Sky Harmonyです。",
        });
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
