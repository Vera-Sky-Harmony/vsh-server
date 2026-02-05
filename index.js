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

/* ========= 設定 ========= */
const DAY1_DELAY_MS = 10 * 60 * 60 * 1000; // 10時間（テスト用）

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* ========= メモリDB（テスト用） =========
userId -> {
  day0SentAt: number,
  day1Sent: boolean
}
======================================== */
const users = new Map();

/* ========= ヘルスチェック ========= */
app.get("/", (_, res) => res.send("VSH server running"));

/* ========= Webhook ========= */
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    if (!verifySignature(req)) {
      return res.status(401).send("Bad signature");
    }
    const body = JSON.parse(req.body.toString("utf8"));
    await handleEvents(body.events || []);
  } catch (e) {
    console.error(e);
  }
  res.status(200).send("OK");
});

/* ========= LINEイベント処理 ========= */
async function handleEvents(events) {
  for (const ev of events) {
    if (ev.type === "follow") {
      await handleFollow(ev.source.userId);
    }
  }
}

/* ========= Day0送信 ========= */
async function handleFollow(userId) {
  if (users.has(userId)) return;

  const now = Date.now();
  users.set(userId, {
    day0SentAt: now,
    day1Sent: false,
  });

  await client.pushMessage(userId, [
    {
      type: "image",
      originalContentUrl: DAY0_IMAGE_URL,
      previewImageUrl: DAY0_IMAGE_URL,
    },
    {
      type: "text",
      text:
`ようこそ、Vera Sky Harmony へ
― あなたは「選ばれた」のではありません。「気づいた」のです ―

ここから数日間、
完成された仕組みを体験していただきます。

判断はいつでも自由です。
押されることも、急かされることもありません。

明日は、
「なぜこの仕組みが成り立つのか」をお伝えします。`
    }
  ]);

  console.log("Day0 sent:", userId);
}

/* ========= Day1 自動送信チェック ========= */
setInterval(async () => {
  const now = Date.now();

  for (const [userId, data] of users.entries()) {
    if (data.day1Sent) continue;

    if (now - data.day0SentAt >= DAY1_DELAY_MS) {
      await sendDay1(userId);
      data.day1Sent = true;
      console.log("Day1 sent:", userId);
    }
  }
}, 60 * 1000); // 1分ごとにチェック

/* ========= Day1送信 ========= */
async function sendDay1(userId) {
  await client.pushMessage(userId, [
    {
      type: "image",
      originalContentUrl: DAY1_IMAGE_URL,
      previewImageUrl: DAY1_IMAGE_URL,
    },
    {
      type: "text",
      text:
`なぜ、この仕組みは
「人が頑張らなくても」成り立つのか。

あなたが体験したのは
説明ではありません。

完成された仕組みの入口です。

明日は、
「健康」と「繁栄」が
なぜ同時に生まれるのかをお伝えします。`
    }
  ]);
}

/* ========= 署名検証 ========= */
function verifySignature(req) {
  const signature = req.headers["x-line-signature"];
  const body = req.body;
  const hash = crypto
    .createHmac("SHA256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

app.listen(PORT || 10000, () =>
  console.log("Server listening")
);
