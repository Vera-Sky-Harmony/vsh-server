import { registerRoutes } from "./register.js";
import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { supabase, loadAdmin, saveAdmin } from "./supabase.js";
import { pushToIntroducer } from "./message.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/* =========================
   Admin データ
========================= */


const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  PORT,
} = process.env;

const app = express();
registerRoutes(app);
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* =========================
   静的ページ配信
========================= */

app.use(express.static(__dirname));
app.use("/ページ", express.static(path.join(__dirname, "ページ")));
app.use("/api", express.json());
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

/* =========================
   Admin取得（Supabase）
========================= */

/* =========================
   Admin取得（Supabase）
========================= */

/* =========================
   Admin取得（Supabase）
========================= */

app.get("/api/admin", async (_req, res) => {

  try {

    const data = await loadAdmin();

    res.json(data);

  }

  catch (err) {

    console.error(err);

    res.status(500).json({

      success:false

    });

  }

});
/* =========================
   紹介者UserID保存
========================= */

app.post("/api/introducer", async (req, res) => {

  try {

    const data = await loadAdmin();

    data.introducerUserId = req.body.userId;

    await saveAdmin(data);

    res.json({
      success: true
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false
    });

  }

});
/* =========================
   新規登録者 LINE UserID 保存
========================= */

app.post("/api/member", async (req, res) => {

  try {

   const data = await loadAdmin();

    if (!data.members) {
      data.members = [];
   }

   const exists = data.members.find(
    x => x.userId === req.body.userId
);

if (!exists) {

    data.members.push({

        userId: req.body.userId,

        name: "",

        flp: "",

        status: "Day0",

        created: new Date().toISOString()

    });

}

    await saveAdmin(data);

    res.json({
      success: true
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false
    });

  }

});
app.post("/api/admin", async (req, res) => {

  try {

    const body = {

      introducerName:
        req.body.introducerName || "",

      introducerFLP:
        req.body.introducerFLP || "",

      introducerUserId:
        req.body.introducerUserId || "",

      flpList:
        req.body.flpList || [],

      members:
        req.body.members || []

    };

    await saveAdmin(body);

    res.json({

      success:true

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

app.get("/api/next-flp", async (_req, res) => {
console.log("===== /api/next-flp =====");
console.log("ADMIN_FILE =", ADMIN_FILE);
console.log(fs.readFileSync(ADMIN_FILE, "utf8"));
  const data = await loadAdmin();

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

app.post("/api/use-flp", async (req, res) => {

const data = await loadAdmin(); 

  const item = data.flpList.find(
    x => x.flp === req.body.flp
  );

  if (!item) {

    return res.status(404).json({
      success: false
    });

  }

  item.status = "使用中";

 await saveAdmin(data); 

  res.json({
    success: true
  });

});

/* =========================
   FLP番号を使用済へ変更
========================= */

app.post("/api/complete-flp", async (req, res) => {
const data = await loadAdmin(); 

  const item = data.flpList.find(
    x => x.flp === req.body.flp
  );

  if (!item) {

    return res.status(404).json({
      success:false
    });

  }

  item.status = "使用済";

  await saveAdmin(data);

  res.json({
    success:true
  });

});
/* =========================
   第一世代登録者一覧取得
========================= */

app.get("/api/members", async (_req, res) => {

  try {

    const data = await loadAdmin();

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

app.post("/api/register", async (req, res) => {

  try {

    const { name, flp } = req.body;

    if (!name || !flp) {

      return res.json({
        success: false,
        message: "氏名またはFLP番号がありません。"
      });

    }

   const data = await loadAdmin();
      fs.readFileSync(ADMIN_FILE, "utf8")
    );

    //----------------------------------
// FLP番号確認
//----------------------------------

const item = data.flpList.find(
    x => x.flp === flp
);

if (!item) {

    return res.json({

        success: false,

        message: "FLP番号が見つかりません。"

    });

}

//----------------------------------
// FLP番号を使用済へ変更
//----------------------------------

item.status = "使用済";

//----------------------------------
// 第一世代登録者
//----------------------------------

if (!data.members) {

    data.members = [];

}

data.members.push({

    userId: req.body.userId || "",

    name: name,

    flp: flp,

    status: "登録完了",

    created: new Date().toISOString()

});
    await saveAdmin(data);
await pushToIntroducer(name, flp, req.body.userId);
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

   const rawBody = req.body.toString("utf8");

const hash = crypto
  .createHmac("sha256", CHANNEL_SECRET)
  .update(rawBody)
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
   管理者登録
========================= */

if (text === "管理者登録") {

 const data = await loadAdmin();

data.introducerUserId = userId;

await saveAdmin(data);

  await client.replyMessage(
    ev.replyToken,
    {
      type: "text",
      text: "管理者LINEを登録しました。"
    }
  );

  return;
}
      // LINE UserID 保存
const data = await loadAdmin();

if (!data.members) {
  data.members = [];
}



/* =========================
   登録完了 → Day7-3送信
========================= */
if (text.startsWith("【登録完了】")) {

  await client.pushMessage(userId, [

    {
      type: "image",
      originalContentUrl:
        "https://res.cloudinary.com/dxegzwukb/image/upload/v1786601163/Day7-3%E9%81%A9%E7%94%A8_sjydub.png",
      previewImageUrl:
        "https://res.cloudinary.com/dxegzwukb/image/upload/v1786601163/Day7-3%E9%81%A9%E7%94%A8_sjydub.png"
    },

    {
      type: "text",
      text:
`【Day7-3】

登録を受け付けました。

紹介者がFLP本体システムで登録を確認後、
Vera Sky Harmony を譲渡いたします。`
    }

  ]);

  // 
  await pushToIntroducer("", "", userId);

  return res.status(200).end();
}
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


app.listen(Number(PORT || 10000), () => {
  console.log("=================================");
  console.log("VSH Stable Version Running");
  console.log("=================================");
});
