const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// JSON受信（Webhook用）
app.use(bodyParser.json());

// ===============================
// ✅ pages フォルダを正しく静的公開
// ===============================
app.use(
  "/pages",
  express.static(path.join(__dirname, "pages"))
);

// 動作確認用
app.get("/", (req, res) => {
  res.send("VSH Server is running");
});

// Webhook（今は空でOK）
app.post("/webhook", (req, res) => {
  res.sendStatus(200);
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`VSH server running on port ${PORT}`);
});
