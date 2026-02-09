import express from "express";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
