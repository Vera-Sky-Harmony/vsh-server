import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  DAY0_IMAGE_URL,
  DAY1_IMAGE_URL,
  DAY2_IMAGE_URL,
  DAY3_IMAGE_URL,
  PORT = 3000,
} = process.env;

const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });
const app = express();

/* ===== 署名検証 ===== */
function verify(req) {
  const sig = req.headers["x-line-signature"];
  const hash = crypto
    .createHmac("SHA256", CHANNEL_SECRET)
    .update(req.body)
    .digest("base64");
  return sig === hash;
}

/* ===== 共通Flex ===== */
function flex(imageUrl, title, body, next) {
  return {
    type: "flex",
    altText: title,
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url: imageUrl,
        size: "full",
        aspectRatio: "1:1",
        aspectMode: "cover",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: title, weight: "bold", wrap: true },
          { type: "separator", margin: "md" },
          { type: "text", text: body, wrap: true, margin: "md" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            action: {
              type: "postback",
              label: "次を読む",
              data: next,
            },
            style: "primary",
          },
        ],
      },
    },
  };
}

/* ===== 各Day ===== */
const day0 = () =>
  flex(
    DAY0_IMAGE_URL,
    "ようこそ、Vera Sky Harmony へ",
    `あなたは今、
売り込みも、説得も、勧誘もされていません。

それにも関わらず、
ここに辿り着いたという事実そのものが、
とても重要な意味を持っています。

これは
「健康」と「繁栄」が
同時に広がっていく仕組みです。

あなたがすることは、
「理解すること」と「選択すること」だけ。

次は、
なぜこの仕組みが成り立つのかをお伝えします。`,
    "DAY1"
  );

const day1 = () =>
  flex(
    DAY1_IMAGE_URL,
    "Day1｜人が頑張らなくても成り立つ理由",
    `あなたが体験したのは
説明ではありません。
完成された仕組みの入口です。

VSHでは、
紹介・説明・教育・拡散
すべてをAIが担います。

あなたが行うのは、
体験し、判断することだけ。

これは楽ではなく、
正しく設計された結果です。`,
    "DAY2"
  );

const day2 = () =>
  flex(
    DAY2_IMAGE_URL,
    "Day2｜健康と繁栄を同時に扱う理由",
    `健康だけでは不安定になり、
お金だけでは心と体が消耗します。

FLPが守ってきた理念は
「健康と繁栄は同時に育つ」。

VSHは、
その理念をAIで再構築した仕組みです。

次は、
なぜこの構造が止まらないのかをお伝えします。`,
    "DAY3"
  );

const day3 = () =>
  flex(
    DAY3_IMAGE_URL,
    "Day3｜連鎖が止まらない理由",
    `多くのMLMは
人が動かないと広がりません。

VSHは違います。
あなたが存在するだけで、
連鎖が起こります。

伝える・説明する・教育する・保つ
すべてAI。

人は、
判断するだけの存在に戻されます。`,
    "DAY4"
  );

/* ===== Webhook ===== */
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  if (!verify(req)) return res.sendStatus(401);

  const events = JSON.parse(req.body).events;

  for (const ev of events) {
    const userId = ev.source.userId;

    if (ev.type === "follow") {
      await client.pushMessage(userId, day0());
    }

    if (ev.type === "postback") {
      if (ev.postback.data === "DAY1") await client.pushMessage(userId, day1());
      if (ev.postback.data === "DAY2") await client.pushMessage(userId, day2());
      if (ev.postback.data === "DAY3") await client.pushMessage(userId, day3());
    }
  }

  res.sendStatus(200);
});

/* ===== 起動 ===== */
app.listen(PORT, () => {
  console.log("VSH server running");
});
