import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  INTRODUCER_NAME,
  INTRODUCER_FLP,
  ADMIN_NOTIFY_USER_ID,
  DAY7_1_IMAGE_URL,
  DAY7_2_IMAGE_URL,
  FLP_OFFICIAL_URL,
  ENTRY_GUIDE_URL,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  PORT,
} = process.env;

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

let flpUnused = [];
let flpAssigned = new Map();
let flpConsumed = new Map();
const threePointsState = new Map();

app.get("/", (_req, res) => res.send("VSH server running"));

app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  const signature = req.headers["x-line-signature"];
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(req.body)
    .digest("base64");

  if (signature !== hash) return res.status(401).end();

  const body = JSON.parse(req.body.toString());
  await handleWebhook(body);
  res.status(200).end();
});

async function handleWebhook(body) {
  for (const ev of body.events || []) {
    if (!ev?.source?.userId) continue;
    const userId = ev.source.userId;

    if (ev.type === "message" && ev.message.type === "text") {
      const text = ev.message.text.trim();

      if (text === "登録希望") {
        await showYellow(userId);
        return;
      }

      if (text === "登録確定") {
        await executeRegistration(userId);
        return;
      }

      if (text === "3点返信開始") {
        threePointsState.set(userId, { step: 1 });
        await client.pushMessage(userId, {
          type: "text",
          text: "① 氏名を入力してください",
        });
        return;
      }

      const state = threePointsState.get(userId);
      if (state?.step === 1) {
        state.name = text;
        state.step = 2;
        await client.pushMessage(userId, {
          type: "text",
          text: "② あなたのFLP番号を入力してください",
        });
        return;
      }

      if (state?.step === 2) {
        state.flp = text;
        state.step = 3;
        await client.pushMessage(userId, {
          type: "text",
          text: "③ 購入画面スクリーンショットを送ってください",
        });
        return;
      }
    }

    if (ev.type === "message" && ev.message.type === "image") {
      await handleScreenshot(ev.source.userId, ev.message.id);
    }
  }
}

async function showYellow(userId) {
  await client.pushMessage(userId, [
    {
      type: "text",
      text:
        "🌟1週間ありがとうございました！\n\n" +
        "下の黄色ボタンを押してください。",
    },
    {
      type: "flex",
      altText: "登録希望",
      contents: {
        type: "bubble",
        hero: {
          type: "image",
          url: DAY7_1_IMAGE_URL,
          size: "full",
          aspectMode: "cover",
          aspectRatio: "20:13",
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
                label: "登録希望",
                text: "登録確定",
              },
            },
          ],
        },
      },
    },
  ]);
}

async function executeRegistration(userId) {
  if (flpUnused.length === 0) {
    await client.pushMessage(userId, {
      type: "text",
      text: "現在準備中です。",
    });
    return;
  }

  const assigned = flpUnused.shift();
  flpAssigned.set(userId, assigned);

  await client.pushMessage(userId, [
    {
      type: "flex",
      altText: "3点返信",
      contents: {
        type: "bubble",
        hero: {
          type: "image",
          url: DAY7_2_IMAGE_URL,
          size: "full",
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
    },
    {
      type: "text",
      text:
        `① 紹介者氏名:${INTRODUCER_NAME}\n` +
        `② 紹介者FLP:${INTRODUCER_FLP}\n` +
        `③ あなたのFLP:${assigned}`,
    },
  ]);
}

async function handleScreenshot(userId, messageId) {
  const state = threePointsState.get(userId);
  if (!state || state.step !== 3) return;

  const stream = await client.getMessageContent(messageId);
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  const upload = await new Promise((resolve, reject) => {
    const up = cloudinary.uploader.upload_stream(
      { folder: "vsh_screenshots" },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    streamifier.createReadStream(buffer).pipe(up);
  });

  const imageUrl = upload.secure_url;

  await client.pushMessage(ADMIN_NOTIFY_USER_ID, [
    {
      type: "image",
      originalContentUrl: imageUrl,
      previewImageUrl: imageUrl,
    },
    {
      type: "text",
      text:
        `【3点完了】\n氏名:${state.name}\n入力FLP:${state.flp}\n割当FLP:${flpAssigned.get(userId)}`,
    },
  ]);

  flpAssigned.delete(userId);
  threePointsState.delete(userId);
}

app.listen(Number(PORT || 10000));
