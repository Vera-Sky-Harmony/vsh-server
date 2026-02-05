 import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

/* ========= ENV ========= */
const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  DAY0_IMAGE_URL,
  DAY1_IMAGE_URL,
  PORT,
} = process.env;

function must(v, name) {
  if (!v) {
    console.error(`Missing ENV: ${name}`);
    process.exit(1);
  }
  return v;
}

must(CHANNEL_ACCESS_TOKEN, "CHANNEL_ACCESS_TOKEN");
must(CHANNEL_SECRET, "CHANNEL_SECRET");
must(DAY0_IMAGE_URL, "DAY0_IMAGE_URL");
must(DAY1_IMAGE_URL, "DAY1_IMAGE_URL");

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* ========= 設定 ========= */
// テスト用：10時間後（本番は 24 * 60 * 60 * 1000）
const DAY1_DELAY_MS = 10 * 60 * 60 * 1000;

/* ========= ユーザー状態（簡易：メモリ） ========= */
// userId -> { day0SentAt }
const users = new Map();

/* ========= Health ========= */
app.get("/", (_req, res) => res.send("VSH server running"));

/* ========= Webhook ========= */
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    if (!verifySignature(req)) {
      return res.status(401).send("Bad signature");
    }
    const body = JSON.parse(req.body.toString("utf8"));
    await handleEvents(body.events || []);
    res.status(200).send("OK");
  } catch (e) {
    console.error(e);
    res.status(200).send("OK");
  }
});

/* ========= Event handler ========= */
async function handleEvents(events) {
  for (const ev of events) {
    if (ev.type === "follow") {
      const userId = ev.source.userId;
      await sendDay0(userId);
      scheduleDay1(userId);
    }
  }
}

/* ========= Day0 ========= */
async function sendDay0(userId) {
  const message = {
    type: "flex",
    altText: "Vera Sky Harmony - Day0",
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url: DAY0_IMAGE_URL,
        size: "full",
        aspectRatio: "1.51:1",
        aspectMode: "cover",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "ようこそ、Vera Sky Harmony へ",
            weight: "bold",
            size: "lg",
            wrap: true,
          },
          {
            type: "text",
            text:
              "あなたは「選ばれた」のではありません。\n" +
              "「気づいた」のです。\n\n" +
              "売り込みも、説得も、勧誘もありません。\n" +
              "それでも、ここに辿り着いた事実そのものが\n" +
              "重要な意味を持っています。\n\n" +
              "これから数日間、\n" +
              "完成された仕組みを体験してください。\n\n" +
              "明日は、\n" +
              "なぜこの仕組みが成り立つのかをお伝えします。",
            wrap: true,
            margin: "md",
          },
        ],
      },
    },
  };

  await client.pushMessage(userId, message);
  users.set(userId, { day0SentAt: Date.now() });
}

/* ========= Day1 ========= */
async function sendDay1(userId) {
  if (!users.has(userId)) return;

  const message = {
    type: "flex",
    altText: "Vera Sky Harmony - Day1",
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url: DAY1_IMAGE_URL,
        size: "full",
        aspectRatio: "1.51:1",
        aspectMode: "cover",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "なぜ、この仕組みは成り立つのか",
            weight: "bold",
            size: "lg",
            wrap: true,
          },
          {
            type: "text",
            text:
              "あなたが体験しているのは\n" +
              "説明ではありません。\n\n" +
              "人が頑張らなくても成立する\n" +
              "正しく設計された構造です。\n\n" +
              "明日は、\n" +
              "この仕組みが\n" +
              "健康と繁栄を同時に生む理由を\n" +
              "お伝えします。",
            wrap: true,
            margin: "md",
          },
        ],
      },
    },
  };

  await client.pushMessage(userId, message);
}

/* ========= スケジューラ ========= */
function scheduleDay1(userId) {
  setTimeout(() => {
    sendDay1(userId).catch(console.error);
  }, DAY1_DELAY_MS);
}

/* ========= Signature ========= */
function verifySignature(req) {
  const signature = req.headers["x-line-signature"];
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(req.body)
    .digest("base64");
  return hash === signature;
}

/* ========= Start ========= */
const port = PORT || 3000;
app.listen(port, () => {
  console.log(`VSH listening on ${port}`);
});
