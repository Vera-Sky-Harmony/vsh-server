import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  ADMIN_NOTIFY_USER_ID,
  DAY7_2_IMAGE_URL,
  PORT,
} = process.env;

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* =====================================
   🔵 静的ページ完全復旧設定
===================================== */

// ルート直下
app.use(express.static(__dirname));

// /ページ/
app.use("/ページ", express.static(path.join(__dirname, "ページ")));

// /pages/
app.use("/pages", express.static(path.join(__dirname, "ページ")));

// 動作確認用
app.get("/test", (_req, res) => {
  res.send("VSH Static OK");
});

// ルート確認
app.get("/", (_req, res) => {
  res.send("VSH server running");
});

/* =====================================
   3点ステート管理
===================================== */

const threePointsState = new Map();

/* =====================================
   Webhook
===================================== */

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
    await handleWebhook(body);

    res.status(200).end();
  } catch (e) {
    console.error("Webhook error:", e);
    res.status(200).end();
  }
});

/* =====================================
   Webhook本体
===================================== */

async function handleWebhook(body) {
  for (const ev of body.events || []) {
    if (!ev?.source?.userId) continue;

    const userId = ev.source.userId;

    if (ev.type === "message" && ev.message.type === "text") {
      const text = ev.message.text.trim();

      console.log("受信:", text);

      // 🔥 登録希望トリガー（強化版）
      if (text.includes("登録希望")) {
        await sendDay7_2(userId);
        return;
      }

      // 3点開始
      if (text === "3点返信開始") {
        threePointsState.set(userId, { step: 1 });

        await client.replyMessage(ev.replyToken, {
          type: "text",
          text: "① 氏名を入力してください",
        });
        return;
      }

      const state = threePointsState.get(userId);

      if (state?.step === 1) {
        state.name = text;
        state.step = 2;

        await client.replyMessage(ev.replyToken, {
          type: "text",
          text: "② あなたのFLP番号を入力してください",
        });
        return;
      }

      if (state?.step === 2) {
        state.flp = text;
        threePointsState.delete(userId);

        await client.replyMessage(ev.replyToken, {
          type: "text",
          text: "登録確認が完了しました。",
        });

        if (ADMIN_NOTIFY_USER_ID) {
          await client.pushMessage(ADMIN_NOTIFY_USER_ID, {
            type: "text",
            text: `【登録通知】\n氏名:${state.name}\nFLP:${state.flp}`,
          });
        }

        return;
      }
    }
  }
}

/* =====================================
   Day7-2送信
===================================== */

async function sendDay7_2(userId) {
  await client.pushMessage(userId, [
    {
      type: "flex",
      altText: "3点返信開始",
      contents: {
        type: "bubble",
        hero: {
          type: "image",
          url: DAY7_2_IMAGE_URL,
          size: "full",
          aspectRatio: "20:13",
          aspectMode: "cover",
        },
        body: {
          type: "box",
          layout: "vertical",
          spacing: "md",
          contents: [
            {
              type: "text",
              text: "登録が終わったら、ここから3点返信を開始します",
              wrap: true,
            },
            {
              type: "button",
              style: "primary",
              action: {
                type: "message",
                label: "3点をLINEで返信する",
                text: "3点返信開始",
              },
            },
          ],
        },
      },
    },
  ]);
}

/* =====================================
   起動
===================================== */

app.listen(Number(PORT || 10000), () => {
  console.log("=================================");
  console.log("VSH Complete Stable Running");
  console.log("PORT:", PORT);
  console.log("=================================");
});
