import express from 'express';
import * as line from '@line/bot-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== ENV ======
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;

const INTRODUCER_NAME = process.env.INTRODUCER_NAME || '細井信孝';
const INTRODUCER_FLP = process.env.INTRODUCER_FLP || '203145165';
const INTRODUCER_USER_ID = process.env.INTRODUCER_USER_ID || '';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const PORT = process.env.PORT || 3000;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error('FATAL: CHANNEL_ACCESS_TOKEN / CHANNEL_SECRET が未設定です');
}

// ====== LINE SDK ======
const config = {
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
  channelSecret: CHANNEL_SECRET,
};
const client = new line.Client(config);

// ====== データ保存先 ======
const DATA_DIR = path.join(__dirname, 'data');
const USERS_DB = path.join(DATA_DIR, 'users.json');
const ADMIN_DB = path.join(DATA_DIR, 'admin.json');
const GUIDE_TXT = path.join(DATA_DIR, 'fbo_guide.txt');

// ====== トリガー ======
const TRIG_WANT_REGISTER = '登録希望';
const TRIG_SEND_3PTS = '3点をLINEで返信する';
const TRIG_START_REG = '登録';

// ====== 初期ガイド ======
const DEFAULT_GUIDE_TEXT = `フォーエバービジネスオーナー（FBO）登録手順

１．最初にLINE画面の上段画像（黄色）の登録希望をタップして、以下を受け取ってください。
① 紹介者氏名
② 紹介者FLP番号
③ あなたのFLP番号

２．FLP公式サイト（https://www.flpj.co.jp）に入る。
３．左上のメニューをタップ
４．メニューが開いたら、下方の会員登録・ログインの下の会員登録をタップ
５．フォーエバー会員登録ページが開く
６．最初に現れるフォーエバービジネスオーナーの説明文下段の
　① 登録セットを購入して登録 をタップ
　② 日本国籍をお持ちですか：はい → 登録セットを購入して登録 をタップ

７．各種同意事項とメールアドレス入力欄
① フォーエバービジネスオーナー（FBO）申請の条件：はい
② ご紹介者のFLP番号：②を入力
③ 同意・承諾・必須事項の確認
④ フォーエバービジネスオーナー会員規約への同意
⑤ 個人情報の取り扱いへの同意
⑥ お客様のメールアドレス（あなたのメールアドレス）
⑦ 本人確認メールを送信する
⑧ ご本人様確認URL（フォーエバービジネスオーナー仮申請）
　URLをタップして申請を続けてください

８．登録申請情報の入力
① FLP番号（お送りした、あなたのFLP番号です）
② FC番号の入力は必要ありません
③ 申請者氏名を入力
④ 申請者性別
⑤ 申請者生年月日
⑥ 配偶者氏名（任意）
⑦ 住所の入力
⑧ 電話番号・FAX番号入力
⑨ ボーナスの振込先 金融機関名入力（入金口座）

９．登録セット購入情報の入力
① 「E:登録らくらく３本入りアロエベラジュース」を選択
② 支払い方法：クレジット決済
③ 登録セット配送日時（選択）

１０．次回らくらく便（定期便）配送日時
配送日は毎月２２日：配達希望時間帯を入力
※「会社からのお知らせ、メールマガジンを購読する（無料）」は選択

１１．「次の画面へ」をタップ
`;

// ====== Util ======
function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_DB)) fs.writeFileSync(USERS_DB, JSON.stringify({}, null, 2), 'utf8');
  if (!fs.existsSync(ADMIN_DB)) fs.writeFileSync(ADMIN_DB, JSON.stringify({ flp_pool: [], flp_cursor: 0 }, null, 2), 'utf8');
  if (!fs.existsSync(GUIDE_TXT)) fs.writeFileSync(GUIDE_TXT, DEFAULT_GUIDE_TEXT, 'utf8');
}
function readJson(fp, fallback) {
  try {
    ensureFiles();
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(fp, obj) {
  ensureFiles();
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2), 'utf8');
}
function normalizeText(s) {
  if (!s) return '';
  return s.normalize('NFKC').replace(/\r\n/g, '\n').trim();
}
function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function loadAdmin() {
  return readJson(ADMIN_DB, { flp_pool: [], flp_cursor: 0 });
}
function saveAdmin(admin) {
  writeJson(ADMIN_DB, admin);
}
function allocateFlpForUser(userId) {
  const admin = loadAdmin();
  const pool = Array.isArray(admin.flp_pool) ? admin.flp_pool : [];
  const cursor = Number.isInteger(admin.flp_cursor) ? admin.flp_cursor : 0;

  if (pool.length === 0 || cursor >= pool.length) return { ok: false, reason: 'POOL_EMPTY' };

  const assigned = String(pool[cursor]).trim();
  admin.flp_cursor = cursor + 1;
  saveAdmin(admin);
  return { ok: true, flp: assigned, index: cursor + 1, poolSize: pool.length };
}
function loadUsers() {
  return readJson(USERS_DB, {});
}
function saveUsers(users) {
  writeJson(USERS_DB, users);
}
function getUser(users, userId) {
  if (!users[userId]) {
    users[userId] = { state: 'idle', name: '', flp: '', lastImageId: '', assignedFlp: '', assignedAt: '' };
  }
  return users[userId];
}
function loadGuideText() {
  ensureFiles();
  return fs.readFileSync(GUIDE_TXT, 'utf8');
}

async function notifyIntroducerIfPossible(text) {
  if (!INTRODUCER_USER_ID) return;
  try {
    await client.pushMessage(INTRODUCER_USER_ID, [{ type: 'text', text }]);
  } catch (e) {
    console.error('pushMessage failed:', e);
  }
}

// ====== Express ======
const app = express();

/**
 * ★重要：Webhook 署名検証のため、express.json() をWebhookより先に掛けない！
 * ここが今回の「SignatureValidationFailed」の原因です。
 */

// health
app.get('/', (_req, res) => res.status(200).send('OK'));

// VHSページ（閲覧用）
app.get('/vhs/fbo-guide', (req, res) => {
  const guide = loadGuideText();
  const assignedFlp = String(req.query.flp || '').trim();

  const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>FBO登録手順（VHS）</title>
  <style>
    body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans JP"; margin:16px; line-height:1.6;}
    .box{border:1px solid #ddd; border-radius:10px; padding:12px; margin:12px 0;}
    .muted{color:#666; font-size:0.95em;}
    pre{white-space:pre-wrap; word-break:break-word; background:#fafafa; border:1px solid #eee; border-radius:10px; padding:12px;}
  </style>
</head>
<body>
  <h1>フォーエバービジネスオーナー（FBO）登録手順</h1>
  <div class="box">
    <div class="muted">※ このページはVHS上の手順書です。内容は今後アップデートされます。</div>
    ${
      assignedFlp
        ? `<p><b>あなたのFLP番号：</b> ${escapeHtml(assignedFlp)}</p>`
        : `<p class="muted">（あなたのFLP番号は、LINEの「登録希望」で自動送信された内容をご確認ください）</p>`
    }
  </div>
  <pre>${escapeHtml(guide)}</pre>
</body>
</html>`;

  res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ====== Webhook（必ず express.json より先！） ======
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).end();
  }
});

// ====== ここから下は JSONパーサーOK（管理API用） ======
app.use(express.json({ limit: '2mb' }));

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(403).json({ ok: false, error: 'ADMIN_TOKEN not set' });
  const token = req.headers['x-admin-token'] || req.query.token || '';
  if (token !== ADMIN_TOKEN) return res.status(403).json({ ok: false, error: 'unauthorized' });
  next();
}

// ガイド更新
app.post('/admin/fbo-guide', requireAdmin, (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  if (!text.trim()) return res.status(400).json({ ok: false, error: 'text required' });
  ensureFiles();
  fs.writeFileSync(GUIDE_TXT, text, 'utf8');
  return res.json({ ok: true });
});

// FLPプール更新
app.post('/admin/flp-pool', requireAdmin, (req, res) => {
  const list = req.body?.flp_pool;
  if (!Array.isArray(list)) return res.status(400).json({ ok: false, error: 'flp_pool array required' });

  const cleaned = list.map(x => String(x || '').trim()).filter(x => x.length > 0);

  const admin = loadAdmin();
  admin.flp_pool = cleaned;
  admin.flp_cursor = 0;
  saveAdmin(admin);

  return res.json({ ok: true, count: cleaned.length });
});

app.get('/admin/status', requireAdmin, (_req, res) => {
  const admin = loadAdmin();
  return res.json({ ok: true, flp_pool_count: admin.flp_pool?.length || 0, flp_cursor: admin.flp_cursor || 0 });
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));

// ====== LINE Event Handler ======
async function handleEvent(event) {
  if (event.type !== 'message') return null;

  const userId = event?.source?.userId || '';
  const users = loadUsers();
  const u = getUser(users, userId);

  if (event.message.type === 'text') {
    const raw = event.message.text || '';
    const text = normalizeText(raw);

    console.log(`[INCOMING] userId=${userId} raw="${raw}" normalized="${text}" state=${u.state}`);

    // Day7：登録希望
    if (text === TRIG_WANT_REGISTER) {
      u.state = 'idle';

      let assigned = u.assignedFlp;
      if (!assigned) {
        const alloc = allocateFlpForUser(userId);
        if (alloc.ok) {
          assigned = alloc.flp;
          u.assignedFlp = assigned;
          u.assignedAt = new Date().toISOString();
        } else {
          saveUsers(users);
          await notifyIntroducerIfPossible(`【登録希望（プール未入力）】\n登録者userId：${userId}\nFLP番号プールが空のため割当不可`);
          return client.replyMessage(event.replyToken, [{
            type: 'text',
            text:
              `新規登録者のFLP番号が入力されていません。\n\n` +
              `これから自動紹介を開始するために、\n` +
              `30人分の新規登録者用FLP番号（Day8で詳しく説明する）を入力してください。\n\n` +
              `FLP番号は、新規登録者がフォーエバー社に電話でスタートキットを注文して入手します。\n\n` +
              `※ FLP番号が入力されるまで、自動紹介は開始されません。`
          }]).catch(err => console.error('replyMessage failed (pool empty):', err));
        }
      }

      saveUsers(users);

      const msg1 =
        `（登録希望を受け付けました）\n` +
        `以下登録に必要な３点を送ります。\n` +
        `最下段に表示されますフォーエバービジネスオーナー（FBO）登録手順を見て、ご登録ください。\n\n` +
        `登録に必要な３点\n` +
        `①\t紹介者氏名：${INTRODUCER_NAME}\n` +
        `②\t紹介者のFLP番号：${INTRODUCER_FLP}\n` +
        `③\tあなたのFLP番号：${assigned}\n\n` +
        `登録が終わりましたら、上の画面（青色）の「３点をLINEで返信する」をタップし、案内に従ってください。`;

      const BASE_URL = process.env.BASE_URL || 'https://vsh-server.onrender.com';
      const guideUrl = `${BASE_URL}/vhs/fbo-guide?flp=${encodeURIComponent(assigned)}`;

      const msg2 = {
        type: 'template',
        altText: 'フォーエバービジネスオーナー（FBO）登録手順',
        template: {
          type: 'buttons',
          title: 'FBO登録手順（WEB）',
          text: '下のボタンから登録手順を開いてください。',
          actions: [{ type: 'uri', label: '登録手順を見る', uri: guideUrl }],
        },
      };

      await notifyIntroducerIfPossible(`【登録希望】\n登録者userId：${userId}\n割当FLP：${assigned}`);

      return client.replyMessage(event.replyToken, [{ type: 'text', text: msg1 }, msg2])
        .catch(err => console.error('replyMessage failed (want register):', err));
    }

    // Day7：3点をLINEで返信する
    if (text === TRIG_SEND_3PTS) {
      u.state = 'idle';
      saveUsers(users);
      return client.replyMessage(event.replyToken, [{ type: 'text', text: `案内に従ってください。\n「登録」と送ると開始します。` }])
        .catch(err => console.error('replyMessage failed (3pts guide):', err));
    }

    // 受付開始
    if (text === TRIG_START_REG) {
      u.state = 'await_name';
      saveUsers(users);
      return client.replyMessage(event.replyToken, [{ type: 'text', text: '【登録受付を開始します】\n① 氏名 を入力してください' }])
        .catch(err => console.error('replyMessage failed (start):', err));
    }

    if (u.state === 'await_name') {
      u.name = text;
      u.state = 'await_flp';
      saveUsers(users);
      return client.replyMessage(event.replyToken, [{ type: 'text', text: 'ありがとうございます。\n② FLP番号 を入力してください' }])
        .catch(err => console.error('replyMessage failed (name):', err));
    }

    if (u.state === 'await_flp') {
      u.flp = text;
      u.state = 'await_image';
      saveUsers(users);
      return client.replyMessage(event.replyToken, [{ type: 'text', text: '③ 最後に【購入画面のスクリーンショット】を画像で送ってください。' }])
        .catch(err => console.error('replyMessage failed (flp):', err));
    }

    saveUsers(users);
    return null;
  }

  if (event.message.type === 'image') {
    console.log(`[INCOMING_IMAGE] userId=${userId} state=${u.state} messageId=${event.message.id}`);

    if (u.state !== 'await_image') {
      saveUsers(users);
      return client.replyMessage(event.replyToken, [{
        type: 'text',
        text: '画像を受信しました。\n登録受付を開始する場合は「登録」と送ってください。'
      }]).catch(err => console.error('replyMessage failed (image outside):', err));
    }

    u.lastImageId = event.message.id || '';
    u.state = 'completed';
    saveUsers(users);

    await notifyIntroducerIfPossible(
      `【登録情報が揃いました】\n氏名：${u.name}\nFLP：${u.flp}\nスクショID：${u.lastImageId}\nuserId：${userId}\n（確認後、VSHを譲渡してください）`
    );

    return client.replyMessage(event.replyToken, [
      {
        type: 'text',
        text:
          '画像を受け取りました。ありがとうございます。\n' +
          '【登録情報が揃いました】\n・氏名\n・FLP番号\n・購入画面スクリーンショット\n\n' +
          '紹介者が確認後、VSHを譲渡します。'
      },
      {
        type: 'text',
        text:
          `【登録完了】\n氏名：${u.name}\nFLP：${u.flp}\nスクショID：${u.lastImageId}\nuserId：${userId}`
      }
    ]).catch(err => console.error('replyMessage failed (completed):', err));
  }

  saveUsers(users);
  return null;
}
