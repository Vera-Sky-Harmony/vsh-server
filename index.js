/**
 * VSH server - index.js (FULL REPLACE)
 * 目的：
 *  - LINE Webhook を確実に受信してログに出す
 *  - 「登録希望」→ unused から1つ割当(assigned) → 登録者へ自動返信（3点＋手順URL）
 *  - 「3点をLINEで返信する」→ 登録者から「氏名→FLP番号→画像」を順に受けるガイド
 *  - 受信した3点を ADMIN_USER_ID へ push 通知（紹介者確認用）
 *  - /admin でプール状態を確認・更新（スクショのUIに寄せた簡易管理画面）
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client, middleware } = require("@line/bot-sdk");

const app = express();

// =====================
// 必須環境変数（RenderのEnvironmentに設定）
// =====================
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const BASE_URL = process.env.BASE_URL || ""; // 例：https://vsh-server.onrender.com
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change_me"; // /admin?token=...
const INTRODUCER_NAME = process.env.INTRODUCER_NAME || "紹介者";
const INTRODUCER_FLP = process.env.INTRODUCER_FLP || "000000000";
const FBO_GUIDE_URL = process.env.FBO_GUIDE_URL || "https://example.com";
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || ""; // 例：Uxxxxxxxx（紹介者に通知したいLINEユーザーID）

if (!config.channelAccessToken || !config.channelSecret) {
  console.error("ENV missing: CHANNEL_ACCESS_TOKEN / CHANNEL_SECRET");
}

const client = new Client(config);

// =====================
// データ保存（簡易）
// Renderで永続化が必要なら Persistent Disk を有効にして DATA_DIR を設定推奨
// =====================
const DATA_DIR = process.env.DATA_DIR || process.cwd();
const DATA_FILE = path.join(DATA_DIR, "vsh-data.json");

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {
        pool: {
          unused: [],
          assigned: {}, // userId -> flp
          consumed: {}, // userId -> flp
        },
        applicants: {}, // userId -> { step, name, flp, imageMessageId, assignedFlp, updatedAt }
      };
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch (e) {
    console.error("loadData error:", e);
    return {
      pool: { unused: [], assigned: {}, consumed: {} },
      applicants: {},
    };
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("saveData error:", e);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function pickFromUnused(data) {
  // unused から先頭を1つ取り出す（スクショ仕様に合わせる）
  const flp = data.pool.unused.shift();
  return flp || null;
}

function maskToken(token) {
  if (!token) return "";
  if (token.length <= 6) return "***";
  return token.slice(0, 3) + "***" + token.slice(-3);
}

// =====================
// ルート
// =====================
app.get("/", (req, res) => {
  res.status(200).send("VSH server is running");
});

// 管理画面（スクショに寄せた簡易版）
app.get("/admin", (req, res) => {
  const token = req.query.token || "";
  if (token !== ADMIN_TOKEN) return res.status(401).send("Unauthorized");

  const data = loadData();

  const unusedCount = data.pool.unused.length;
  const assignedCount = Object.keys(data.pool.assigned).length;
  const consumedCount = Object.keys(data.pool.consumed).length;

  const unusedPreview = data.pool.unused.slice(0, 50).join("\n");

  const html = `
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>VSH Admin</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    .pill { display:inline-block; padding: 8px 12px; border:1px solid #ddd; border-radius: 20px; margin-right: 10px; }
    textarea { width: 520px; height: 420px; font-family: monospace; }
    .note { color:#666; margin: 10px 0; }
    button { padding: 8px 14px; }
    .row { margin: 16px 0; }
  </style>
</head>
<body>
  <h1>VSH Admin</h1>
  <div class="row">
    <span class="pill">unused: <b>${unusedCount}</b></span>
    <span class="pill">assigned: <b>${assignedCount}</b></span>
    <span class="pill">consumed: <b>${consumedCount}</b></span>
  </div>

  <div class="note">unused を改行区切りで貼り付け → 保存（上から30件のみ有効）</div>

  <form method="POST" action="/admin/pool?token=${encodeURIComponent(token)}">
    <textarea name="unused">${unusedPreview}</textarea>
    <div class="row">
      <button type="submit">保存</button>
    </div>
  </form>

  <hr />
  <h3>割当済み（assigned）</h3>
  <pre>${Object.entries(data.pool.assigned)
    .slice(0, 50)
    .map(([uid, flp]) => `${uid} -> ${flp}`)
    .join("\n")}</pre>

  <hr />
  <h3>受信済み3点（applicants）</h3>
  <pre>${Object.entries(data.applicants)
    .slice(0, 50)
    .map(([uid, a]) => `${uid} | step=${a.step} | name=${a.name || ""} | flp=${a.flp || ""} | assigned=${a.assignedFlp || ""} | updated=${a.updatedAt || ""}`)
    .join("\n")}</pre>
</body>
</html>
  `;
  res.status(200).send(html);
});

// admin: プール更新
app.post("/admin/pool", express.urlencoded({ extended: true }), (req, res) => {
  const token = req.query.token || "";
  if (token !== ADMIN_TOKEN) return res.status(401).send("Unauthorized");

  const raw = (req.body.unused || "").toString();
  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // 先頭30件だけ採用（あなたの画面の注意書き仕様）
  const top30 = lines.slice(0, 30);

  const data = loadData();
  data.pool.unused = top30;
  saveData(data);

  res.redirect(`/admin?token=${encodeURIComponent(token)}`);
});

// =====================
// LINE Webhook
// =====================
app.post("/callback", middleware(config), async (req, res) => {
  try {
    console.log("=== LINE WEBHOOK RECEIVED ===");
    console.log("events length:", req.body?.events?.length ?? 0);

    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));

    res.status(200).end();
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  try {
    // ログ（重要）
    console.log("event.type:", event.type);

    if (event.type !== "message") return null;
    if (!event.message) return null;

    const userId = event.source && event.source.userId ? event.source.userId : "";
    const data = loadData();

    // ---- テキスト ----
    if (event.message.type === "text") {
      const text = (event.message.text || "").trim();
      console.log("text:", text);

      // ① 登録希望
      if (text === "登録希望") {
        // すでに割当済みなら同じFLPを使う
        let assignedFlp = data.pool.assigned[userId] || null;

        // 未割当なら unused から1つ引いて assigned へ
        if (!assignedFlp) {
          assignedFlp = pickFromUnused(data);
          if (!assignedFlp) {
            // プール枯渇
            await client.replyMessage(event.replyToken, {
              type: "text",
              text: "現在、登録用の番号が不足しています。しばらくしてからもう一度お試しください。",
            });
            return null;
          }
          data.pool.assigned[userId] = assignedFlp;
        }

        // applicants 初期化（3点返信のステップ管理）
        data.applicants[userId] = {
          step: 0,
          name: "",
          flp: "",
          imageMessageId: "",
          assignedFlp,
          updatedAt: nowIso(),
        };

        saveData(data);

        const replyMessages = [
          {
            type: "text",
            text:
              "【登録受付を開始します】\n" +
              "下の3点を確認してください。\n\n" +
              `① 紹介者氏名：${INTRODUCER_NAME}\n` +
              `② 紹介者FLP番号：${INTRODUCER_FLP}\n` +
              `③ あなたのFLP番号：${assignedFlp}\n\n` +
              "※このあと、FBO登録手順を送ります。",
          },
          {
            type: "text",
            text:
              "【FBO登録手順】\n" +
              "以下のページを開いて、手順どおりに登録を進めてください。\n" +
              `${FBO_GUIDE_URL}`,
          },
        ];

        console.log("assignedFlp:", assignedFlp, "unused now:", loadData().pool.unused.length);
        return client.replyMessage(event.replyToken, replyMessages);
      }

      // ② 3点をLINEで返信する
      if (text === "3点をLINEで返信する") {
        if (!data.applicants[userId]) {
          data.applicants[userId] = {
            step: 0,
            name: "",
            flp: "",
            imageMessageId: "",
            assignedFlp: data.pool.assigned[userId] || "",
            updatedAt: nowIso(),
          };
        }
        data.applicants[userId].step = 1; // 次に氏名を待つ
        data.applicants[userId].updatedAt = nowIso();
        saveData(data);

        return client.replyMessage(event.replyToken, {
          type: "text",
          text:
            "ありがとうございます。\n" +
            "まず【① 氏名】をテキストで送ってください。",
        });
      }

      // 3点ステップ処理（氏名 → FLP番号）
      if (data.applicants[userId]) {
        const a = data.applicants[userId];

        // step=1 なら「氏名」
        if (a.step === 1) {
          a.name = text;
          a.step = 2;
          a.updatedAt = nowIso();
          saveData(data);

          return client.replyMessage(event.replyToken, {
            type: "text",
            text: "ありがとうございます。次に【② FLP番号】を送ってください。",
          });
        }

        // step=2 なら「FLP番号」
        if (a.step === 2) {
          a.flp = text;
          a.step = 3; // 次に画像待ち
          a.updatedAt = nowIso();
          saveData(data);

          return client.replyMessage(event.replyToken, {
            type: "text",
            text: "ありがとうございます。最後に【③ 購入画面のスクリーンショット】を画像で送ってください。",
          });
        }
      }

      // それ以外
      return null;
    }

    // ---- 画像（購入スクショ）----
    if (event.message.type === "image") {
      console.log("image received");
      if (!userId) return null;

      if (!data.applicants[userId]) {
        // いきなり画像が来た場合の案内
        return client.replyMessage(event.replyToken, {
          type: "text",
          text:
            "画像を受け取りました。\n" +
            "念のため、先に【氏名】と【FLP番号】をテキストで送ってください。",
        });
      }

      const a = data.applicants[userId];

      // step=3（画像待ち）として扱う
      a.imageMessageId = event.message.id || "";
      a.step = 9; // 完了
      a.updatedAt = nowIso();
      saveData(data);

      // 登録者へ返信
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: "画像を受け取りました。ありがとうございます。\n紹介者が確認し、譲渡手続きへ進みます。",
      });

      // 管理者へ push 通知（紹介者確認用）
      if (ADMIN_USER_ID) {
        const assignedFlp = a.assignedFlp || data.pool.assigned[userId] || "";
        const msg =
          "【VSH 3点受信】\n" +
          `userId: ${userId}\n` +
          `氏名: ${a.name || "(未入力)"}\n` +
          `FLP番号: ${a.flp || "(未入力)"}\n` +
          `購入スクショ messageId: ${a.imageMessageId || "(不明)"}\n` +
          `割当FLP(あなたのFLP番号): ${assignedFlp || "(未割当)"}\n` +
          `受信時刻: ${a.updatedAt}`;

        await client.pushMessage(ADMIN_USER_ID, { type: "text", text: msg });
      } else {
        console.log("ADMIN_USER_ID not set -> skip pushMessage");
      }

      return null;
    }

    return null;
  } catch (err) {
    console.error("handleEvent error:", err);
    return null;
  }
}

// =====================
// 起動
// =====================
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log("======================================");
  console.log("VSH server listening on port", port);
  console.log("BASE_URL:", BASE_URL);
  console.log("ADMIN_TOKEN:", maskToken(ADMIN_TOKEN));
  console.log("FBO_GUIDE_URL:", FBO_GUIDE_URL);
  console.log("INTRODUCER_NAME:", INTRODUCER_NAME);
  console.log("INTRODUCER_FLP:", INTRODUCER_FLP);
  console.log("ADMIN_USER_ID set:", ADMIN_USER_ID ? "YES" : "NO");
  console.log("Admin:", `${BASE_URL}/admin?token=${ADMIN_TOKEN ? maskToken(ADMIN_TOKEN) : ""}`);
  console.log("Webhook:", `${BASE_URL}/callback`);
  console.log("======================================");
});
