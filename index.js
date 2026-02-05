import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

/* ========= ENV ========= */
const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  DAY0_IMAGE_URL,
  PORT
} = process.env;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET || !DAY0_IMAGE_URL) {
  console.error("ENV不足");
  process.exit(1);
}

const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });
const app = express();

/* ========= Day0 文書 ========= */
const DAY0_TEXT = `
ようこそ、Vera Sky Harmony へ
― あなたは「選ばれた」のではありません。「気づいた」のです ―

はじめまして。
そして、ここまで辿り着いてくださり、ありがとうございます。

あなたは今、
売り込みも、説得も、勧誘もされていません。
それにも関わらず、
ここに辿り着いたという事実そのものが、
とても重要な意味を持っています。

────────────────

これからあなたが目にするのは、
・誰かに依存しない
・人に気を遣わない
・無理をしない
・我慢を前提としない

それでいて、
「健康」と「繁栄」が同時に広がっていく仕組みです。

────────────────

Vera Sky Harmony（VSH）は、
従来のMLMの常識をすべて捨てて設計されました。

人が頑張る → ❌  
人が説明する → ❌  
人が教育する → ❌  
人が拡散する → ❌  

これらはすべて、AIが担います。

あなたがすることは、
「理解すること」と「選択すること」だけです。

────────────────

この仕組みは、
✔ 経験  
✔ 年齢  
✔ 人脈  
✔ 話術  

いずれも一切問いません。
なぜなら、人の能力に依存しない設計だからです。

────────────────

ここから数日間、
あなたは「説明」を受けるのではなく、
一つの完成されたシステムを体験していきます。

判断はいつでも自由です。
押されることも、急かされることもありません。

────────────────

ただ一つだけ、大切なことがあります。

「理解してから判断してほしい」

────────────────

それでは、
Vera Sky Harmony の世界へ。

明日は、
「なぜこの仕組みが成り立つのか」をお伝えします。
`;

/* ========= Health ========= */
app.get("/", (_req, res) => res.send("VSH Day0 server running"));

/* ========= Webhook ========= */
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    if (!verify(req)) return res.status(401).end();

    const body = JSON.parse(req.body.toString("utf8"));
    for (const ev of body.events || []) {
      if (ev.type === "follow") {
        await client.replyMessage(ev.replyToken, [
          {
            type: "image",
            originalContentUrl: DAY0_IMAGE_URL,
            previewImageUrl: DAY0_IMAGE_URL
          },
          {
            type: "text",
            text: DAY0_TEXT
          }
        ]);
      }
    }
    res.status(200).end();
  } catch (e) {
    console.error(e);
    res.status(200).end();
  }
});

/* ========= Signature ========= */
function verify(req) {
  const sig = req.headers["x-line-signature"];
  const body = req.body;
  const hmac = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return sig === hmac;
}

app.listen(PORT || 10000);

