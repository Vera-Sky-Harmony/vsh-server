import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

const { CHANNEL_ACCESS_TOKEN, CHANNEL_SECRET, PORT } = process.env;

const app = express();

// 重要：raw ではなく json 使用
app.use(express.json());

const client = new Client({
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
});

const threePointsState = new Map();

app.post("/webhook", async (req, res) => {
  try {
    const signature = req.headers["x-line-signature"];

    const hash = crypto
      .createHmac("sha256", CHANNEL_SECRET)
      .update(JSON.stringify(req.body))
      .digest("base64");

    if (signature !== hash) {
      console.log("署名エラー");
      return res.status(401).end();
    }

    const body = req.body;

    for (const ev of body.events || []) {

      if (ev.type !== "message") continue;
      if (ev.message.type !== "text") continue;

      const userId = ev.source.userId;
      const text = ev.message.text.trim();

      /* ======================
         登録希望
      ====================== */
      if (text === "登録希望") {

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

      /* ======================
         スタート押下
      ====================== */
      if (text === "VSH_START") {

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
    console.error(err);
    res.status(500).end();
  }
});

app.listen(Number(PORT || 10000), () => {
  console.log("VSH 安定版起動");
});
