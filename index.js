import express from "express";
import * as line from "@line/bot-sdk";

const app = express();
const PORT = process.env.PORT || 3000;

// ===== 必須環境変数 =====
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

// ✅ 追加：紹介者（あなた）に通知する先のユーザーID
// RenderのEnvironment Variablesに ADMIN_USER_ID を追加してください
const ADMIN_USER_ID = process.env.ADMIN_USER_ID;

if (!CHANNEL_SECRET || !CHANNEL_ACCESS_TOKEN) {
  console.error("❌ Missing CHANNEL_SECRET or CHANNEL_ACCESS_TOKEN");
}
if (!ADMIN_USER_ID) {
  console.error("⚠️ Missing ADMIN_USER_ID (push通知先が未設定です)");
}

// LINE SDK クライアント
const config = {
  channelSecret: CHANNEL_SECRET,
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
};
const client = new line.Client(config);

// ===== 登録状態（簡易：メモリ） =====
// ※ Render無料枠は再起動で消えます。運用で必要なら後でDB化します。
const sessions = new Map();
/*
session例:
{
  step: "WAIT_NAME" | "WAIT_FLP" | "WAIT_IMAGE" | "DONE",
  name: "",
  flp: "",
  imageMessageId: ""
}
*/

// ===== 便利関数 =====
const normalize = (s) => (s || "").replace(/\s+/g, " ").trim();

function resetSession(userId) {
  sessions.set(userId, { step: "WAIT_NAME", name: "", flp: "", imageMessageId: "" });
}

function getSession(userId) {
  if (!sessions.has(userId)) resetSession(userId);
  return sessions.get(userId);
}

function isFlpNumber(text) {
  // 例: 203145165（数字のみ、6〜12桁くらいを許容）
  return /^[0-9]{6,12}$/.test(text);
}

function isResetCommand(text) {
  return text === "最初から" || text === "やり直し";
}

async function replyText(replyToken, text) {
  return client.replyMessage(replyToken, { type: "text", text });
}

async function pushToAdmin(text) {
  if (!ADMIN_USER_ID) return;
  try {
    await client.pushMessage(ADMIN_USER_ID, { type: "text", text });
  } catch (e) {
    console.error("❌ pushMessage to ADMIN failed:", e?.message || e);
  }
}

// ===== ルート =====
app.get("/", (req, res) => {
  res.send("Vera Sky Harmony Server is running");
});

// ===== Webhook（署名検証あり） =====
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    console.log("Webhook received:", JSON.stringify(req.body));

    for (const event of events) {
      // メッセージ以外は基本スルー（必要なら後で追加）
      if (event.type !== "message") continue;

      const userId = event.source?.userId;
      const replyToken = event.replyToken;

      if (!userId || !replyToken) continue;

      const session = getSession(userId);

      // --- テキストメッセージ ---
      if (event.message.type === "text") {
        const text = normalize(event.message.text);

        // 復旧コマンド
        if (isResetCommand(text)) {
          resetSession(userId);
          await replyText(
            replyToken,
            "了解です。最初からやり直します。\nまず「登録」と送ってください。"
          );
          continue;
        }

        // 開始コマンド
        if (text === "登録") {
          resetSession(userId);
          await replyText(
            replyToken,
            "登録の受付を開始します。\nまず【氏名】を送ってください。\n（途中で戻す場合は「最初から」または「やり直し」）"
          );
          continue;
        }

        // 登録開始前に何か送った場合
        if (!session || !session.step) {
          resetSession(userId);
          await replyText(replyToken, "まず「登録」と送ってください。");
          continue;
        }

        // ステップ処理
        if (session.step === "WAIT_NAME") {
          // 氏名として受け取る（数字だけならFLPっぽいので案内）
          if (isFlpNumber(text)) {
            await replyText(
              replyToken,
              "FLP番号のようです。先に【氏名】を送ってください。\n例：細井 信孝"
            );
            continue;
          }

          session.name = text;
          session.step = "WAIT_FLP";
          sessions.set(userId, session);

          await replyText(
            replyToken,
            `ありがとうございます。\n次に【FLP番号】を数字だけで送ってください。\n例：203145165\n（やり直し：最初から）`
          );
          continue;
        }

        if (session.step === "WAIT_FLP") {
          if (!isFlpNumber(text)) {
            await replyText(
              replyToken,
              "FLP番号は【数字のみ】で送ってください。\n例：203145165"
            );
            continue;
          }

          session.flp = text;
          session.step = "WAIT_IMAGE";
          sessions.set(userId, session);

          await replyText(
            replyToken,
            "ありがとうございます。\n最後に【購入画面のスクリーンショット】を画像で送ってください。"
          );
          continue;
        }

        if (session.step === "WAIT_IMAGE") {
          // 画像待ちなのにテキストが来た
          await replyText(
            replyToken,
            "ただいま【スクリーンショット】を受け取る段階です。\n購入画面のスクリーンショット（画像）を送ってください。\n（やり直し：最初から）"
          );
          continue;
        }

        if (session.step === "DONE") {
          await replyText(
            replyToken,
            "登録情報はすでに揃っています。\n紹介者が確認後、VSHを譲渡します。\n（やり直し：最初から）"
          );
          continue;
        }
      }

      // --- 画像メッセージ ---
      if (event.message.type === "image") {
        const session = getSession(userId);
        const messageId = event.message.id; // ✅ これが画像確認用のmessageIdです

        // 登録開始前に画像だけ送った場合
        if (!session || !session.step) {
          resetSession(userId);
          await replyText(
            replyToken,
            "画像ありがとうございます。ただいま画像を受け取る段階ではありません。\n先に「登録」と送ってください。"
          );
          continue;
        }

        // まだ「登録」前（WAIT_NAME）またはFLP未入力（WAIT_FLP）なら案内
        if (session.step === "WAIT_NAME") {
          await replyText(
            replyToken,
            "画像ありがとうございます。ただいま画像を受け取る段階ではありません。\n先に「登録」と送り、【氏名】を送ってください。"
          );
          continue;
        }

        if (session.step === "WAIT_FLP") {
          await replyText(
            replyToken,
            "画像ありがとうございます。ただいま画像を受け取る段階ではありません。\n先に【FLP番号】を送ってください。"
          );
          continue;
        }

        // 画像を受け取る段階
        if (session.step === "WAIT_IMAGE") {
          session.imageMessageId = messageId;
          session.step = "DONE";
          sessions.set(userId, session);

          // ユーザーへ完了メッセージ（あなたが提示した文章 그대로）
          await replyText(
            replyToken,
            "画像を受け取りました。ありがとうございます。\n" +
              "【登録情報が揃いました】\n" +
              "・氏名\n" +
              "・FLP番号\n" +
              "・購入画面スクリーンショット\n\n" +
              "紹介者が確認後、VSHを譲渡します。"
          );

          // ✅ 紹介者（あなた）へ通知（messageId付き）
          await pushToAdmin(
            `✅登録完了：${session.name} / ${session.flp} / スクショ受信\n` +
              `image messageId: ${messageId}\n` +
              `（必要なら「最初から」で復旧指示できます）`
          );

          console.log("✅ Registration completed:", {
            userId,
            name: session.name,
            flp: session.flp,
            imageMessageId: messageId,
          });

          continue;
        }

        // DONE後に画像が追加で来た場合
        if (session.step === "DONE") {
          await replyText(
            replyToken,
            "画像ありがとうございます。\n登録情報はすでに揃っています。\n紹介者が確認後、VSHを譲渡します。\n（やり直し：最初から）"
          );
          continue;
        }
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Webhook error:", err?.message || err);
    res.status(500).send("Internal Server Error");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
