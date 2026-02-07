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

/* ===== 連打防止（簡易ステート）===== */
const lastDay = {}; // { userId: "DAY1" }
function canProceed(userId, nextDay) {
  if (lastDay[userId] === nextDay) return false;
  lastDay[userId] = nextDay;
  return true;
}

/* ===== 共通送信（全文・分割表示）===== */
async function sendDay(userId, imageUrl, texts, nextData) {
  // ① 画像
  await client.pushMessage(userId, {
    type: "image",
    originalContentUrl: imageUrl,
    previewImageUrl: imageUrl,
  });

  // ② テキスト（分割して全文表示）
  for (const t of texts) {
    await client.pushMessage(userId, {
      type: "text",
      text: t,
    });
  }

  // ③ 次へ（最後のみ）
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
`ようこそ、Vera Sky Harmony へ`,

`あなたは今、
売り込みも、説得も、勧誘もされていません。`,

`それにも関わらず、
ここに辿り着いたという事実そのものが、
とても重要な意味を持っています。`,

`これは
「健康」と「繁栄」が
同時に広がっていく仕組みです。`,

`あなたがすることは、
「理解すること」と「選択すること」だけ。`,

`次は、
なぜこの仕組みが成り立つのかをお伝えします。`
], "DAY1");

/* ===== Day1 ===== */
const day1 = (userId) =>
  sendDay(userId, DAY1_IMAGE_URL, [
`Day1｜人が頑張らなくても成り立つ理由`,

`あなたが体験しているのは、
説明ではありません。`,

`これは、
完成された仕組みの入口です。`,

`VSHでは、
紹介・説明・教育・拡散
そのすべてをAIが担います。`,

`あなたが行うのは、
体験し、判断することだけ。`,

`これは楽ではなく、
正しく設計された結果です。`
], "DAY2");

/* ===== Day2 ===== */
const day2 = (userId) =>
  sendDay(userId, DAY2_IMAGE_URL, [
`Day2｜健康と繁栄を同時に扱う理由`,

`健康だけでは不安定になり、
お金だけでは心と体が消耗します。`,

`FLPが守ってきた理念は、
「健康と繁栄は同時に育つ」という考え方です。`,

`VSHは、
この理念をAIで再構築した仕組みです。`,

`次は、
なぜこの構造が止まらないのかをお伝えします。`
], "DAY3");

/* ===== Day3 ===== */
const day3 = (userId) =>
  sendDay(userId, DAY3_IMAGE_URL, [
`Day3｜連鎖が止まらない理由`,

`多くのMLMは、
人が動かなければ広がりません。`,

`VSHは違います。`,

`伝える・説明する・教育する・保つ
そのすべてをAIが行います。`,

`人は、
判断するだけの存在に戻されます。`
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
  console.log("VSH server running (B mode / full text)");
});
