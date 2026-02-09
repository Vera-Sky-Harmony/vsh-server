const express = require("express");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;

// JSON受信
app.use(bodyParser.json());

// ✅ pages フォルダを静的公開（←これが無いと Error）
app.use("/pages", express.static("pages"));

// 確認用トップ
app.get("/", (req, res) => {
  res.send("VSH Server is running");
});

// Webhook（今は空でOK：Day7は後で統合）
app.post("/webhook", (req, res) => {
  res.sendStatus(200);
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`VSH server running on port ${PORT}`);
});
