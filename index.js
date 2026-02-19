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
  DAY7_2_IMAGE_URL,
  PORT,
} = process.env;

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* =========================================
   🔵 静的ページ（最優先・完全独立）
========================================= */

app.use("/pages", express.static(path.join(__dirname, "ページ")));
app.use("/ページ", express.static(path.join(__dirname, "ページ")));
app.use(express.static(path.join(__dirname, "ページ")));

app.get("/test", (_req, res) => {
  res.send("STATIC_OK");
});

app.get("/", (_req, res) => {
  res.send("SERVER_OK");
});

/* =========================================
   3点ステート管理
========================================= */

const threePointsState = new Map();

/* =========================================
   Webhook（完全防御版）
========================================= */

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

    for (const ev of body.events || []) {
      await handleEvent(ev);
    }

    res.status(200).end();
  } catch (e) {
    console.error("Webhook Error:", e);
    // 絶対に落とさない
    res.status(200).end();
  }
});

/* =========================================
   イベント処理
========================================= */

async function handleEvent(ev) {
  if (!ev?.source?.userId) return;
  if (ev.type !== "message") return;
  if (ev.message.type !== "text") return;

  const userId = ev.source.userId;
  const text = ev.message.text.trim();

  console.log("受信:", text);

  /* ===== 登録希望 ===== */

  if (text.includes("登録希望")) {
    await safeReply(ev.replyToken, buildDay7_2());
    return;
  }

  /* ===== 3点開始 ===== */

  if (text === "3点返信開始") {
    threePointsState.set(userId, { step: 1 });

    await safeReply(ev.replyToken, {
      type: "text",
      text: "① 氏名を入力してください",
    });
    return;
  }

  /* ===== 3点フロー ===== */

  const state = threePointsState.get(userId);

  if (state?.step === 1) {
    state.name = text;
    state.step = 2;

    await safeReply(ev.replyToken, {
      type: "text",
      text: "② あなたのFLP番号を入力してください",
    });
    return;
  }

  if (state?.step === 2) {
    state.flp = text;
    threePointsState.delete(userId);

    await safeReply(ev.replyToken, {
      type: "text",
      text: "登録確認が完了しました。",
    });
    return;
  }
}

/* =========================================
   Day7-2 Flex
========================================= */

function buildDay7_2() {
  return {
    type: "flex",
    altText: "3点返信開始",
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url:
          DAY7_2_IMAGE_URL ||
          "https://via.placeholder.com/600x400.png?text=Day7-2",
        size: "full",
        aspectRatio: "20:13",
        aspectMode: "cover",
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "登録が終わったら、ここから3点返信を開始します",
            wrap: true,
          },
          {
            type: "button",
            style: "primary",
            action: {
              type: "message",
              label: "3点をLINEで返信する",
              text: "3点返信開始",
            },
          },
        ],
      },
    },
  };
}

/* =========================================
   安全reply（429でも落ちない）
========================================= */

async function safeReply(token, message) {
  try {
    await client.replyMessage(token, message);
  } catch (e) {
    console.error("Reply Error:", e?.originalError?.response?.data || e);
  }
}

/* =========================================
   起動
=================
-
