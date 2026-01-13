import express from 'express';
import * as line from '@line/bot-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== ENV =====
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;

const BASE_URL = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://vsh-server.onrender.com').replace(/\/+$/, '');
const OA_LINE_ID = (process.env.OA_LINE_ID || '').trim(); // 例: @abcd1234

// ルート（Gen0）
const ROOT_INTRODUCER_NAME = process.env.INTRODUCER_NAME || '細井信孝';
const ROOT_INTRODUCER_FLP  = process.env.INTRODUCER_FLP  || '203145165';
const ROOT_INTRODUCER_USER_ID = process.env.INTRODUCER_USER_ID || ''; // 任意

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const PORT = process.env.PORT || 3000;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error('FATAL: CHANNEL_ACCESS_TOKEN / CHANNEL_SECRET が未設定です');
}

const config = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET,
};
const client = new line.Client(config);

// ===== Storage =====
const DATA_DIR = path.join(__dirname, 'data');
const USERS_DB = path.join(DATA_DIR, 'users.json');
const ADMIN_DB = path.join(DATA_DIR, 'admin.json');
const GUIDE_TXT = path.join(DATA_DIR, 'fbo_guide.txt');

// ===== Triggers =====
const TRIG_WANT_REGISTER = '登録希望';
const TRIG_SEND_3PTS     = '3点をLINEで返信する';
const TRIG_START_REG     = '登録';
const TRIG_REF_PREFIX    = 'REF '; // 例: "REF abcd1234"

// ===== Constants =====
const REQUIRED_POOL_COUNT = 30;
const EXPIRE_DAYS = 10;
const EXPIRE_MS = EXPIRE_DAYS * 24 * 60 * 60 * 1000;

// ===== Default guide text =====
const DEFAULT_GUIDE_TEXT = `フォーエバービジネスオーナー（FBO）登録手順（VHS）

１．最初にLINE画面の上段画像（黄色）の登録希望をタップして、以下を受け取ってください。
① 紹介者氏名
② 紹介者FLP番号
③ あなたのFLP番号

２．FLP公式サイト（https://www.flpj.co.jp）に入る。
３．左上のメニューをタップ
４．会員登録へ
５．FBO登録へ進む
…（ここは管理WEBから自由に更新できます）
`;

// ===== Utils =====
function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_DB)) fs.writeFileSync(USERS_DB, JSON.stringify({}, null, 2), 'utf8');
  if (!fs.existsSync(ADMIN_DB)) {
    const init = {
      pool: [],
      reserved: {},     // userId -> { flp, assignedAt, introducerUserId, introducerName, introducerFlp }
      completed: {},    // userId -> { flp, completedAt }
      expired_log: [],
      introducers: {},  // introducerUserId -> { name, flp, refCode, createdAt }
      refIndex: {}      // refCode -> introducerUserId
    };
    fs.writeFileSync(ADMIN_DB, JSON.stringify(init, null, 2), 'utf8');
  }
  if (!fs.existsSync(GUIDE_TXT)) fs.writeFileSync(GUIDE_TXT, DEFAULT_GUIDE_TEXT, 'utf8');
}
function readJson(fp, fallback) {
  try { ensureFiles(); return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return fallback; }
}
function writeJson(fp, obj) { ensureFiles(); fs.writeFileSync(fp, JSON.stringify(obj, null, 2), 'utf8'); }
function normalizeText(s) { return (s||'').normalize('NFKC').replace(/\r\n/g, '\n').trim(); }
function escapeHtml(s) {
  return String(s)
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
function nowIso(){ return new Date().toISOString(); }

function loadAdmin(){ return readJson(ADMIN_DB, { pool:[], reserved:{}, completed:{}, expired_log:[], introducers:{}, refIndex:{} }); }
function saveAdmin(a){ writeJson(ADMIN_DB, a); }

function loadUsers(){ return readJson(USERS_DB, {}); }
function saveUsers(u){ writeJson(USERS_DB, u); }
function getUser(users, userId) {
  if (!users[userId]) {
    users[userId] = {
      state: 'idle',
      name: '',
      flp: '',
      lastImageId: '',
      introducerRef: '' // 新規登録者が送った REFコード
    };
  }
  return users[userId];
}

function loadGuideText(){ ensureFiles(); return fs.readFileSync(GUIDE_TXT, 'utf8'); }
function saveGuideText(text){ ensureFiles(); fs.writeFileSync(GUIDE_TXT, text, 'utf8'); }

async function pushToUser(userId, text) {
  if (!userId) return;
  try { await client.pushMessage(userId, [{ type:'text', text }]); }
  catch(e){ console.error('pushMessage failed:', e); }
}

// ===== Expire logic =====
function reclaimExpired(admin) {
  const now = Date.now();
  for (const [userId, r] of Object.entries(admin.reserved || {})) {
    const assignedAtMs = Date.parse(r.assignedAt || '');
    const isCompleted = !!admin.completed?.[userId];
    if (!isCompleted && Number.isFinite(assignedAtMs) && (now - assignedAtMs) >= EXPIRE_MS) {
      const flp = String(r.flp || '').trim();
      if (flp) admin.pool.push(flp);
      admin.expired_log = Array.isArray(admin.expired_log) ? admin.expired_log : [];
      admin.expired_log.push({ flp, userId, assignedAt: r.assignedAt, expiredAt: nowIso() });
      delete admin.reserved[userId];
    }
  }
}
function poolReadyExactly30(admin) {
  const n = Array.isArray(admin.pool) ? admin.pool.length : 0;
  return n === REQUIRED_POOL_COUNT;
}

// ===== Ref / Introducer registry =====
function makeRefCode() {
  // 10桁程度
  return Math.random().toString(36).slice(2, 12);
}
function registerIntroducer(admin, introducerUserId, name, flp) {
  admin.introducers = admin.introducers || {};
  admin.refIndex = admin.refIndex || {};

  const existing = admin.introducers[introducerUserId];
  if (existing?.refCode) {
    // 情報更新だけ
    admin.introducers[introducerUserId] = { ...existing, name, flp };
    return existing.refCode;
  }

  let code = makeRefCode();
  while (admin.refIndex[code]) code = makeRefCode();

  admin.introducers[introducerUserId] = { name, flp, refCode: code, createdAt: nowIso() };
  admin.refIndex[code] = introducerUserId;
  return code;
}
function resolveIntroducerForNewUser(admin, users, newUserId) {
  const u = users[newUserId];
  const ref = (u?.introducerRef || '').trim();
  if (ref && admin.refIndex?.[ref]) {
    const iid = admin.refIndex[ref];
    const intro = admin.introducers?.[iid];
    if (intro?.name && intro?.flp) {
      return { introducerUserId: iid, introducerName: intro.name, introducerFlp: intro.flp };
    }
  }
  // refが無い場合はルート（Gen0）
  return { introducerUserId: ROOT_INTRODUCER_USER_ID, introducerName: ROOT_INTRODUCER_NAME, introducerFlp: ROOT_INTRODUCER_FLP };
}

// ===== Assign on Day7 =====
function assignNextFlp(admin, userId, introducerInfo) {
  // reuse if exists
  if (admin.reserved?.[userId]?.flp) return { ok:true, flp: admin.reserved[userId].flp, reused:true };
  if (admin.completed?.[userId]?.flp) return { ok:true, flp: admin.completed[userId].flp, reused:true };

  const pool = Array.isArray(admin.pool) ? admin.pool : [];
  if (pool.length <= 0) return { ok:false, reason:'POOL_EMPTY' };

  const flp = String(pool.shift()).trim();
  admin.pool = pool;
  admin.reserved = admin.reserved || {};
  admin.reserved[userId] = {
    flp,
    assignedAt: nowIso(),
    introducerUserId: introducerInfo.introducerUserId || '',
    introducerName: introducerInfo.introducerName || '',
    introducerFlp: introducerInfo.introducerFlp || ''
  };
  return { ok:true, flp, reused:false };
}
function markCompleted(admin, userId, flp) {
  admin.completed = admin.completed || {};
  admin.completed[userId] = { flp, completedAt: nowIso() };
  if (admin.reserved?.[userId]) delete admin.reserved[userId];
}

// ===== Express =====
const app = express();

app.get('/', (_req,res)=>res.status(200).send('OK'));

// VHS guide
app.get('/vhs/fbo-guide', (req,res)=>{
  const guide = loadGuideText();
  const assignedFlp = String(req.query.flp || '').trim();
  const html = `<!doctype html><html lang="ja"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>FBO登録手順（VHS）</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans JP",Arial; margin:16px; line-height:1.7;}
.box{border:1px solid #ddd; border-radius:12px; padding:12px; margin:12px 0; background:#fafafa;}
pre{white-space:pre-wrap; word-break:break-word; border:1px solid #eee; border-radius:12px; padding:12px; background:#fff;}
.small{color:#666; font-size:0.95em;}
</style></head><body>
<h1>フォーエバービジネスオーナー（FBO）登録手順</h1>
<div class="box">
  <div class="small">※ この手順書は管理WEBからいつでも更新できます。</div>
  ${assignedFlp ? `<p><b>あなたのFLP番号：</b> ${escapeHtml(assignedFlp)}</p>` : ``}
</div>
<pre>${escapeHtml(guide)}</pre>
</body></html>`;
  res.status(200).setHeader('Content-Type','text/html; charset=utf-8');
  res.send(html);
});

// Ref landing（紹介リンク）
app.get('/ref/:code', (req,res)=>{
  const code = String(req.params.code || '').trim();
  const admin = loadAdmin();
  const iid = admin.refIndex?.[code];
  const intro = iid ? admin.introducers?.[iid] : null;

  // LINE OA チャットを開いて "REF code" を入力させるリンク
  let oaLink = '';
  if (OA_LINE_ID) {
    const text = encodeURIComponent(`REF ${code}`);
    // 公式アカウントとのトーク画面を開き、メッセージをプリセット
    oaLink = `https://line.me/R/oaMessage/${encodeURIComponent(OA_LINE_ID)}/?${text}`;
  }

  const html = `<!doctype html><html lang="ja"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>VHS 参加</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans JP",Arial; margin:16px; line-height:1.7;}
.box{border:1px solid #ddd; border-radius:14px; padding:14px; margin:12px 0;}
a.btn{display:inline-block; padding:12px 14px; border-radius:12px; border:1px solid #aaa; background:#f5f5f5; text-decoration:none; color:#000;}
small{color:#666;}
</style></head><body>
<h1>VHS 参加ページ</h1>
<div class="box">
  <p>紹介者：<b>${escapeHtml(intro?.name || '未判定')}</b> / FLP：<b>${escapeHtml(intro?.flp || '')}</b></p>
  <p>次に、LINEで <b>「REF ${escapeHtml(code)}」</b> を送信してください。</p>
  ${oaLink ? `<p><a class="btn" href="${oaLink}">LINEで開く（REFを自動入力）</a></p>` : `<p><small>※ OA_LINE_ID が未設定のため、ボタンを表示できません。LINEで「REF ${escapeHtml(code)}」を手動送信してください。</small></p>`}
</div>
<div class="box">
  <small>REF送信後、Day0〜Day7の案内に従って進めてください。</small>
</div>
</body></html>`;
  res.status(200).setHeader('Content-Type','text/html; charset=utf-8');
  res.send(html);
});

// Webhook (must be before json parser)
app.post('/webhook', line.middleware(config), async (req,res)=>{
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch(e) {
    console.error('Webhook error:', e);
    res.status(500).end();
  }
});

// Admin parsers
app.use(express.json({ limit:'3mb' }));
app.use(express.urlencoded({ extended:true, limit:'3mb' }));

function requireAdmin(req,res,next){
  if (!ADMIN_TOKEN) return res.status(403).send('ADMIN_TOKEN not set');
  const token = req.query.token || req.headers['x-admin-token'] || '';
  if (token !== ADMIN_TOKEN) return res.status(403).send('unauthorized');
  next();
}

// Admin UI
app.get('/admin', requireAdmin, (req,res)=>{
  const admin = loadAdmin();
  reclaimExpired(admin);
  saveAdmin(admin);

  const pool = Array.isArray(admin.pool) ? admin.pool : [];
  const reserved = admin.reserved || {};
  const completed = admin.completed || {};
  const introducers = admin.introducers || {};
  const expiredLog = Array.isArray(admin.expired_log) ? admin.expired_log.slice(-30).reverse() : [];

  const ready = pool.length === REQUIRED_POOL_COUNT ? 'OK（30件）' : `NG（現在 ${pool.length} 件）`;

  const html = `<!doctype html><html lang="ja"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>VHS 管理WEB</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans JP",Arial; margin:16px; line-height:1.6;}
.box{border:1px solid #ddd; border-radius:12px; padding:12px; margin:12px 0;}
textarea{width:100%; min-height:220px; font-family:ui-monospace,Menlo,Consolas,monospace;}
input[type="submit"]{padding:10px 14px; border-radius:10px; border:1px solid #aaa; background:#f5f5f5;}
table{width:100%; border-collapse:collapse;}
td,th{border-bottom:1px solid #eee; padding:6px; text-align:left; vertical-align:top;}
.bad{color:#b00020; font-weight:700;}
.good{color:#0a6; font-weight:700;}
small{color:#666;}
</style></head><body>
<h1>VHS 管理WEB</h1>

<div class="box">
  <h2>状態</h2>
  <p>配信条件（poolがちょうど30件）： ${pool.length===REQUIRED_POOL_COUNT ? `<span class="good">${ready}</span>` : `<span class="bad">${ready}</span>`}</p>
  <p>未使用pool： <b>${pool.length}</b> / 30　予約中： <b>${Object.keys(reserved).length}</b>　完了： <b>${Object.keys(completed).length}</b></p>
  <p><small>reservedは10日で失効→poolへ戻ります。</small></p>
</div>

<div class="box">
  <h2>assignedFlp（未使用pool）を30件入力（ちょうど30件）</h2>
  <form method="post" action="/admin/pool?token=${encodeURIComponent(req.query.token)}">
    <p><small>1行に1番号。30行だけ（31行以上は拒否）。</small></p>
    <textarea name="text" placeholder="例：&#10;123456789&#10;..."></textarea>
    <p><input type="submit" value="30件を登録（上書き）"/></p>
  </form>
</div>

<div class="box">
  <h2>FBO登録手順（VHS WEB原稿）更新</h2>
  <form method="post" action="/admin/guide?token=${encodeURIComponent(req.query.token)}">
    <textarea name="text">${escapeHtml(loadGuideText())}</textarea>
    <p><input type="submit" value="登録手順を更新"/></p>
  </form>
</div>

<div class="box">
  <h2>紹介者（連鎖）一覧</h2>
  <table><thead><tr><th>introducerUserId</th><th>氏名</th><th>FLP</th><th>紹介リンク</th></tr></thead><tbody>
    ${Object.entries(introducers).map(([uid, it])=>{
      const link = `${BASE_URL}/ref/${it.refCode}`;
      return `<tr>
        <td>${escapeHtml(uid)}</td>
        <td>${escapeHtml(it.name)}</td>
        <td>${escapeHtml(it.flp)}</td>
        <td>${escapeHtml(link)}</td>
      </tr>`;
    }).join('')}
  </tbody></table>
  <p><small>※ 新規登録者が「3点返信完了」すると自動で紹介者登録され、リンクが発行されます。</small></p>
</div>

<div class="box">
  <h2>予約中（reserved）</h2>
  <table><thead><tr><th>userId</th><th>assignedFlp</th><th>assignedAt</th><th>紹介者</th></tr></thead><tbody>
    ${Object.entries(reserved).map(([uid, r])=>`<tr>
      <td>${escapeHtml(uid)}</td>
      <td>${escapeHtml(r.flp)}</td>
      <td>${escapeHtml(r.assignedAt)}</td>
      <td>${escapeHtml(r.introducerName||'')} / ${escapeHtml(r.introducerFlp||'')}</td>
    </tr>`).join('')}
  </tbody></table>
</div>

<div class="box">
  <h2>失効ログ（直近30件）</h2>
  <table><thead><tr><th>flp</th><th>userId</th><th>assignedAt</th><th>expiredAt</th></tr></thead><tbody>
    ${expiredLog.map(x=>`<tr>
      <td>${escapeHtml(x.flp)}</td><td>${escapeHtml(x.userId)}</td>
      <td>${escapeHtml(x.assignedAt)}</td><td>${escapeHtml(x.expiredAt)}</td>
    </tr>`).join('')}
  </tbody></table>
</div>

</body></html>`;

  res.status(200).setHeader('Content-Type','text/html; charset=utf-8');
  res.send(html);
});

app.post('/admin/pool', requireAdmin, (req,res)=>{
  const text = String(req.body?.text || '');
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);

  if (lines.length !== REQUIRED_POOL_COUNT) {
    return res.status(400).send(`assignedFlpは「ちょうど30件」必要です。現在 ${lines.length} 件です。`);
  }
  const set = new Set(lines);
  if (set.size !== lines.length) return res.status(400).send('重複した番号があります。重複を取り除いてください。');

  const admin = loadAdmin();
  admin.pool = lines.slice();
  saveAdmin(admin);
  res.redirect(`/admin?token=${encodeURIComponent(req.query.token)}`);
});

app.post('/admin/guide', requireAdmin, (req,res)=>{
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).send('空の原稿は保存できません。');
  saveGuideText(text);
  res.redirect(`/admin?token=${encodeURIComponent(req.query.token)}`);
});

app.listen(PORT, ()=>console.log(`Server running on ${PORT}`));

// ===== LINE handler =====
async function handleEvent(event) {
  if (event.type !== 'message') return null;

  const userId = event?.source?.userId || '';
  const users = loadUsers();
  const u = getUser(users, userId);

  // expire reclaim on every event
  const admin0 = loadAdmin();
  reclaimExpired(admin0);
  saveAdmin(admin0);

  if (event.message.type === 'text') {
    const raw = event.message.text || '';
    const text = normalizeText(raw);
    console.log(`[INCOMING] userId=${userId} raw="${raw}" normalized="${text}" state=${u.state}`);

    // REF受信（紹介者の紐付け）
    if (text.startsWith(TRIG_REF_PREFIX)) {
      const code = text.slice(TRIG_REF_PREFIX.length).trim();
      const admin = loadAdmin();
      if (admin.refIndex?.[code]) {
        u.introducerRef = code;
        saveUsers(users);
        return client.replyMessage(event.replyToken, [{
          type:'text',
          text: `紹介リンクを確認しました。\nこのままDay0〜Day7の案内に従って進めてください。\n（Day7では「登録希望」をタップしてください）`
        }]).catch(e=>console.error('replyMessage failed (ref):', e));
      }
      return client.replyMessage(event.replyToken, [{
        type:'text',
        text: '紹介コードが確認できませんでした。紹介者から受け取ったリンクをもう一度開いてください。'
      }]).catch(e=>console.error('replyMessage failed (ref invalid):', e));
    }

    // Day7: 登録希望
    if (text === TRIG_WANT_REGISTER) {
      const admin = loadAdmin();
      reclaimExpired(admin);
      saveAdmin(admin);

      // Day0-7配信条件（あなたの仕様）
      if (!poolReadyExactly30(admin) && !admin.reserved?.[userId] && !admin.completed?.[userId]) {
        await pushToUser(ROOT_INTRODUCER_USER_ID, `【アラート】Day7 登録希望が来ましたが、poolが30件ではないため受付停止。\npool=${admin.pool?.length||0}\nuserId=${userId}`);
        return client.replyMessage(event.replyToken, [{ type:'text', text:'現在、受付準備中です。紹介者へご連絡ください。' }])
          .catch(e=>console.error('replyMessage failed (pool not ready):', e));
      }

      // その新規登録者の「紹介者」を解決（連鎖）
      const introducerInfo = resolveIntroducerForNewUser(admin, users, userId);

      // 先着割当
      const assigned = assignNextFlp(admin, userId, introducerInfo);
      saveAdmin(admin);

      if (!assigned.ok || !assigned.flp) {
        await pushToUser(introducerInfo.introducerUserId || ROOT_INTRODUCER_USER_ID,
          `【アラート】Day7 登録希望：assignedFlp割当不可（pool空）\nuserId=${userId}`
        );
        return client.replyMessage(event.replyToken, [{ type:'text', text:'現在、受付を終了しています。紹介者へご連絡ください。' }])
          .catch(e=>console.error('replyMessage failed (pool empty):', e));
      }

      const assignedFlp = assigned.flp;

      // 紹介者へ通知（連鎖：その人へ送る）
      await pushToUser(introducerInfo.introducerUserId || ROOT_INTRODUCER_USER_ID,
        `【登録希望】\nuserId=${userId}\n割当FLP（あなたのFLP番号）=${assignedFlp}\n（10日以内に3点返信が無い場合は失効→再割当）`
      );

      const msgText =
        `あなたが登録するのに必要な3点をお送りします。\n` +
        `① 紹介者の氏名：${introducerInfo.introducerName}\n` +
        `② 紹介者FLP番号：${introducerInfo.introducerFlp}\n` +
        `③ あなたのFLP番号：${assignedFlp}\n\n` +
        `下段に表示された「登録手順」を参考に登録してください。\n` +
        `登録が終わりましたら、青い画像の「3点をLINEで返信する」をタップして登録状況を送信してください。`;

      const guideUrl = `${BASE_URL}/vhs/fbo-guide?flp=${encodeURIComponent(assignedFlp)}`;
      const guideBtn = {
        type:'template',
        altText:'登録手順（VHS）',
        template:{
          type:'buttons',
          title:'フォーエバービジネスオーナー（FBO）登録手順',
          text:'下のボタンから登録手順を開いてください。',
          actions:[{ type:'uri', label:'登録手順を見る', uri: guideUrl }]
        }
      };

      return client.replyMessage(event.replyToken, [{ type:'text', text: msgText }, guideBtn])
        .catch(e=>console.error('replyMessage failed (want register):', e));
    }

    // Day7: 3点をLINEで返信する（現状OK）
    if (text === TRIG_SEND_3PTS) {
      u.state = 'idle';
      saveUsers(users);
      return client.replyMessage(event.replyToken, [{ type:'text', text:'案内に従ってください。\n「登録」と送ると開始します。' }])
        .catch(e=>console.error('replyMessage failed (3pts):', e));
    }

    // 登録フロー
    if (text === TRIG_START_REG) {
      u.state = 'await_name';
      saveUsers(users);
      return client.replyMessage(event.replyToken, [{ type:'text', text:'【登録受付を開始します】\n① 氏名 を入力してください' }])
        .catch(e=>console.error('replyMessage failed (start):', e));
    }

    if (u.state === 'await_name') {
      u.name = text;
      u.state = 'await_flp';
      saveUsers(users);
      return client.replyMessage(event.replyToken, [{ type:'text', text:'ありがとうございます。\n② FLP番号 を入力してください' }])
        .catch(e=>console.error('replyMessage failed (name):', e));
    }

    if (u.state === 'await_flp') {
      u.flp = text;
      u.state = 'await_image';
      saveUsers(users);
      return client.replyMessage(event.replyToken, [{ type:'text', text:'③ 最後に【購入画面のスクリーンショット】を画像で送ってください。' }])
        .catch(e=>console.error('replyMessage failed (flp):', e));
    }

    saveUsers(users);
    return null;
  }

  if (event.message.type === 'image') {
    const users2 = loadUsers();
    const u2 = getUser(users2, userId);

    console.log(`[INCOMING_IMAGE] userId=${userId} state=${u2.state} messageId=${event.message.id}`);

    if (u2.state !== 'await_image') {
      saveUsers(users2);
      return client.replyMessage(event.replyToken, [{ type:'text', text:'画像を受信しました。\n登録受付を開始する場合は「登録」と送ってください。' }])
        .catch(e=>console.error('replyMessage failed (image outside):', e));
    }

    u2.lastImageId = event.message.id || '';
    u2.state = 'completed';
    saveUsers(users2);

    // 完了時：reservedをcompletedへ、紹介者へ通知（reservedに紐づく紹介者）
    const admin = loadAdmin();
    reclaimExpired(admin);

    const r = admin.reserved?.[userId];
    const assignedFlp = r?.flp || admin.completed?.[userId]?.flp || '';
    const introducerUserId = r?.introducerUserId || ROOT_INTRODUCER_USER_ID;

    if (assignedFlp) {
      markCompleted(admin, userId, assignedFlp);
    }
    saveAdmin(admin);

    // ★連鎖：このユーザーを「次の紹介者」として登録（自動譲渡と同義）
    if (u2.name && u2.flp) {
      const admin2 = loadAdmin();
      reclaimExpired(admin2);
      const refCode = registerIntroducer(admin2, userId, u2.name, u2.flp);
      saveAdmin(admin2);

      const myRefLink = `${BASE_URL}/ref/${refCode}`;

      // 本人へ「あなたの紹介リンク」を送る（次世代連鎖の起点）
      await client.pushMessage(userId, [{
        type:'text',
        text:
          `【VSH 譲渡完了】\n` +
          `これより、あなたが紹介者として連鎖します。\n\n` +
          `あなたの紹介リンク（これを次の方へ送ってください）\n${myRefLink}\n\n` +
          `※ 次の方はリンクを開いた後、LINEで「REF ${refCode}」を送信してからDay7へ進みます。`
      }]).catch(e=>console.error('pushMessage failed (ref link):', e));
    }

    // 紹介者へ通知（連鎖先へ）
    await pushToUser(introducerUserId,
      `【登録情報が揃いました】\n氏名：${u2.name}\nFLP：${u2.flp}\nスクショID：${u2.lastImageId}\nuserId：${userId}\n（確認後、VSHを譲渡してください）\n割当FLP：${assignedFlp}`
    );

    return client.replyMessage(event.replyToken, [
      {
        type:'text',
        text:
          '画像を受け取りました。ありがとうございます。\n' +
          '【登録情報が揃いました】\n・氏名\n・FLP番号\n・購入画面スクリーンショット\n\n' +
          '紹介者が確認後、VSHを譲渡します。'
      },
      {
        type:'text',
        text:
          `【登録完了】\n氏名：${u2.name}\nFLP：${u2.flp}\nスクショID：${u2.lastImageId}\nuserId：${userId}`
      }
    ]).catch(e=>console.error('replyMessage failed (completed):', e));
  }

  return null;
}
