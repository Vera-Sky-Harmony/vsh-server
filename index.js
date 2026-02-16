import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  INTRODUCER_NAME,
  INTRODUCER_FLP,
  ADMIN_NOTIFY_USER_ID,
  ADMIN_TOKEN,
  DAY7_2_IMAGE_URL,
  ENTRY_GUIDE_URL,
  ASSIGNED_FLP_TIMEOUT_DAYS,
  PORT,
} = process.env;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error("ENV不足");
  process.exit(1);
}

const TIMEOUT_DAYS = Number(ASSIGNED_FLP_TIMEOUT_DAYS || "10");
const TIMEOUT_MS = TIMEOUT_DAYS * 24 * 60 * 60 * 1000;

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });
app.use("/pages", express.static("pages"));

let flpUnused = [
  "361799161",
  "361799162",
  "361799163"
];
let flpAssigned = new Map();
let flpConsumed = new Map();
const threePointsState = new Map();

app.get("/", (_req, res) => res.send("VSH server running"));

app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    if (!verifySignature(req)) return res.status(401).send("Bad signature");

    const body = JSON.parse(req.body.toString());
    await handleWebhook(body);
    res.status(200).send("OK");
  } catch (e) {
    console.error(e);
    res.status(200).send("OK");
  }
});

async function handleWebhook(body) {
  for (const ev of body.events || []) {
    if (!ev.source?.userId) continue;
    const userId = ev.source.userId;

    if (ev.type === "message" && ev.message.type === "text") {
      const text = ev.message.text.trim();

      // ===== Day6 → Day7開始 =====
      if (text === "Day7開始") {
        await safePush(userId, [
          {
            type: "text",
            text:
              "🌟1週間ありがとうございました！\n\n" +
              "あなたが登録すると、このVera Sky Harmonyがあなたにプレゼントされます。\n" +
              "AIが紹介・登録・教育・拡散を代行し、健康と繁栄の輪が広がります。\n\n" +
              "登録を希望される方は、下の黄色画面をタップしてください。",
          },
          buildYellowFlex()
        ]);
        continue;
      }

      // ===== 黄色Flexタップ =====
      if (text === "登録希望") {
        await handleRegister(userId);
        continue;
      }

      // ===== 青Flexタップ =====
      if (text === "3点返信開始") {
        threePointsState.set(userId, { step: 1, name: "", flp: "" });
        await safePush(userId, [
          { type: "text", text: "① 氏名を入力してください" }
        ]);
        continue;
      }

      await handleThreePoints(userId, text);
    }

    if (ev.type === "message" && ev.message.type === "image") {
      await handleScreenshot(ev.source.userId, ev.message.id);
    }
  }
}

async function handleRegister(userId) {
  const assigned = assignFlp(userId);

  if (!assigned) {
    await safePush(userId, [
      { type: "text", text: "現在準備中です。紹介者へご連絡ください。" }
    ]);
    return;
  }

  await safePush(userId, [
    buildBlueFlex(),
    {
      type: "text",
      text:
        "あなたが登録するのに必要な3点をお送りします。\n\n" +
        `① 紹介者氏名：${INTRODUCER_NAME}\n` +
        `② 紹介者FLP番号：${INTRODUCER_FLP}\n` +
        `③ あなたのFLP番号：${assigned}`
    },
    {
      type: "text",
      text: "📘 登録手順書\n" + ENTRY_GUIDE_URL
    }
  ]);
}

function buildYellowFlex() {
  return {
    type: "flex",
    altText: "登録希望",
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url: "https://res.cloudinary.com/dxegzwukb/image/upload/v1770446396/1fb98781-8e51-43d9-87c1-691eb51f6d8b_cjdpfm.png",
        size: "full",
        aspectRatio: "20:13",
        aspectMode: "cover",
        action: {
          type: "message",
          label: "登録希望",
          text: "登録希望"
        }
      }
    }
  };
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
        aspectMode: "cover"
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
              text: "3点返信開始"
            }
          }
        ]
      }
    }
  };
}

async function handleThreePoints(userId, text) {
  const state = threePointsState.get(userId);
  if (!state) return;

  if (state.step === 1) {
    state.name = text;
    state.step = 2;
    await safePush(userId, [{ type: "text", text: "② あなたのFLP番号を入力してください" }]);
  } else if (state.step === 2) {
    state.flp = text;
    state.step = 3;
    await safePush(userId, [{ type: "text", text: "③ 購入画面スクリーンショットを送ってください" }]);
  }
}

async function handleScreenshot(userId, messageId) {
  const state = threePointsState.get(userId);
  if (!state || state.step !== 3) return;

  threePointsState.delete(userId);

  await safePush(userId, [
    { type: "text", text: "確認しました。紹介者が対応します。" }
  ]);
}

function assignFlp(userId) {
  if (flpAssigned.has(userId)) return flpAssigned.get(userId);

  if (flpUnused.length === 0) return null;

  const flp = flpUnused.shift();
  flpAssigned.set(userId, flp);
  return flp;
}

function verifySignature(req) {
  const signature = req.headers["x-line-signature"];
  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(req.body)
    .digest("base64");
  return signature === hash;
}

async function safePush(to, messages) {
  try {
    await client.pushMessage(to, messages);
  } catch (e) {
    console.error(e);
  }
}

app.listen(PORT || 10000);
