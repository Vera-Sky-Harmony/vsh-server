// src/index.js  (ESM対応・全面差し替え版)
import express from "express";

const app = express();

// LINEのWebhookはJSONで届く
app.use(express.json());

// ヘルスチェック（Render用）
app.get("/", (req, res) => res.status(200).send("ok"));
app.get("/health", (req, res) => res.status(200).json({ ok: true }));

// Webhook受信
app.post("/callback", async (req, res) => {
  try {
    // まずは「届いている事」を最優先で確認するためログに出す
    console.log("=== LINE WEBHOOK RECEIVED ===");
    console.log(JSON.stringify(req.body, null, 2));

    const events = req.body?.events || [];
    for (const ev of events) {
      const userId = ev?.source?.userId;
      const text = ev?.message?.text;

      if (userId) {
        console.log("source.userId =", userId);
      }
      if (text) {
        console.log("message.text =", text);
      }

      // 管理者へ通知（必要なら）
      // ADMIN_NOTIFY_USER_ID を設定すると、そのIDに「誰から何が来たか」通知できる土台
      // ※実際に通知送信する場合は、CHANNEL_ACCESS_TOKEN が必須
      // ここでは「まずWebhookが動く」を優先し、送信は後でONにします
    }

    // LINEには必ず 200 を返す（返さないと再送されることがあります）
    return res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e);
    return res.sendStatus(500);
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log("Server running on port", port);
});
