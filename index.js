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

/* ========= APP ========= */
const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* ========= Health ========= */
app.get("/", (_req, res) => res.send("VSH server running"));

/* ========= Webhook ========= */
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    if (!verifySignature(req)) {
      res.status(401).send("Bad signature");
      return;
    }
    const body = JSON.parse(req.body.toString("utf8"));
    await handleEvents(body.events || []);
    res.status(200).send("OK");
  } catch (e) {
    console.error(e);
    res.status(200).send("OK");
  }
});

/* ========= Signature ========= */
function verifySignature(req) {
  const signature = req.headers["x-line-signature"];
  const hash = crypto
    .createHmac("SHA256", CHANNEL_SECRET)
    .update(req.body)
    .digest("base64");
  return hash === signature;
}

/* ========= Event Handler ========= */
async function handleEvents(events) {
  for (const ev of events) {
    if (!ev?.source?.userId) continue;
    const userId = ev.source.userId;

    /* --- Day0 : 友だち追加 --- */
    if (ev.type === "follow") {
      await sendDay0(userId);
      continue;
    }

    /* --- Day1 : 「次を読む」押下 --- */
    if (ev.type === "message" && ev.message.type === "text") {
      if (ev.message.text === "次を読む") {
        await sendDay1(userId);
      }
    }
  }
}

/* ========= Messages ========= */

async function sendDay0(userId) {
  await client.pushMessage(userId, [
    {
      type: "image",
      originalContentUrl: DAY0_IMAGE_URL,
      previewImageUrl: DAY0_IMAGE_URL,
    },
    {
      type: "text",
      text: `ようこそ、Vera Sky Harmony へ
― あなたは「選ばれた」のではありません。「気づいた」のです ―

はじめまして。
そして、ここまで辿り着いてくださり、ありがとうございます。

あなたは今、
売り込みも、説得も、勧誘もされていません。
それにも関わらず、
ここに辿り着いたという事実そのものが、
とても重要な意味を持っています。

これからあなたが目にするのは、
・誰かに依存しない
・人に気を遣わない
・無理をしない
・我慢を前提としない
それでいて、
「健康」と「繁栄」が同時に広がっていく仕組みです。

Vera Sky Harmony（VSH）は、
従来のMLMの常識をすべて捨てて設計されました。
人が頑張る → ❌
人が説明する → ❌
人が教育する → ❌
人が拡散する → ❌
すべてAIが担います。

あなたがすることは、
「理解すること」と「選択すること」だけです。

ただ一つだけ大切なことがあります。
「理解してから判断してほしい」

それでは、
Vera Sky Harmony の世界へ。`,
      quickReply: {
        items: [
          {
            type: "action",
            action: {
              type: "message",
              label: "次を読む",
              text: "次を読む",
            },
          },
        ],
      },
    },
  ]);
}

async function sendDay1(userId) {
  await client.pushMessage(userId, [
    {
      type: "image",
      originalContentUrl: DAY1_IMAGE_URL,
      previewImageUrl: DAY1_IMAGE_URL,
    },
    {
      type: "text",
      text: `Day1
なぜ、この仕組みは「人が頑張らなくても」成り立つのか

あなたが体験したのは、
「説明」ではありません。
完成された仕組みの入口です。

世の中の多くのビジネスは、
人の努力・才能・時間・人脈に依存しています。
だからこそ、多くの人が途中で疲れ、諦めます。

Vera Sky Harmony が目指したのは、その真逆。
「人が頑張らなくても成立する構造」

紹介 → AI
説明 → AI
登録案内 → AI
教育 → AI
拡散 → AI

あなたが行うのは、
「体験すること」と「判断すること」だけ。
これは楽をする仕組みではありません。
正しい設計の結果です。`,
      quickReply: {
        items: [
          {
            type: "action",
            action: {
              type: "message",
              label: "次を読む",
              text: "次を読む",
            },
          },
        ],
      },
    },
  ]);
}

/* ========= Listen ========= */
const port = PORT || 3000;
app.listen(port, () => {
  console.log("VSH server listening on", port);
});
