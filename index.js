// index.js  (ESM / "type":"module" 対応)
// =====================================
// 環境変数（Renderの Environment）
// - CHANNEL_ACCESS_TOKEN
// - CHANNEL_SECRET
// - ADMIN_TOKEN
// - ADMIN_USER_ID（任意: 管理者へ通知したい場合）
// - BASE_URL（任意）例: https://vsh-server.onrender.com
// =====================================

import express from "express";
import { Client, middleware } from "@line/bot-sdk";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

// ---- 基本設定
const PORT = process.env.PORT || 10000;

const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN || "";
const CHANNEL_SECRET = process.env.CHANNEL_SECRET || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || ""; // 任意
const BASE_URL = process.env.BASE_URL || "";

// ---- LINEクライアント
const lineConfig = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET,
};

const lineClient = new Client(lineConfig);

// ---- データ保存（簡易JSON / WEB_CONCURRENCY=1想定）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function nowMs() {
  return Date.now();
}

function safeReadStore() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    return {
      pool: [], // [{ flp, status: "unused"|"assigned"|"consumed", assignedTo, assignedAt, consumedAt }]
      users: {}, // userId -> { assignedFlp, assignedAt, consumedAt, lastActionAt }
      meta: { updatedAt: nowMs() },
    };
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const data = JSON.parse(raw);
    // 最低限の整形
    data.pool = Array.isArray(data.pool) ? data.pool : [];
    data.users = data.users && typeof data.users === "object" ? data.users : {};
    data.meta = data.meta && typeof data.meta === "object" ? data.meta : {};
    return data;
  } catch (e) {
    // 壊れていても新規
    return {
      pool: [],
      users: {},
      meta: { updatedAt: nowMs(), corruptedRecoveredAt: nowMs() },
    };
  }
}

function safeWriteStore(store) {
  ensureDataDir();
  store.meta = store.meta || {};
  store.meta.updatedAt = nowMs();

  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
  fs.renameSync(tmp, DATA_FILE);
}

function normalizeFlpLines(text) {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/[^\d]/g, "")) // 数字以外除去
    .filter((s) => s.length >= 6); // 最低6桁
}

function uniq(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

// ---- 10日経過 assigned を unused に戻す
const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

function recycleExpiredAssigned(store) {
  const t = nowMs();
  for (const item of store.pool) {
    if (item.status === "assigned" && item.assignedAt && t - item.assignedAt > TEN_DAYS_MS) {
      // userの紐付けも解除
      const uid = item.assignedTo;
      item.status = "unused";
      item.assignedTo = null;
      item.assignedAt = null;

      if (uid && store.users[uid] && store.users[uid].assignedFlp === item.flp) {
        // consumedじゃなければ解除
        if (!store.users[uid].consumedAt) {
          delete store.users[uid].assignedFlp;
          delete store.users[uid].assignedAt;
        }
      }
    }
  }
}

// ---- カウンター
function getCounters(store) {
  let unused = 0,
    assigned = 0,
    consumed = 0;
  for (const p of store.pool) {
    if (p.status === "unused") unused++;
    else if (p.status === "assigned") assigned++;
    else if (p.status === "consumed") consumed++;
  }
  return { unused, assigned, consumed };
}

// ---- 割り当て（登録希望）
function assignNextFlpToUser(store, userId) {
  recycleExpiredAssigned(store);

  // 既に割り当て済みならそれを返す（同じ番号を再送）
  const u = store.users[userId];
  if (u && u.assignedFlp && !u.consumedAt) {
    return { ok: true, flp: u.assignedFlp, already: true };
  }

  // 先頭unusedを取る（1→30）
  const next = store.pool.find((x) => x.status === "unused");
  if (!next) return { ok: false, reason: "NO_UNUSED" };

  next.status = "assigned";
  next.assignedTo = userId;
  next.assignedAt = nowMs();

  store.users[userId] = store.users[userId] || {};
  store.users[userId].assignedFlp = next.flp;
  store.users[userId].assignedAt = next.assignedAt;
  store.users[userId].lastActionAt = nowMs();

  return { ok: true, flp: next.flp, already: false };
}

// ---- consumed（3点返信を受けた扱い）
function markConsumed(store, userId) {
  const u = store.users[userId];
  if (!u || !u.assignedFlp) return { ok: false, reason: "NO_ASSIGNED" };
  if (u.consumedAt) return { ok: true, already: true, flp: u.assignedFlp };

  // pool側も更新
  const item = store.pool.find((x) => x.flp === u.assignedFlp);
  if (item) {
    item.status = "consumed";
    item.consumedAt = nowMs();
  }
  u.consumedAt = nowMs();
  u.lastActionAt = nowMs();

  return { ok: true, already: false, flp: u.assignedFlp };
}

// ---- メッセージ判定（3点返信っぽいか）
function looksLike3PointReply(event) {
  // 画像なら「3点返信が来た」とみなす（テスト優先で簡易）
  if (event.message?.type === "image") return true;

  // テキストなら「FLP」or「番号」+ 6桁以上の数字があるなら3点っぽい
  if (event.message?.type === "text") {
    const text = (event.message.text || "").trim();
    const hasDigits = /\d{6,}/.test(text);
    const hasKeyword = /FLP|番号|会員|会員番号|ID/i.test(text);
    const hasName = /氏名|名前|名前/.test(text);
    // 厳密でなく「っぽい」判定
    return (hasDigits && hasKeyword) || (hasDigits && hasName);
  }
  return false;
}

// ---- LINE返信テンプレ
function buildAssignedMessage(flp) {
  return [
    {
      type: "text",
      text:
        "【登録受付を開始します】\n" +
        "以下の内容で登録を進めてください。\n\n" +
        "① 紹介者氏名：細井信孝\n" +
        "② 紹介者FLP番号：203145165\n" +
        `③ あなたのFLP番号：${flp}\n\n` +
        "登録完了後、Day7のボタン「3点をLINEで返信する」から\n" +
        "①氏名 ②FLP番号 ③購入画面スクリーンショット を送ってください。",
    },
  ];
}

function buildAsk3PointsMessage() {
  return [
    {
      type: "text",
      text:
        "【3点を送ってください】\n" +
        "① 氏名\n" +
        "② FLP番号\n" +
        "③ 購入画面のスクリーンショット（画像）\n\n" +
        "この順で送ってください。",
    },
  ];
}

function buildPreparingMessage() {
  return [
    {
      type: "text",
      text: "現在、受付準備中です。紹介者へご連絡ください。",
    },
  ];
}

// ---- Express
const app = express();

// Render / LINE middleware は raw body を使うため、/webhook は middleware に任せる
app.get("/", (req, res) => {
  res.status(200).send("VSH server running.");
});

// 管理画面
app.get("/admin", (req, res) => {
  const token = req.query.token || "";
  if (!ADMIN_TOKEN) return res.status(500).send("ADMIN_TOKEN not set");
  if (token !== ADMIN_TOKEN) return res.status(401).send("Unauthorized");

  const store = safeReadStore();
  recycleExpiredAssigned(store);
  safeWriteStore(store);

  const { unused, assigned, consumed } = getCounters(store);

  const listText = store.pool.map((x) => x.flp).join("\n");

  // 状態一覧（最大30）
  const statusLines = store.pool.slice(0, 30).map((x, i) => {
    const idx = String(i + 1).padStart(2, "0");
    const st = x.status || "unused";
    const to = x.assignedTo ? `to:${x.assignedTo}` : "to:-";
    const at = x.assignedAt ? `at:${new Date(x.assignedAt).toLocaleString("ja-JP")}` : "at:-";
    return `${idx}. ${x.flp} [${st}] ${to} ${at}`;
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>VSH Admin</title>
  <style>
    body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans JP",sans-serif;background:#fff;margin:0;padding:24px;}
    .card{max-width:920px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,.04);}
    h1{margin:0 0 16px;font-size:42px;letter-spacing:.5px}
    .pill{display:inline-block;padding:10px 16px;border-radius:999px;border:1px solid #e5e7eb;background:#f9fafb;margin-right:10px;font-size:18px}
    .muted{color:#6b7280}
    textarea{width:100%;min-height:280px;border:1px solid #e5e7eb;border-radius:10px;padding:14px;font-size:16px;line-height:1.4}
    button{display:inline-block;margin-top:12px;background:#111827;color:#fff;border:none;border-radius:10px;padding:10px 14px;font-size:16px;cursor:pointer}
    pre{background:#0b1020;color:#e5e7eb;border-radius:10px;padding:12px;overflow:auto}
    .row{margin-top:14px}
  </style>
</head>
<body>
  <div class="card">
    <h1>VSH Admin</h1>
    <div>
      <span class="pill">unused: <b>${unused}</b></span>
      <span class="pill">assigned: <b>${assigned}</b></span>
      <span class="pill">consumed: <b>${consumed}</b></span>
    </div>

    <div class="row muted">
      assignedFlp を改行区切りで貼り付け → 保存（上から30件のみ有効）
    </div>

    <div class="row">
      <textarea id="flp">${escapeHtml(listText || "")}</textarea>
      <button onclick="save()">保存する</button>
      <span id="msg" class="muted" style="margin-left:10px;"></span>
    </div>

    <div class="row">
      <div class="muted">状態一覧（先頭30件）</div>
      <pre>${escapeHtml(statusLines.join("\n"))}</pre>
    </div>

    <div class="row muted">
      URL: ${escapeHtml(BASE_URL ? `${BASE_URL}/admin?token=...` : "(BASE_URL未設定)")}
    </div>
  </div>

<script>
async function save(){
  const token = new URLSearchParams(location.search).get("token");
  const flp = document.getElementById("flp").value || "";
  const msg = document.getElementById("msg");
  msg.textContent = "保存中...";
  const r = await fetch("/admin/assignedFlp?token="+encodeURIComponent(token),{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ text: flp })
  });
  const j = await r.json().catch(()=>({ok:false}));
  if(j.ok){
    msg.textContent = "保存しました。再読み込みします...";
    setTimeout(()=>location.reload(),600);
  }else{
    msg.textContent = "保存失敗: " + (j.error || r.status);
  }
}
</script>
</body>
</html>
  `);
});

app.use(express.json({ limit: "2mb" })); // admin post用

app.post("/admin/assignedFlp", (req, res) => {
  const token = req.query.token || "";
  if (!ADMIN_TOKEN) return res.status(500).json({ ok: false, error: "ADMIN_TOKEN not set" });
  if (token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const text = (req.body?.text || "").toString();
  const lines = normalizeFlpLines(text);
  const flps = uniq(lines).slice(0, 30);

  const store = safeReadStore();

  // 仕様：貼り付け保存したら、プールを作り直して全て unused にする（テスト優先）
  store.pool = flps.map((flp) => ({
    flp,
    status: "unused",
    assignedTo: null,
    assignedAt: null,
    consumedAt: null,
  }));

  // users は残すが、割当済みは一旦解除（プール再生成なので整合性優先）
  for (const uid of Object.keys(store.users)) {
    delete store.users[uid].assignedFlp;
    delete store.users[uid].assignedAt;
    delete store.users[uid].consumedAt;
  }

  safeWriteStore(store);
  res.json({ ok: true, count: store.pool.length });
});

// ---- LINE webhook
// middleware が署名検証 + rawbody を面倒見ます
app.post("/webhook", middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body?.events || [];
    const store = safeReadStore();

    for (const event of events) {
      if (event.type !== "message") continue;
      const userId = event.source?.userId;
      if (!userId) continue;

      // 期限切れ回収
      recycleExpiredAssigned(store);

      // ユーザーが押した文字（リッチメニューのテキスト送信）
      if (event.message.type === "text") {
        const text = (event.message.text || "").trim();

        // 1) 登録希望 → ここで割当（仕様確定）
        if (text === "登録希望") {
          if (!store.pool.length) {
            // プールが空なら受付準備中
            await replySafe(event.replyToken, buildPreparingMessage());
            continue;
          }

          const r = assignNextFlpToUser(store, userId);
          safeWriteStore(store);

          if (!r.ok) {
            await replySafe(event.replyToken, buildPreparingMessage());
            continue;
          }

          await replySafe(event.replyToken, buildAssignedMessage(r.flp));

          // 管理者へ通知（任意）
          if (ADMIN_USER_ID) {
            await pushSafe(ADMIN_USER_ID, [
              {
                type: "text",
                text: `【登録希望】userId=${userId}\n割当FLP=${r.flp}\n(assigned ${r.already ? "再送" : "新規"})`,
              },
            ]);
          }
          continue;
        }

        // 2) 3点をLINEで返信する → 返信の案内
        if (text === "3点をLINEで返信する") {
          await replySafe(event.replyToken, buildAsk3PointsMessage());
          continue;
        }

        // 3) 3点返信とみなせる入力 → consumed
        if (looksLike3PointReply(event)) {
          const m = markConsumed(store, userId);
          safeWriteStore(store);

          if (m.ok && !m.already) {
            await replySafe(event.replyToken, [
              { type: "text", text: "受け取りました。ありがとうございます。" },
              { type: "text", text: `（受付処理中）あなたのFLP番号: ${m.flp}` },
            ]);

            if (ADMIN_USER_ID) {
              await pushSafe(ADMIN_USER_ID, [
                {
                  type: "text",
                  text:
                    `【3点返信受領 → consumed】\nuserId=${userId}\nFLP=${m.flp}\n` +
                    `内容: ${text.slice(0, 100)}`,
                },
              ]);
            }
          } else {
            // 既にconsumed等
            await replySafe(event.replyToken, [{ type: "text", text: "受領済みです。ありがとうございます。" }]);
          }
          continue;
        }

        // その他の通常テキスト：何もしない（誤爆防止）
        store.users[userId] = store.users[userId] || {};
        store.users[userId].lastActionAt = nowMs();
        safeWriteStore(store);
        continue;
      }

      // 画像など → 3点返信扱いで consumed
      if (event.message.type === "image") {
        const m = markConsumed(store, userId);
        safeWriteStore(store);

        if (m.ok && !m.already) {
          await replySafe(event.replyToken, [
            { type: "text", text: "画像を受け取りました。ありがとうございます。" },
            { type: "text", text: `（受付処理中）あなたのFLP番号: ${m.flp}` },
          ]);

          if (ADMIN_USER_ID) {
            await pushSafe(ADMIN_USER_ID, [
              { type: "text", text: `【画像受領 → consumed】\nuserId=${userId}\nFLP=${m.flp}` },
            ]);
          }
        } else {
          await replySafe(event.replyToken, [{ type: "text", text: "画像は受領済みです。ありがとうございます。" }]);
        }
        continue;
      }
    }

    res.status(200).end();
  } catch (err) {
    console.error("webhook error:", err);
    res.status(200).end(); // LINEには200返す
  }
});

// ---- 返信/通知の安全ラッパー
async function replySafe(replyToken, messages) {
  try {
    if (!replyToken) return;
    await lineClient.replyMessage(replyToken, messages);
  } catch (e) {
    console.error("replySafe error:", e?.message || e);
  }
}
async function pushSafe(to, messages) {
  try {
    if (!to) return;
    await lineClient.pushMessage(to, messages);
  } catch (e) {
    console.error("pushSafe error:", e?.message || e);
  }
}

// ---- HTML escape
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

app.listen(PORT, () => {
  const store = safeReadStore();
  const c = getCounters(store);
  console.log("======================================");
  console.log(`VSH server listening on :${PORT}`);
  console.log(`ADMIN_TOKEN=${ADMIN_TOKEN ? "set" : "missing"}`);
  console.log(`BASE_URL=${BASE_URL || "(not set)"}`);
  console.log(`pool: unused=${c.unused} assigned=${c.assigned} consumed=${c.consumed}`);
  console.log("======================================");
});
