import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  PORT,
} = process.env;

const app = express();

const client = new Client({
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
});

const threePointsState = new Map();

app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const signature = req.headers["x-line-signature"];

    const hash = crypto
      .createHmac("sha256", CHANNEL_SECRET)
      .update(req.body)
      .digest("base64");

    if (signature !== hash) {
      return res.status(401).end();
    }

    const body = JSON.parse(req.body.toString());

    for (const ev of body.events || []) {
      if (!ev?.source?.userId) continue;

      const userId = ev.source.userId;

      if (ev.type === "message" && ev.message.type === "text") {
        const text = ev.message.text.trim();

        /* =======================
           Day7-2
        ======================== */
        if (text === "登録希望") {

          // 画像送信
          await client.pushMessage(userId, {
            type: "image",
            originalContentUrl:
              "https://res.cloudinary.com/dxegzwukb/image/upload/v1771291127/X41_s9psh6.png",
            previewImageUrl:
              "https://res.cloudinary.com/dxegzwukb/image/upload/v1771291127/X41_s9psh6.png",
          });

          // 従来案内文
          await client.pushMessage(userId, {
            type: "text",
            text:
              "【VSH登録受付】\n\n" +
              "あなたの決断を確認しました。\n\n" +
              "準備ができましたら\n" +
              "『3点返信開始』と送信してください。",
          });

          continue;
        }

        /* =======================
           3点開始
        ======================== */
        if (text === "3点返信開始") {
          threePointsState.set(userId, { step: 1 });

          await client.pushMessage(userId, {
            type: "text",
            text: "① 氏名を入力してください",
          });
          continue;
        }

        const state = threePointsState.get(userId);

        if (state?.step === 1) {
          state.name = text;
          state.step = 2;

          await client.pushMessage(userId, {
            type: "text",
            text: "② あなたのFLP番号を入力してください",
          });
          continue;
        }

        if (state?.step === 2) {
          state.flp = text;

          // Day7-3 Flexメッセージ
          await client.pushMessage(userId, {
            type: "flex",
            altText: "登録完了をLINEで返信する",
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
                    type: "button",
                    style: "primary",
                    action: {
                      type: "message",
                      label: "登録完了をLINEで返信する",
                      text: "登録完了",
                    },
                  },
                ],
              },
            },
          });

          threePointsState.delete(userId);
          continue;
        }
      }
    }

    res.status(200).end();
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

app.listen(Number(PORT || 10000), () => {
  console.log("Server Running");
});
