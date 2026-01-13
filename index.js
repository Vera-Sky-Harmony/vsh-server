/**
 * VSH Server (LINE Webhook + Admin Web + Guide Web)
 * - Day7: "登録希望" => auto send 3 points + show /guide link (登録手順)
 * - assignedFlp pool: admin web manages 30 items; assign in order 1..30
 * - expire: if no completion within 10 days, release assignedFlp back to pool
 * - chaining: after completion, user becomes next introducer (name/flp update by generation)
 *
 * Required ENV:
 *  CHANNEL_ACCESS_TOKEN
 *  CHANNEL_SECRET
 *  BASE_URL            e.g. https://vsh-server.onrender.com
 *
 * Optional ENV:
 *  ADMIN_TOKEN         (admin web access token) e.g. long random string
 *  ROOT_INTRODUCER_NAME  default: 細井信孝
 *  ROOT_INTRODUCER_FLP   default: 203145165
 *  ADMIN_USER_ID       (LINE userId of Hosoi) for alert push (optional)
 *  DATA_PATH           default: ./vsh_db.json
 */

"use strict";

const express = require("express");
const line = require("@line/bot-sdk");
const fs = require("fs");
const path = require("path");

const app = express();

// ===== ENV =====
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;
const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || "";

const ROOT_INTRODUCER_NAME = process.env.ROOT_INTRODUCER_NAME || "細井信孝";
const ROOT_INTRODUCER_FLP = process.env.ROOT_INTRODUCER_FLP || "203145165";

const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, "vsh_db.json");

// ===== LINE client =====
if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error("Missing CHANNEL_ACCESS_TOKEN or CHANNEL_SECRET in env.");
}
const lineConfig = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET,
};
const client = new line.Client(lineConfig);

// ===== Simple JSON DB (no extra deps) =====
const DB_DEFAULT = {
  version: 1,
  // flpPool: [{ flp, status: "unused"|"assigned"|"used", assignedTo, assignedAt, expiresAt }]
  flpPool: [],
  // users: { [userId]: { userId, introducerName, introducerFlp, parentUserId, assignedFlp, assignedAt, stepState, createdAt, updatedAt, lastSeenAt } }
  users: {},
  // guideHtml: editable content served at /guide
  guideHtml: null,
};

let db = null;
let saving = false;

function nowIso() {
  return new Date().toISOString();
}

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function loadDb() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      db = { ...DB_DEFAULT };
      saveDbSync();
      return;
    }
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    db = JSON.parse(raw);
    // migrate defaults
    db.version = db.version || 1;
    db.flpPool = Array.isArray(db.flpPool) ? db.flpPool : [];
    db.users = db.users && typeof db.users === "object" ? db.users : {};
    if (db.guideHtml === undefined) db.guideHtml = null;
  } catch (e) {
    console.error("DB load error:", e);
    db = { ...DB_DEFAULT };
  }
}

function saveDbSync() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2), "utf8");
  } catch (e) {
    console.error("DB save error:", e);
  }
}

async function saveDb() {
  if (saving) return;
  saving = true;
  try {
    await fs.promises.writeFile(DATA_PATH, JSON.stringify(db, null, 2), "utf8");
  } catch (e) {
    console.error("DB save error:", e);
  } finally {
    saving = false;
  }
}

function ensureUser(userId) {
  if (!db.users[userId]) {
    db.users[userId] = {
      userId,
      introducerName: ROOT_INTRODUCER_NAME,
      introducerFlp: ROOT_INTRODUCER_FLP,
      parentUserId: null,
      assignedFlp: null,
      assignedAt: null,
      stepState: "idle", // idle | waiting_3points | completed
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastSeenAt: nowIso(),
    };
  } else {
    db.users[userId].lastSeenAt = nowIso();
    db.users[userId].updatedAt = nowIso();
  }
  return db.users[userId];
}

// ===== Pool logic =====
function normalizeFlp(s) {
  return String(s || "").trim().replace(/[^\d]/g, "");
}

function poolCounts() {
  const unused = db.flpPool.filter((x) => x.status === "unused").length;
  const assigned = db.flpPool.filter((x) => x.status === "assigned").length;
  const used = db.flpPool.filter((x) => x.status === "used").length;
  return { unused, assigned, used, total: db.flpPool.length };
}

function releaseExpiredAssignments() {
  const now = Date.now();
  let changed = false;
  for (const item of db.flpPool) {
    if (item.status === "assigned" && item.expiresAt) {
      const exp = Date.parse(item.expiresAt);
      if (!Number.isNaN(exp) && exp <= now) {
        // release
        item.status = "unused";
        item.assignedTo = null;
        item.assignedAt = null;
        item.expiresAt = null;
        changed = true;
      }
    }
  }
  if (changed) saveDbSync();
  return changed;
}

function getAssignedItemForUser(userId) {
  return db.flpPool.find((x) => x.status === "assigned" && x.assignedTo === userId) || null;
}

function assignNextFlpToUser(userId) {
  releaseExpiredAssignments();

  // If already assigned and still valid, reuse it
  const existing = getAssignedItemForUser(userId);
  if (existing) return existing;

  // Assign next unused (in array order)
  const item = db.flpPool.find((x) => x.status === "unused");
  if (!item) return null;

  item.status = "assigned";
  item.assignedTo = userId;
  item.assignedAt = nowIso();
  item.expiresAt = daysFromNow(10); // 10 days to complete

  return item;
}

function markFlpUsedForUser(userId) {
  const item = getAssignedItemForUser(userId);
  if (!item) return null;
  item.status = "used";
  item.expiresAt = null;
  return item;
}

// ===== Alerts =====
async function pushAdminAlert(text) {
  if (!ADMIN_USER_ID) return;
  try {
    await client.pushMessage(ADMIN_USER_ID, { type: "text", text });
  } catch (e) {
    console.error("pushAdminAlert failed:", e);
  }
}

// ===== Guide page content (editable) =====
function defaultGuideHtml() {
  // You can edit this later from /admin (textarea) without touching code.
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>フォーエバービジネスオーナー（FBO）登録手順</title>
  <style>
    body{font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans JP", sans-serif; margin: 16px; line-height: 1.7;}
    h1{font-size: 20px;}
    .box{border:1px solid #ddd; border-radius:12px; padding:12px; margin:12px 0;}
    .small{color:#555; font-size: 13px;}
    ol{padding-left: 18px;}
    a{word-break: break-all;}
  </style>
</head>
<body>
  <h1>フォーエバービジネスオーナー（FBO）登録手順</h1>

  <div class="box">
    <b>1.</b> まずLINEのDay7「登録希望」をタップして、登録に必要な3点を受け取ってください。<br/>
    ①紹介者氏名 / ②紹介者FLP番号 / ③あなたのFLP番号
  </div>

  <div class="box">
    <b>2.</b> FLP公式サイトへ<br/>
    <a href="https://www.flpj.co.jp" target="_blank" rel="noopener">https://www.flpj.co.jp</a>
  </div>

  <div class="box">
    <ol>
      <li>左上メニューをタップ</li>
      <li>「会員登録・ログイン」→「会員登録」をタップ</li>
      <li>FBO説明文の下で「登録セットを購入して登録」へ進む</li>
      <li>同意事項とメールアドレス入力で本人確認メールを送信</li>
      <li>届いたURLを開き、申請情報（氏名・住所・電話・振込先など）を入力</li>
      <li>登録セットを選択し、支払い・配送日時を入力</li>
      <li>「次の画面へ」</li>
    </ol>
    <div class="small">※このページは管理画面からいつでも更新できます。</div>
  </div>
</body>
</html>`;
}

// ===== Web routes =====
app.get("/", (req, res) => {
  res.status(200).send("VSH server is running.");
});

// Guide page
app.get("/guide", (req, res) => {
  const html = db.guideHtml || defaultGuideHtml();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
});

// Admin simple auth
function isAdmin(req) {
  if (!ADMIN_TOKEN) return false;
  const t = req.query.token || req.headers["x-admin-token"];
  return t && String(t) === String(ADMIN_TOKEN);
}

app.get("/admin", (req, res) => {
  if (!isAdmin(req)) {
    res.status(401).send("Unauthorized. Add ?token=ADMIN_TOKEN");
    return;
  }

  releaseExpiredAssignments();
  const counts = poolCounts();
  const rows = db.flpPool
    .map((x, i) => {
      return `<tr>
        <td>${i + 1}</td>
        <td>${x.flp}</td>
        <td>${x.status}</td>
        <td>${x.assignedTo || ""}</td>
        <td>${x.assignedAt || ""}</td>
        <td>${x.expiresAt || ""}</td>
      </tr>`;
    })
    .join("");

  const guideLen = (db.guideHtml || "").length;

  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>VSH Admin</title>
<style>
  body{font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans JP", sans-serif; margin:16px; line-height:1.6;}
  input, textarea{width:100%; padding:10px; border:1px solid #ccc; border-radius:10px;}
  button{padding:10px 14px; border-radius:10px; border:1px solid #666; background:#fff; cursor:pointer;}
  .grid{display:grid; gap:12px;}
  .box{border:1px solid #ddd; border-radius:12px; padding:12px;}
  table{width:100%; border-collapse:collapse; font-size:12px;}
  th,td{border:1px solid #ddd; padding:6px; text-align:left; vertical-align:top;}
  .small{color:#555; font-size:12px;}
</style>
</head>
<body>
  <h2>VSH Admin</h2>
  <div class="box">
    <b>Pool status</b><br/>
    total=${counts.total} / unused=${counts.unused} / assigned=${counts.assigned} / used=${counts.used}<br/>
    <span class="small">Day0〜Day7配信条件：unused が30件以上あること（運用ルール）。</span>
  </div>

  <div class="grid">
    <div class="box">
      <h3>assignedFlp を追加（複数OK）</h3>
      <div class="small">数字のみ。改行 or カンマ区切りで入力できます。重複は自動で弾きます。</div>
      <form method="POST" action="/admin/pool/add?token=${encodeURIComponent(req.query.token)}">
        <textarea name="flps" rows="6" placeholder="例: 123456789&#10;987654321"></textarea><br/><br/>
        <button type="submit">追加する</button>
      </form>
    </div>

    <div class="box">
      <h3>Pool を全削除（注意）</h3>
      <form method="POST" action="/admin/pool/clear?token=${encodeURIComponent(req.query.token)}" onsubmit="return confirm('本当に全削除しますか？');">
        <button type="submit">全削除</button>
      </form>
    </div>

    <div class="box">
      <h3>登録手順ページ（/guide）を編集</h3>
      <div class="small">現在のHTML文字数: ${guideLen}</div>
      <form method="POST" action="/admin/guide/save?token=${encodeURIComponent(req.query.token)}">
        <textarea name="html" rows="12" placeholder="ここにHTMLを貼り付けて保存">${db.guideHtml || ""}</textarea><br/><br/>
        <button type="submit">保存</button>
      </form>
      <div class="small">保存後は <a href="/guide" target="_blank">/guide</a> を開いて確認してください。</div>
    </div>

    <div class="box">
      <h3>Pool一覧</h3>
      <table>
        <thead>
          <tr><th>#</th><th>FLP</th><th>status</th><th>assignedTo</th><th>assignedAt</th><th>expiresAt</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>
</body></html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
});

app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.post("/admin/pool/add", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).send("Unauthorized");

  const raw = String(req.body.flps || "");
  const parts = raw.split(/[\s,]+/).map(normalizeFlp).filter(Boolean);

  const existingSet = new Set(db.flpPool.map((x) => x.flp));
  let added = 0;

  for (const p of parts) {
    if (existingSet.has(p)) continue;
    db.flpPool.push({
      flp: p,
      status: "unused",
      assignedTo: null,
      assignedAt: null,
      expiresAt: null,
    });
    existingSet.add(p);
    added++;
  }

  await saveDb();
  res.redirect(`/admin?token=${encodeURIComponent(req.query.token)}#pool`);
});

app.post("/admin/pool/clear", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).send("Unauthorized");
  db.flpPool = [];
  await saveDb();
  res.redirect(`/admin?token=${encodeURIComponent(req.query.token)}`);
});

app.post("/admin/guide/save", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).send("Unauthorized");
  db.guideHtml = String(req.body.html || "");
  await saveDb();
  res.redirect(`/admin?token=${encodeURIComponent(req.query.token)}#guide`);
});

// ===== LINE webhook =====
app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch (e) {
    console.error("Webhook error:", e);
    res.status(500).end();
  }
});

// ===== Message helpers =====
function guideUrl() {
  if (!BASE_URL) return "/guide";
  return `${BASE_URL}/guide`;
}

function flexGuideMessage() {
  const url = guideUrl();
  return {
    type: "flex",
    altText: "登録手順",
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "フォーエバービジネスオーナー（FBO）登録手順", wrap: true, weight: "bold", size: "md" },
          { type: "text", text: "下のボタンから登録手順ページを開いてください。", wrap: true, size: "sm", color: "#555555" },
          {
            type: "button",
            style: "primary",
            action: { type: "uri", label: "登録手順を開く", uri: url },
          },
          { type: "text", text: url, wrap: true, size: "xs", color: "#888888" },
        ],
      },
    },
  };
}

function buildRegisterNeed3PointsText(introducerName, introducerFlp, assignedFlp) {
  return [
    "あなたが登録するのに必要な3点をお送りします。",
    `① 紹介者の氏名：${introducerName}`,
    `② 紹介者FLP番号：${introducerFlp}`,
    `③ あなたのFLP番号：${assignedFlp}`,
    "",
    "下段に表示された「登録手順」を参考に登録してください。",
    "登録が終わりましたら、青い画像の「3点をLINEで返信する」をタップして登録状況を送信してください。",
  ].join("\n");
}

// ===== Main handler =====
async function handleEvent(event) {
  // Follow/unfollow
  if (event.type === "follow") {
    const userId = event.source.userId;
    ensureUser(userId);
    await saveDb();
    return;
  }
  if (event.type !== "message" || event.message.type !== "text") return;

  const userId = event.source.userId;
  const user = ensureUser(userId);

  const raw = String(event.message.text || "").trim();
  const text = raw.replace(/\s+/g, "");

  console.log(`[INCOMING] userId=${userId} raw="${raw}" normalized="${text}" state=${user.stepState}`);

  // Always release expired before processing
  releaseExpiredAssignments();

  // ===== Day7: 登録希望 =====
  if (text === "登録希望") {
    // assignedFlp must exist in pool (unused or already assigned)
    const assignedItem = assignNextFlpToUser(userId);

    const introducerName = user.introducerName || ROOT_INTRODUCER_NAME;
    const introducerFlp = user.introducerFlp || ROOT_INTRODUCER_FLP;

    if (!introducerName || !introducerFlp || !assignedItem || !assignedItem.flp) {
      // Alert admin
      const msg = [
        "【VSHアラート】Day7「登録希望」の3点が揃いません。",
        `userId: ${userId}`,
        `introducerName: ${introducerName || "(missing)"}`,
        `introducerFlp: ${introducerFlp || "(missing)"}`,
        `assignedFlp: ${assignedItem && assignedItem.flp ? assignedItem.flp : "(missing/pool empty)"}`,
        "→ 管理WEBで assignedFlp を30件入力してください。",
      ].join("\n");

      await pushAdminAlert(msg);

      // Reply to user
      const replyText =
        "新規登録者のFLP番号（assignedFlp）が準備できていません。\n" +
        "紹介者にご連絡ください。\n" +
        "（紹介者は管理WEBで30件の新規登録者用FLP番号を入力後、再度「登録希望」を押してください）";

      await client.replyMessage(event.replyToken, [{ type: "text", text: replyText }]);
      await saveDb();
      return;
    }

    // Set state
    user.assignedFlp = assignedItem.flp;
    user.assignedAt = assignedItem.assignedAt;
    user.stepState = "waiting_3points";
    user.updatedAt = nowIso();

    const textMsg = buildRegisterNeed3PointsText(introducerName, introducerFlp, assignedItem.flp);

    // Reply: text + guide flex
    await client.replyMessage(event.replyToken, [
      { type: "text", text: textMsg },
      flexGuideMessage(),
    ]);

    await saveDb();
    return;
  }

  // ===== Existing flow: "3点をLINEで返信する" -> instruct =====
  if (text === "3点をLINEで返信する") {
    const msg =
      "案内に従ってください。\n" +
      "「登録」と送ると開始します。";
    await client.replyMessage(event.replyToken, [{ type: "text", text: msg }]);
    return;
  }

  // ===== 3 points reply flow (simplified) =====
  // When user sends "登録" we start collecting (name, flp, screenshot).
  if (text === "登録") {
    user.stepState = "collect_name";
    user.updatedAt = nowIso();
    await saveDb();
    await client.replyMessage(event.replyToken, [{ type: "text", text: "【登録受付を開始します】\n① 氏名 を入力してください" }]);
    return;
  }

  if (user.stepState === "collect_name") {
    user.applicantName = raw;
    user.stepState = "collect_userflp";
    user.updatedAt = nowIso();
    await saveDb();
    await client.replyMessage(event.replyToken, [{ type: "text", text: "ありがとうございます。\n② FLP番号 を入力してください" }]);
    return;
  }

  if (user.stepState === "collect_userflp") {
    user.applicantFlp = normalizeFlp(raw);
    user.stepState = "collect_screenshot";
    user.updatedAt = nowIso();
    await saveDb();
    await client.replyMessage(event.replyToken, [{ type: "text", text: "③ 最後に【購入画面のスクリーンショット】を画像で送ってください。" }]);
    return;
  }

  // NOTE: screenshot is image message -> handle below (not text)
  // For now, fallback:
  await client.replyMessage(event.replyToken, [{ type: "text", text: "現在、受付準備中です。紹介者へご連絡ください。" }]);
}

// ===== Image message handler for screenshot =====
// (We register a second webhook to catch non-text messages)
app.post("/webhook2", line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent2));
    res.status(200).end();
  } catch (e) {
    console.error("Webhook2 error:", e);
    res.status(500).end();
  }
});

async function handleEvent2(event) {
  if (event.type !== "message") return;
  const userId = event.source.userId;
  const user = ensureUser(userId);

  // If waiting screenshot and got image
  if (event.message.type === "image" && user.stepState === "collect_screenshot") {
    // We do not download the file here (can be added later)
    user.screenshotMessageId = event.message.id;
    user.stepState = "completed";
    user.updatedAt = nowIso();

    // Mark assignedFlp used
    const usedItem = markFlpUsedForUser(userId);

    // CHAINING:
    // After completion, this user becomes introducer for next generation.
    // We set introducerName/Flp to applicant values.
    if (user.applicantName) user.introducerName = user.applicantName;
    if (user.applicantFlp) user.introducerFlp = user.applicantFlp;

    await saveDb();

    await client.replyMessage(event.replyToken, [
      { type: "text", text: "画像を受け取りました。ありがとうございます。\n【登録情報を確認中です】" },
    ]);

    // Optional: notify admin
    if (ADMIN_USER_ID) {
      const msg = [
        "【VSH通知】3点返信が届きました。",
        `userId: ${userId}`,
        `氏名: ${user.applicantName || ""}`,
        `FLP: ${user.applicantFlp || ""}`,
        `assignedFlp: ${usedItem ? usedItem.flp : user.assignedFlp || ""}`,
      ].join("\n");
      await pushAdminAlert(msg);
    }
  }
}

// ===== Start =====
loadDb();

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`VSH server listening on ${PORT}`);
  if (BASE_URL) console.log(`BASE_URL=${BASE_URL}`);
  console.log(`Guide URL: ${BASE_URL ? BASE_URL + "/guide" : "/guide"}`);
  console.log(`Webhook URL: ${BASE_URL ? BASE_URL + "/webhook" : "/webhook"}`);
});
