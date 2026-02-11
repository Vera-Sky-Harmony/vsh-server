import express from "express";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// 静的公開
app.use("/pages", express.static(path.join(__dirname, "pages")));

app.get("/", (req, res) => {
  res.send("VSH Server is running");
});

// ===============================
// LINE Webhook
// ===============================
app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events;

    if (!events) {
      return res.sendStatus(200);
    }

    for (const event of events) {
      if (
        event.type === "message" &&
        event.message.type === "text" &&
        event.message.text === "登録希望"
      ) {
        const replyToken = event.replyToken;

        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: replyToken,
            messages: [
              {
                type: "text",
                text: "登録受付を開始します。\n① 氏名を入力してください"
              }
            ]
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
            }
          }
        );
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook Error:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`VSH server running on port ${PORT}`);
});
