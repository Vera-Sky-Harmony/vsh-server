const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
app.use(express.json());

const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;

const PORT = process.env.PORT || 10000;

app.post("/webhook", async (req, res) => {
  const signature = req.headers["x-line-signature"];
  const body = JSON.stringify(req.body);

  const hash = crypto
    .createHmac("SHA256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");

  if (signature !== hash) {
    console.log("❌ 署名エラー");
    return res.status(403).send("Invalid signature");
  }

  const events = req.body.events;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;
      const replyToken = event.replyToken;

      if (userMessage === "登録希望") {
        try {
          await axios.post(
            "https://api.line.me/v2/bot/message/reply",
            {
              replyToken: replyToken,
              messages: [
                {
                  type: "text",
                  text: "🟡 Day7-1：登録受付を開始します"
                },
                {
                  type: "text",
                  text: "🔵 Day7-2：①氏名 ②FLP番号 ③購入スクショを送信してください"
                }
              ]
            },
            {
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`
              }
            }
          );

          console.log("✅ 返信成功");
        } catch (error) {
          console.log("❌ LINE送信エラー");
          console.log(error.response?.data || error.message);
        }
      }
    }
  }

  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("VSH Server Running");
});

app.listen(PORT, () => {
  console.log(`🚀 VSHサーバー起動 ポート${PORT}`);
});
