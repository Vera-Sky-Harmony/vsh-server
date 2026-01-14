import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

const app = express();

/* ===== 環境変数 ===== */
const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  INTRODUCER_NAME,
  INTRODUCER_FLP,
  FBO_GUIDE_URL
} = process.env;

/* ===== LINE Client ===== */
const client = new Client({
  channelAccessToken: CHANNEL_ACCESS_TOKEN
});

/* ===== Webhook 検証 ===== */
function verifySignature(req, res, buf) {
  const signature = crypto
    .createHmac("SHA256", CHANNEL_SECRET)
    .update(buf)
    .digest("base64");

  if (signature !== req.headers["x-line-signature"]) {
    throw new Error("Invalid signature");
  }
}

app.post(
  "/callback",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      verifySignature(req, res, req.body);
      const events = JSON.parse(req.body.toString()).events;
      events.forEach(handleEvent);
      res.status(200).end();
    } catch (err) {
      console.error(err);
      res.status(403).end();
    }
  }
);

/* ===== イベント処理 ===== */
async function handleEvent(event) {
  if (event.type !== "message") return;

  const text = event.message.text;

  /* 登録希望 */
  if (text === "登録希望") {
    await client.replyMessage(event.replyToken, {
      type: "text",
      text:
        `【登録情報】\n\n` +
        `紹介者氏名：${INTRODUCER_NAME}\n` +
        `紹介者FLP番号：${INTRODUCER_FLP}\n` +
        `あなたのFLP番号：${INTRODUCER_FLP}\n\n` +
        `▼FBO登録手順はこちら\n${FBO_GUIDE_URL}`
    });
  }

  /* 3点返信 */
  if (text === "３点をLINEで返信する") {
    await client.replyMessage(event.replyToken, {
      type: "text",
      text:
        `以下の3点をこのままLINEで送信してください。\n\n` +
        `① 氏名\n② FLP番号\n③ 購入画面のスクリーンショット`
    });
  }
}

/* ===== 起動 ===== */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`VSH server running on port ${PORT}`);
});

