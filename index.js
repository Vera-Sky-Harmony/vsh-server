import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  INTRODUCER_NAME,
  INTRODUCER_FLP,
  ADMIN_NOTIFY_USER_ID,
  ADMIN_TOKEN,
  DAY7_2_IMAGE_URL,
  FLP_OFFICIAL_URL,
  ENTRY_GUIDE_URL,
  PORT,
} = process.env;

if (!CHANNEL_ACCESS_TOKEN || !CHANNEL_SECRET) {
  console.error("ENV不足");
  process.exit(1);
}

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

app.use(express.json());

/* =============================
   ヘルスチェック
============================= */
app.get("/", (req, res) => {
  res.send("VSH Server Running");
});

/* =============================
   Webhook
============================= */
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const signature = req.headers["x-line-signature"];
    const hash = crypto
      .createHmac("sha256", CHANNEL_SECRET)
      .update(req.body)
      .digest("base64");

    if (hash !== signature) {
      return res.status(401).send("署名不一致");
    }

    const body = JSON.parse(req.body.toString());
    const events = body.events || [];

    for (const event of events) {
      if (!event.source?.userId) continue;
      const userId = event.source.userId;

      /* =============================
         友だち追加（followイベント）
      ============================= */
      if (event.type === "follow") {
        await client.pushMessage(userId, {
          type: "text",
          text:
            "Vera Sky Harmonyへようこそ。\n\n" +
            "まずはDay0からご覧ください。\n" +
            "https://vsh-server.onrender.com/pages/day0.html",
        });
        continue;
      }

      /* =============================
         テキスト受信
      ============================= */
      if (event.type === "message" && event.message.type === "text") {
        const text = event.message.text.trim();

        /* ===== 登録希望 ===== */
        if (text === "登録希望") {

          /* 黄色画面 */
          await client.pushMessage(userId, {
            type: "flex",
            altText: "登録を開始しますか？",
            contents: {
              type: "bubble",
              body: {
                type: "box",
                layout: "vertical",
                contents: [
                  {
                    type: "text",
                    text: "登録を開始しますか？",
                    weight: "bold",
                    size: "lg",
                  },
                  {
                    type: "button",
                    style: "primary",
                    margin: "md",
                    action: {
                      type: "message",
                      label: "登録希望",
                      text: "登録希望確定",
                    },
                  },
                ],
              },
            },
          });

          continue;
        }

        /* ===== 登録希望確定 → 青画面 ===== */
        if (text === "登録希望確定") {

          await client.pushMessage(userId, {
            type: "flex",
            altText: "登録を進めてください",
            contents: {
              type: "bubble",
              hero: {
                type: "image",
                url: DAY7_2_IMAGE_URL,
                size: "full",
                aspectMode: "cover",
                aspectRatio: "20:13",
              },
              body: {
                type: "box",
                layout: "vertical",
                contents: [
                  {
                    type: "text",
                    text:
                      "7日間ありがとうございました。\n\n" +
                      "あなたが登録すると同時にVSHがプレゼントされます。",
                    wrap: true,
                  },
                  {
                    type: "button",
                    style: "primary",
                    margin: "md",
                    action: {
                      type: "message",
                      label: "3点をLINEで返信する",
                      text: "3点返信開始",
                    },
                  },
                ],
              },
            },
          });

          continue;
        }

        /* ===== 3点返信開始 ===== */
        if (text === "3点返信開始") {
          await client.pushMessage(userId, {
            type: "text",
            text:
              "① 氏名を入力してください\n" +
              "② FLP番号を入力してください\n" +
              "③ 購入スクリーンショットを送信してください",
          });
          continue;
        }
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    res.status(200).send("ERROR");
  }
});

app.listen(PORT || 10000, () => {
  console.log("VSH Server started");
});
