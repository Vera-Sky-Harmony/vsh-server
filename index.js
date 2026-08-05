import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/* =========================
   Admin データ
========================= */

const ADMIN_FILE = path.join(__dirname, "root-admin.json");

if (!fs.existsSync(ADMIN_FILE)) {

  fs.writeFileSync(
    ADMIN_FILE,

    JSON.stringify(
      {
        introducerName: "",
        introducerFLP: "",
        memberFLP: ""
      },
      null,
      2
    )
  );

}
const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  PORT,
} = process.env;

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* =========================
   静的ページ配信
========================= */

app.use(express.static(__dirname));
app.use("/ページ", express.static(path.join(__dirname, "ページ")));
app.use(express.json());
app.get("/test", (_req, res) => {
  res.send("VSH Static OK");
});

app.get("/", (_req, res) => {
  res.send("VSH server running");
});
/* =========================
   Admin
========================= */

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/api/admin", (_req, res) => {

  const data = JSON.parse(
    fs.readFileSync(ADMIN_FILE, "utf8")
  );

  res.json(data);

});

app.post("/api/admin", (req, res) => {

  try {

    const body = {

      introducerName:
        req.body.introducerName || "",

      introducerFLP:
        req.body.introducerFLP || "",

      flpList:
        req.body.flpList || [],

      members:
        req.body.members || []

    };

    fs.writeFileSync(

      ADMIN_FILE,

      JSON.stringify(body, null, 2),

      "utf8"

    );

    res.json({

      success: true

    });

  }

  catch (err) {

    console.error(err);

    res.status(500).json({

      success: false

    });

  }

});
/* =========================
   次の未使用FLP取得
========================= */

app.get("/api/next-flp", (_req, res) => {

  const data = JSON.parse(
    fs.readFileSync(ADMIN_FILE, "utf8")
  );

  const item = data.flpList.find(
    x => x.status === "未使用"
  );

  if (!item) {
    return res.status(404).json({
      success: false,
      message: "未使用のFLP番号がありません"
    });
  }

  res.json({
    success: true,
    introducerName: data.introducerName,
    introducerFLP: data.introducerFLP,
    myFLP: item.flp
  });

});

/* =========================
   FLP番号を使用中へ変更
========================= */

app.post("/api/use-flp", (req, res) => {

  const data = JSON.parse(
    fs.readFileSync(ADMIN_FILE, "utf8")
  );

  const item = data.flpList.find(
    x => x.flp === req.body.flp
  );

  if (!item) {

    return res.status(404).json({
      success: false
    });

  }

  item.status = "使用中";

  fs.writeFileSync(
    ADMIN_FILE,
    JSON.stringify(data, null, 2)
  );

  res.json({
    success: true
  });

});

/* =========================
   FLP番号を使用済へ変更
========================= */

app.post("/api/complete-flp", (req, res) => {

  const data = JSON.parse(
    fs.readFileSync(ADMIN_FILE, "utf8")
  );

  const item = data.flpList.find(
    x => x.flp === req.body.flp
  );

  if (!item) {

    return res.status(404).json({
      success:false
    });

  }

  item.status = "使用済";

  fs.writeFileSync(
    ADMIN_FILE,
    JSON.stringify(data,null,2)
  );

  res.json({
    success:true
  });

});
/* =========================
   第一世代登録者一覧取得
========================= */

app.get("/api/members", (_req, res) => {

  try {

    const data = JSON.parse(
      fs.readFileSync(ADMIN_FILE, "utf8")
    );

    res.json({
      success: true,
      members: data.members || []
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false,
      members: []
    });

  }

});
/* =========================
   登録受付
========================= */

app.post("/api/register", (req, res) => {

  try {

    const { name, flp } = req.body;

    if (!name || !flp) {

      return res.json({
        success: false,
        message: "氏名またはFLP番号がありません。"
      });

    }

    const data = JSON.parse(
      fs.readFileSync(ADMIN_FILE, "utf8")
    );

    const item = data.flpList.find(
      x => x.flp === flp
    );

    if (!item) {

      return res.json({
        success: false,
        message: "FLP番号が見つかりません。"
      });

    }

    item.status = "使用済";
if (!data.members) {

  data.members = [];

}

data.members.push({

  name: name,

  flp: flp

});
    fs.writeFileSync(
      ADMIN_FILE,
      JSON.stringify(data, null, 2)
    );

    res.json({
      success: true,
      userName: name,
      userFLP: flp
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false,
      message: "登録処理エラー"
    });

  }

});
/* =========================
   Webhook
========================= */

app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const signature = req.headers["x-line-signature"];

    const hash = crypto
      .createHmac("sha256", CHANNEL_SECRET)
      .update(req.body)
      .digest("base64");

    if (signature !== hash) {
      console.log("署名エラー");
      return res.status(401).end();
    }

    const body = JSON.parse(req.body.toString());

    for (const ev of body.events || []) {
      if (!ev?.source?.userId) continue;
      if (ev.type !== "message") continue;
      if (ev.message.type !== "text") continue;

      const text = ev.message.text.trim();
      const userId = ev.source.userId;

      /* =========================
         Day7-2
      ========================= */

      if (text === "Day7-2へ進む") {
        await client.replyMessage(ev.replyToken, [
          {
            type: "image",
            originalContentUrl:
              "https://res.cloudinary.com/dxegzwukb/image/upload/v1771291127/X41_s9psh6.png",
            previewImageUrl:
              "https://res.cloudinary.com/dxegzwukb/image/upload/v1771291127/X41_s9psh6.png",
          },
          {
            type: "text",
            text:
`【VSH登録受付】

FBO登録が全て完了しましたら画面下のスタートを押し、「あなたの氏名」と「あなたのFLP番号」を送信してください。

【登録申請】方法は、
・FBO登録申請書（WEB版）の入力
・登録セットの「登録らくらく３本入アロエベラジュース１L」
（12,420円・0.575CC）を購入して完了です

クーリングオフ制度がありますので、安心して登録してください。

あなたが登録すると、この✨Vera.Sky.Harmony✨があなたにプレゼントされます。`
          }
        ]);
        return;
      }

      /* =========================
         登録希望（既存保持）
      ========================= */

      if (text === "登録希望") {
        await client.replyMessage(ev.replyToken, {
          type: "text",
          text: "🌟1週間ありがとうございました！\n下の黄色ボタンを押してください。",
        });
        return;
      }

    }

    res.status(200).end();

  } catch (err) {
    console.error("Webhookエラー:", err);
    res.status(500).end();
  }
});

/* ========================= */

app.listen(Number(PORT || 10000), () => {
  console.log("=================================");
  console.log("VSH Stable Version Running");
  console.log("=================================");
});



