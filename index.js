import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

/* ===========================
   ENV
=========================== */
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error("❌ CHANNEL_ACCESS_TOKEN または CHANNEL_SECRET 未設定");
  process.exit(1);
}

const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* ===========================
   静的ページ公開（Day0〜Day6）
=========================== */
app.use("/pages", express.static(path.join(__dirname, "pages")));

/* ===========================
   Health Check
=========================== */
app.get("/", (req, res) => {
  res.send("VSH server running");
});

/* ===========================
   Webhook（署名検証）
=========================== */
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const signature = req.headers["x-line-signature"];
    const hash = crypto
      .createHmac("sha256", CHANNEL_SECRET)
      .update(req.body)
      .digest("base64");

    if (signature !== hash) {
      console.log("❌ 署名不一致");
      return res.status(401).send("Invalid signature");
    }

    const body = JSON.parse(req.body.toString("utf8"));
    await handleEvents(body.events);
    res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook Error:", err);
    res.status(200).send("OK");
  }
});

/* ===========================
   イベント処理
=========================== */
async function handleEvents(events) {
  for (const event of events) {

    // ともだち追加時
    if (event.type === "follow") {
      await client.replyMessage(event.replyToken, [
        {
          type: "text",
          text:
            "ようこそ Vera Sky Harmony へ。\n\n" +
            "こちらから Day0 をお読みください。\n" +
            "https://vsh-server.onrender.com/pages/day0.html"
        }
      ]);
    }

    // メッセージ受信
    if (event.type === "message" && event.message.type === "text") {

      const text = event.message.text.trim();

      /* ========= 登録希望 ========= */
      if (text === "登録希望") {

        await client.replyMessage(event.replyToken, [

          // Day7-1 黄色画像
          {
            type: "image",
            originalContentUrl:
              "https://res.cloudinary.com/dxegzwukb/image/upload/v1770446396/1fb98781-8e51-43d9-87c1-691eb51f6d8b_cjdpfm.png",
            previewImageUrl:
              "https://res.cloudinary.com/dxegzwukb/image/upload/v1770446396/1fb98781-8e51-43d9-87c1-691eb51f6d8b_cjdpfm.png"
          },

          // Day7-2 青画像
          {
            type: "image",
            originalContentUrl:
              "https://res.cloudinary.com/dxegzwukb/image/upload/v1769679233/Day7-1_dpjx3u.png",
            previewImageUrl:
              "https://res.cloudinary.com/dxegzwukb/image/upload/v1769679233/Day7-1_dpjx3u.png"
          },

          // 説明メッセージ
          {
            type: "text",
            text:
              "登録ありがとうございます。\n\n" +
              "この後、登録手順をご案内いたします。"
          }
        ]);
      }
    }
  }
}

/* ===========================
   サーバー起動
=========================== */
app.listen(PORT, () => {
  console.log(`VSH server running on port ${PORT}`);
});
