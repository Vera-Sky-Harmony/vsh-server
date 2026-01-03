import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Vera Sky Harmony Server is running");
});

app.post("/webhook", (req, res) => {
  console.log("Webhook received:", JSON.stringify(req.body, null, 2));

  res.status(200).json({
    replyToken: req.body.events?.[0]?.replyToken,
    messages: [
      {
        type: "text",
        text: "自動返信テスト成功です"
      }
    ]
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
