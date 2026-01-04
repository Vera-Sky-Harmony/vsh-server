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

// メモリ上の簡易セッション（後でDB化可能）
const sessions = {};

// LINE署名検証
app.post("/webhook", express.json({
  verify: (req, res, buf) => {
    const signature = req.headers["x-line-signature"];
    const hash = crypto
      .createHmac("SHA256", config.channelSecret)
      .update(buf)
      .digest("base64");
    if (hash !== signature) {
      throw new Error("Invalid signature");
    }
  }
}), async (req, res) => {
  const events = req.body.events || [];
  for (const event of events) {
    await handleEvent(event);
  }
  res.sendStatus(200);
});

async function handleEvent(event) {
  if (event.type !== "message") return;

  const userId = event.source.userId;
  sessions[userId] ??= {};

  // ===== テキスト =====
  if (event.message.type === "text") {
    const text = event.message.text.trim();

    if (text === "登録") {
      sessions[userId] = { step: "name" };
      return reply(userId, "登録を開始します。\n【氏名】を送ってください。");
    }

    if (text === "最初から" || text === "やり直し") {
      sessions[userId] = {};
      return reply(userId, "リセットしました。\n「登録」と送ってください。");
    }

    if (sessions[userId].step === "name") {
      sessions[userId].name = text;
      sessions[userId].step = "flp";
      return reply(userId, "ありがとうございます。\n【FLP番号】を送ってください。");
    }

    if (sessions[userId].step === "flp") {
      sessions[userId].flp = text;
      sessions[userId].step = "image";
      return reply(userId, "最後に【購入画面のスクリーンショット】を画像で送ってください。");
    }

    return reply(userId, "案内に従ってください。\n「登録」と送ると開始します。");
  }

  // ===== 画像 =====
  if (event.message.type === "image") {
    if (sessions[userId].step !== "image") {
      return reply(userId, "画像ありがとうございます。\n先に「登録」と送ってください。");
    }

    sessions[userId].imageMessageId = event.message.id;

    // 登録完了メッセージ（ユーザー）
    await reply(userId,
      "【登録情報が揃いました】\n" +
      "・氏名\n・FLP番号\n・購入画面スクリーンショット\n\n" +
      "紹介者が確認後、VSHを譲渡します。"
    );

    // 管理者通知
    if (ADMIN_USER_ID) {
      await client.pushMessage(ADMIN_USER_ID, {
        type: "text",
        text:
`【登録完了】
氏名：${sessions[userId].name}
FLP：${sessions[userId].flp}
スクショID：${sessions[userId].imageMessageId}

（画像確認用 messageId）`
      });
    }

    delete sessions[userId];
  }
}

function reply(userId, text) {
  return client.pushMessage(userId, { type: "text", text });
}

app.get("/", (_, res) => {
  res.send("Vera Sky Harmony Server is running");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
