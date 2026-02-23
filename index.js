import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { CHANNEL_ACCESS_TOKEN, CHANNEL_SECRET, PORT } = process.env;

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

/* =========================
   静的ページ配信（日本語フォルダ固定）
========================= */

app.use(express.static(__dirname));
app.use("/ページ", express.static(path.join(__dirname, "ページ")));

app.get("/", (_req, res) => {
  res.send("VSH server running");
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

FBO登録が全て完了しましたら画面下のスタートを
押し、「あなたの氏名」と「あなたのFLP番号」を
送信してください。

【登録申請】方法は、
・FBO登録申請書（WEB版）の入力
・登録セットの「登録らくらく３本入アロエベラジュース１L」
（12,420円・0.575CC）を購入して完了です

クーリングオフ制度がありますので、安心して登録してください。

あなたが登録すると、この✨Vera.Sky.Harmony✨があなたにプレゼントされます。

○FBO登録申請書（WEB版）
https://member.flpj.co.jp/memberregi/memberregi.php?subsys=wksv2200&gid=Wksv220000&eventid=C001

○登録申請に必要な3点（申請書に入力します）
・紹介者氏名：紹介者氏名を表示させる
・紹介者FLP番号：紹介者FLP番号を表示させる
・あなたのFLP番号：VSH Adminから「あなたのFLP番号」を表示させる

○事前に用意するもの
・ボーナス振込み用口座
ここに毎月のボーナスが振込まれます
・クレジットカード（VISA／MASTERカードのみ）
登録セットの支払いに使います

添付書類：
・登録手順書
https://sites.google.com/view/vsh-entry-guide/%E3%83%9B%E3%83%BC%E3%83%A0
・スタートキットのファイル：後で入力します
・販売ルールのファイル：後で入力します

登録が完了しましたら
「登録完了をLINEで送信する」をタップし、
「あなたの氏名」→トーク欄から手動送信
「あなたのFLP番号」→トーク欄から手動送信`
          }
        ]);
        return;
      }

      /* =========================
         登録完了 → Day7-3
      ========================= */

      if (text === "登録完了をLINEで送信する") {
        await client.replyMessage(ev.replyToken, {
          type: "text",
          text:
`登録を受け付けました。

FOREVERに
FBO登録が確認されましたら
Vera.Sky.Harmonyシステムを譲渡します。

しばらくお待ちください。

▼確認ページ
https://vsh-server.onrender.com/ページ/day7-3.html`
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
  console.log("VSH Practical Version Running");
});
