"use strict"; const express = require('express'); const line = require('@line/bot-sdk'); // LINE Bot SDK設定 const config = { channelSecret: process.env.CHANNEL_SECRET, channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN }; // LINEクライアントの作成 const client = new line.Client(config); // 管理者（紹介者）のLINEユーザーID（Renderの環境変数で設定する） const ADMIN_USER_ID = process.env.ADMIN_USER_ID; // Expressアプリのセットアップ const app = express(); // セッション管理（ユーザーごとの登録フロー状態を保持） const sessions = {}; function findOrCreateSession(userId) { if (!sessions[userId]) { sessions[userId] = { step: null, data: {} }; } return sessions[userId]; } // Webhookエンドポイント app.post('/webhook', line.middleware(config), (req, res) => { Promise .all(req.body.events.map(handleEvent)) .then(result => res.json(result)) .catch(err => { console.error('Error handling events:', err); res.status(500).end(); }); }); // イベント処理関数 async function handleEvent(event) { // 対象以外のイベントタイプは無視 if (event.type !== 'message' && event.type !== 'postback') { return Promise.resolve(null); } const userId = event.source.userId; const session = findOrCreateSession(userId); // メッセージイベントの処理 if (event.type === 'message' && event.message.type === 'text') { const userMessage = event.message.text; // 1. 「登録希望」ボタン（メッセージアクションとして送信された場合） if (userMessage === '登録希望') { // 「登録希望」押下時の処理を実行（管理者通知＋ユーザーへの案内返信） return handleRegisterRequest(userId, event.replyToken); } // 2. 「3点をLINEで返信する」ボタン（メッセージアクションとして送信された場合） if (userMessage === '3点をLINEで返信する') { // 登録フロー開始処理を実行（セッション開始＋案内メッセージ） return handleStartRegistration(userId, event.replyToken); } // 3. 登録フロー進行中の入力処理 if (session.step === 'AWAITING_NAME') { // 氏名を受信 session.data.name = userMessage; session.step = 'AWAITING_FLP'; const replyText = 'FLP番号を送ってください。'; // 次にFLP番号を要求 return client.replyMessage(event.replyToken, { type: 'text', text: replyText }); } else if (session.step === 'AWAITING_FLP') { // FLP番号を受信 session.data.flp = userMessage; session.step = 'AWAITING_IMAGE'; const replyText = '登録用の画像を送ってください。'; // 次に画像を要求 return client.replyMessage(event.replyToken, { type: 'text', text: replyText }); } else if (session.step === 'AWAITING_IMAGE') { // 画像待ちの状態でテキストが送られてきた場合 const replyText = '画像を送ってください。'; // 画像送信をリマインド return client.replyMessage(event.replyToken, { type: 'text', text: replyText }); } else { // 特にハンドリングしないメッセージ（通常は無視かエコー） return Promise.resolve(null); } } // 画像メッセージイベントの処理（登録フローで画像待ちの場合） if (event.type === 'message' && event.message.type === 'image') { if (session.step === 'AWAITING_IMAGE') { // ユーザーが登録用の画像を送信した session.data.imageId = event.message.id; // 画像メッセージIDを保存 const name = session.data.name || ''; const flp = session.data.flp || ''; // 管理者へ登録情報を通知（氏名・FLP番号・ユーザーID等） if (ADMIN_USER_ID) { const adminText = `登録者から情報が届きました。\n氏名: ${name}\nFLP番号: ${flp}\nユーザーID: ${userId}\n※画像データ受信済み`; client.pushMessage(ADMIN_USER_ID, { type: 'text', text: adminText }) .catch(err => console.error('Failed to push message to admin:', err)); } // ユーザーへ受付完了メッセージ const thankYouMessage = { type: 'text', text: '登録情報を受け付けました。ありがとうございました。' }; // セッション状態をリセット sessions[userId] = { step: null, data: {} }; return client.replyMessage(event.replyToken, thankYouMessage); } else { // 想定外の画像メッセージは無視 return Promise.resolve(null); } } // ポストバックイベントの処理 if (event.type === 'postback') { const data = event.postback.data; // 1. 「登録希望」ボタン（ポストバックアクションの場合） if (data === 'register_request' || data === '登録希望') { return handleRegisterRequest(userId, event.replyToken); } // 2. 「3点をLINEで返信する」ボタン（ポストバックアクションの場合） if (data === 'start_registration' || data === '3点をLINEで返信する') { return handleStartRegistration(userId, event.replyToken); } // その他のポストバックデータがあればここで処理 } return Promise.resolve(null); } // 「登録希望」ボタン押下時の処理：管理者通知＋ユーザーへの案内返信 function handleRegisterRequest(userId, replyToken) { // 管理者（紹介者）に登録希望の通知をプッシュ送信 if (ADMIN_USER_ID) { const adminMsg = { type: 'text', text: '登録希望者が来ました。' }; client.pushMessage(ADMIN_USER_ID, adminMsg) .catch(err => console.error('Failed to push admin notification:', err)); } // ユーザーへ登録方法の案内メッセージを返信（仮の文面） const userMsg = { type: 'text', text: '登録方法をご案内します。こちらから順に対応してください。' }; // ※上記の案内メッセージ文言は仮置きです（必要に応じて変更してください） return client.replyMessage(replyToken, userMsg); } // 「3点をLINEで返信する」ボタン押下時の処理：登録フロー開始 function handleStartRegistration(userId, replyToken) { // ユーザーのセッション状態を初期化して登録フローへ移行 sessions[userId] = { step: 'AWAITING_NAME', data: {} }; // 最初の案内メッセージを送信（氏名の入力促し） const promptMsg = { type: 'text', text: '登録を開始します。氏名を送ってください。' }; return client.replyMessage(replyToken, promptMsg); } // サーバ起動 const PORT = process.env.PORT || 3000; app.listen(PORT, () => { console.log(`Server is running at Port ${PORT}`); }); const express = require('express');
const line = require('@line/bot-sdk');

// LINE Messaging APIの設定情報（環境変数から取得）
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
};

// LINE SDKクライアントを作成
const client = new line.Client(config);

// ユーザーごとのセッション情報を管理するオブジェクト（メモリ上に保持）
const sessions = {};

// Expressアプリケーションの作成
const app = express();

// Webhookエンドポイントの設定（LINEからの全てのイベントがPOSTリクエストで届く）
app.post('/webhook', line.middleware(config), (req, res) => {
  // イベント処理のPromise配列を作成し、全て処理完了後にHTTP 200レスポンスを返す
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))  // 処理結果をJSONで返信（内容は使用しない）
    .catch((err) => {
      console.error('Error handling events:', err);
      res.status(500).end();
    });
});

// Webhookイベントを処理する関数
async function handleEvent(event) {
  // メッセージイベント以外は処理をスキップ
  if (event.type !== 'message') {
    return null;
  }

  const userId = event.source.userId;           // メッセージ送信者のユーザーID
  const message = event.message;

  // ** テキストメッセージの処理 **
  if (message.type === 'text') {
    const text = message.text;

    // 「登録希望」または「3点をLINEで返信する」のメッセージを受信した場合：登録フロー開始
    if (text === '登録希望' || text === '3点をLINEで返信する') {
      // ユーザーのセッションを新規に作成（既存セッションがあれば上書き）
      sessions[userId] = { step: 'waitingName', name: null, flp: null };
      // 初期応答メッセージを作成
      const replyText = '登録受付を開始します。\nまず、氏名を送信してください。';
      // ユーザーに初期メッセージを返信（登録開始案内と氏名入力の依頼）
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: replyText }]
      });
      return null;
    }

    // セッションが存在する場合（登録フロー進行中のユーザーからのメッセージ）
    const session = sessions[userId];
    if (session) {
      if (session.step === 'waitingName') {
        // 1つ目の情報（氏名）を受け取った場合
        session.name = text;                  // 氏名を保存
        session.step = 'waitingFLP';          // 次のステップへ
        // FLP番号の入力を促すメッセージを返信
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '次にFLP番号を送信してください。' }]
        });
        return null;
      } else if (session.step === 'waitingFLP') {
        // 2つ目の情報（FLP番号）を受け取った場合
        session.flp = text;                   // FLP番号を保存
        session.step = 'waitingImage';        // 次のステップへ
        // スクリーンショット画像の送信を促すメッセージを返信
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '最後にスクリーンショット（画像）を送信してください。' }]
        });
        return null;
      } else if (session.step === 'waitingImage') {
        // スクリーンショット待ちの状態でテキストメッセージを受信した場合（エラーハンドリング）
        // 画像の送信を促すリマインドメッセージを返信
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '申し訳ありません。スクリーンショットの画像を送信してください。' }]
        });
        return null;
      }
    }

    // セッションがない状態でその他のテキストを受信した場合（ここでは特に処理しない）
    return null;
  }

  // ** 画像メッセージの処理 **
  if (message.type === 'image') {
    const session = sessions[userId];
    // セッションが存在し、現在スクリーンショット待ちの段階である場合
    if (session && session.step === 'waitingImage') {
      // 3つ目の情報（スクリーンショット画像）を受信したので、登録情報が全て揃った
      const imageMessageId = message.id;   // 画像メッセージのIDを取得
      session.screenshotId = imageMessageId;

      // 登録者（ユーザー）への確認メッセージを作成
      const confirmText =
        `登録受付が完了しました。\n` +
        `氏名: ${session.name}\n` +
        `FLP番号: ${session.flp}\n` +
        `スクリーンショットを受け付けました。\n` +
        `ご登録ありがとうございました。`;
      // ユーザーへ登録内容の確認メッセージを返信
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: confirmText }]
      });

      // 管理者（紹介者）への通知メッセージを作成
      const adminText =
        `新規登録希望者から以下の情報を受け取りました。\n` +
        `氏名: ${session.name}\n` +
        `FLP番号: ${session.flp}\n` +
        `スクリーンショットID: ${session.screenshotId}\n` +
        `ユーザーID: ${userId}`;
      // 管理者へプッシュメッセージを送信（環境変数 ADMIN_USER_ID に設定されたユーザーIDに通知）
      await client.pushMessage({
        to: process.env.ADMIN_USER_ID,
        messages: [{ type: 'text', text: adminText }]
      });

      // （補足）紹介者の氏名や紹介者FLP番号等の自動送信は現在保留（将来的に追加予定）

      // セッション情報をクリア（登録フロー完了）
      delete sessions[userId];
      return null;
    } else {
      // 登録フロー外で画像メッセージを受信した場合の対応
      // （ここではエラーメッセージを返信する）
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: '申し訳ありません。現在登録受付を行っておりません。' }]
      });
      return null;
    }
  }

  // 上記以外のメッセージタイプは処理しない
  return null;
}

// サーバーを起動して指定のポートで待機
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running and listening on port ${port}`);
});


