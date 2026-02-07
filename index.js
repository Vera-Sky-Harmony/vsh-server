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

/* ===== 連打防止 ===== */
const lastDay = {};
function canProceed(userId, nextDay) {
  if (lastDay[userId] === nextDay) return false;
  lastDay[userId] = nextDay;
  return true;
}

/* ===== 共通送信（全文分割）===== */
async function sendDay(userId, imageUrl, texts, nextData) {
  await client.pushMessage(userId, {
    type: "image",
    originalContentUrl: imageUrl,
    previewImageUrl: imageUrl,
  });

  for (const t of texts) {
    await client.pushMessage(userId, { type: "text", text: t });
  }

  if (nextData) {
    await client.pushMessage(userId, {
      type: "text",
      text: "▼ 次を読む",
      quickReply: {
        items: [
          {
            type: "action",
            action: {
              type: "postback",
              label: "次を読む",
              data: nextData,
            },
          },
        ],
      },
    });
  }
}

/* ===== Day0 ===== */
const day0 = (userId) =>
  sendDay(userId, DAY0_IMAGE_URL, [
`【タイトル】
ようこそ、Vera Sky Harmony へ
― あなたは「選ばれた」のではありません。「気づいた」のです ―`,

`はじめまして。
そして、ここまで辿り着いてくださり、ありがとうございます。`,

`あなたは今、
売り込みも、説得も、勧誘もされていません。`,

`それにも関わらず、
ここに辿り着いたという事実そのものが、
とても重要な意味を持っています。`,

`これからあなたが目にするのは、
誰かに依存せず、
人に気を遣わず、
無理も我慢もしない。`,

`それでいて、
「健康」と「繁栄」が
同時に広がっていく仕組みです。`,

`Vera Sky Harmony（VSH）は、
従来のMLMの常識をすべて捨てて設計されました。`,

`人が頑張る必要も、
説明する必要も、
教育する必要も、
拡散する必要もありません。`,

`それらはすべて、AIが担います。
あなたがすることは、
「理解すること」と「選択すること」だけです。`,

`経験・年齢・人脈・話術は、
一切問いません。
人の能力に依存しない設計だからです。`,

`ここから数日間、
あなたは「説明」ではなく、
完成された仕組みを体験します。`,

`押されることも、
急かされることもありません。`,

`ただ一つだけ、
大切なことがあります。`,

`「理解してから判断してほしい」`,

`それでは、
Vera Sky Harmony の世界へ。`
], "DAY1");

/* ===== Day1 ===== */
const day1 = (userId) =>
  sendDay(userId, DAY1_IMAGE_URL, [
`Day1
なぜ、この仕組みは
「人が頑張らなくても」成り立つのか`,

`あなたが体験したのは、
「説明」ではありません。
完成された仕組みの入口です。`,

`多くのビジネスは、
人の努力・才能・時間・人脈に依存します。`,

`だから多くの人が、
疲れ、諦め、続きません。`,

`Vera Sky Harmony が目指したのは、
その真逆。
「人が頑張らなくても成立する構造」です。`,

`紹介・説明・登録案内・教育・拡散
そのすべてを、
最初からAIが担います。`,

`あなたが行うのは、
体験し、判断することだけ。`,

`これは「楽をする仕組み」ではなく、
「正しい設計」の結果です。`
], "DAY2");

/* ===== Day2 ===== */
const day2 = (userId) =>
  sendDay(userId, DAY2_IMAGE_URL, [
`Day2
なぜこの仕組みは
「健康」と「繁栄」を同時に扱うのか`,

`多くのビジネスは「お金」だけ。
多くの健康活動は「理想」だけ。`,

`どちらか一方だけでは、
人は続きません。`,

`健康だけでは生活が不安定になり、
お金だけでは心と体が消耗します。`,

`FLPが守り続けてきたのは、
「健康と繁栄は同時に育てるもの」
という理念でした。`,

`VSHは、
その理念をAIで再構築した仕組みです。`,

`無理をしなくても、
説得しなくても、
自然につながる構造を
設計段階で完成させています。`,

`VSHは
「稼ぐための仕組み」ではありません。
正しく生きた結果として
繁栄が生まれる構造です。`
], "DAY3");

/* ===== Day3 ===== */
const day3 = (userId) =>
  sendDay(userId, DAY3_IMAGE_URL, [
`Day3
なぜVera Sky Harmonyは
連鎖が止まらないのか`,

`多くのMLMが止まる理由は、
人が動かなければ
広がらないからです。`,

`紹介・説明・継続。
この人依存がある限り、
連鎖は止まります。`,

`VSHは、
この前提を最初から捨てました。`,

`あなたが動かなくても、
存在するだけで連鎖が起こります。`,

`伝えるのも、
説明するのも、
教育するのも、
拡散を保つのもAI。`,

`人は、
判断するだけの存在に戻されます。`,

`あなたがやることは一つ。
納得して、使い続けること。`,

`VSHは
「広げる仕組み」ではなく、
“広がってしまう構造”です。`
], null);

/* ===== Webhook ===== */
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  if (!verify(req)) return res.sendStatus(401);
  const events = JSON.parse(req.body).events;

  for (const ev of events) {
    const userId = ev.source.userId;

    if (ev.type === "follow") {
      lastDay[userId] = "DAY0";
      await day0(userId);
    }

    if (ev.type === "postback") {
      const d = ev.postback.data;
      if (d === "DAY1" && canProceed(userId, "DAY1")) await day1(userId);
      if (d === "DAY2" && canProceed(userId, "DAY2")) await day2(userId);
      if (d === "DAY3" && canProceed(userId, "DAY3")) await day3(userId);
    }
  }
  res.sendStatus(200);
});

/* ===== 起動 ===== */
app.listen(PORT, () => {
  console.log("VSH server running (B mode / official text)");
});
