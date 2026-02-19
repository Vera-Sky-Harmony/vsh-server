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
  PORT
} = process.env;

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* ===============================
   🔵 static（page固定）
=============================== */
app.use("/pages", express.static(path.join(__dirname, "page")));

app.get("/test", (req, res) => {
  res.send("STATIC_OK");
});

app.get("/", (req, res) => {
  res.send("SERVER_OK");
});

/* ===============================
   🔵 状態管理
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
    console.error(err);
    res.status(200).end();
  }
});

/* ===============================
   🔵 LINEイベント処理
=============================== */
async function handleEvent(event) {

  if (event.type !== "message") return;
  if (event.message.type !== "text") return;

  const userId = event.source.userId;
  const text = event.message.text.trim();

  /* Day7-1 → 登録希望 */
  if (text === "登録希望") {
    await client.replyMessage(event.replyToken, {
      type: "text",
      text: "【Day7-2】\nFLP登録を完了してください。\n登録後『3点をLINEで返信する』と入力してください。"
    });
    return;
  }

  /* 3点開始 */
  if (text === "3点をLINEで返信する") {
    threePointsState.set(userId, { step: 1 });

    await client.replyMessage(event.replyToken, {
      type: "text",
      text: "① 氏名を入力してください"
    });
    return;
  }

  const state = threePointsState.get(userId);

  if (state?.step === 1) {
    state.name = text;
    state.step = 2;

    await client.replyMessage(event.replyToken, {
      type: "text",
      text: "② FLP番号を入力してください"
    });
    return;
  }

  if (state?.step === 2) {
    state.flp = text;
    threePointsState.delete(userId);

    await client.replyMessage(event.replyToken, {
      type: "text",
      text: "登録を受け付けました。\n確認後VSHを譲渡します。"
    });
    return;
  }
}

/* ===============================
   🔵 起動
=============================== */
app.listen(Number(PORT || 10000), () => {
  console.log("VSH STABLE RUNNING");
});
