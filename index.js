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
  ADMIN_NOTIFY_USER_ID
} = process.env;

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* ===============================
   🔵 Web（Day0～Day7-1のみ）
=============================== */
app.use("/pages", express.static(path.join(__dirname, "pages")));

app.get("/test", (_req, res) => res.send("STATIC_OK"));
app.get("/", (_req, res) => res.send("SERVER_OK"));

/* ===============================
   🔵 3点フロー状態管理
=============================== */
const threePointsState = new Map();

/* ===============================
   🔵 Webhook
=============================== */
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const signature = req.headers["x-line-signature"];
    const hash = crypto
      .createHmac("sha256", CHANNEL_SECRET)
      .update(req.body)
      .digest("base64");

    if (signature !== hash) {
      return res.status(401).end();
    }

    const body = JSON.parse(req.body.toString());

    for (const event of body.events || []) {
      await handleEvent(event);
    }

    res.status(200).end();
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(200).end();
  }
});

/* ===============================
   🔵 LINE処理（Day7-2/7-3のみ）
=============================== */
async function handleEvent(event) {

  if (event.type !== "message") return;
  if (event.message.type !== "text") return;

  const userId = event.source.userId;
  const text = event.message.text.trim();

  /* ===== Day7-2 ===== */
  if (text === "登録希望") {
    await safeReply(event.replyToken, {
      type: "text",
      text:
        "【Day7-2】\n" +
        "FLP登録を完了してください。\n\n" +
        "登録完了後、\n" +
        "『3点をLINEで返信する』と入力してください。"
    });
    return;
  }

  /* ===== 3点開始 ===== */
  if (text === "3点をLINEで返信する") {
    threePointsState.set(userId, { step: 1 });
    await safeReply(event.replyToken, {
      type: "text",
      text: "① 氏名を入力してください"
    });
    return;
  }

  const state = threePointsState.get(userId);

  if (state?.step === 1) {
    state.name = text;
    state.step = 2;

    await safeReply(event.replyToken, {
      type: "text",
      text: "② あなたのFLP番号を入力してください"
    });
    return;
  }

  if (state?.step === 2) {
    state.flp = text;
    threePointsState.delete(userId);

    await safeReply(event.replyToken, {
      type: "text",
      text:
        "【Day7-3】\n" +
        "登録を受け付けました。\n\n" +
        "FLPシステムへの登録確認後、\n" +
        "VSHを譲渡いたします。"
    });

    if (ADMIN_NOTIFY_USER_ID) {
      await safePush(ADMIN_NOTIFY_USER_ID, {
        type: "text",
        text:
          "【登録完了通知】\n" +
          `氏名: ${state.name}\n` +
          `FLP: ${state.flp}\n` +
          `userId: ${userId}`
      });
    }

    return;
  }
}

/* ===============================
   🔵 安全送信
=============================== */
async function safeReply(token, message) {
  try {
    await client.replyMessage(token, message);
  } catch (e) {
    console.error("Reply error:", e?.originalError?.response?.data || e);
  }
}

async function safePush(to, message) {
  try {
    await client.pushMessage(to, message);
  } catch (e) {
    console.error("Push error:", e?.originalError?.response?.data || e);
  }
}

/* ===============================
   🔵 起動
=============================== */
app.listen(Number(PORT || 10000), () => {
  console.log("VSH LINE MODE RUNNING");
});
