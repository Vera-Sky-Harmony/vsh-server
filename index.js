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
  await client.pushMessage(userId, {
    type: "text",
    text: "🌟1週間ありがとうございました！\n下の黄色ボタンを押してください。",
  });
}

async function executeRegistration(userId) {
  await client.pushMessage(userId, {
    type: "text",
    text: "登録準備が完了しました。",
  });
}

async function handleScreenshot(userId, messageId) {
  const state = threePointsState.get(userId);
  if (!state || state.step !== 3) return;

  try {
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

    // ① 画像を単体送信
    await client.pushMessage(ADMIN_NOTIFY_USER_ID, {
      type: "image",
      originalContentUrl: imageUrl,
      previewImageUrl: imageUrl,
    });

    // ② テキストを別送信
    await client.pushMessage(ADMIN_NOTIFY_USER_ID, {
      type: "text",
      text:
        `【3点完了】\n` +
        `氏名:${state.name}\n` +
        `入力FLP:${state.flp}`,
    });

    threePointsState.delete(userId);

  } catch (err) {
    console.error("スクショ送信エラー:", err);
  }
}

app.listen(Number(PORT || 10000), () => {
  console.log("VSH Stable Version Running");
});
