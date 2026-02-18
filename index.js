import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  PORT,
} = process.env;

const app = express();

const client = new Client({
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
});

app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const signature = req.headers["x-line-signature"];

    const hash = crypto
      .createHmac("sha256", CHANNEL_SECRET)
      .update(req.body)
      .digest("base64");

    if (signature !== hash) {
      return res.status(401).end();
    }

    const body = JSON.parse(req.body.toString());

    for (const ev of body.events || []) {
      if (ev.type === "message" && ev.message.type === "text") {
        const text = ev.message.text.trim();
        const userId = ev.source.userId;

        if (text === "登録希望") {
          await client.pushMessage(userId, {
            type: "text",
            text:
              "【VSH登録受付】\n\n" +
              "あなたの決断を確認しました。\n\n" +
              "準備ができましたら\n" +
              "『3点返信開始』と送信してください。",
          });
        }
      }
    }

    res.status(200).end();
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

app.listen(Number(PORT || 10000), () => {
  console.log("Server Running");
});
