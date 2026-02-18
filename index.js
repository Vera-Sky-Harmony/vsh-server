import express from "express";
import { middleware, Client } from "@line/bot-sdk";

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const app = express();
const client = new Client(config);

const threePointsState = new Map();

app.post("/webhook", middleware(config), async (req, res) => {

  try {

    for (const ev of req.body.events) {

      if (ev.type !== "message") continue;
      if (ev.message.type !== "text") continue;

      const userId = ev.source.userId;
      const text = ev.message.text.trim();

      /* 登録希望 */
      if (text === "登録希望") {

        await client.replyMessage(ev.replyToken, [
          {
            type: "image",
            originalContentUrl:
              "https://res.cloudinary.com/dxegzwukb/image/upload/v1771291127/X41_s9psh6.png",
            previewImageUrl:
              "https://res.cloudinary.com/dxegzwukb/image/upload/v1771291127/X41_s9psh6.png",
          },
          {
            type: "flex",
            altText: "スタート",
            contents: {
              type: "bubble",
              body: {
                type: "box",
                layout: "vertical",
                contents: [
                  {
                    type: "text",
                    text:
                      "【VSH登録受付】\n\n" +
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
          },
        ]);

        continue;
      }

      if (text === "VSH_START") {

        threePointsState.set(userId, { step: 1 });

        await client.replyMessage(ev.replyToken, {
          type: "text",
          text: "① 氏名を入力してください",
        });

        continue;
      }

      const state = threePointsState.get(userId);

      if (state?.step === 1) {

        state.step = 2;

        await client.replyMessage(ev.replyToken, {
          type: "text",
          text: "② あなたのFLP番号を入力してください",
        });

        continue;
      }

      if (state?.step === 2) {

        threePointsState.delete(userId);

        await client.replyMessage(ev.replyToken, {
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
                    "FLP登録確認後、VSHを譲渡いたします。",
                  wrap: true,
                },
              ],
            },
          },
        });

        continue;
      }

    }

    res.status(200).end();

  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

app.listen(process.env.PORT || 10000, () => {
  console.log("VSH reply版 起動");
});
