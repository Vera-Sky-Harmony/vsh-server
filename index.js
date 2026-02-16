import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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
  DAY7_1_IMAGE_URL,
  DAY7_2_IMAGE_URL,
  FLP_OFFICIAL_URL,
  ENTRY_GUIDE_URL,
  ASSIGNED_FLP_TIMEOUT_DAYS,
  PORT,
} = process.env;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error("ENV不足");
  process.exit(1);
}

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

app.use("/pages", express.static("pages"));

let flpUnused = [];
let flpAssigned = new Map();
let flpConsumed = new Map();
const threePointsState = new Map();

const TIMEOUT_DAYS = Number(ASSIGNED_FLP_TIMEOUT_DAYS || 10);
const TIMEOUT_MS = TIMEOUT_DAYS * 24 * 60 * 60 * 1000;

app.get("/", (_req, res) => res.send("VSH server running"));

/* ================= ADMIN ================= */

app.get("/admin", (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send("Forbidden");

  cleanupExpired();

  res.send(`
    <h2>VSH Admin</h2>
    unused: ${flpUnused.length}<br>
    assigned: ${flpAssigned.size}<br>
    consumed: ${flpConsumed.size}<br><br>

    <form method="POST" action="/admin/add?token=${ADMIN_TOKEN}">
      <textarea name="list" rows="10" cols="40"></textarea><br>
      <button>追加</button>
    </form>
  `);
});

app.post("/admin/add", express.urlencoded({ extended: false }), (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send("Forbidden");

  const list = req.body.list
    .split(/\r?\n/)
    .map(v => v.trim())
    .filter(Boolean);

  for (const f of list) {
    if (!flpUnused.includes(f)) flpUnused.push(f);
  }

  res.redirect(`/admin?token=${ADMIN_TOKEN}`);
});

/* ================= WEBHOOK ================= */

app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const signature = req.headers["x-line-signature"];
    const hash = crypto
      .createHmac("sha256", CHANNEL_SECRET)
      .update(req.body)
      .digest("base64");

    if (signature !== hash) return res.status(401).end();

    const body = JSON.parse(req.body.toString());
    await handleWebhook(body);
    res.status(200).end();
  } catch (e) {
    console.error(e);
    res.status(200).end();
  }
});

/* ================= CORE ================= */

async function handleWebhook(body) {
  cleanupExpired();

  for (const ev of body.events || []) {
    if (!ev?.source?.userId) continue;
    const userId = ev.source.userId;

    if (ev.type === "message" && ev.message.type === "text") {
      const text = ev.message.text.trim();

      if (text === "登録希望") return showYellow(userId);
      if (text === "登録確定") return executeRegistration(userId);
      if (text === "3点返信開始") return startThreePoints(userId);

      await handleConversation(userId, text);
    }

    if (ev.type === "message" && ev.message.type === "image") {
      await handleScreenshot(userId, ev.message.id);
    }
  }
}

/* ================= YELLOW ================= */

async function showYellow(userId) {
  await client.pushMessage(userId, [
    {
      type: "text",
      text:
        "🌟1週間ありがとうございました！\n\n" +
        "あなたが登録するとVSHがあなたにプレゼントされます。\n\n" +
        "下の黄色ボタンを押してください。",
    },
    {
      type: "flex",
      altText: "登録希望",
      contents: {
        type: "bubble",
        hero: {
          type: "image",
          url: DAY7_1_IMAGE_URL,
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
                label: "登録希望",
                text: "登録確定",
              },
            },
          ],
        },
      },
    },
  ]);
}

/* ================= REGISTRATION ================= */

async function executeRegistration(userId) {
  if (flpUnused.length === 0) {
    await client.pushMessage(userId, {
      type: "text",
      text: "現在準備中です。紹介者へご連絡ください。",
    });
    return;
  }

  const flp = flpUnused.shift();
  flpAssigned.set(userId, { flp, assignedAt: Date.now() });

  await client.pushMessage(userId, [
    buildBlueFlex(),
    {
      type: "text",
      text:
        `①紹介者氏名:${INTRODUCER_NAME}\n` +
        `②紹介者FLP:${INTRODUCER_FLP}\n` +
        `③あなたのFLP:${flp}`,
    },
    {
      type: "text",
      text: `登録手順\n${ENTRY_GUIDE_URL}\n\n公式\n${FLP_OFFICIAL_URL}`,
    },
  ]);

  await client.pushMessage(ADMIN_NOTIFY_USER_ID, {
    type: "text",
    text: `【登録確定】\n${userId}\nFLP:${flp}`,
  });
}

/* ================= BLUE ================= */

function buildBlueFlex() {
  return {
    type: "flex",
    altText: "3点返信",
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

/* ================= 3POINT ================= */

async function startThreePoints(userId) {
  threePointsState.set(userId, { step: 1 });
  await client.pushMessage(userId, { type: "text", text: "①氏名" });
}

async function handleConversation(userId, text) {
  const s = threePointsState.get(userId);
  if (!s) return;

  if (s.step === 1) {
    s.name = text;
    s.step = 2;
    return client.pushMessage(userId, { type: "text", text: "②FLP番号" });
  }

  if (s.step === 2) {
    s.flp = text;
    s.step = 3;
    return client.pushMessage(userId, { type: "text", text: "③スクショ送信" });
  }
}

async function handleScreenshot(userId, messageId) {
  const s = threePointsState.get(userId);
  if (!s || s.step !== 3) return;

  threePointsState.delete(userId);

  const assigned = flpAssigned.get(userId)?.flp;
  flpAssigned.delete(userId);
  flpConsumed.set(userId, assigned);

  // 🔹 画像データ取得
  const stream = await client.getMessageContent(messageId);

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  // 🔹 まずテキスト送信
  await client.pushMessage(ADMIN_NOTIFY_USER_ID, {
    type: "text",
    text:
      `【3点完了】\n` +
      `氏名:${s.name}\n入力FLP:${s.flp}\n割当FLP:${assigned}`,
  });

  // 🔹 画像をAへ転送
  await client.pushMessage(ADMIN_NOTIFY_USER_ID, {
    type: "image",
    originalContentUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`,
    previewImageUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`,
  });

  await client.pushMessage(userId, {
    type: "text",
    text: "確認完了しました。",
  });
}


/* ================= TIMEOUT ================= */

function cleanupExpired() {
  const now = Date.now();
  for (const [uid, v] of flpAssigned.entries()) {
    if (now - v.assignedAt > TIMEOUT_MS) {
      flpAssigned.delete(uid);
      flpUnused.push(v.flp);
    }
  }
}

app.listen(Number(PORT || 10000), () => {
  console.log("VSH FULL PRODUCTION SYSTEM RUNNING");
});
