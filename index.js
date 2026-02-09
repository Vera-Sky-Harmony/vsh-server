import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

/* =====================
   ENV
===================== */
const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  INTRODUCER_NAME,
  INTRODUCER_FLP,
  ADMIN_NOTIFY_USER_ID,
  ADMIN_TOKEN,
  DAY7_2_IMAGE_URL,
  FLP_OFFICIAL_URL,
  ENTRY_GUIDE_URL,
  PORT,
} = process.env;

function must(v, name) {
  if (!v) {
    console.error(`Missing ENV: ${name}`);
    process.exit(1);
  }
}
[
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  INTRODUCER_NAME,
  INTRODUCER_FLP,
  ADMIN_NOTIFY_USER_ID,
  ADMIN_TOKEN,
  DAY7_2_IMAGE_URL,
  FLP_OFFICIAL_URL,
  ENTRY_GUIDE_URL,
].forEach((v, i) =>
  must(v, [
    "CHANNEL_ACCESS_TOKEN",
    "CHANNEL_SECRET",
    "INTRODUCER_NAME",
    "INTRODUCER_FLP",
    "ADMIN_NOTIFY_USER_ID",
    "ADMIN_TOKEN",
    "DAY7_2_IMAGE_URL",
    "FLP_OFFICIAL_URL",
    "ENTRY_GUIDE_URL",
  ][i])
);

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* =====================
   テスト用メモリDB
===================== */
let flpUnused = [];
let flpAssigned = new Map();
let flpConsumed = new Map();
const threePointsState = new Map();

/* =====================
   Health
===================== */
app.get("/", (_, res) => res.send("VSH server running"));

/* =====================
   Webhook
===================== */
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).send("Bad signature");
  }

  const body = JSON.parse(req.body.toString("utf8"));
  const events = body.events || [];

  for (const ev of events) {
    const userId = ev?.source?.userId;
    if (!userId) continue;

    /* ========= 友だち追加 ========= */
    if (ev.type === "follow") {
      await client.pushMessage(userId, [
        {
          type: "text",
          text:
            "Vera Sky Harmonyへようこそ。\n\n" +
            "まずはこちらから【Day0】をご覧ください👇\n" +
            "https://vsh-server.onrender.com/pages/day0.html\n\n" +
            "このあと、順番に読み進めてください。",
        },
      ]);
      continue;
    }

    /* ========= テキスト ========= */
    if (ev.type === "message" && ev.message.type === "text") {
      const text = ev.message.text.trim();

      if (text === "登録希望") {
        await onRegisterIntent(userId);
        continue;
      }

      if (text === "3点返信開始") {
        threePointsState.set(userId, { step: 1 });
        await client.pushMessage(userId, [
          { type: "text", text: "① 氏名 を入力してください" },
        ]);
        continue;
      }

      const st = threePointsState.get(userId);
      if (st) {
        if (st.step === 1) {
          st.name = text;
          st.step = 2;
          await client.pushMessage(userId, [
            { type: "text", text: "② あなたのFLP番号 を入力してください" },
          ]);
          continue;
        }
        if (st.step === 2) {
          st.flp = text;
          st.step = 3;
          await client.pushMessage(userId, [
            {
              type: "text",
              text: "③ 最後に【購入画面のスクリーンショット】を画像で送ってください",
            },
          ]);
          continue;
        }
      }
    }

    /* ========= 画像 ========= */
    if (ev.type === "message" && ev.message.type === "image") {
      const st = threePointsState.get(userId);
      if (!st || st.step !== 3) continue;

      threePointsState.delete(userId);

      await client.pushMessage(ADMIN_NOTIFY_USER_ID, [
        {
          type: "text",
          text:
            "【登録情報受信】\n" +
            `氏名：${st.name}\n` +
            `FLP番号：${st.flp}\n` +
            `userId：${userId}`,
        },
      ]);

      await client.pushMessage(userId, [
        {
          type: "text",
          text: "ありがとうございます。紹介者が確認後、次の案内を行います。",
        },
      ]);
    }
  }

  res.status(200).send("OK");
});

/* =====================
   登録希望
===================== */
async function onRegisterIntent(userId) {
  await client.pushMessage(ADMIN_NOTIFY_USER_ID, [
    {
      type: "text",
      text: `【登録希望】userId: ${userId}`,
    },
  ]);

  await client.pushMessage(userId, [
    buildDay7BlueFlex(),
    {
      type: "text",
      text:
        `① 紹介者氏名：${INTRODUCER_NAME}\n` +
        `② 紹介者FLP番号：${INTRODUCER_FLP}\n\n` +
        "登録完了後、青いボタンを押してください。",
    },
    {
      type: "text",
      text:
        "📘 登録手順書\n" +
        ENTRY_GUIDE_URL,
    },
  ]);
}

/* =====================
   Flex
===================== */
function buildDay7BlueFlex() {
  return {
    type: "flex",
    altText: "3点をLINEで返信する",
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url: DAY7_2_IMAGE_URL,
        size: "full",
        aspectMode: "cover",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            action: {
              type: "message",
              label: "3点をLINEで返信する",
              text: "3点返信開始",
            },
          },
        ],
      },
    },
  };
}

/* =====================
   署名検証
===================== */
function verifySignature(req) {
  const sig = req.headers["x-line-signature"];
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(req.body)
    .digest("base64");
  return sig === hash;
}

app.listen(PORT || 10000, () =>
  console.log("VSH listening on", PORT || 10000)
);
