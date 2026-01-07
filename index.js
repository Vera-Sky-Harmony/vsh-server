'use strict';

const express = require('express');
const line = require('@line/bot-sdk');
const fs = require('fs');
const path = require('path');

// ====== 必須 ENV ======
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// ====== 任意 ENV（設計に必要） ======
// 紹介者（あなた）へ通知する先 userId（固定運用の場合）
const INTRODUCER_USER_ID = process.env.INTRODUCER_USER_ID || ''; // 例: Uxxxxxxxx
const INTRODUCER_NAME = process.env.INTRODUCER_NAME || '紹介者';
const INTRODUCER_FLP = process.env.INTRODUCER_FLP || '（未設定）';

// ポート
const PORT = process.env.PORT || 3000;

// ====== 簡易ストレージ（JSON） ======
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
  } catch (e) {
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

// ====== LINE Client ======
const client = new line.Client(config);

// ====== アプリ ======
const app = express();

// Webhook
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

// ヘルスチェック
app.get('/', (req, res) => res.status(200).send('OK'));

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});

// ====== メインハンドラ ======
async function handleEvent(event) {
  if (event.type !== 'message') return null;

  const userId = event.source && event.source.userId ? event.source.userId : '';
  const db = readDb();
  const u = getUser(db, userId);

  // --- テキストメッセージ ---
  if (event.message.type === 'text') {
    const text = (event.message.text || '').trim();

    // ① Day7ボタン「登録希望」：登録受付フローに入れない（ここが最重要）
    if (text === '登録希望') {
      u.state = 'idle'; // 必ず受付フローを解除
      writeDb(db);

      // 紹介者へ通知
      await notifyIntroducerIfPossible({
        registrantUserId: userId,
        registrantName: u.name,
        registrantFlp: u.flp,
      });

      // 登録者へ自動返信（設計通りの3点）
      const registrantFlpLine = u.flp ? `③ 登録者のFLP番号：${u.flp}` : `③ 登録者のFLP番号：未入力（この後、FLP番号を返信してください）`;

      return client.replyMessage(event.replyToken, [
        {
          type: 'text',
          text:
            `【登録希望を受け付けました】\n` +
            `以下を自動で共有します。\n\n` +
            `① 紹介者氏名：${INTRODUCER_NAME}\n` +
            `② 紹介者のFLP番号：${INTRODUCER_FLP}\n` +
            `${registrantFlpLine}\n\n` +
            `※次のステップに進むには「3点をLINEで返信する」ボタンから案内に従ってください。`,
        },
      ]);
    }

    // ② Day7ボタン「3点をLINEで返信する」：案内だけ（自動で受付開始しない）
    if (text === '3点をLINEで返信する') {
      // 受付開始は「登録」で開始（現状の思想に合わせる）
      u.state = 'idle';
      writeDb(db);

      return client.replyMessage(event.replyToken, [
        { type: 'text', text: '案内に従ってください。\n「登録」と送ると開始します。' },
      ]);
    }

    // ③ 受付開始キーワード
    if (text === '登録') {
      u.state = 'await_name';
      writeDb(db);

      return client.replyMessage(event.replyToken, [
        { type: 'text', text: '【登録受付を開始します】\n① 氏名 を入力してください' },
      ]);
    }

    // ④ 状態機械：登録受付フロー
    if (u.state === 'await_name') {
      u.name = text;
      u.state = 'await_flp';
      writeDb(db);

      return client.replyMessage(event.replyToken, [
        { type: 'text', text: 'ありがとうございます。\n② FLP番号 を入力してください' },
      ]);
    }

    if (u.state === 'await_flp') {
      u.flp = text;
      u.state = 'await_image';
      writeDb(db);

      return client.replyMessage(event.replyToken, [
        { type: 'text', text: '③ 最後に【購入画面のスクリーンショット】を画像で送ってください。' },
      ]);
    }

    // その他：何もしない（誤作動防止）
    writeDb(db);
    return null;
  }

  // --- 画像メッセージ ---
  if (event.message.type === 'image') {
    // 登録受付フロー中だけ反応
    if (u.state !== 'await_image') {
      writeDb(db);
      return client.replyMessage(event.replyToken, [
        { type: 'text', text: '画像を受信しました。\n登録受付を開始する場合は「登録」と送ってください。' },
      ]);
    }

    // スクショID（message.id）を保存
    u.lastImageId = event.message.id || '';
    u.state = 'completed';
    writeDb(db);

    // 紹介者へ「登録情報が揃った」通知
    await notifyIntroducerIfPossible({
      registrantUserId: userId,
      registrantName: u.name,
      registrantFlp: u.flp,
      screenshotId: u.lastImageId,
      completed: true,
    });

    // 登録者へ完了メッセージ
    return client.replyMessage(event.replyToken, [
      { type: 'text', text: '画像を受け取りました。ありがとうございます。\n【登録情報が揃いました】\n・氏名\n・FLP番号\n・購入画面スクリーンショット\n\n紹介者が確認後、VSHを譲渡します。' },
      {
        type: 'text',
        text:
          `【登録完了】\n` +
          `氏名：${u.name}\n` +
          `FLP：${u.flp}\n` +
          `スクショID：${u.lastImageId}\n` +
          `userId：${userId}`,
      },
    ]);
  }

  // その他メッセージタイプは無視
  writeDb(db);
  return null;
}

// ====== 紹介者通知 ======
async function notifyIntroducerIfPossible(payload) {
  // 固定紹介者userIdが設定されていないなら通知しない（落ちない設計）
  if (!INTRODUCER_USER_ID) return;

  const {
    registrantUserId,
    registrantName = '',
    registrantFlp = '',
    screenshotId = '',
    completed = false,
  } = payload;

  const head = completed ? '【登録情報が揃いました】' : '【登録希望が届きました】';

  const lines = [
    head,
    `登録者userId：${registrantUserId}`,
    registrantName ? `登録者氏名：${registrantName}` : '登録者氏名：（未入力）',
    registrantFlp ? `登録者FLP：${registrantFlp}` : '登録者FLP：（未入力）',
  ];

  if (completed) {
    lines.push(screenshotId ? `スクショID：${screenshotId}` : 'スクショID：（不明）');
    lines.push('確認後、VSH譲渡を実施してください。');
  } else {
    lines.push('登録者へ紹介者情報を自動送信しました。');
  }

  try {
    await client.pushMessage(INTRODUCER_USER_ID, [{ type: 'text', text: lines.join('\n') }]);
  } catch (e) {
    console.error('pushMessage failed:', e);
  }
}
