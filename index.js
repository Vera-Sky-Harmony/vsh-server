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
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });
app.use(express.static("ページ"));

/* =========================
   🔵 静的ページ配信設定
========================= */

// ルート直下を公開
app.use(express.static(__dirname));

// 「ページ」フォルダを公開
app.use("/ページ", express.static(path.join(__dirname, "ページ")));

// 確認用
app.get("/test", (_req, res) => {
  res.send("VSH Static OK");
});

/* ========================= */

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
  await showYellow(ev.replyToken, userId);
  return;
}

      if (text === "登録確定") {
        await executeRegistration(userId);
        return;
      }

      if (text === "登録完了をLINEで返信する") {
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

        await client.pushMessage(ADMIN_NOTIFY_USER_ID, {
          type: "text",
          text:
            `【登録完了通知】\n` +
            `氏名:${state.name}\n` +
            `FLP:${state.flp}`,
        });

        threePointsState.delete(userId);

        await client.pushMessage(userId, {
          type: "text",
          text: "登録確認が完了しました。",
        });

        return;
      }
    }
  }
}

async function showYellow(replyToken, userId) {
  await client.replyMessage(replyToken, {
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

app.listen(Number(PORT || 10000), () => {
  console.log("=================================");
  console.log("VSH Stable Version Running");
  console.log("PORT:", PORT);
  console.log("=================================");
});
