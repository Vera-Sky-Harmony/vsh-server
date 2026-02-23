import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  PORT,
} = process.env;

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* =========================
   管理値
========================= */

const 紹介者氏名 = "紹介者氏名";
const 紹介者FLP番号 = "203145165";

/* =========================
   ユーザー状態管理
========================= */

const userState = {};

/* =========================
   静的ページ配信
========================= */

// ルート方式（重要）
app.get("/day7-2", (req, res) => {
  res.sendFile(path.join(__dirname, "ページ", "day7-2.html"));
});

app.get("/", (_req, res) => {
  res.send("VSH server running");
});

/* =========================
   Webhook
========================= */

app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const signature = req.headers["x-line-signature"];

    const hash = crypto
      .createHmac("sha256", CHANNEL_SECRET)
      .update(req.body)
      .digest("base64");

    if (signature !== hash) {
      console.log("署名エラー");
      return res.status(401).end();
    }

    const body = JSON.parse(req.body.toString());

    for (const ev of body.events || []) {
      if (!ev?.source?.userId) continue;
      if (ev.type !== "message") continue;
      if (ev.message.type !== "text") continue;

      const text = ev.message.text.trim();
      const userId = ev.source.userId;

      /* =========================
         登録完了 → 氏名入力へ
      ========================= */

      if (text === "登録完了をLINEで送信する") {
        userState[userId] = { step: "waitingName" };

        await client.replyMessage(ev.replyToken, {
          type: "text",
          text: "あなたの氏名を入力してください。"
        });

        continue;
      }

      /* =========================
         氏名受信
      ========================= */

      if (userState[userId]?.step === "waitingName") {
        userState[userId].name = text;
        userState[userId].step = "waitingFLP";

        await client.replyMessage(ev.replyToken, {
          type: "text",
          text: "あなたのFLP番号を入力してください。"
        });

        continue;
      }

      /* =========================
         FLP番号受信 → Day7-3
      ========================= */

      if (userState[userId]?.step === "waitingFLP") {

        delete userState[userId];

        await client.replyMessage(ev.replyToken, [
          {
            type: "image",
            originalContentUrl:
              "https://res.cloudinary.com/dxegzwukb/image/upload/v1771508589/Day7-3%E9%81%A9%E7%94%A8_avaarn.png",
            previewImageUrl:
              "https://res.cloudinary.com/dxegzwukb/image/upload/v1771508589/Day7-3%E9%81%A9%E7%94%A8_avaarn.png",
          },
          {
            type: "text",
            text:
`登録を受け付けました。

FOREVERのシステムに
FBO登録が確認されましたら
✨Vera.Sky.Harmony✨システムを譲渡します。

しばらくお待ちください。`
          }
        ]);

        continue;
      }
    }

    res.status(200).end();

  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

app.listen(Number(PORT || 10000), () => {
  console.log("VSH Stable Version Running");
});
