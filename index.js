'use strict';

import express from 'express';
import * as line from '@line/bot-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ====== __dirname (ESM) ======
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== 必須 ENV ======
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// ====== 紹介者情報（ENV） ======
const INTRODUCER_USER_ID = process.env.INTRODUCER_USER_ID || ''; // Push通知先（紹介者）
const INTRODUCER_NAME = process.env.INTRODUCER_NAME || '紹介者';
const INTRODUCER_FLP = process.env.INTRODUCER_FLP || '（未設定）';

const PORT = process.env.PORT || 3000;

// ====== テキストトリガー（日本語＋安全コマンドの両対応） ======
// Day7ボタンが送る文言（現状のままでも動く）
const TRIG_WANT_REGISTER_JP = '登録希望';
const TRIG_SEND_3PTS_JP = '3点をLINEで返信する';
const TRIG_START_JP = '登録';

// もし今後、ボタン送信を安全コマンドに変えるならこちらも使える（任意）
const TRIG_WANT_REGISTER_CMD = '__WANT_REGISTER__';
const TRIG_SEND_3PTS_CMD = '__REG_GUIDE__';
const TRIG_START_CMD = '__REG_START__';

// ====== 簡易ストレージ ======
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'users.json');

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({}), 'utf8');
}
function readDb() {
  ensureDb();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function writeDb(db) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}
function getUser(db, userId) {
  if (!db[userId]) db[userId] = { state: 'idle', name: '', flp: '', lastImageId: '' };
  return db[userId];
}
function normalizeText(s) {
  if (!s) return '';
  return s.normalize('NFKC').replace(/\r\n/g, '\n').trim();
}

// ====== LINE client ======
const client = new line.Client(config);

// ====== App ======
const app = express();
app.get('/', (req, res) => res.status(200).send('OK'));

app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).end();
  }
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));

// ====== Event handler ======
async function handleEvent(event) {
  if (event.type !== 'message') return null;

  const userId = event?.source?.userId || '';
  const db = readDb();
  const u = getUser(db, userId);

  // ---- TEXT ----
  if (event.message.type === 'text') {
    const raw = event.message.text || '';
    const text = normalizeText(raw);

    // ★受信ログ（あなたの画像に出ていたINCOMING）
    console.log(`[INCOMING] userId=${userId} raw="${raw}" normalized="${text}" state=${u.state}`);

    // 1) 登録希望（受付フローに入れない：通知＋3点送信のみ）
    if (text === TRIG_WANT_REGISTER_JP || text === TRIG_WANT_REGISTER_CMD) {
      // 受付フロー強制解除
      u.state = 'idle';
      writeDb(db);

      // 紹介者へ通知（設定されていれば）
      await notifyIntroducerIfPossible({
        kind: 'want_register',
        registrantUserId: userId,
        registrantName: u.name,
        registrantFlp: u.flp,
      });

      const registrantFlpLine = u.flp
        ? `③ 登録者のFLP番号：${u.flp}`
        : `③ 登録者のFLP番号：未入力（FLP番号だけ先に返信してください）`;

      return client.replyMessage(event.replyToken, [
        {
          type: 'text',
          text:
            `【登録希望を受け付けました】\n\n` +
            `① 紹介者氏名：${INTRODUCER_NAME}\n` +
            `② 紹介者のFLP番号：${INTRODUCER_FLP}\n` +
            `${registrantFlpLine}\n\n` +
            `※次のステップ（3点返信）に進むには、\n` +
            `「3点をLINEで返信する」ボタンから案内に従ってください。`,
        },
      ]).catch(e => console.error('replyMessage failed (want_register):', e));
    }

    // 2) 3点をLINEで返信する（案内のみ。開始は「登録」）
    if (text === TRIG_SEND_3PTS_JP || text === TRIG_SEND_3PTS_CMD) {
      u.state = 'idle';
      writeDb(db);

      return client.replyMessage(event.replyToken, [
        {
          type: 'text',
          text:
            `案内に従ってください。\n` +
            `「登録」と送ると開始します。`,
        },
      ]).catch(e => console.error('replyMessage failed (guide):', e));
    }

    // 3) 受付開始（「登録」）
    if (text === TRIG_START_JP || text === TRIG_START_CMD) {
      u.state = 'await_name';
      writeDb(db);

      return client.replyMessage(event.replyToken, [
        { type: 'text', text: '【登録受付を開始します】\n① 氏名 を入力してください' },
      ]).catch(e => console.error('replyMessage failed (start):', e));
    }

    // 4) 状態機械
    if (u.state === 'await_name') {
      u.name = text;
      u.state = 'await_flp';
      writeDb(db);

      return client.replyMessage(event.replyToken, [
        { type: 'text', text: 'ありがとうございます。\n② FLP番号 を入力してください' },
      ]).catch(e => console.error('replyMessage failed (name):', e));
    }

    if (u.state === 'await_flp') {
      u.flp = text;
      u.state = 'await_image';
      writeDb(db);

      return client.replyMessage(event.replyToken, [
        { type: 'text', text: '③ 最後に【購入画面のスクリーンショット】を画像で送ってください。' },
      ]).catch(e => console.error('replyMessage failed (flp):', e));
    }

    // それ以外は無視（誤作動防止）
    writeDb(db);
    return null;
  }

  // ---- IMAGE ----
  if (event.message.type === 'image') {
    console.log(`[INCOMING_IMAGE] userId=${userId} state=${u.state} messageId=${event.message.id}`);

    if (u.state !== 'await_image') {
      writeDb(db);
      return client.replyMessage(event.replyToken, [
        { type: 'text', text: '画像を受信しました。\n登録受付を開始する場合は「登録」と送ってください。' },
      ]).catch(e => console.error('replyMessage failed (image_outside):', e));
    }

    u.lastImageId = event.message.id || '';
    u.state = 'completed';
    writeDb(db);

    // 紹介者へ「揃いました」通知
    await notifyIntroducerIfPossible({
      kind: 'completed',
      registrantUserId: userId,
      registrantName: u.name,
      registrantFlp: u.flp,
      screenshotId: u.lastImageId,
    });

    return client.replyMessage(event.replyToken, [
      {
        type: 'text',
        text:
          '画像を受け取りました。ありがとうございます。\n' +
          '【登録情報が揃いました】\n・氏名\n・FLP番号\n・購入画面スクリーンショット\n\n' +
          '紹介者が確認後、VSHを譲渡します。',
      },
      {
        type: 'text',
        text:
          `【登録完了】\n` +
          `氏名：${u.name}\n` +
          `FLP：${u.flp}\n` +
          `スクショID：${u.lastImageId}\n` +
          `userId：${userId}`,
      },
    ]).catch(e => console.error('replyMessage failed (completed):', e));
  }

  writeDb(db);
  return null;
}

// ====== 紹介者通知 ======
async function notifyIntroducerIfPossible(payload) {
  if (!INTRODUCER_USER_ID) return;

  const {
    kind,
    registrantUserId,
    registrantName = '',
    registrantFlp = '',
    screenshotId = '',
  } = payload;

  const head = kind === 'completed'
    ? '【登録情報が揃いました】'
    : '【登録希望が届きました】';

  const lines = [
    head,
    `登録者userId：${registrantUserId}`,
    registrantName ? `登録者氏名：${registrantName}` : '登録者氏名：（未入力）',
    registrantFlp ? `登録者FLP：${registrantFlp}` : '登録者FLP：（未入力）',
  ];

  if (kind === 'completed') {
    lines.push(screenshotId ? `スクショID：${screenshotId}` : 'スクショID：（不明）');
    lines.push('確認後、VSH譲渡を実施してください。');
  } else {
    lines.push('登録者へ紹介者情報（氏名・FLP・登録者FLP）を自動送信しました。');
  }

  try {
    await client.pushMessage(INTRODUCER_USER_ID, [{ type: 'text', text: lines.join('\n') }]);
  } catch (e) {
    console.error('pushMessage failed:', e);
  }
}
