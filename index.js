import express from "express";
import crypto from "crypto";
import { Client, middleware } from "@line/bot-sdk";

/* =====================
   環境変数
===================== */
const {
  CHANNEL_SECRET,
  CHANNEL_ACCESS_TOKEN,
  BASE_URL,
  ADMIN_TOKEN,
  ADMIN_USER_ID,
  FBO_GUIDE_URL,
  INTRODUCER_NAME,
  INTRODUCER_FLP
} = process.env;

/* =====================
   LINE Client
===================== */
const lineClient = new Client({
  channelAccessToken: CHANNEL_ACCESS_TOKEN
});

/* =====================
   Express
===================== */
const app = express();

/* =====================
   管理用メモリ（簡易）
===================== */
let assignedIndex = 0;
const MAX_ASSIGN = 30;

/* =====================
   Webhook
===================== */
app.post(
  "/callback",
  middleware({ channelSecret: CHANNEL_SECRET }),
  async (req, res) => {
    try {
      const events = req.body.events;
      for (const event of events) {
        if (event.type === "message" && event.message.type === "text") {
          await handleText(event);
        }
      }
      res.status(200).end();
    } catch (err) {
      console.error("Webhook error:", err);
      res.status(500).end();
    }
  }
);

/* =====================
   テキスト処理
===================== */
async function handleText(event) {
  const text = event.message.text.trim();
  const userId = event.source.userId;

  /* 登録希望 */
  if (text === "登録希望") {
    if (assignedIndex >= MAX_ASSIGN) {
      await reply(event.replyToken, "現在受付は終了しています。");
      return;
    }

    assignedIndex++;

    // ① 新規登録者へ3点送信
    await reply(
      event.replyToken,
      `【登録に必要な3点】\n` +
      `紹介者氏名：${INTRODUCER_NAME}\n` +
      `紹介者FLP番号：${INTRODUCER_FLP}\n` +
      `あなたのFLP番号：割当-${assignedIndex}`
    );

    // ② FBO登録手順URL送信
    await push(
      userId,
      `▼ フォーエバービジネスオーナー（FBO）登録手順\n${FBO_GUIDE_URL}`
    );

    // ③ 紹介者へ通知
    if (ADMIN_USER_ID) {
      await push(
        ADMIN_USER_ID,
        `【登録希望受信】\n割当番号：${assignedIndex}`
      );
    }
  }

  /* 3点返信 */
  if (text === "3点をLINEで返信する") {
    await reply(
      event.replyToken,
      "①氏名\n②FLP番号\n③購入画面スクリーンショット\nをこのまま送信してください。"
    );
  }
}

/* =====================
   LINE送信関数
===================== */
async function reply(replyToken, text) {
  await lineClient.replyMessage(replyToken, {
    type: "text",
    text
  });
}

async function push(to, text) {
  await lineClient.pushMessage(to, {
    type: "text",
    text
  });
}

/* =====================
   管理画面
===================== */
app.get("/admin", (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) {
    return res.status(403).send("Forbidden");
  }
  res.json({
    assigned: assignedIndex,
    remaining: MAX_ASSIGN - assignedIndex
  });
});

/* =====================
   起動
===================== */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`VSH server listening on ${PORT}`);
  console.log(`Webhook: ${BASE_URL}/callback`);
});

