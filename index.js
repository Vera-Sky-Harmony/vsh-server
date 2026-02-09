import express from "express";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@line/bot-sdk";

/* ===============================
   ESModule 用 __dirname 定義
================================ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ===============================
   環境変数
================================ */
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
    console.error(`Missing ENV: ${name}`);
    process.exit(1);
  }
  return v;
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

/* ===============================
   Express / LINE Client
================================ */
const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* ===============================
   ★ Day0～Day7-2 HTML 配信
================================ */
app.use("/pages", express.static(path.join(__dirname, "pages")));

/* ===============================
   メモリデータ（テスト用）
================================ */
let flpUnused = [];
let flpAssigned = new Map();
let flpConsumed = new Map();
const threePointsState = new Map();

/* ===============================
   Health
================================ */
app.get("/", (_req, res) => {
  res.send("VSH server is running");
});

/* ===============================
   Admin
================================ */
app.get("/admin", (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) {
    return res.status(403).send("Forbidden");
  }

  cleanupExpiredAssignments();

  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`
<h2>VSH Admin</h2>
<p>unused: ${flpUnused.length}</p>
<p>assigned: ${flpAssigned.size}</p>
<p>consumed: ${flpConsumed.size}</p>
<form method="POST" action="/admin/pool?token=${ADMIN_TOKEN}">
<textarea name="pool" rows="10" style="width:100%"></textarea>
<button type="submit">FLP番号追加</button>
</form>
`);
});

app.post("/admin/pool", express.urlencoded({ extended: false }), (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) {
    return res.status(403).send("Forbidden");
  }

  const lines = (req.body.pool || "")
    .split(/\r?\n/)
    .map(v => v.trim())
    .filter(Boolean);

  const exists = new Set([
    ...flpUnused,
    ...Array.from(flpAssigned.values()).map(v => v.flp),
    ...Array.from(flpConsumed.values()).map(v => v.flp),
  ]);

  for (const flp of lines) {
    if (!exists.has(flp)) flpUnused.push(flp);
  }

  res.redirect(`/admin?token=${ADMIN_TOKEN}`);
});

/* ===============================
   Webhook
================================ */
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    if (!verifyLineSignature(req)) {
      return res.status(401).send("Bad signature");
    }
    const body = JSON.parse(req.body.toString("utf8"));
    await handleWebhook(body);
    res.status(200).send("OK");
  } catch (e) {
    console.error(e);
    res.status(200).send("OK");
  }
});

async function handleWebhook(body) {
  cleanupExpiredAssignments();

  for (const ev of body.events || []) {
    const userId = ev?.source?.userId;
    if (!userId) continue;

    if (ev.type === "message" && ev.message.type === "text") {
      const text = ev.message.text.trim();

      if (text === "登録希望") {
        await onRegisterIntent(userId);
      } else if (text === "3点返信開始") {
        await startThreePointsFlow(userId);
      } else {
        await handleThreePointsConversation(userId, text);
      }
    }

    if (ev.type === "message" && ev.message.type === "image") {
      await handleScreenshot(userId, ev.message.id);
    }
  }
}

/* ===============================
   Day7 本体
================================ */
async function onRegisterIntent(userId) {
  const flp = assignFlpToUser(userId);

  await safePush(ADMIN_NOTIFY_USER_ID, [{
    type: "text",
    text: `【登録希望】\nuserId:${userId}\n割当FLP:${flp ?? "なし"}`
  }]);

  if (!flp) {
    await safePush(userId, [{ type: "text", text: "現在受付準備中です。" }]);
    return;
  }

  await safePush(userId, [
    buildDay7BlueFlex(),
    {
      type: "text",
      text:
        `① 紹介者氏名：${INTRODUCER_NAME}\n` +
        `② 紹介者FLP番号：${INTRODUCER_FLP}\n` +
        `③ あなたのFLP番号：${flp}\n\n` +
        "登録後、青いボタンから3点返信してください。"
    },
    {
      type: "text",
      text: `📘 登録手順書\n${ENTRY_GUIDE_URL}`
    }
  ]);
}

function buildDay7BlueFlex() {
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
        aspectRatio: "20:13"
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [{
          type: "button",
          style: "primary",
          action: {
            type: "message",
            label: "3点をLINEで返信する",
            text: "3点返信開始"
          }
        }]
      }
    }
  };
}

/* ===============================
   3点返信
================================ */
async function startThreePointsFlow(userId) {
  threePointsState.set(userId, { step: 1, name: "", flp: "" });
  await safePush(userId, [{ type: "text", text: "① 氏名を入力してください" }]);
}

async function handleThreePointsConversation(userId, text) {
  const st = threePointsState.get(userId);
  if (!st) return;

  if (st.step === 1) {
    st.name = text;
    st.step = 2;
    await safePush(userId, [{ type: "text", text: "② あなたのFLP番号を入力してください" }]);
  } else if (st.step === 2) {
    st.flp = text;
    st.step = 3;
    await safePush(userId, [{ type: "text", text: "③ 購入画面のスクショを送ってください" }]);
  }
}

async function handleScreenshot(userId, messageId) {
  const st = threePointsState.get(userId);
  if (!st || st.step !== 3) return;

  threePointsState.delete(userId);

  await safePush(ADMIN_NOTIFY_USER_ID, [{
    type: "text",
    text:
      `【登録完了】\n氏名:${st.name}\nFLP:${st.flp}\nuserId:${userId}\nimg:${messageId}`
  }]);

  if (flpAssigned.has(userId)) {
    const v = flpAssigned.get(userId);
    flpAssigned.delete(userId);
    flpConsumed.set(userId, v);
  }

  await safePush(userId, [{ type: "text", text: "ありがとうございます。確認後ご案内します。" }]);
}

/* ===============================
   補助
================================ */
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

function verifyLineSignature(req) {
  const sig = req.headers["x-line-signature"];
  const hash = crypto.createHmac("sha256", CHANNEL_SECRET).update(req.body).digest("base64");
  return sig === hash;
}

async function safePush(to, messages) {
  try {
    await client.pushMessage(to, messages);
  } catch (e) {
    console.error(e);
  }
}

/* ===============================
   起動
================================ */
app.listen(Number(PORT || 10000), () => {
  console.log("VSH server running");
});

 
