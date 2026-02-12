import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
   ENV
========================= */

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  INTRODUCER_NAME,
  INTRODUCER_FLP,
  ADMIN_NOTIFY_USER_ID,
  ADMIN_TOKEN,
  DAY7_2_IMAGE_URL,
  FLP_OFFICIAL_URL,
  ENTRY_GUIDE_URL,
  ASSIGNED_FLP_TIMEOUT_DAYS,
  PORT,
} = process.env;

function must(v, name) {
  if (!v) {
    console.error("Missing ENV:", name);
    process.exit(1);
  }
}

must(CHANNEL_ACCESS_TOKEN, "CHANNEL_ACCESS_TOKEN");
must(CHANNEL_SECRET, "CHANNEL_SECRET");
must(INTRODUCER_NAME, "INTRODUCER_NAME");
must(INTRODUCER_FLP, "INTRODUCER_FLP");
must(ADMIN_NOTIFY_USER_ID, "ADMIN_NOTIFY_USER_ID");
must(ADMIN_TOKEN, "ADMIN_TOKEN");
must(DAY7_2_IMAGE_URL, "DAY7_2_IMAGE_URL");
must(FLP_OFFICIAL_URL, "FLP_OFFICIAL_URL");
must(ENTRY_GUIDE_URL, "ENTRY_GUIDE_URL");

const TIMEOUT_DAYS = Number(ASSIGNED_FLP_TIMEOUT_DAYS || "10");
const TIMEOUT_MS = TIMEOUT_DAYS * 24 * 60 * 60 * 1000;

/* =========================
   App
========================= */

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* =========================
   静的ページ (Day0〜Day6 / Day8以降)
========================= */

app.use("/pages", express.static(path.join(__dirname, "pages")));

app.get("/", (req, res) => {
  res.send("VSH server running");
});

/* =========================
   データ（メモリ）
========================= */

let flpUnused = [];
let flpAssigned = new Map();
let flpConsumed = new Map();
const threePointsState = new Map();

/* =========================
   Webhook
========================= */

app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    if (!verifyLineSignature(req)) {
      return res.status(401).send("Bad signature");
    }

    const body = JSON.parse(req.body.toString("utf8"));
    await handleWebhook(body);
    res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(200).send("OK");
  }
});

function verifyLineSignature(req) {
  const signature = req.headers["x-line-signature"];
  if (!signature) return false;

  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(req.body)
    .digest("base64");

  return hash === signature;
}

/* =========================
   Webhook本体
========================= */

async function handleWebhook(body) {
  cleanupExpiredAssignments();

  for (const ev of body.events || []) {
    if (!ev?.source?.userId) continue;
    const userId = ev.source.userId;

    if (ev.type === "follow") {
      await client.pushMessage(userId, [
        {
          type: "text",
          text: "ようこそVera Sky Harmonyへ。\nこちらからスタートしてください。",
        },
        {
          type: "text",
          text: `${process.env.BASE_URL}/pages/day0.html`,
        },
      ]);
      continue;
    }

    if (ev.type === "message" && ev.message.type === "text") {
      const text = ev.message.text.trim();

      if (text === "登録希望") {
        await onRegisterIntent(userId);
        continue;
      }

      if (text === "3点返信開始") {
        await startThreePointsFlow(userId);
        continue;
      }

      await handleThreePointsConversation(userId, text);
      continue;
    }

    if (ev.type === "message" && ev.message.type === "image") {
      await handleScreenshot(userId, ev.message.id);
    }
  }
}

/* =========================
   Day7ロジック
========================= */

async function onRegisterIntent(userId) {
  const assignedFlp = assignFlpToUser(userId);

  await safePush(ADMIN_NOTIFY_USER_ID, [
    {
      type: "text",
      text: `【登録希望】\nuserId: ${userId}\n割当FLP: ${
        assignedFlp || "失敗"
      }`,
    },
  ]);

  if (!assignedFlp) {
    await safePush(userId, [
      {
        type: "text",
        text: "現在受付準備中です。紹介者へご連絡ください。",
      },
    ]);
    return;
  }

  await safePush(userId, [
    buildDay7BlueFlex(),
    {
      type: "text",
      text:
        `①紹介者氏名：${INTRODUCER_NAME}\n` +
        `②紹介者FLP番号：${INTRODUCER_FLP}\n` +
        `③あなたのFLP番号：${assignedFlp}`,
    },
    {
      type: "text",
      text: `FLP公式サイト\n${FLP_OFFICIAL_URL}\n\n手順書\n${ENTRY_GUIDE_URL}`,
    },
  ]);
}

function buildDay7BlueFlex() {
  return {
    type: "flex",
    altText: "3点をLINEで返信する",
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url: DAY7_2_IMAGE_URL,
        size: "full",
        aspectMode: "cover",
        aspectRatio: "20:13",
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

/* =========================
   3点返信
========================= */

async function startThreePointsFlow(userId) {
  threePointsState.set(userId, { step: 1 });
  await safePush(userId, [
    { type: "text", text: "① 氏名を入力してください" },
  ]);
}

async function handleThreePointsConversation(userId, text) {
  const st = threePointsState.get(userId);
  if (!st) return;

  if (st.step === 1) {
    st.name = text;
    st.step = 2;
    await safePush(userId, [
      { type: "text", text: "② あなたのFLP番号を入力してください" },
    ]);
  } else if (st.step === 2) {
    st.flp = text;
    st.step = 3;
    await safePush(userId, [
      { type: "text", text: "③ 購入画面のスクリーンショットを送ってください" },
    ]);
  }
}

async function handleScreenshot(userId) {
  const st = threePointsState.get(userId);
  if (!st || st.step !== 3) return;

  threePointsState.delete(userId);

  await safePush(ADMIN_NOTIFY_USER_ID, [
    {
      type: "text",
      text: `【3点完了】\n氏名:${st.name}\nFLP:${st.flp}\nuser:${userId}`,
    },
  ]);

  await safePush(userId, [
    { type: "text", text: "確認後、次の案内を行います。" },
  ]);
}

/* =========================
   FLP管理
========================= */

function assignFlpToUser(userId) {
  if (flpAssigned.has(userId)) return flpAssigned.get(userId).flp;
  if (flpUnused.length === 0) return null;

  const flp = flpUnused.shift();
  flpAssigned.set(userId, { flp, assignedAt: Date.now() });
  return flp;
}

function cleanupExpiredAssignments() {
  const now = Date.now();
  for (const [uid, v] of flpAssigned.entries()) {
    if (now - v.assignedAt > TIMEOUT_MS) {
      flpAssigned.delete(uid);
      flpUnused.push(v.flp);
    }
  }
}

async function safePush(to, messages) {
  try {
    await client.pushMessage(to, messages);
  } catch (err) {
    console.error("Push error:", err);
  }
}

/* ========================= */

app.listen(Number(PORT || 10000), () => {
  console.log("VSH server running on port", PORT || 10000);
});
