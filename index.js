import express from "express";
import { middleware, Client } from "@line/bot-sdk";

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const app = express();
const client = new Client(config);

// 3点入力状態管理
const threePointsState = new Map();

app.post("/webhook", middleware(config), async (req, res) => {
  try {

    for (const ev of req.body.events) {

      console.log("受信イベント:", ev.type, ev.message?.text);

      if (ev.type !== "message") continue;
      if (ev.message.type !== "text") continue;

      const userId = ev.source.userId;
      const text = ev.message.text.trim();

      /* ===============================
         登録希望
      =============================== */
      if (text === "登録希望") {

        console.log("登録希望受信");

        await client.pushMessage(userId, {
          type: "image",
          originalContentUrl:
            "https://res.cloudinary.com/dxegzwukb/image/upload/v1771291127/X41_s9psh6.png",
          previewImageUrl:
            "https://res.cloudinary.com/dxegzwukb/image/upload/v1771291127/X41_s9psh6.png",
        });

        await client.pushMessage(userId, {
          type: "flex",
          altText: "スタート",
          contents: {
            type: "bubble",
            body: {
              type: "box",
              layout: "vertical",
              spacing: "md",
              contents: [
                {
                  type: "text",
                  text:
                    "【VSH登録受付】\n\n" +
                    "登録に必要な以下の3点をお渡しします。\n\n" +
                    "① 紹介者の氏名\n" +
                    "② 紹介者のFLP番号\n" +
                    "③ あなたのFLP番号",
                  wrap: true,
                },
                {
                  type: "button",
                  style: "primary",
                  action: {
                    type: "message",
                    label: "スタート",
                    text: "VSH_START",
                  },
                },
              ],
            },
          },
        });

        continue;
      }

      /* ===============================
         スタート押下
      =============================== */
      if (text === "VSH_START") {

        console.log("スタート押下");

        threePointsState.set(userId, { step: 1 });

        await client.pushMessage(userId, {
          type: "text",
          text: "① 氏名を入力してください",
        });

        continue;
      }

      const state = threePointsState.get(userId);

      /* ===============================
         ① 氏名入力
      =============================== */
      if (state?.step === 1) {

        console.log("氏名受信:", text);

        state.name = text;
        state.step = 2;

        await client.pushMessage(userId, {
          type: "text",
          text: "② あなたのFLP番号を入力してください",
        });

        continue;
      }

      /* ===============================
         ② FLP番号入力
      =============================== */
      if (state?.step === 2) {

        console.log("FLP番号受信:", text);

        await client.pushMessage(userId, {
          type: "flex",
          altText: "登録ありがとうございます",
          contents: {
            type: "bubble",
            hero: {
              type: "image",
              url:
                "https://res.cloudinary.com/dxegzwukb/image/upload/v1769679233/Day7-1_dpjx3u.png",
              size: "full",
              aspectRatio: "1:1",
              aspectMode: "cover",
            },
            body: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "text",
                  text:
                    "登録を受け付けました。\n\n" +
                    "FLPのシステムへの登録完了が確認できるまで\n" +
                    "数日お待ちください。\n\n" +
                    "確認でき次第VSHを譲渡いたします。",
                  wrap: true,
                },
              ],
            },
          },
        });

        threePointsState.delete(userId);
        continue;
      }

    }

    res.status(200).end();

  } catch (err) {
    console.error("エラー発生:", err);
    res.status(500).end();
  }
});

app.get("/", (req, res) => {
  res.send("VSHサーバー稼働中");
});

app.listen(process.env.PORT || 10000, () => {
  console.log("VSH middleware最終版 起動");
});
