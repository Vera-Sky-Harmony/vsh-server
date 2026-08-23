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
// ========================================
// 7日経過した「確認中」登録者を自動整理
// 登録者削除 ＋ FLP番号を未使用へ復元
// ========================================

async function cleanupExpiredPendingMembers() {

  try {

   const data = await loadAdmin();

    if (!Array.isArray(data.members)) {
      data.members = [];
    }

    if (!Array.isArray(data.flpList)) {
      data.flpList = [];
    }

    const now = Date.now();

    const sevenDays =
      7 * 24 * 60 * 60 * 1000;

    let changed = false;

    const remainingMembers = [];

    for (const member of data.members) {

      //----------------------------------
      // 「確認中」以外はそのまま残す
      //----------------------------------

      if (member.status !== "確認中") {

        remainingMembers.push(member);
        continue;

      }

      //----------------------------------
      // 登録日時がない場合も削除しない
      //----------------------------------

      if (!member.created) {

        remainingMembers.push(member);
        continue;

      }

      const createdTime =
        new Date(member.created).getTime();

      //----------------------------------
      // 日付異常の場合も削除しない
      //----------------------------------

      if (!Number.isFinite(createdTime)) {

        remainingMembers.push(member);
        continue;

      }

      const elapsed =
        now - createdTime;

      //----------------------------------
      // まだ7日未満
      //----------------------------------

      if (elapsed < sevenDays) {

        remainingMembers.push(member);
        continue;

      }

      //----------------------------------
      // 7日経過
      // FLP番号を未使用へ戻す
      //----------------------------------

      const flpItem =
        data.flpList.find(
          x =>
            String(x.flp) ===
            String(member.flp)
        );

      if (flpItem) {

        flpItem.status = "未使用";

      }

      //----------------------------------
      // remainingMembersへ入れない
      // ＝登録者削除
      //----------------------------------

      changed = true;

      console.log(
        "確認期限切れ登録者を自動削除:",
        member.name,
        member.flp
      );

      console.log(
        "FLP番号を未使用へ復元:",
        member.flp
      );

    }

    //----------------------------------
    // 変更があった場合だけ保存
    //----------------------------------

    if (changed) {

      data.members =
        remainingMembers;

      await saveAdmin(data);

      console.log(
        "7日経過登録者の自動整理完了"
      );

    }

    return data;

  }

  catch (err) {

    console.error(
      "7日経過登録者の自動整理エラー:",
      err
    );

    throw err;

  }

}
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

    const data =
      await cleanupExpiredPendingMembers();

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

  const data =
    await cleanupExpiredPendingMembers();

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
   7日経過処理 テスト専用
   ※テスト終了後に削除
========================= */

app.post("/api/test-expire-member", async (req, res) => {

  try {

    const { flp } = req.body;

    const data = await loadAdmin();

    if (!Array.isArray(data.members)) {
      data.members = [];
    }

    const member = data.members.find(
      x => String(x.flp) === String(flp)
    );

    if (!member) {

      return res.status(404).json({
        success: false,
        message: "登録者が見つかりません。"
      });

    }

    // 8日前の登録日時に変更
    member.created =
      new Date(
        Date.now() - 8 * 24 * 60 * 60 * 1000
      ).toISOString();

    await saveAdmin(data);

    console.log(
      "期限切れテスト日時設定:",
      member.name,
      member.flp,
      member.created
    );

    res.json({
      success: true,
      name: member.name,
      flp: member.flp,
      created: member.created
    });

  }

  catch (err) {

    console.error(
      "期限切れテスト設定エラー:",
      err
    );

    res.status(500).json({
      success: false
    });

  }

});
/* =========================
   7日経過処理 スマホテスト専用
   ※テスト終了後に削除
========================= */

app.get("/api/test-expire-member/:flp", async (req, res) => {

  try {

    const flp = req.params.flp;

    const data = await loadAdmin();

    if (!Array.isArray(data.members)) {
      data.members = [];
    }

    const member = data.members.find(
      x => String(x.flp) === String(flp)
    );

    if (!member) {

      return res.status(404).send(
        "登録者が見つかりません。"
      );

    }

    // 安全対策：「確認中」の登録者だけテスト可能
    if (member.status !== "確認中") {

      return res.status(400).send(
        "確認中の登録者ではないため変更しません。"
      );

    }

    // 登録日時を8日前へ変更
    member.created =
      new Date(
        Date.now() - 8 * 24 * 60 * 60 * 1000
      ).toISOString();

    await saveAdmin(data);

    console.log(
      "スマホ期限切れテスト日時設定:",
      member.name,
      member.flp,
      member.created
    );

    return res.send(
`テスト設定成功

氏名：${member.name}
FLP番号：${member.flp}

登録日時を8日前に変更しました。

次にRoot Adminを開いてください。`
    );

  }

  catch (err) {

    console.error(
      "スマホ期限切れテスト設定エラー:",
      err
    );

    return res.status(500).send(
      "テスト設定エラー"
    );

  }

});
/* =========================
   第一世代登録確認
   確認中 → 登録済
========================= */

/* =========================
   第一世代登録確認
   確認中 → 登録済
   Day8 LINE送信
========================= */

app.post("/api/confirm-member", async (req, res) => {

  try {

    const { flp } = req.body;

    //----------------------------------
    // FLP番号確認
    //----------------------------------

    if (!flp) {

      return res.status(400).json({
        success: false,
        message: "FLP番号がありません。"
      });

    }

    //----------------------------------
    // 最新管理データ取得
    //----------------------------------

    const data = await loadAdmin();

    if (!Array.isArray(data.members)) {
      data.members = [];
    }

    //----------------------------------
    // 該当登録者を検索
    //----------------------------------

    const member = data.members.find(
      x => String(x.flp) === String(flp)
    );

    if (!member) {

      return res.status(404).json({
        success: false,
        message: "登録者が見つかりません。"
      });

    }

    //----------------------------------
    // LINE User ID確認
    //----------------------------------

    if (!member.userId) {

      return res.status(400).json({
        success: false,
        message:
          "この登録者のLINE User IDが保存されていません。"
      });

    }

    //----------------------------------
    // すでに登録済
    //----------------------------------

    if (member.status === "登録済") {

      return res.json({
        success: true,
        message: "すでに登録済です。"
      });

    }

    //----------------------------------
    // 登録済へ変更
    //----------------------------------

    member.status = "登録済";

    member.confirmed =
      new Date().toISOString();

    //----------------------------------
    // 先にSupabaseへ保存
    //----------------------------------

    await saveAdmin(data);

    console.log(
      "FBO登録確認:",
      member.name,
      member.flp
    );

    //----------------------------------
    // Day8を本人のLINEへ送信
    //----------------------------------

   await client.pushMessage(
  member.userId,
  [

    {
    
  type: "image",

  originalContentUrl:
    "https://res.cloudinary.com/dxegzwukb/image/upload/v1787477831/vsh-day8-congratulations",

  previewImageUrl:
    "https://res.cloudinary.com/dxegzwukb/image/upload/v1787477831/vsh-day8-congratulations"
},

    {
      type: "text",

          text:
`━━━━━━━━━━━━━━━━━━
【Vera Sky Harmony】
【Day8】
━━━━━━━━━━━━━━━━━━

ご登録おめでとうございます。

FOREVERへのFBO登録が確認され、
あなた専用の
Vera Sky Harmony（VSH）
の利用が開始されました。

━━━━━━━━━━━━━━━━━━

これからは、
健康と繁栄の「両方」を得るための
学びが始まります。

Day8では、
Vera Sky Harmony の核心である
「FLPビジネスの仕組み」
について学びます。

━━━━━━━━━━━━━━━━━━
【FLPビジネスとは】
━━━━━━━━━━━━━━━━━━

FLPビジネスについてはこちらをご覧ください。

https://www.flpj.co.jp/business.html

━━━━━━━━━━━━━━━━━━
【VSHの重要な目標】
━━━━━━━━━━━━━━━━━━

VSHでは、FBO登録後、
1か月以内を目標として、
最大2か月以内に
5人の新規登録者につなげることを
重要な運用条件としています。

これはFLPが定める
登録期限ではありません。

FLPのブレイクアウェイ方式による
報酬システムと、
ランクアップに伴う
ボーナスの仕組みを基礎として、

より早いランクアップを
目指すために
VSHが設定した目標です。

VSHは、この5人への連鎖を
できるだけ早く実現するため、

SNS
（YouTube・Instagram・X）

を活用した紹介活動を支援します。

※ランクアップや報酬額は、
FLP所定の資格・CC・組織実績などの
条件によって決まり、
一定のランクや収入を
保証するものではありません。

━━━━━━━━━━━━━━━━━━
【最初で最後の作業】
━━━━━━━━━━━━━━━━━━

あなたが紹介する方のための
「あなたのFLP番号」
5人分を準備してください。

この作業が、
VSHで行う
最初で最後の作業です。

━━━━━━━━━━━━━━━━━━
【手順①】
━━━━━━━━━━━━━━━━━━

FLP本社へ電話し、
スターターキットを
5冊注文してください。

【FLP本社】
0120-834-882

スターターキット
1冊400円＋送料

━━━━━━━━━━━━━━━━━━
【手順②】
━━━━━━━━━━━━━━━━━━

スターターキット内の
「エントリーガイド」にある

『フォーエバービジネスオーナー
（FBO）登録申請書』

上部に記載されている
「あなたのFLP番号」
を確認してください。

その番号を
あなたの管理画面へ
5人分登録してください。

━━━━━━━━━━━━━━━━━━

「あなたのFLP番号」が
管理画面へ登録された時点から、

あなたへ譲渡された
Vera Sky Harmony（VSH）は、

SNS
（YouTube・Instagram・X）

による紹介活動を開始します。

━━━━━━━━━━━━━━━━━━
【重要 ― 最初の2か月】
━━━━━━━━━━━━━━━━━━

FBO登録後の
最初の2か月は、
とても重要な期間です。

VSHでは、

1か月以内に5人、
遅くとも2か月以内に5人

への連鎖を目標とします。

FLPのビジネスプログラムを
有効に活用するために、

「いつ5人につながるか」

も重要だからです。

FBO登録後は、
速やかにスターターキットを準備し、

5人分の
「あなたのFLP番号」を
管理画面へ登録してください。

━━━━━━━━━━━━━━━━━━

この作業が終わりましたら、

「エントリーガイド」
「商品販売ルール」

をお読みください。

━━━━━━━━━━━━━━━━━━

次は
「管理画面」へ進みます。

ここで5人分の
「あなたのFLP番号」を
登録していただきます。

Vera Sky Harmony
Version 1.1`
        }

      ]
    );

       console.log(
      "Day8 LINE送信成功:",
      member.name,
      member.flp
    );

    //----------------------------------
    // 正常終了
    //----------------------------------

    return res.json({
      success: true,
      name: member.name,
      flp: member.flp,
      status: member.status,
      day8Sent: true
    });

  }

  catch (err) {

    console.error(
      "FBO登録確認・Day8送信エラー:",
      err
    );

    return res.status(500).json({
      success: false,
      message:
        "登録確認またはDay8送信処理でエラーが発生しました。"
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

//----------------------------------
// 第一世代登録者
// 重複登録防止
//----------------------------------

if (!Array.isArray(data.members)) {

    data.members = [];

}

// 同じFLP番号がすでに登録されているか確認
const alreadyRegistered = data.members.some(
    member => String(member.flp) === String(flp)
);

// 未登録の場合だけ追加
if (!alreadyRegistered) {

    data.members.push({

        userId: req.body.userId || "",

        name: name,

        flp: flp,

       status: "確認中",

        created: new Date().toISOString()

    });

}
    await saveAdmin(data);

//----------------------------------
// 登録成功を先に確定
//----------------------------------

res.json({
  success: true,
  userName: name,
  userFLP: flp
});

//----------------------------------
// 紹介者へのLINE通知
// 通知失敗でも登録処理には影響させない
//----------------------------------

try {

  await pushToIntroducer(
    name,
    flp,
    req.body.userId
  );

} catch (pushErr) {

  console.error(
    "紹介者LINE通知エラー:",
    pushErr
  );

}

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

  //----------------------------------
  // LINEメッセージから氏名・FLP番号取得
  //----------------------------------

  const nameMatch =
    text.match(/氏名：(.+)/);

  const flpMatch =
    text.match(/FLP番号：([0-9]+)/);

  const memberName =
    nameMatch ? nameMatch[1].trim() : "";

  const memberFLP =
    flpMatch ? flpMatch[1].trim() : "";

  //----------------------------------
  // LINE User IDを登録者へ紐付け
  //----------------------------------

  const adminData = await loadAdmin();

  if (!Array.isArray(adminData.members)) {
    adminData.members = [];
  }

  const member = adminData.members.find(
    x => String(x.flp) === String(memberFLP)
  );

  if (member) {

    member.userId = userId;

    await saveAdmin(adminData);

    console.log(
      "LINE User ID 保存成功:",
      memberName,
      memberFLP
    );

  } else {

    console.log(
      "LINE User ID 保存対象が見つかりません:",
      memberName,
      memberFLP
    );

  }

  //----------------------------------
  // Day7-3を本人へ送信
  //----------------------------------

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

  //----------------------------------
  // 既存処理
  //----------------------------------

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
