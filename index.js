import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
import path from "path";
import { fileURLToPath } from "url";

/* =========================
   🔵 __dirname 対応（ESM用）
========================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
   🔵 環境変数
========================= */

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  ADMIN_NOTIFY_USER_ID,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  PORT,
} = process.env;

/* =========================
   🔵 Cloudinary設定
========================= */

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

/* =========================
   🔵 Express & LINE初期化
========================= */

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* =========================
   🔵 静的ページ公開（重要）
========================= */

app.use(express.static(__dirname));
app.use("/ページ", express.static(path.join(__dirname, "ページ")));

app.get("/test", (_req, res) => {
  res.send("VSH Static OK");
});

app.get("/", (_req, res) => {
  res.send("VSH Server Running");
});

/* =========================
   🔵 Webhook
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
   🔵 状態管理
========================= */

const threePointsState = new Map();

/* =========================
   🔵 Webhook処理
========================= */

async function handleWebhook(body) {
  for (const ev of body.events || []) {
    if (!ev?.source?.userId) continue;
    const userId = ev.source.userId;

    /* ---- テキスト ---- */
    if (ev.type === "message" && ev.message.type === "text") {
      const text = ev.message.text.trim();

      if (text === "登録希望") {
        await client.pushMessage(userId, {
          type: "text",
          text:
            "こちらから進んでください。\n" +
            "https://vsh-server.onrender.com/day7-1.html",
        });
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
            "【登録完了通知】\n" +
            "氏名：" + state.name + "\n" +
            "FLP番号：" + state.flp,
        });

        threePointsState.delete(userId);

        await client.pushMessage(userId, {
          type: "text",
          text: "登録受付が完了しました。",
        });

        return;
      }
    }
  }
}

/* =========================
   🔵 サーバー起動
========================= */

app.listen(Number(PORT || 10000), () => {
  console.log("VSH Stable Version Running");
});
