import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use("/pages", express.static(path.join(__dirname, "pages")));

const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* =========================
   🔵 静的ページ完全設定
========================= */

// ルート直下公開（day7-1.htmlなど）
app.use(express.static(__dirname));

// 「ページ」フォルダ公開
app.use("/ページ", express.static(path.join(__dirname, "ページ")));

// 確認用
app.get("/test", (_req, res) => {
  res.send("VSH Static OK");
});

/* =========================
   🔵 LINE Webhook
========================= */

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

/* =========================
   🔵 Webhook処理
========================= */

const threePointsState = new Map();

async function handleWebhook(body) {
  for (const ev of body.events || []) {
    if (!ev?.source?.userId) continue;
    const userId = ev.source.userId;

    if (ev.type === "message" && ev.message.type === "text") {
      const text = ev.message.text.trim();

      if (text === "3点返信開始") {
        threePointsState.set(userId, { step: 1 });
        await client.pushMessage(userId, {
          type: "text",
          text: "① 氏名を入力してください",
        });
        continue;
      }

      const state = threePointsState.get(userId);

      if (state?.step === 1) {
        state.name = text;
        state.step = 2;
        await client.pushMessage(userId, {
          type: "text",
          text: "② あなたのFLP番号を入力してください",
        });
        continue;
      }

      if (state?.step === 2) {
        state.flp = text;
        state.step = 3;
        await client.pushMessage(userId, {
          type: "text",
          text: "③ 購入画面スクリーンショットを送ってください",
        });
        continue;
      }
    }

    if (ev.type === "message" && ev.message.type === "image") {
      await handleScreenshot(ev.source.userId, ev.message.id);
    }
  }
}

/* =========================
   🔵 スクショ処理
========================= */

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

    await client.pushMessage(ADMIN_NOTIFY_USER_ID, {
      type: "image",
      originalContentUrl: imageUrl,
      previewImageUrl: imageUrl,
    });

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

/* ========================= */

app.listen(Number(PORT || 10000), () => {
  console.log("VSH Server Running");
});
