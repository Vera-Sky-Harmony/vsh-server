import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";
import path from "path";
import { fileURLToPath } from "url";

/* =========================
   基本設定
========================= */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  ADMIN_NOTIFY_USER_ID,
  PORT,
} = process.env;

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* =========================
   🔵 Day0～Day7-1 静的配信
========================= */

/* フォルダ名は必ず「ページ」 */
app.use("/ページ", express.static(path.join(__dirname, "ページ")));

/* 動作確認 */
app.get("/test", (_req, res) => {
  res.send("VSH Static OK");
});

/* =========================
   ルート確認
========================= */

app.get("/", (_req, res) => {
  res.send("VSH Server Running");
});

/* =========================
   LINE Webhook（Day7-2 / Day7-3）
========================= */

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
  } catch (err) {
    console.error("Webhook Error:", err);
    res.status(500).end();
  }
});

/* =========================
   Day7-2 / Day7-3 処理
========================= */

const threePointsState = new Map();

async function handleWebhook(body) {
  for (const ev of body.events || []) {
    if (!ev?.source?.userId) continue;

    const userId = ev.source.userId;

    if (ev.type === "message" && ev.message.type === "text") {
      const text = ev.message.text.trim();

      /* Day7-2 */
      if (text === "登録希望") {
        await client.pushMessage(userId, {
          type: "text",
          text:
            "【登録受付を開始します】\n\n" +
            "① 氏名 を入力してください",
        });

        threePointsState.set(userId, { step: 1 });
        return;
      }

      const state = threePointsState.get(userId);

      /* ① 氏名 */
      if (state?.step === 1) {
        state.name = text;
        state.step = 2;

        await client.pushMessage(userId, {
          type: "text",
          text: "② FLP番号 を入力してください",
        });

        return;
      }

      /* ② FLP番号 */
      if (state?.step === 2) {
        state.flp = text;
        state.step = 3;

        await client.pushMessage(userId, {
          type: "text",
          text:
            "③ 購入画面のスクリーンショットを送ってください",
        });

        return;
      }
    }

    /* ③ スクリーンショット受信 */
    if (ev.type === "message" && ev.message.type === "image") {
      const userId = ev.source.userId;
      const state = threePointsState.get(userId);

      if (state?.step === 3) {
        await client.pushMessage(userId, {
          type: "text",
          text:
            "登録情報を受け取りました。\n" +
            "確認後、VSHを譲渡いたします。",
        });

        /* 管理者通知 */
        if (ADMIN_NOTIFY_USER_ID) {
          await client.pushMessage(ADMIN_NOTIFY_USER_ID, {
            type: "text",
            text:
              "【新規登録通知】\n" +
              `氏名: ${state.name}\n` +
              `FLP: ${state.flp}`,
          });
        }

        threePointsState.delete(userId);
      }
    }
  }
}

/* =========================
   サーバー起動
========================= */

const port = Number(PORT) || 10000;

app.listen(port, () => {
  console.log("=================================");
  console.log("VSH Day0～Day7-3 稼働中");
  console.log("PORT:", port);
  console.log("=================================");
});
