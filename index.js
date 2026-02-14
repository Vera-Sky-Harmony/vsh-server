import express from "express";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@line/bot-sdk";

/* =========================
   基本設定
========================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function must(v, name) {
  if (!v) {
    console.error(`Missing ENV: ${name}`);
    process.exit(1);
  }
}

must(CHANNEL_ACCESS_TOKEN, "CHANNEL_ACCESS_TOKEN");
must(CHANNEL_SECRET, "CHANNEL_SECRET");
must(INTRODUCER_NAME, "INTRODUCER_NAME");
must(INTRODUCER_FLP, "INTRODUCER_FLP");
must(ADMIN_NOTIFY_USER_ID, "ADMIN_NOTIFY_USER_ID");
must(ADMIN_TOKEN, "ADMIN_TOKEN");
must(DAY7_1_IMAGE_URL, "DAY7_1_IMAGE_URL");
must(DAY7_2_IMAGE_URL, "DAY7_2_IMAGE_URL");

const TIMEOUT_DAYS = Number(ASSIGNED_FLP_TIMEOUT_DAYS || "10");
const TIMEOUT_MS = TIMEOUT_DAYS * 24 * 60 * 60 * 1000;

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* =========================
   静的ページ配信（Day0～Day6）
========================= */

app.use("/pages", express.static(path.join(__dirname, "pages")));

/* =========================
   データ管理（暫定メモリ）
========================= */

let flpUnused = [];
let flpAssigned = new Map();
let flpConsumed = new Map();
const threePointsState = new Map();

/* =========================
   Health
========================= */

app.get("/", (_req, res) => {
  res.send("VSH Server Running");
});

/* =========================
   VSH Admin
========================= */

app.get("/admin", (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) {
    return res.status(403).send("Forbidden");
  }

  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(`
    <h2>VSH Admin</h2>
    <p>unused: ${flpUnused.length}</p>
    <p>assigned: ${flpAssigned.size}</p>
    <p>consumed: ${flpConsumed.size}</p>
  `);
});

/* =========================
   Webhook
========================= */

app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    if (!verifySignature(req)) {
      return res.status(401).send("Bad signature");
    }

    const body = JSON.parse(req.body.toString("utf8"));
    await handleEvents(body.events || []);
    res.status(200).send("OK");
  } catch (e) {
    console.error("Webhook error:", e);
    res.status(200).send("OK");
  }
});

/* =========================
   イベント処理
========================= */

async function handleEvents(events) {
  cleanupExpiredAssignments();

  for (const ev of events) {
    if (!ev?.source?.userId) continue;
    const userId = ev.source.userId;

    if (ev.type === "message" && ev.message?.type === "text") {
      const text = ev.message.text.trim();

      if (text === "登録希望") {
        await sendDay7(userId);
      }

      if (text === "3点返信開始") {
        threePointsState.set(userId, { step: 1 });
        await push(userId, "① 氏名を入力してください");
      }
    }
  }
}

/* =========================
   Day7 完成版送信
========================= */

async function sendDay7(userId) {

  const assignedFlp = assignFlp(userId);

  // 黄色画像
  await client.pushMessage(userId, {
    type: "image",
    originalContentUrl: DAY7_1_IMAGE_URL,
    previewImageUrl: DAY7_1_IMAGE_URL
  });

  // 青画像
  await client.pushMessage(userId, {
    type: "image",
    originalContentUrl: DAY7_2_IMAGE_URL,
    previewImageUrl: DAY7_2_IMAGE_URL
  });

  // テキスト
  await push(userId,
`あなたが登録するのに必要な3点です。

① 紹介者氏名：${INTRODUCER_NAME}
② 紹介者FLP番号：${INTRODUCER_FLP}
③ あなたのFLP番号：${assignedFlp}

登録後は「3点返信開始」と送信してください。`
  );
}

/* =========================
   FLP割当
========================= */

function assignFlp(userId) {
  if (flpAssigned.has(userId)) {
    return flpAssigned.get(userId).flp;
  }

  if (flpUnused.length === 0) {
    return "未発行";
  }

  const flp = flpUnused.shift();
  flpAssigned.set(userId, { flp, assignedAt: Date.now() });
  return flp;
}

/* =========================
   期限切れ処理
========================= */

function cleanupExpiredAssignments() {
  const now = Date.now();
  for (const [uid, v] of flpAssigned.entries()) {
    if (now - v.assignedAt > TIMEOUT_MS) {
      flpAssigned.delete(uid);
      flpUnused.push(v.flp);
    }
  }
}

/* =========================
   署名検証
========================= */

function verifySignature(req) {
  const signature = req.headers["x-line-signature"];
  if (!signature) return false;

  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(req.body)
    .digest("base64");

  return hash === signature;
}

/* =========================
   共通push
========================= */

async function push(userId, text) {
  await client.pushMessage(userId, {
    type: "text",
    text
  });
}

/* =========================
   起動
========================= */

app.listen(Number(PORT || 10000), () => {
  console.log("VSH Server started");
});
