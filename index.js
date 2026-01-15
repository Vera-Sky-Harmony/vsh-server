// ===============================
// VSH LINE Webhook Server
// ES Modules 完全対応版
// ===============================

import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

// ===============================
// 環境変数
// ===============================
const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  PORT = 10000,
  INTRODUCER_NAME,
  INTRODUCER_FLP,
  FBO_GUIDE_URL
} = process.env;

// ===============================
// LINE Client
// ===============================
const lineClient = new Client({
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
});

// ===============================
// Express App
// ===============================
const app = express();

// raw body を保持（署名検証用）
app.post(
  "/callback",
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
  async (req, res) => {
    try {
      // ===============================
      // 署名検証
      // ===============================
      const signature = req.headers["x-line-signature"];
      const hash = crypto
        .createHmac("sha256", CHANNEL_SECRET)
        .update(req.rawBody)
        .digest("base64");

      if (signature !== hash) {
        console.error("署名不一致");
        return res.status(401).end();
      }

      // ===============================
      // イベント処理
      // ===============================
      const events = req.body.events;

      for (const event of events) {
        if (event.type !== "message") continue;
        if (event.message.type !== "text") continue;

        const text = event.message.text.trim();
        const userId = event.source.userId;

        // ===============================
        // 「登録希望」受信
        // ===============================
        if (text === "登録希望") {
          const replyText = `
【登録希望 受信】

ユーザーID：
${userId}

ありがとうございます。
登録手続きをご案内します。

【あなたの3点情報】
・ 紹介者氏名：${INTRODUCER_NAME}
・ 紹介者FLP番号：${INTRODUCER_FLP}
・ あなたのFLP番号：後ほど発行されます

▼ FBO登録手順はこちら
${FBO_GUIDE_URL}

登録完了後、
「3点をLINEで返信する」ボタンを押してください。
          `.trim();

          await lineClient.replyMessage(event.replyToken, {
            type: "text",
            text: replyText,
          });
        }
      }

      res.status(200).end();
    } catch (err) {
      console.error("Webhook Error:", err);
      res.status(500).end();
    }
  }
);

// ===============================
// 起動
// ===============================
app.get("/", (req, res) => {
  res.send("VSH server running");
});

app.listen(PORT, () => {
  console.log("=======================================");
  console.log(`VSHサーバー起動中: ポート ${PORT}`);
  console.log(`Webhook URL: /callback`);
  console.log("=======================================");
});

