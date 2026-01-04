import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

const app = express();
const PORT = process.env.PORT || 10000;

const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};

const client = new Client(config);
const ADMIN_USER_ID = process.env.ADMIN_USER_ID;

// 簡易セッション（Render再起動で消えます）
const sessions = {};

app.post(
  "/webhook",
  express.json({
    verify: (req, res, buf) => {
      const signature = req.headers["x-line-signature"];
      const hash = crypto
        .createHmac("SHA256", config.channelSecret)
        .update(buf)
        .digest("base64");
      if (hash !== signature) throw new Error("Invalid signature");
    },
  }),
  async (req, res) => {
    const events = req.body.events || [];
    for (const event of events) {
      try {
        await handleEvent(event);
      } catch (e) {
        console.error("handleEvent error:", e);
      }
    }
    res.sendStatus(200);
  }
);

async function handleEvent(event) {
  if (event.type !== "message") return;

  const userId = event.source.userId;
  const replyToken = event.replyToken;

  sessions[userId] ??= { step: null };

  // ===== テキスト =====
  if (event.message.type === "text") {
    const text = event.message.text.trim();

    // 復旧コマンド
    if (text === "最初から" || text === "やり直し" || text === "リセット") {
      sessions[userId] = { step: null };
      return reply(replyToken, "リセットしました。\n「登録」と送ってください。");
    }

    // 登録開始（※データは消さない）
    if (text === "登録") {
      if (!sessions[userId].step) sessions[userId].step = "name";
      return reply(replyToken, "登録の受付を開始します。\n【氏名】を送ってください。");
    }

    // 未開始
    if (!sessions[userId].step) {
      return reply(replyToken, "「登録」と送ると、登録の受付を開始します。");
    }

    // 氏名
    if (sessions[userId].step === "name") {
      sessions[userId].name = text;
      sessions[userId].step = "flp";
      return reply(replyToken, "ありがとうございます。\n【FLP番号】を送ってください。");
    }

    // FLP
    if (sessions[userId].step === "flp") {
      const digits = text.replace(/[^\d]/g, "");
      sessions[userId].flp = digits || text;
      sessions[userId].step = "image";
      return reply(replyToken, "最後に【購入画面のスクリーンショット】を画像で送ってください。");
    }

    // 画像待ち
    if (sessions[userId].step === "image") {
      return reply(
        replyToken,
        "いまは【購入画面のスクリーンショット】（画像）を送ってください。\nやり直す場合は「やり直し」"
      );
    }
  }

  // ===== 画像 =====
  if (event.message.type === "image") {
    // 未開始
    if (!sessions[userId].step) {
      return reply(replyToken, "画像ありがとうございます。\n先に「登録」と送ってください。");
    }

    // 順番違い
    if (sessions[userId].step !== "image") {
      return reply(
        replyToken,
        "画像ありがとうございます。ただいま画像を受け取る段階ではありません。\n先に案内に従ってください。\n\n最初からなら「やり直し」"
      );
    }

    const name = sessions[userId].name;
    const flp = sessions[userId].flp;

    // 空欄防止
    if (!name) {
      sessions[userId].step = "name";
      return reply(replyToken, "氏名が未入力です。\n【氏名】を送ってください。");
    }
    if (!flp) {
      sessions[userId].step = "flp";
      return reply(replyToken, "FLP番号が未入力です。\n【FLP番号】を送ってください。");
    }

    const imageMessageId = event.message.id;

    // 登録者へ「確実に」返信（reply）
    await reply(
      replyToken,
      "画像を受け取りました。ありがとうございます。\n" +
        "【登録情報が揃いました】\n" +
        "・氏名\n・FLP番号\n・購入画面スクリーンショット\n\n" +
        "紹介者が確認後、VSHを譲渡します。"
    );

    // 管理者へ通知（push）
    if (ADMIN_USER_ID) {
      await client.pushMessage(ADMIN_USER_ID, {
        type: "text",
        text:
          `【登録完了】\n` +
          `氏名：${name}\n` +
          `FLP：${flp}\n` +
          `スクショID：${imageMessageId}\n` +
          `userId：${userId}`,
      });
    } else {
      console.warn("⚠️ ADMIN_USER_IDが未設定です（管理者通知できません）");
    }

    delete sessions[userId];
  }
}

function reply(replyToken, text) {
  return client.replyMessage(replyToken, { type: "text", text });
}

app.get("/", (_, res) => res.send("Vera Sky Harmony Server is running"));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (!ADMIN_USER_ID) console.log("⚠️ ADMIN_USER_IDが未設定です（push通知ができません）");
});

