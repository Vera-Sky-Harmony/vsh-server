import express from "express";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@line/bot-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function must(v, name) {
  if (!v) {
    console.error(`Missing ENV: ${name}`);
    process.exit(1);
  }
}
must(CHANNEL_ACCESS_TOKEN, "CHANNEL_ACCESS_TOKEN");
must(CHANNEL_SECRET, "CHANNEL_SECRET");

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

app.use("/pages", express.static(path.join(__dirname, "pages")));

app.get("/", (req, res) => {
  res.send("VSH Server Running");
});

/* =========================
   友だち追加時 自動Day0送信
========================= */
async function sendDay0(userId) {
  await client.pushMessage(userId, [
    {
      type: "text",
      text:
        "Vera Sky Harmonyへようこそ。\n\nまずはDay0からご覧ください。\n\nhttps://vsh-server.onrender.com/pages/day0.html",
    },
  ]);
}

/* =========================
   Webhook
========================= */
app.post(
  "/webhook",
  express.raw({ type: "*/*" }),
  async (req, res) => {
    try {
      const signature = req.headers["x-line-signature"];
      const hash = crypto
        .createHmac("sha256", CHANNEL_SECRET)
        .update(req.body)
        .digest("base64");

      if (hash !== signature) {
        return res.status(401).send("Bad signature");
      }

      const body = JSON.parse(req.body.toString());

      for (const ev of body.events) {
        if (!ev.source?.userId) continue;
        const userId = ev.source.userId;

        /* ===== 友だち追加 ===== */
        if (ev.type === "follow") {
          await sendDay0(userId);
        }

        /* ===== テキスト受信 ===== */
        if (ev.type === "message" && ev.message.type === "text") {
          const text = ev.message.text.trim();

          /* Day7-1 */
          if (text === "登録希望") {
            await client.pushMessage(userId, [
              buildDay7Flex(),
            ]);
          }

          /* Day7-2 */
          if (text === "3点返信開始") {
            await client.pushMessage(userId, [
              {
                type: "text",
                text:
                  "【3点返信を開始します】\n① 氏名を入力してください",
              },
            ]);
          }
        }
      }

      res.sendStatus(200);
    } catch (err) {
      console.error(err);
      res.sendStatus(200);
    }
  }
);

/* =========================
   Day7-1（黄色画面）
========================= */
function buildDay7Flex() {
  return {
    type: "flex",
    altText: "登録希望",
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
        spacing: "md",
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
            action: {
              type: "message",
              label: "登録希望",
              text: "登録希望",
            },
          },
        ],
      },
    },
  };
}

app.listen(PORT || 10000, () => {
  console.log("VSH running");
});
