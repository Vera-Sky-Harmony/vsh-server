import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  PORT,
} = process.env;

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* =========================
   🔵 静的ページ配信設定
========================= */

app.use(express.static(__dirname));
app.use("/ページ", express.static(path.join(__dirname, "ページ")));

app.get("/test", (_req, res) => {
  res.send("VSH Static OK");
});

/* ========================= */

const threePointsState = new Map();

app.get("/", (_req, res) => res.send("VSH server running"));

app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  const signature = req.headers["x-line-signature"];

  const hash = crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(req.body)
    .digest("base64");

  if (signature !== hash) return res.status(401).end();

  const body = JSON.parse(req.body.toString());
  await handleWebhook(body);

  res.status(200).end();
});

/* =========================
   🔵 メイン処理
========================= */

async function handleWebhook(body) {
  for (const ev of body.events || []) {
    if (!ev?.source?.userId) continue;

    const userId = ev.source.userId;

    if (ev.type !== "message" || ev.message.type !== "text") continue;

    const text = ev.message.text.trim();

    /* ========= Day7-2 ========= */

    if (text === "Day7-2へ進む") {
      await client.pushMessage(userId, [
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

あなたが登録すると、この✨Vera.Sky.Harmony✨があなたにプレゼントされます。

○FBO登録申請書（WEB版）
https://member.flpj.co.jp/memberregi/memberregi.php?subsys=wksv2200&gid=Wksv220000&eventid=C001

○登録申請に必要な3点
・紹介者氏名
・紹介者FLP番号
・あなたのFLP番号

○事前に用意するもの
・ボーナス振込み用口座
・クレジットカード（VISA／MASTERカードのみ）

添付書類：
・登録手順書
https://sites.google.com/view/vsh-entry-guide/ホーム`
        }
      ]);
      return;
    }

    /* ========= 登録希望（既存保持） ========= */

    if (text === "登録希望") {
      await client.pushMessage(userId, {
        type: "text",
        text: "🌟1週間ありがとうございました！\n下の黄色ボタンを押してください。",
      });
      return;
    }

    /* ========= 3点入力処理 ========= */

    if (text === "登録完了をLINEで返信する") {
      threePointsState.set(userId, { step: 1 });
      await client.pushMessage(userId, {
        type: "text",
        text: "① 氏名を入力してください",
      });
      return;
    }

    const state = threePointsState.get(userId);

    if (state?.step === 1) {
      state.name = text;
      state.step = 2;
      await client.pushMessage(userId, {
        type: "text",
        text: "② あなたのFLP番号を入力してください",
      });
      return;
    }

    if (state?.step === 2) {
      state.flp = text;
      threePointsState.delete(userId);

      await client.pushMessage(userId, {
        type: "text",
        text: "登録確認が完了しました。",
      });
      return;
    }
  }
}

/* ========================= */

app.listen(Number(PORT || 10000), () => {
  console.log("=================================");
  console.log("VSH Stable Version Running");
  console.log("=================================");
});
