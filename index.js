import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

/* ===== ENV =====
CHANNEL_ACCESS_TOKEN
CHANNEL_SECRET
DAY0_IMAGE_URL
DAY1_IMAGE_URL
DAY2_IMAGE_URL
PORT
================ */

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  DAY0_IMAGE_URL,
  DAY1_IMAGE_URL,
  DAY2_IMAGE_URL,
  PORT
} = process.env;

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* ===== LINE署名検証 ===== */
function verifySignature(req) {
  const signature = req.headers["x-line-signature"];
  const body = req.body.toString("utf8");
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

/* ===== Webhook ===== */
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).send("Bad signature");
  }
  const body = JSON.parse(req.body.toString());
  for (const event of body.events) {
    await handleEvent(event);
  }
  res.send("OK");
});

/* ===== イベント分岐 ===== */
async function handleEvent(event) {
  const userId = event?.source?.userId;
  if (!userId) return;

  // Day0：友だち追加
  if (event.type === "follow") {
    await client.pushMessage(userId, day0());
    return;
  }

  // Day1 / Day2：ボタン遷移
  if (event.type === "postback") {
    if (event.postback.data === "DAY1") {
      await client.pushMessage(userId, day1());
    }
    if (event.postback.data === "DAY2") {
      await client.pushMessage(userId, day2());
    }
  }
}

/* ===== Day0 ===== */
function day0() {
  return {
    type: "flex",
    altText: "Day0",
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url: DAY0_IMAGE_URL,
        size: "full",
        aspectRatio: "1:1",
        aspectMode: "cover"
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "ようこそ、Vera Sky Harmony へ", weight: "bold", size: "lg" },
          {
            type: "text",
            text: "あなたは「選ばれた」のではありません。「気づいた」のです。",
            wrap: true,
            size: "sm"
          },
          { type: "separator" },
          {
            type: "text",
            text: "理解してから判断してほしい。それだけです。",
            wrap: true
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            action: { type: "postback", label: "次を読む", data: "DAY1" }
          }
        ]
      }
    }
  };
}

/* ===== Day1 ===== */
function day1() {
  return {
    type: "flex",
    altText: "Day1",
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url: DAY1_IMAGE_URL,
        size: "full",
        aspectRatio: "1:1",
        aspectMode: "cover"
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "Day1", weight: "bold" },
          {
            type: "text",
            text: "なぜ、この仕組みは「人が頑張らなくても」成り立つのか",
            wrap: true
          },
          { type: "separator" },
          {
            type: "text",
            text: "これは楽をする仕組みではなく、正しい設計の結果です。",
            wrap: true
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            action: { type: "postback", label: "次を読む", data: "DAY2" }
          }
        ]
      }
    }
  };
}

/* ===== Day2 ===== */
function day2() {
  return {
    type: "flex",
    altText: "Day2",
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url: DAY2_IMAGE_URL,
        size: "full",
        aspectRatio: "1:1",
        aspectMode: "cover"
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "Day2", weight: "bold" },
          {
            type: "text",
            text: "なぜこの仕組みは「健康」と「繁栄」を同時に扱うのか",
            wrap: true
          },
          { type: "separator" },
          {
            type: "text",
            text: "正しく生きた結果として、繁栄が生まれる構造です。",
            wrap: true
          }
        ]
      }
    }
  };
}

/* ===== Health Check ===== */
app.get("/", (_req, res) => res.send("VSH server running"));

app.listen(PORT || 3000, () => {
  console.log("VSH server started");
});
