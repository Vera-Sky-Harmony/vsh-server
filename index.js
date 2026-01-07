'use strict';

import express from 'express';
import * as line from '@line/bot-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ====== __dirname 互換（ESM） ======
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== 必須 ENV ======
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// ====== 紹介者情報（ENV） ======
const INTRODUCER_USER_ID = process.env.INTRODUCER_USER_ID || '';
const INTRODUCER_NAME = process.env.INTRODUCER_NAME || '紹介者';
const INTRODUCER_FLP = process.env.INTRODUCER_FLP || '（未設定）';

const PORT = process.env.PORT || 3000;

// ====== コマンド（衝突しない）=====
// Day7 リッチメッセージのボタンが送るテキストを、必ずこれにしてください
const CMD_WANT_REGISTER = '__WANT_REGISTER__'; // 「登録希望」ボタン
const CMD_REG_GUIDE    = '__REG_GUIDE__';     // 「3点をLINEで返信する」ボタン
const CMD_REG_START    = '__REG_START__';     // 受付開始（案内で送らせる）

// ====== 簡易ストレージ ======
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'users.json');

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({}), 'utf8');
}
function readDb() {
  ensureDb();
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return {}; }
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

const client = new line.Client(config);
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

async function handleEvent(event) {
  if (event.type !== 'message') return null;

  const userId = event?.source?.userId || '';
  const db = readDb();
  const u = getUser(db, userId);

  // ---- TEXT ----
  if (event.message.type === 'text') {
    const raw = event.message.text || '';
    const text = normalizeText(raw);

    // ★必須ログ：実際に届いている文字を確認
    console.log(`[INCOMING] userId=${userId} raw="${raw}" normalized="${text}" state=${u.state}`);

    // 1) 「登録希望」：受付フローに入れない（通知＋3点送信のみ）
    if (text === CMD_WANT_REGISTER) {
      u.state = 'idle';
      writeDb(db);

      await notifyIntroducerIfPossible({
        type: 'want_register',
        registrantUserId: userId,
        registrantName: u.name,
        registrantFlp: u.flp,
      });

      const registrantFlpLine = u.flp
        ? `③ 登録者のFLP番号：${u.flp}`
        : `③ 登録者のFLP番号：未入力（FLP番号だけ先に返信してください）`;

      return client.replyMessage(event.replyToken, [{
        type: 'text',
        text:
          `【登録希望を受け付けました】\n\n` +
          `① 紹介者氏名：${INTRODUCER_NAME}\n` +
          `② 紹介者のFLP番号：${INTRODUCER_FLP}\n` +
          `${registrantFlpLine}\n\n` +
          `※次のステップに進むには「3点をLINEで返信する」ボタンから案内に従ってください。`
      }]);
    }

    // 2) 「3点返信」：案内だけ
    if (text === CMD_REG_GUIDE) {
      u.state = 'idle';
      writeDb(db);

      return client.replyMessage(event.replyToken, [{
        type: 'text',
        text:
          `案内に従ってください。\n` +
          `開始するには「${CMD_REG_START}」と送ってください。`
      }]);
    }

    // 3) 受付開始（衝突ゼロ）
    if (text === CMD_REG_START) {
      u.state = 'await_name';
      writeDb(db);
      return client.replyMessage(event.replyToken, [{
        type: 'text',
        text: '【登録受付を開始します】\n① 氏名 を入力してください'
      }]);
    }

    // 4) 状態機械
    if (u.state === 'await_name') {
      u.name = text;
      u.state = 'await_flp';
      writeDb(db);
      return client.replyMessage(event.replyToken, [{
        type: 'text',
        text: 'ありがとうございます。\n② FLP番号 を入力してください'
      }]);
    }

    if (u.state === 'await_flp') {
      u.flp = text;
      u.state = 'await_image';
      writeDb(db);
      return client.replyMessage(event.replyToken, [{
        type: 'text',
        text: '③ 最後に【購入画面のスクリーンショット】を画像で送ってください。'
      }]);
    }

    writeDb(db);
    return null;
  }

  // ---- IMAGE ----
  if (event.message.type === 'image') {
    console.log(`[INCOMING_IMAGE] userId=${userId} state=${u.state} messageId=${event.message.id}`);

    if (u.state !== 'await_image') {
      writeDb(db);
      return client.replyMessage(event.replyToken, [{
        type: 'text',
        text: `画像を受信しました。\n登録受付を開始する場合は「${CMD_REG_START}」と送ってください。`
      }]);
    }

    u.lastImageId = event.message.id || '';
    u.state = 'completed';
    writeDb(db);

    await notifyIntroducerIfPossible({
      type: 'completed',
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
          '紹介者が確認後、VSHを譲渡します。'
      },
      {
        type: 'text',
        text:
          `【登録完了】\n` +
          `氏名：${u.name}\n` +
          `FLP：${u.flp}\n` +
          `スクショID：${u.lastImageId}\n` +
          `userId：${userId}`
      }
    ]);
  }

  writeDb(db);
  return null;
}

async function notifyIntroducerIfPossible(payload) {
  if (!INTRODUCER_USER_ID) return;

  const { type, registrantUserId, registrantName, registrantFlp, screenshotId } = payload;
  const head = type === 'completed' ? '【登録情報が揃いました】' : '【登録希望が届きました】';

  const lines = [
    head,
    `登録者userId：${registrantUserId}`,
    registrantName ? `登録者氏名：${registrantName}` : '登録者氏名：（未入力）',
    registrantFlp ? `登録者FLP：${registrantFlp}` : '登録者FLP：（未入力）',
  ];

  if (type === 'completed') {
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
