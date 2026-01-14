import express from "express";
import { middleware, Client } from "@line/bot-sdk";

// =====================
// 環境変数
// =====================
const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  ADMIN_USER_ID,
  INTRODUCER_NAME,
  INTRODUCER_FLP,
  FBO_GUIDE_URL,
  PORT
} = process.env;

// =====================
// LINE SDK 設定
// =====================
const lineConfig = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET,
};

const client = new Client(lineConfig);

// =====================
// Express 初期化
// =====================
const app = express();

// Render 対策（必須）
const port = PORT || 10000;

// =====================
// Webhook エンドポイント
// =====================
app.post(
  "/callback",
  middleware(lineConfig),
  async (req, res) => {
    try {
      const events = req.body.events;
      await Promise.all(events.map(handleEvent));
      res.status(200).end();
    } catch (err) {
      console.error("Webhook Error:", err);
      res.status(500).end();
    }
  }
);

// =====================
// イベント処理
// =====================
async function handleEvent(event) {
  if (event.type !== "message") return;

  const userId = event.source.userId;
  const text = event.message.text;

  // ---------------------
  // 「登録希望」
  // ---------------------
  if (text === "登録希望") {

    // ① 管理者（紹介者）へ通知
    await client.pushMessage(ADMIN_USER_ID, {
      type: "text",
      text: `【登録希望 受信】\n\nユーザーID:\n${userId}`,
    });

    // ② 新規登録者へ3点＋案内送信
    const replyText =
`ありがとうございます。登録手続きをご案内します。

【あなたの3点情報】
・紹介者氏名：${INTRODUCER_NAME}
・紹介者FLP番号：${INTRODUCER_FLP}
・あなたのFLP番号：後ほど発行されます

▼ FBO登録手順はこちら
${FBO_GUIDE_URL}

登録完了後、
「3点をLINEで返信する」ボタンを押してください。`;

    await client.replyMessage(event.replyToken, {
      type: "text",
      text: replyText,
    });
  }

  // ---------------------
  // 「3点をLINEで返信する」
  // ---------------------
  if (text === "3点をLINEで返信する") {
    await client.replyMessage(event.replyToken, {
      type: "text",
      text:
`次の3点を、このままLINEで送ってください。

① 氏名
② FLP番号
③ 購入画面のスクリーンショット（画像）

確認後、Vera Sky Harmony を譲渡します。`,
    });
  }
}

// =====================
// ヘルスチェック（重要）
// =====================
app.get("/", (req, res) => {
  res.send("VSH server is running 🚀");
});

// =====================
// サーバー起動
// =====================
app.listen(port, () => {
  console.log(`VSHサーバー起動中：ポート ${port}`);
  console.log(`Webhook URL: /callback`);
});

