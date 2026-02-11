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
  ADMIN_NOTIFY_USER_ID,
  DAY7_2_IMAGE_URL,
  PORT,
} = process.env;

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* =============================
   🔵 静的ファイル公開（これが重要）
============================= */
app.use("/pages", express.static(path.join(__dirname, "pages")));

app.use(express.json());

let usedRegisterIntent = new Set();
let threePointsState = new Map();

/* =============================
   Webhook
============================= */
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    if (!verifyLineSignature(req)) {
      return res.status(401).send("Bad signature");
    }
    const body = JSON.parse(req.body.toString("utf8"));
    await handleWebhook(body);
    res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    res.status(200).send("OK");
  }
});

/* =============================
   イベント処理
============================= */
async function handleWebhook(body) {
  const events = body.events || [];

  for (const ev of events) {
    if (!ev.source?.userId) continue;
    const userId = ev.source.userId;

    /* follow時 */
    if (ev.type === "follow") {
      await client.pushMessage(userId, {
        type: "text",
        text:
          "Vera Sky Harmonyへようこそ。\n\nまずはDay0からご覧ください。\nhttps://vsh-server.onrender.com/pages/day0.html",
      });
      continue;
    }

    if (ev.type === "message" && ev.message.type === "text") {
      const text = ev.message.text.trim();

      if (text === "登録希望") {
        if (usedRegisterIntent.has(userId)) return;
        usedRegisterIntent.add(userId);
        await sendDay7(userId);
        continue;
      }

      if (text === "3点返信開始") {
        await startThreePointsFlow(userId);
        continue;
      }

      await handleThreePointsConversation(userId, text);
    }

    if (ev.type === "message" && ev.message.type === "image") {
      await handleScreenshot(userId, ev.message.id);
    }
  }
}

/* =============================
   Day7送信
============================= */
async function sendDay7(userId) {
  await client.pushMessage(userId, [
    {
      type: "text",
      text: "7日間ありがとうございました！",
    },
    buildBlueFlex(),
  ]);
}

function buildBlueFlex() {
  return {
    type: "flex",
    altText: "3点返信開始",
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url: DAY7_2_IMAGE_URL,
        size: "full",
        aspectRatio: "20:13",
        aspectMode: "cover",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
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

/* =============================
   3点フロー
============================= */
async function startThreePointsFlow(userId) {
  threePointsState.set(userId, { step: 1 });
  await client.pushMessage(userId, {
    type: "text",
    text: "① 氏名を入力してください",
  });
}

async function handleThreePointsConversation(userId, text) {
  const state = threePointsState.get(userId);
  if (!state) return;

  if (state.step === 1) {
    state.name = text;
    state.step = 2;
    await client.pushMessage(userId, {
      type: "text",
      text: "② あなたのFLP番号を入力してください",
    });
    return;
  }

  if (state.step === 2) {
    state.flp = text;
    state.step = 3;
    await client.pushMessage(userId, {
      type: "text",
      text: "③ 購入画面スクリーンショットを送信してください",
    });
  }
}

async function handleScreenshot(userId, messageId) {
  const state = threePointsState.get(userId);
  if (!state || state.step !== 3) return;

  threePointsState.delete(userId);

  await client.pushMessage(userId, {
    type: "text",
    text: "登録情報を受け取りました。",
  });

  await client.pushMessage(ADMIN_NOTIFY_USER_ID, {
    type: "text",
    text:
      "【登録報告】\n" +
      `氏名: ${state.name}\n` +
      `FLP: ${state.flp}`,
  });
}

/* =============================
   署名検証
============================= */
function verifyLineSignature(req) {
  const signature = req.headers["x-line-signature"];
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(req.body)
    .digest("base64");
  return signature === hash;
}

app.listen(PORT || 10000, () =>
  console.log("VSH server running")
);
