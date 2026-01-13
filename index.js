/**
 * VSH Server - Full index.js (Render / LINE Messaging API)
 *
 * Features:
 * - /webhook : LINE webhook
 * - Day7 "登録希望" → assignedFlp を先着順に割当 → 3点（紹介者氏名/紹介者FLP/あなたのFLP番号）を自動送信
 * - "3点をLINEで返信する" / "登録" → 3点返信フロー（氏名→FLP→スクショ）
 * - 10日経過で未完了なら assignedFlp をプールへ返却（再割当可能）
 * - 連鎖あり：返信で確定した本人の「氏名/FLP」を次世代の INTRODUCER として採用
 * - /admin?token=... : assignedFlp 30件を改行入力して登録
 *
 * Required ENV on Render:
 * - CHANNEL_ACCESS_TOKEN
 * - CHANNEL_SECRET
 * - ADMIN_TOKEN
 * - ADMIN_USER_ID           (あなた/紹介者の LINE userId  ※通知を受ける人)
 *
 * Optional ENV:
 * - INTRODUCER_NAME_BASE    default: 細井信孝
 * - INTRODUCER_FLP_BASE     default: 203145165
 */

const express = require('express');
const line = require('@line/bot-sdk');
const fs = require('fs');
const path = require('path');

// -------------------- ENV --------------------
const PORT = process.env.PORT || 10000;

const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN; // ここが無いと admin 開かない
const ADMIN_USER_ID = process.env.ADMIN_USER_ID; // 紹介者にアラート送る先

const INTRODUCER_NAME_BASE = process.env.INTRODUCER_NAME_BASE || '細井信孝';
const INTRODUCER_FLP_BASE = process.env.INTRODUCER_FLP_BASE || '203145165';

const POOL_REQUIRED = 30;
const ASSIGN_EXPIRE_DAYS = 10;

// -------------------- LINE CONFIG --------------------
if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error('[FATAL] CHANNEL_ACCESS_TOKEN / CHANNEL_SECRET is missing.');
}

const config = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET,
};

const client = new line.Client(config);

// -------------------- Simple File DB --------------------
const DB_FILE = path.join(process.cwd(), 'vsh-db.json');

function nowTs() {
  return Date.now();
}

function addDaysTs(days) {
  return nowTs() + days * 24 * 60 * 60 * 1000;
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const init = {
        pool: [],         // [{flp, status:'unused'|'assigned'|'used', assignedTo, assignedAt, expiresAt}]
        users: {},        // userId -> { state, name, flp, screenshotMessageId, parentIntroducerUserId, introducerName, introducerFlp, assignedFlp, assignedAt, expiresAt }
        logs: [],
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2), 'utf-8');
      return init;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('[DB] load error:', e);
    // fallback
    return { pool: [], users: {}, logs: [] };
  }
}

function saveDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (e) {
    console.error('[DB] save error:', e);
  }
}

function logDB(db, msg) {
  db.logs.push({ t: new Date().toISOString(), msg });
  if (db.logs.length > 300) db.logs.shift();
}

// -------------------- Pool Helpers --------------------
function normalizeFlpLines(text) {
  // 改行/スペース区切りを許容 → 数字だけ抽出（空行除外）
  return (text || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/[^\d]/g, ''))
    .filter(Boolean);
}

function setPoolFromLines(db, lines) {
  // 既存を全消しして再構築（管理画面で上書き）
  const unique = [];
  const seen = new Set();
  for (const flp of lines) {
    if (!seen.has(flp)) {
      seen.add(flp);
      unique.push(flp);
    }
  }
  db.pool = unique.map(flp => ({
    flp,
    status: 'unused',
    assignedTo: null,
    assignedAt: null,
    expiresAt: null,
  }));
  logDB(db, `[ADMIN] pool set. count=${db.pool.length}`);
}

function poolCounts(db) {
  const total = db.pool.length;
  const unused = db.pool.filter(x => x.status === 'unused').length;
  const assigned = db.pool.filter(x => x.status === 'assigned').length;
  const used = db.pool.filter(x => x.status === 'used').length;
  return { total, unused, assigned, used };
}

function allocateNextFlp(db, userId) {
  // 先着順：unused の先頭を assigned に
  const item = db.pool.find(x => x.status === 'unused');
  if (!item) return null;

  item.status = 'assigned';
  item.assignedTo = userId;
  item.assignedAt = nowTs();
  item.expiresAt = addDaysTs(ASSIGN_EXPIRE_DAYS);
  return item.flp;
}

function releaseAssignedFlp(db, userId) {
  // userId に割当済みの assigned を unused に戻す
  const item = db.pool.find(x => x.status === 'assigned' && x.assignedTo === userId);
  if (!item) return false;
  item.status = 'unused';
  item.assignedTo = null;
  item.assignedAt = null;
  item.expiresAt = null;
  return true;
}

function markUsedFlp(db, userId) {
  // userId に割当済みの assigned を used に
  const item = db.pool.find(x => x.status === 'assigned' && x.assignedTo === userId);
  if (!item) return false;
  item.status = 'used';
  return true;
}

// -------------------- User Helpers --------------------
function getUser(db, userId) {
  if (!db.users[userId]) {
    db.users[userId] = {
      state: 'idle', // idle | awaiting_name | awaiting_flp | awaiting_screenshot
      name: null,
      flp: null,
      screenshotMessageId: null,

      // 連鎖：このユーザーの「上位紹介者」
      parentIntroducerUserId: ADMIN_USER_ID || null,

      // このユーザーが次世代に渡す紹介者情報（確定後に自分自身の name/flp に更新される）
      introducerName: INTRODUCER_NAME_BASE,
      introducerFlp: INTRODUCER_FLP_BASE,

      // Day7 登録希望で割り当てた assignedFlp（あなたのFLP番号 として渡す）
      assignedFlp: null,
      assignedAt: null,
      expiresAt: null,
    };
  }
  return db.users[userId];
}

function userHasAllThree(user) {
  // ①紹介者氏名（introducerName）
  // ②紹介者FLP（introducerFlp）
  // ③あなたのFLP番号（assignedFlp）
  return Boolean(user.introducerName) && Boolean(user.introducerFlp) && Boolean(user.assignedFlp);
}

// -------------------- Message Builders --------------------
function buildRegisterWishMessage(user) {
  // Day7「登録希望」押下後に新規登録者へ送る文面（要求どおり）
  const text =
`あなたが登録するのに必要な3点をお送りします。

① 紹介者の氏名：${user.introducerName || '（未設定）'}
② 紹介者FLP番号：${user.introducerFlp || '（未設定）'}
③ あなたのFLP番号：${user.assignedFlp || '（未割当）'}

下段に表示された「登録手順」を参考に登録してください。
登録が終わりましたら、青い画像の「3点をLINEで返信する」をタップして登録状況を送信してください。`;
  return { type: 'text', text };
}

function buildNeedPoolMessage(counts) {
  const text =
`現在、受付準備中です。
紹介者へご連絡ください。

（assignedFlp 未使用プールが不足しています：未使用 ${counts.unused} / 必要 ${POOL_REQUIRED}）`;
  return { type: 'text', text };
}

function buildStart3PointsFlow() {
  return { type: 'text', text: '【登録受付を開始します】\n① 氏名 を入力してください' };
}

function buildAskFlp() {
  return { type: 'text', text: 'ありがとうございます。\n② FLP番号 を入力してください（数字のみ）' };
}

function buildAskScreenshot() {
  return { type: 'text', text: '③ 最後に【購入画面のスクリーンショット】を画像で送ってください。' };
}

function buildDoneThanks() {
  return { type: 'text', text: '画像を受け取りました。ありがとうございます。\n【登録情報を受領しました】' };
}

// -------------------- Core Logic --------------------
async function sendToUser(userId, messages) {
  try {
    await client.pushMessage(userId, Array.isArray(messages) ? messages : [messages]);
  } catch (e) {
    console.error('[LINE] pushMessage error:', e && e.message ? e.message : e);
  }
}

async function reply(event, messages) {
  try {
    await client.replyMessage(event.replyToken, Array.isArray(messages) ? messages : [messages]);
  } catch (e) {
    console.error('[LINE] replyMessage error:', e && e.message ? e.message : e);
  }
}

async function alertIntroducerIfMissing(db, user, reason) {
  // ①②③のどれか欠けた場合：紹介者へアラート
  if (!ADMIN_USER_ID) return;
  const missing = [];
  if (!user.introducerName) missing.push('①紹介者氏名');
  if (!user.introducerFlp) missing.push('②紹介者FLP番号');
  if (!user.assignedFlp) missing.push('③あなたのFLP番号(assignedFlp)');
  if (missing.length === 0) return;

  const msg =
`【VSHアラート】3点が未入力/未割当です
理由：${reason || '不明'}
対象ユーザー：${user._userId || '(unknown)'}
不足：${missing.join(' / ')}`;
  await sendToUser(ADMIN_USER_ID, { type: 'text', text: msg });
}

function normalizeText(raw) {
  return (raw || '').trim();
}

async function handleRegisterWish(event, db) {
  const userId = event.source.userId;
  const user = getUser(db, userId);
  user._userId = userId; // for alert message

  // Day0-7 配信条件：未使用プールが30以上（不足なら受付準備中）
  const counts = poolCounts(db);
  if (counts.unused < POOL_REQUIRED) {
    await reply(event, buildNeedPoolMessage(counts));
    saveDB(db);
    return;
  }

  // 既に assignedFlp があるなら再送（連打対策：同じ assignedFlp を提示）
  if (!user.assignedFlp) {
    const flp = allocateNextFlp(db, userId);
    if (!flp) {
      await reply(event, buildNeedPoolMessage(poolCounts(db)));
      saveDB(db);
      return;
    }
    user.assignedFlp = flp;
    user.assignedAt = nowTs();
    user.expiresAt = addDaysTs(ASSIGN_EXPIRE_DAYS);
    logDB(db, `[ALLOC] userId=${userId} assignedFlp=${flp}`);
  }

  // 3点文面を送信
  await reply(event, buildRegisterWishMessage(user));

  // 欠けがあれば紹介者へアラート
  if (!userHasAllThree(user)) {
    await alertIntroducerIfMissing(db, user, '登録希望処理時');
  }

  saveDB(db);
}

async function handleStart3Points(event, db) {
  const userId = event.source.userId;
  const user = getUser(db, userId);

  user.state = 'awaiting_name';
  user.name = null;
  user.flp = null;
  user.screenshotMessageId = null;

  await reply(event, buildStart3PointsFlow());
  saveDB(db);
}

async function handleTextMessage(event, db) {
  const userId = event.source.userId;
  const text = normalizeText(event.message.text);
  const user = getUser(db, userId);
  user._userId = userId;

  // リッチメニュー/ボタンの文言
  if (text === '登録希望') {
    await handleRegisterWish(event, db);
    return;
  }
  if (text === '3点をLINEで返信する' || text === '登録') {
    await handleStart3Points(event, db);
    return;
  }

  // 状態に応じて処理
  if (user.state === 'awaiting_name') {
    user.name = text;
    user.state = 'awaiting_flp';
    await reply(event, buildAskFlp());
    saveDB(db);
    return;
  }

  if (user.state === 'awaiting_flp') {
    const flp = text.replace(/[^\d]/g, '');
    if (!flp || flp.length < 6) {
      await reply(event, { type: 'text', text: 'FLP番号が正しくありません。数字のみで入力してください。' });
      return;
    }
    user.flp = flp;
    user.state = 'awaiting_screenshot';
    await reply(event, buildAskScreenshot());
    saveDB(db);
    return;
  }

  // idle 時の通常応答（必要なら最小）
  await reply(event, { type: 'text', text: '案内に従ってください。\n「登録」と送ると開始します。' });
}

async function handleImageMessage(event, db) {
  const userId = event.source.userId;
  const user = getUser(db, userId);
  user._userId = userId;

  if (user.state !== 'awaiting_screenshot') {
    // 受付フロー外で画像が来た
    await reply(event, { type: 'text', text: '画像を受け取りました。手順に従い「登録」から開始してください。' });
    return;
  }

  user.screenshotMessageId = event.message.id;
  user.state = 'idle';

  // ここで「この人が次の紹介者になる」= 連鎖あり
  // 次世代へ渡す紹介者情報を本人で更新
  if (user.name) user.introducerName = user.name;
  if (user.flp) user.introducerFlp = user.flp;

  // assignedFlp は「登録希望の時点で割当済み」を used にして確定（※要件：3点返信が来たら譲渡）
  // ただし assignedFlp が無い場合はアラート
  if (user.assignedFlp) {
    markUsedFlp(db, userId);
  } else {
    await alertIntroducerIfMissing(db, user, '3点返信完了時に assignedFlp が空');
  }

  await reply(event, buildDoneThanks());

  // 紹介者へ通知（ADMIN_USER_IDに飛ばす）
  if (ADMIN_USER_ID) {
    const msg =
`【3点返信 受領】
ユーザーID: ${userId}
氏名: ${user.name || '（未入力）'}
FLP番号: ${user.flp || '（未入力）'}
割当assignedFlp: ${user.assignedFlp || '（未割当）'}
購入スクショ(messageId): ${user.screenshotMessageId}

※LINE公式アカウントマネージャー側でも確認してください。`;
    await sendToUser(ADMIN_USER_ID, { type: 'text', text: msg });
  }

  saveDB(db);
}

// -------------------- Expiration Cleanup --------------------
function cleanupExpired(db) {
  const t = nowTs();

  // pool 側で expiresAt 過ぎた assigned を unused に戻す（未返信なら再割当）
  for (const item of db.pool) {
    if (item.status === 'assigned' && item.expiresAt && item.expiresAt < t) {
      const userId = item.assignedTo;
      // user 側もクリア
      if (userId && db.users[userId]) {
        db.users[userId].assignedFlp = null;
        db.users[userId].assignedAt = null;
        db.users[userId].expiresAt = null;
      }
      item.status = 'unused';
      item.assignedTo = null;
      item.assignedAt = null;
      item.expiresAt = null;
      logDB(db, `[EXPIRE] returned to pool. userId=${userId || '(none)'} flp=${item.flp}`);
    }
  }

  saveDB(db);
}

// 10分ごとにクリーンアップ
setInterval(() => {
  const db = loadDB();
  cleanupExpired(db);
}, 10 * 60 * 1000);

// -------------------- Express App --------------------
const app = express();

// NOTE: LINE middleware needs raw body, so we attach on /webhook only.
app.get('/', (req, res) => {
  const db = loadDB();
  const counts = poolCounts(db);
  res.status(200).send(
`VSH server is running.
pool: total=${counts.total}, unused=${counts.unused}, assigned=${counts.assigned}, used=${counts.used}`
  );
});

// -------------------- Admin --------------------
function requireAdminToken(req, res) {
  if (!ADMIN_TOKEN) {
    res.status(500).send('ADMIN_TOKEN not set');
    return false;
  }
  const token = (req.query.token || '').trim();
  if (!token || token !== ADMIN_TOKEN) {
    res.status(403).send('Invalid admin token');
    return false;
  }
  return true;
}

app.get('/admin', (req, res) => {
  if (!requireAdminToken(req, res)) return;

  const db = loadDB();
  const counts = poolCounts(db);

  const listPreview = db.pool
    .slice(0, 40)
    .map(x => `${x.flp}  [${x.status}]${x.assignedTo ? ' -> ' + x.assignedTo : ''}`)
    .join('\n');

  res.status(200).send(`
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>VSH Admin</title>
<style>
body { font-family: sans-serif; margin: 18px; }
textarea { width: 100%; max-width: 520px; }
.box { padding: 10px; border: 1px solid #ccc; border-radius: 8px; margin: 10px 0; }
small { color: #555; }
</style>
</head>
<body>
<h2>VSH Admin（assignedFlp 管理）</h2>

<div class="box">
<div><b>Pool 状態</b></div>
<div>total: ${counts.total}</div>
<div>unused: ${counts.unused}</div>
<div>assigned: ${counts.assigned}</div>
<div>used: ${counts.used}</div>
<div><small>Day0〜Day7 配信条件：unused が ${POOL_REQUIRED} 以上</small></div>
</div>

<form method="POST" action="/admin/assignedFlp?token=${encodeURIComponent(req.query.token)}">
  <div class="box">
    <div><b>assignedFlp を30件入力（改行でOK）</b></div>
    <textarea name="assignedFlp" rows="16" placeholder="例：
12345678
23456789
..."></textarea><br><br>
    <button type="submit">保存（上書き）</button>
  </div>
</form>

<div class="box">
<div><b>先頭プレビュー（最大40件）</b></div>
<pre>${escapeHtml(listPreview || '(empty)')}</pre>
</div>

<div class="box">
<div><b>最近ログ</b></div>
<pre>${escapeHtml((db.logs || []).slice(-30).map(x => `${x.t}  ${x.msg}`).join('\n'))}</pre>
</div>

</body>
</html>
  `);
});

app.use(express.urlencoded({ extended: true }));

app.post('/admin/assignedFlp', (req, res) => {
  if (!requireAdminToken(req, res)) return;

  const db = loadDB();
  const lines = normalizeFlpLines(req.body.assignedFlp);
  setPoolFromLines(db, lines);
  saveDB(db);

  res.status(200).send(
`Saved. count=${db.pool.length}
Return: /admin?token=...`
  );
});

// -------------------- Webhook --------------------
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const db = loadDB();

    const events = req.body.events || [];
    for (const event of events) {
      const userId = event.source && event.source.userId ? event.source.userId : null;

      // 簡易ログ
      if (event.type === 'message' && event.message && event.message.type === 'text') {
        const raw = event.message.text;
        logDB(db, `[INCOMING] userId=${userId} raw="${raw}" normalized="${normalizeText(raw)}" state=${getUser(db, userId).state}`);
      }

      if (event.type === 'follow') {
        // 友だち追加
        const u = getUser(db, userId);
        u.parentIntroducerUserId = ADMIN_USER_ID || null;
        // 必要なら welcome を返す
        await reply(event, { type: 'text', text: '友だち追加ありがとうございます。案内に従ってください。' });
        continue;
      }

      if (event.type === 'message') {
        if (event.message.type === 'text') {
          await handleTextMessage(event, db);
        } else if (event.message.type === 'image') {
          await handleImageMessage(event, db);
        } else {
          await reply(event, { type: 'text', text: 'この形式は現在サポートしていません。' });
        }
      }
    }

    saveDB(db);
    res.status(200).send('OK');
  } catch (e) {
    console.error('[WEBHOOK] error:', e);
    res.status(500).send('ERROR');
  }
});

// -------------------- Utilities --------------------
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// -------------------- Start --------------------
app.listen(PORT, () => {
  console.log(`VSH server listening on port ${PORT}`);
  console.log(`ADMIN_TOKEN: ${process.env.ADMIN_TOKEN ? '(set)' : '(missing)'}`);
  console.log(`ADMIN_USER_ID: ${process.env.ADMIN_USER_ID ? '(set)' : '(missing)'}`);

  // 起動時に pool 条件ログ
  const db = loadDB();
  const counts = poolCounts(db);
  console.log(`POOL total=${counts.total} unused=${counts.unused} assigned=${counts.assigned} used=${counts.used}`);
});
