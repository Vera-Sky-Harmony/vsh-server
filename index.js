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
// 本人専用Adminトークン発行
// ========================================

function createMemberAdminToken() {

  return crypto
    .randomBytes(32)
    .toString("hex");

}
// ========================================
// 本人用Admin セッション管理
// Supabase永続保存方式
// 有効期限：7日間
// ========================================


// ========================================
// 本人用Admin セッション発行
// ========================================

async function createMemberAdminSession(
  adminToken
) {

  const sessionId =
    crypto
      .randomBytes(32)
      .toString("hex");

  const data =
    await loadAdmin();

  if (
    !data.memberAdminSessions ||
    typeof data.memberAdminSessions !== "object" ||
    Array.isArray(data.memberAdminSessions)
  ) {

    data.memberAdminSessions = {};

  }

  //----------------------------------
  // 期限切れセッションを整理
  //----------------------------------

  const now =
    Date.now();

  const sevenDays =
    7 * 24 * 60 * 60 * 1000;

  for (
    const [id, session]
    of Object.entries(
      data.memberAdminSessions
    )
  ) {

    if (
      !session ||
      !session.created ||
      now - session.created >
        sevenDays
    ) {

      delete data.memberAdminSessions[id];

    }

  }

  //----------------------------------
  // 新しいセッションを保存
  //----------------------------------

  data.memberAdminSessions[
    sessionId
  ] = {

    adminToken:
      adminToken,

    created:
      Date.now()

  };

  await saveAdmin(data);

  return sessionId;

}


// ========================================
// 本人用Admin セッション確認
// Supabase永続保存方式
// 有効期限：7日間
// ========================================

async function getMemberAdminSession(
  sessionId
) {

  //----------------------------------
  // セッションID確認
  //----------------------------------

  if (!sessionId) {
    return null;
  }

  //----------------------------------
  // 最新管理データ取得
  //----------------------------------

  const data =
    await loadAdmin();

  if (
    !data.memberAdminSessions ||
    typeof data.memberAdminSessions !== "object" ||
    Array.isArray(data.memberAdminSessions)
  ) {

    return null;

  }

  //----------------------------------
  // セッション取得
  //----------------------------------

  const session =
    data.memberAdminSessions[
      sessionId
    ];

  if (!session) {
    return null;
  }

  //----------------------------------
  // 7日間の有効期限確認
  //----------------------------------

  const sevenDays =
    7 * 24 * 60 * 60 * 1000;

  const created =
    Number(session.created);

  if (
    !Number.isFinite(created) ||
    Date.now() - created >
      sevenDays
  ) {

    //----------------------------------
    // 期限切れセッション削除
    //----------------------------------

    delete data.memberAdminSessions[
      sessionId
    ];

    await saveAdmin(data);

    return null;

  }

  //----------------------------------
  // 有効なセッション
  //----------------------------------

  return session;

}
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
   本人用Admin テスト入口
   ※テスト終了後に削除
========================= */

app.get("/member-admin/test/:flp", async (req, res) => {

  try {

    const flp =
      req.params.flp;

    const data =
      await loadAdmin();

    if (!Array.isArray(data.members)) {
      data.members = [];
    }

    const member =
      data.members.find(
        x =>
          String(x.flp) ===
          String(flp)
      );

    if (
      !member ||
      member.status !== "登録済" ||
      !member.adminToken
    ) {

      return res.status(404).send(
        "テスト対象の登録済メンバーが見つかりません。"
      );

    }

   const sessionId =
  await createMemberAdminSession(
    member.adminToken
  );

    res.cookie(
      "vsh_member_session",
      sessionId,
      {
        httpOnly: true,
        secure: true,
        sameSite: "lax",

        maxAge:
          7 * 24 * 60 * 60 * 1000
      }
    );
console.log(
  "本人Admin Cookie発行:",
  sessionId
    ? "成功"
    : "失敗"
);
    console.log(
      "本人用Adminテスト入室:",
      member.name,
      member.flp
    );

    return res.redirect(
      "/member-admin"
    );

  }

  catch (err) {

    console.error(
      "本人用Adminテスト入室エラー:",
      err
    );

    return res.status(500).send(
      "テスト入室エラー"
    );

  }

});
/* =========================
   本人用Admin 入室処理
   本人専用トークン → 7日間セッション
========================= */

app.get("/member-admin/enter/:token", async (req, res) => {

  try {

    const token =
      req.params.token;

    //----------------------------------
    // トークン確認
    //----------------------------------

    if (!token) {

      return res.status(400).send(
        "本人確認情報がありません。"
      );

    }

    //----------------------------------
    // 登録者データ取得
    //----------------------------------

    const data =
      await loadAdmin();

    if (!Array.isArray(data.members)) {
      data.members = [];
    }

    //----------------------------------
    // 本人専用トークンから登録者確認
    //----------------------------------

    const member =
      data.members.find(
        x =>
          x.adminToken &&
          String(x.adminToken) ===
            String(token)
      );

    if (!member) {

      return res.status(401).send(
        "本人確認ができませんでした。"
      );

    }

    //----------------------------------
    // 登録済のみ利用可能
    //----------------------------------

    if (member.status !== "登録済") {

      return res.status(403).send(
        "FBO登録確認が完了していません。"
      );

    }

    //----------------------------------
// 7日間セッション発行
//----------------------------------

const sessionId =
  await createMemberAdminSession(
    member.adminToken
  );

    //----------------------------------
    // Cookieへ保存
    //----------------------------------

    res.cookie(
      "vsh_member_session",
      sessionId,
      {
        httpOnly: true,
        secure: true,
        sameSite: "lax",

        maxAge:
          7 * 24 * 60 * 60 * 1000
      }
    );

    console.log(
      "本人用Adminセッション発行:",
      member.name,
      member.flp
    );

    //----------------------------------
    // 本人用Adminへ移動
    //----------------------------------

    return res.redirect(
      "/member-admin"
    );

  }

  catch (err) {

    console.error(
      "本人用Admin入室エラー:",
      err
    );

    return res.status(500).send(
      "本人用Admin入室処理エラー"
    );

  }

});
app.get("/member-admin", (_req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "member-admin.html"
    )
  );

});
/* =========================
   本人用Admin 本人確認API
========================= */

/* =========================
   本人用Admin 本人確認API
   7日間Cookieセッション方式
========================= */

app.get("/api/member-admin/me", async (req, res) => {

  try {

    //----------------------------------
    // Cookie取得
    //----------------------------------

    const cookieHeader =
      req.headers.cookie || "";
console.log(
  "本人Admin Cookie有無:",
  cookieHeader
    ? "あり"
    : "なし"
);
    const cookies =
      Object.fromEntries(
        cookieHeader
          .split(";")
          .map(x => x.trim())
          .filter(Boolean)
          .map(x => {

            const index =
              x.indexOf("=");

            if (index === -1) {
              return [x, ""];
            }

            return [
              x.slice(0, index),
              decodeURIComponent(
                x.slice(index + 1)
              )
            ];

          })
      );

    const sessionId =
      cookies.vsh_member_session;
console.log(
  "本人Admin SessionID有無:",
  sessionId
    ? "あり"
    : "なし"
);
    //----------------------------------
    // セッション確認
    //----------------------------------

   const session =
  await getMemberAdminSession(
    sessionId
  );
console.log(
  "本人Admin Session確認:",
  session
    ? "成功"
    : "失敗"
);
    if (!session) {

      return res.status(401).json({
        success: false,
        message:
          "本人確認の有効期限が切れているか、本人確認情報がありません。"
      });

    }

    //----------------------------------
    // 最新管理データ取得
    //----------------------------------

    const data =
      await loadAdmin();

    if (!Array.isArray(data.members)) {
      data.members = [];
    }

    //----------------------------------
    // セッションのトークンから本人検索
    //----------------------------------

    const member =
      data.members.find(
        x =>
          x.adminToken &&
          String(x.adminToken) ===
            String(session.adminToken)
      );

    if (!member) {

      return res.status(401).json({
        success: false,
        message:
          "本人情報が見つかりません。"
      });

    }

    //----------------------------------
    // 登録済のみ利用可能
    //----------------------------------

    if (member.status !== "登録済") {

      return res.status(403).json({
        success: false,
        message:
          "FBO登録確認が完了していません。"
      });

    }

    //----------------------------------
    // 本人情報を返す
    //----------------------------------

    return res.json({
  success: true,

  member: {
    name: member.name,
    flp: member.flp,

    flpNumbers:
      Array.isArray(member.flpNumbers)
        ? member.flpNumbers
        : []
  }
});

  }

  catch (err) {

    console.error(
      "本人用Admin本人確認エラー:",
      err
    );

    return res.status(500).json({
      success: false,
      message:
        "本人確認処理エラー"
    });

  }

});
/* =====================================================
   本人用Admin
   自分が直接紹介した方の登録状況取得
   ※ツリー管理は行わない
===================================================== */

app.get(
  "/api/member-admin/introduced-members",
  async (req, res) => {

    try {

      //----------------------------------
      // Cookie取得
      //----------------------------------

      const cookieHeader =
        req.headers.cookie || "";

      const cookies =
        Object.fromEntries(
          cookieHeader
            .split(";")
            .map(x => x.trim())
            .filter(Boolean)
            .map(x => {

              const index =
                x.indexOf("=");

              if (index === -1) {
                return [x, ""];
              }

              return [
                x.slice(0, index),
                decodeURIComponent(
                  x.slice(index + 1)
                )
              ];

            })
        );

      const sessionId =
        cookies.vsh_member_session;

      //----------------------------------
      // 本人セッション確認
      //----------------------------------

      const session =
        await getMemberAdminSession(
          sessionId
        );

      if (!session) {

        return res.status(401).json({
          success: false,
          message:
            "本人確認の有効期限が切れているか、本人確認情報がありません。"
        });

      }

      //----------------------------------
      // 最新管理データ取得
      //----------------------------------

      const data =
        await loadAdmin();

      if (!Array.isArray(data.members)) {
        data.members = [];
      }

      //----------------------------------
      // セッションから本人検索
      //----------------------------------

      const currentMember =
        data.members.find(
          member =>
            member.adminToken &&
            String(member.adminToken) ===
              String(session.adminToken)
        );

      if (!currentMember) {

        return res.status(401).json({
          success: false,
          message:
            "本人情報が見つかりません。"
        });

      }

      //----------------------------------
      // 登録済本人のみ利用可能
      //----------------------------------

      if (
        currentMember.status !==
        "登録済"
      ) {

        return res.status(403).json({
          success: false,
          message:
            "FBO登録確認が完了していません。"
        });

      }

      //----------------------------------
      // この本人が直接紹介した登録者だけ取得
      //----------------------------------

      const introducedMembers =
        data.members
          .filter(
            member =>
              String(
                member.vshIntroducerFLP || ""
              ) ===
              String(currentMember.flp)
          )
          .map(
            member => ({

              name:
                member.name,

              flp:
                member.flp,

              status:
                member.status || "確認中"

            })
          );

      //----------------------------------
      // 正常終了
      //----------------------------------

      return res.json({

        success: true,

        members:
          introducedMembers

      });

    }

    catch (err) {

      console.error(
        "紹介した方の登録状況取得エラー:",
        err
      );

      return res.status(500).json({
        success: false,
        message:
          "登録状況の取得でエラーが発生しました。"
      });

    }

  }
);
/* =====================================================
   本人用Admin
   自分が直接紹介した方のFBO登録確認
   確認中 → 登録済
   Day8を本人LINEへ送信
   5人登録完了で紹介者SNS連携解除
   ※本人と直接紹介者の関係だけ確認
===================================================== */

app.post(
  "/api/member-admin/confirm-member",
  async (req, res) => {

    try {

      //----------------------------------
      // Cookie取得
      //----------------------------------

      const cookieHeader =
        req.headers.cookie || "";

      const cookies =
        Object.fromEntries(
          cookieHeader
            .split(";")
            .map(x => x.trim())
            .filter(Boolean)
            .map(x => {

              const index =
                x.indexOf("=");

              if (index === -1) {
                return [x, ""];
              }

              return [
                x.slice(0, index),
                decodeURIComponent(
                  x.slice(index + 1)
                )
              ];

            })
        );

      const sessionId =
        cookies.vsh_member_session;

      //----------------------------------
      // 本人Adminセッション確認
      //----------------------------------

      const session =
        await getMemberAdminSession(
          sessionId
        );

      if (!session) {

        return res.status(401).json({
          success: false,
          message:
            "本人確認の有効期限が切れているか、本人確認情報がありません。"
        });

      }

      //----------------------------------
      // FLP番号取得
      //----------------------------------

      const flp =
        String(
          req.body.flp || ""
        ).trim();

      if (!flp) {

        return res.status(400).json({
          success: false,
          message:
            "FLP番号がありません。"
        });

      }

      //----------------------------------
      // 最新管理データ取得
      //----------------------------------

      const data =
        await loadAdmin();

      if (!Array.isArray(data.members)) {
        data.members = [];
      }

      //----------------------------------
      // 現在ログインしている紹介者本人
      //----------------------------------

      const introducer =
        data.members.find(
          member =>
            member.adminToken &&
            String(member.adminToken) ===
              String(session.adminToken)
        );

      if (!introducer) {

        return res.status(401).json({
          success: false,
          message:
            "紹介者本人を確認できません。"
        });

      }

      //----------------------------------
      // 紹介者本人は登録済のみ
      //----------------------------------

      if (introducer.status !== "登録済") {

        return res.status(403).json({
          success: false,
          message:
            "FBO登録確認が完了していません。"
        });

      }

      //----------------------------------
      // 登録確認対象者
      //----------------------------------

      const member =
        data.members.find(
          member =>
            String(member.flp) ===
              String(flp)
        );

      if (!member) {

        return res.status(404).json({
          success: false,
          message:
            "登録者が見つかりません。"
        });

      }

      //----------------------------------
      // 本人が直接紹介した相手か確認
      //----------------------------------

      if (
        String(
          member.vshIntroducerFLP || ""
        ) !==
        String(introducer.flp)
      ) {

        return res.status(403).json({
          success: false,
          message:
            "この登録者を確認する権限がありません。"
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
          message:
            "すでに登録済です。",
          name:
            member.name,
          flp:
            member.flp,
          status:
            member.status,
          day8Sent:
            false
        });

      }

      //----------------------------------
      // 「確認中」だけ登録確認可能
      //----------------------------------

      if (member.status !== "確認中") {

        return res.status(409).json({
          success: false,
          message:
            "現在の状態では登録確認できません。"
        });

      }

      //----------------------------------
      // 確認中 → 登録済
      //----------------------------------

      member.status =
        "登録済";

      member.confirmed =
        new Date().toISOString();

      //----------------------------------
      // 本人専用Adminトークン発行
      //----------------------------------

      if (!member.adminToken) {

        member.adminToken =
          createMemberAdminToken();

        console.log(
          "本人専用Adminトークン発行:",
          member.name,
          member.flp
        );

      }

      //----------------------------------
      // 直接紹介5人の登録完了確認
      // 5人全員登録済ならSNS連携解除
      //----------------------------------

      const registeredDirectMembers =
        data.members.filter(
          x =>
            String(
              x.vshIntroducerFLP || ""
            ) ===
              String(introducer.flp) &&
            x.status === "登録済"
        );

     if (
  registeredDirectMembers.length >= 5
) {

  //----------------------------------
  // 第1段階完了
  // SNS自動支援を解除
  //----------------------------------

  introducer.snsActive =
    false;

  introducer.snsDeactivatedAt =
    new Date().toISOString();


  //----------------------------------
  // 第2段階開始
  // VSHともだち追加を有効化
  //----------------------------------

  introducer.faceToFaceActive =
    true;

  introducer.faceToFaceActivatedAt =
    new Date().toISOString();


  //----------------------------------
  // 使用したFLP番号5件を履歴へ保存
  //----------------------------------

  if (!Array.isArray(introducer.flpHistory)) {
    introducer.flpHistory = [];
  }

  const currentFLPNumbers =
    Array.isArray(introducer.flpNumbers)
      ? [...introducer.flpNumbers]
      : [];

  if (currentFLPNumbers.length > 0) {

    introducer.flpHistory.push({
      numbers:
        currentFLPNumbers,

      completedAt:
        new Date().toISOString()
    });

  }


  //----------------------------------
  // 現在の5件を空にする
  // 次の5件を入力可能にする
  //----------------------------------

  introducer.flpNumbers =
    [];

  delete introducer.flpNumbersRegisteredAt;


  console.log(
    "5人登録完了・第2段階開始:",
    introducer.name,
    introducer.flp
  );

}

      //----------------------------------
      // Supabaseへ保存
      //----------------------------------

      await saveAdmin(data);

      console.log(
        "本人AdminからFBO登録確認:",
        introducer.name,
        "→",
        member.name,
        member.flp
      );

      //----------------------------------
      // Day8を本人LINEへ送信
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

FLPの制度を活用しながら、
VSHが独自に設定している
活動目標です。

ランクアップや報酬額は、
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
          },

          {
            type: "template",

            altText:
              "VSH あなたの管理画面",

            template: {

              type: "buttons",

              text:
                "スターターキットを受け取り、5人分の「あなたのFLP番号」を確認できましたら、下のボタンから管理画面へ進んでください。",

              actions: [

                {
                  type: "uri",

                  label:
                    "あなたの管理画面を開く",

                  uri:
                    `https://vsh-server.onrender.com/member-admin/enter/${member.adminToken}`
                }

              ]

            }
          }

        ]
      );

      //----------------------------------
      // 正常終了
      //----------------------------------

      return res.json({

        success: true,

        name:
          member.name,

        flp:
          member.flp,

        status:
          member.status,

        day8Sent:
          true

      });

    }

    catch (err) {

      console.error(
        "本人Admin FBO登録確認エラー:",
        err
      );

      return res.status(500).json({
        success: false,
        message:
          "登録確認またはDay8送信処理でエラーが発生しました。"
      });

    }

  }
);
/* =========================
   本人用Admin
   FLP番号5件保存API
========================= */

app.post("/api/member-admin/flp", async (req, res) => {

  try {

    //----------------------------------
    // Cookie取得
    //----------------------------------

    const cookieHeader =
      req.headers.cookie || "";

    const cookies =
      Object.fromEntries(
        cookieHeader
          .split(";")
          .map(x => x.trim())
          .filter(Boolean)
          .map(x => {

            const index =
              x.indexOf("=");

            if (index === -1) {
              return [x, ""];
            }

            return [
              x.slice(0, index),
              decodeURIComponent(
                x.slice(index + 1)
              )
            ];

          })
      );

    const sessionId =
      cookies.vsh_member_session;

    //----------------------------------
    // 本人セッション確認
    //----------------------------------

   const session =
  await getMemberAdminSession(
    sessionId
  );
     console.log(
  "本人Admin Session確認:",
  session
    ? "成功"
    : "失敗"
);
    if (!session) {

      return res.status(401).json({
        success: false,
        message:
          "本人確認の有効期限が切れているか、本人確認情報がありません。"
      });

    }

    //----------------------------------
    // FLP番号取得
    //----------------------------------

    const numbers =
      Array.isArray(req.body.numbers)
        ? req.body.numbers.map(
            x => String(x).trim()
          )
        : [];

    //----------------------------------
    // 必ず5件
    //----------------------------------

    if (numbers.length !== 5) {

      return res.status(400).json({
        success: false,
        message:
          "FLP番号を5件入力してください。"
      });

    }

    //----------------------------------
    // すべて9桁の数字か確認
    //----------------------------------

    const invalid =
      numbers.some(
        x => !/^[0-9]{9}$/.test(x)
      );

    if (invalid) {

      return res.status(400).json({
        success: false,
        message:
          "FLP番号は9桁の数字で入力してください。"
      });

    }

    //----------------------------------
    // 5件内の重複確認
    //----------------------------------

    const uniqueNumbers =
      new Set(numbers);

    if (uniqueNumbers.size !== 5) {

      return res.status(400).json({
        success: false,
        message:
          "同じFLP番号が重複しています。"
      });

    }

    //----------------------------------
    // 最新管理データ取得
    //----------------------------------

    const data =
      await loadAdmin();

    if (!Array.isArray(data.members)) {
      data.members = [];
    }

    //----------------------------------
    // セッションから本人検索
    //----------------------------------

    const member =
      data.members.find(
        x =>
          x.adminToken &&
          String(x.adminToken) ===
            String(session.adminToken)
      );

    if (!member) {

      return res.status(401).json({
        success: false,
        message:
          "本人情報が見つかりません。"
      });

    }

    //----------------------------------
    // 登録済FBOのみ
    //----------------------------------

    if (member.status !== "登録済") {

      return res.status(403).json({
        success: false,
        message:
          "FBO登録確認が完了していません。"
      });

    }

    //----------------------------------
    // 初回5件のみ
    // 登録済みなら変更させない
    //----------------------------------

    if (
      Array.isArray(member.flpNumbers) &&
      member.flpNumbers.length === 5
    ) {

      return res.status(409).json({
        success: false,
        message:
          "FLP番号5件はすでに登録済みです。"
      });

    }

    //----------------------------------
    // FLP番号5件を本人へ保存
    //----------------------------------

   //----------------------------------
// 本人のFLP番号5件を保存
//----------------------------------

member.flpNumbers =
  numbers;

member.flpNumbersRegisteredAt =
  new Date().toISOString();


//----------------------------------
// VSH・SNS連携開始状態
// 5件登録完了を開始条件とする
//----------------------------------

member.vshActive = true;

member.snsActive = true;

//----------------------------------
// 第1段階から開始
// 5人達成後に true へ変更する
//----------------------------------

member.faceToFaceActive = false;

//----------------------------------
// 使用済みFLP番号履歴
// 既存履歴があればそのまま保持
//----------------------------------

if (!Array.isArray(member.flpHistory)) {
  member.flpHistory = [];
}

member.snsActivatedAt =
  new Date().toISOString();


//----------------------------------
// Supabaseへ永続保存
//----------------------------------

await saveAdmin(data);

console.log(
  "VSH・SNS連携開始:",
  member.name,
  member.flp
);

    console.log(
      "本人FLP番号5件登録:",
      member.name,
      member.flp
    );

    //----------------------------------
    // 正常終了
    //----------------------------------

    return res.json({
      success: true,
      message:
        "5件のFLP番号を登録しました。",
      numbers:
        member.flpNumbers
    });

  }

  catch (err) {

    console.error(
      "本人FLP番号5件登録エラー:",
      err
    );

    return res.status(500).json({
      success: false,
      message:
        "FLP番号の登録処理でエラーが発生しました。"
    });

  }

});
/* =========================
   本人用Admin
   FLP番号5件 テスト解除
   ※テスト終了後に削除
========================= */

app.get("/api/test-reset-member-flp/:flp", async (req, res) => {

  try {

    const flp =
      req.params.flp;

    //----------------------------------
    // 管理データ取得
    //----------------------------------

    const data =
      await loadAdmin();

    if (!Array.isArray(data.members)) {
      data.members = [];
    }

    //----------------------------------
    // 対象者検索
    //----------------------------------

    const member =
      data.members.find(
        x =>
          String(x.flp) ===
          String(flp)
      );

    if (!member) {

      return res.status(404).send(
        "登録者が見つかりません。"
      );

    }

    //----------------------------------
    // 登録した5件だけ削除
    //----------------------------------

   //----------------------------------
// 登録した5件とVSH・SNS開始状態を
// テスト前の状態へ戻す
//----------------------------------

delete member.flpNumbers;

delete member.flpNumbersRegisteredAt;

delete member.vshActive;

delete member.snsActive;

delete member.snsActivatedAt;

    //----------------------------------
    // 保存
    //----------------------------------
      
    await saveAdmin(data);

    console.log(
      "本人FLP番号5件 テスト解除:",
      member.name,
      member.flp
    );

    //----------------------------------
    // 結果表示
    //----------------------------------

    return res.send(
`テスト解除成功

氏名：${member.name}
FBO番号：${member.flp}

本人用Adminに登録した
「あなたのFLP番号」5件を削除しました。

本人情報・FBO登録済状態・
本人専用Adminトークンは保持しています。`
    );

  }

  catch (err) {

    console.error(
      "本人FLP番号5件 テスト解除エラー:",
      err
    );

    return res.status(500).send(
      "テスト解除エラー"
    );

  }

});
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
/* =====================================================
   ルートID SNS手動管理
   SNS状態取得・連携・解除
===================================================== */


/* =========================
   SNS現在状態取得
========================= */

app.get(
  "/api/root-sns-status",
  async (_req, res) => {

    try {

      const data =
        await loadAdmin();

      //----------------------------------
      // ルートIDのSNS状態
      //----------------------------------

      const snsActive =
        data.rootSnsActive === true;

      return res.json({

        success: true,

        snsActive:
          snsActive

      });

    }

    catch (err) {

      console.error(
        "ルートID SNS状態取得エラー:",
        err
      );

      return res.status(500).json({

        success: false,

        message:
          "SNS状態を取得できませんでした。"

      });

    }

  }
);


/* =========================
   SNS手動連携
========================= */

app.post(
  "/api/root-sns-start",
  async (_req, res) => {

    try {

      const data =
        await loadAdmin();

      //----------------------------------
      // SNS連携開始
      //----------------------------------

      data.rootSnsActive = true;

      data.rootSnsActivatedAt =
        new Date().toISOString();

      delete data.rootSnsDeactivatedAt;

      //----------------------------------
      // 保存
      //----------------------------------

      await saveAdmin(data);

      console.log(
        "ルートID SNS連携開始"
      );

      return res.json({

        success: true,

        snsActive: true

      });

    }

    catch (err) {

      console.error(
        "ルートID SNS連携開始エラー:",
        err
      );

      return res.status(500).json({

        success: false,

        message:
          "SNS連携を開始できませんでした。"

      });

    }

  }
);


/* =========================
   SNS手動解除
========================= */

app.post(
  "/api/root-sns-stop",
  async (_req, res) => {

    try {

      const data =
        await loadAdmin();

      //----------------------------------
      // SNS連携解除
      //----------------------------------

      data.rootSnsActive = false;

      data.rootSnsDeactivatedAt =
        new Date().toISOString();

      //----------------------------------
      // 保存
      //----------------------------------

      await saveAdmin(data);

      console.log(
        "ルートID SNS連携解除"
      );

      return res.json({

        success: true,

        snsActive: false

      });

    }

    catch (err) {

      console.error(
        "ルートID SNS連携解除エラー:",
        err
      );

      return res.status(500).json({

        success: false,

        message:
          "SNS連携を解除できませんでした。"

      });

    }

  }
);
/* =====================================================
   VSH正式紹介入口
   WEB・YouTube・SNS共通入口

   ルートID ＋ 一般FBO 共通対応

   URL：
   /vsh/invite/紹介者FLP

   ※VSH側ではツリー管理を行わない
===================================================== */

app.get("/vsh/invite/:flp", async (req, res) => {

  try {

    //----------------------------------
    // URLから紹介者FLP取得
    //----------------------------------

    const introducerFLP =
      String(
        req.params.flp || ""
      ).trim();

    if (!introducerFLP) {

      return res.status(400).send(
        "紹介者FLP番号がありません。"
      );

    }


    //----------------------------------
    // 最新管理データ取得
    //----------------------------------

    const data =
      await loadAdmin();

    if (!Array.isArray(data.members)) {
      data.members = [];
    }

    if (!Array.isArray(data.flpList)) {
      data.flpList = [];
    }


    /* ==================================
       ケース1
       ルートIDのVSH
    ================================== */

    if (
      String(data.introducerFLP || "") ===
      String(introducerFLP)
    ) {

      //----------------------------------
      // ルートSNS連携状態確認
      //----------------------------------

      if (data.rootSnsActive !== true) {

        return res.status(403).send(
          "このVSHは現在利用できません。"
        );

      }


      //----------------------------------
      // ルート紹介用FLP番号確認
      // 未使用番号があることを確認
      //----------------------------------

      const availableRootFLP =
        data.flpList.filter(
          item =>
            item &&
            item.status === "未使用" &&
            item.flp
        );

      if (availableRootFLP.length === 0) {

        return res.status(403).send(
          "現在利用できる紹介用FLP番号がありません。"
        );

      }


      //----------------------------------
      // この端末に
      // 「ルートVSHから来た」ことを保存
      //----------------------------------

      res.cookie(
        "vsh_introducer_flp",
        introducerFLP,
        {
          httpOnly: true,
          secure: true,
          sameSite: "lax",

          maxAge:
            30 * 24 * 60 * 60 * 1000
        }
      );


      console.log(
        "VSH正式紹介入口・ルート:",
        data.introducerName,
        data.introducerFLP
      );


      //----------------------------------
      // Day0へ
      //----------------------------------

      return res.redirect(
        "/pages/day0.html"
      );

    }


    /* ==================================
       ケース2
       第一世代以降の一般FBO
    ================================== */

    const introducer =
      data.members.find(
        member =>
          String(member.flp) ===
          String(introducerFLP)
      );


    if (!introducer) {

      return res.status(404).send(
        "VSHの紹介者が見つかりません。"
      );

    }


    //----------------------------------
    // FBO登録済み確認
    //----------------------------------

    if (introducer.status !== "登録済") {

      return res.status(403).send(
        "このVSHは現在利用できません。"
      );

    }


    //----------------------------------
    // VSH開始状態確認
    //----------------------------------

    if (introducer.vshActive !== true) {

      return res.status(403).send(
        "このVSHはまだ紹介活動を開始していません。"
      );

    }


    //----------------------------------
    // SNS連携状態確認
    //----------------------------------

    if (introducer.snsActive !== true) {

      return res.status(403).send(
        "このVSHのSNS連携は現在停止しています。"
      );

    }


    //----------------------------------
    // 本人の紹介用FLP番号5件確認
    //----------------------------------

    if (
      !Array.isArray(
        introducer.flpNumbers
      ) ||
      introducer.flpNumbers.length !== 5
    ) {

      return res.status(403).send(
        "紹介用FLP番号が準備されていません。"
      );

    }


    //----------------------------------
    // この端末に
    // 「誰のVSHから来たか」を保存
    //----------------------------------

    res.cookie(
      "vsh_introducer_flp",
      introducerFLP,
      {
        httpOnly: true,
        secure: true,
        sameSite: "lax",

        maxAge:
          30 * 24 * 60 * 60 * 1000
      }
    );


    console.log(
      "VSH正式紹介入口・一般FBO:",
      introducer.name,
      introducer.flp
    );


    //----------------------------------
    // Day0へ
    //----------------------------------

    return res.redirect(
      "/pages/day0.html"
    );

  }

  catch (err) {

    console.error(
      "VSH正式紹介入口エラー:",
      err
    );

    return res.status(500).send(
      "VSH紹介入口エラー"
    );

  }

});
/* =====================================================
   VSH紹介者情報取得API
   ルートID ＋ 一般FBO 共通対応
   VSH紹介者識別用
   ※ツリー管理は行わない
===================================================== */

app.get("/api/vsh-introducer/:flp", async (req, res) => {

  try {

    //----------------------------------
    // URLから紹介者FLP取得
    //----------------------------------

    const introducerFLP =
      String(
        req.params.flp || ""
      ).trim();

    if (!introducerFLP) {

      return res.status(400).json({
        success: false,
        message:
          "紹介者FLP番号がありません。"
      });

    }


    //----------------------------------
    // 最新管理データ取得
    //----------------------------------

    const data =
      await loadAdmin();

    if (!Array.isArray(data.members)) {
      data.members = [];
    }

    if (!Array.isArray(data.flpList)) {
      data.flpList = [];
    }


    /* ==================================
       ケース1
       ルートID
    ================================== */

    if (
      String(data.introducerFLP || "") ===
      String(introducerFLP)
    ) {

      //----------------------------------
      // ルートSNS連携状態確認
      //----------------------------------

      if (data.rootSnsActive !== true) {

        return res.status(403).json({
          success: false,
          message:
            "このVSHは現在利用できません。"
        });

      }


      //----------------------------------
      // 未使用FLP番号取得
      //----------------------------------

      const availableFLPs =
        data.flpList
          .filter(
            item =>
              item &&
              item.status === "未使用" &&
              item.flp
          )
          .map(
            item =>
              String(item.flp)
          );


      if (availableFLPs.length === 0) {

        return res.status(400).json({
          success: false,
          message:
            "利用できる紹介用FLP番号がありません。"
        });

      }


      //----------------------------------
      // ルートID情報を返す
      //----------------------------------

      return res.json({

        success: true,

        source:
          "root",

        introducer: {

          name:
            data.introducerName,

          flp:
            data.introducerFLP,

          flpNumbers:
            availableFLPs

        }

      });

    }


    /* ==================================
       ケース2
       第一世代以降の一般FBO
    ================================== */

    const introducer =
      data.members.find(
        member =>
          String(member.flp) ===
          String(introducerFLP)
      );


    if (!introducer) {

      return res.status(404).json({
        success: false,
        message:
          "紹介者が見つかりません。"
      });

    }


    //----------------------------------
    // 登録済FBOのみ
    //----------------------------------

    if (introducer.status !== "登録済") {

      return res.status(403).json({
        success: false,
        message:
          "紹介者のFBO登録確認が完了していません。"
      });

    }


    //----------------------------------
    // VSH・SNS開始状態確認
    //----------------------------------

    if (
      introducer.vshActive !== true ||
      introducer.snsActive !== true
    ) {

      return res.status(403).json({
        success: false,
        message:
          "このVSHはまだ紹介活動を開始していません。"
      });

    }


    //----------------------------------
    // FLP番号5件確認
    //----------------------------------

    if (
      !Array.isArray(
        introducer.flpNumbers
      ) ||
      introducer.flpNumbers.length !== 5
    ) {

      return res.status(400).json({
        success: false,
        message:
          "紹介用FLP番号5件が登録されていません。"
      });

    }


    //----------------------------------
    // 一般FBO情報を返す
    //----------------------------------

    return res.json({

      success: true,

      source:
        "member",

      introducer: {

        name:
          introducer.name,

        flp:
          introducer.flp,

        flpNumbers:
          introducer.flpNumbers

      }

    });

  }

  catch (err) {

    console.error(
      "VSH紹介者情報取得エラー:",
      err
    );

    return res.status(500).json({
      success: false,
      message:
        "VSH紹介者情報取得エラー"
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
/* =====================================================
   現在のVSH紹介者取得
   ルートID ＋ 一般FBO 共通対応
   Cookieから「誰のVSHか」を確認
   ※ツリー管理は行わない
===================================================== */

app.get("/api/current-vsh-introducer", async (req, res) => {

  try {

    //----------------------------------
    // Cookie取得
    //----------------------------------

    const cookieHeader =
      req.headers.cookie || "";

    const cookies =
      Object.fromEntries(
        cookieHeader
          .split(";")
          .map(x => x.trim())
          .filter(Boolean)
          .map(x => {

            const index =
              x.indexOf("=");

            if (index === -1) {
              return [x, ""];
            }

            return [
              x.slice(0, index),
              decodeURIComponent(
                x.slice(index + 1)
              )
            ];

          })
      );

    const introducerFLP =
      cookies.vsh_introducer_flp;


    //----------------------------------
    // 紹介者Cookieがない場合
    //----------------------------------

    if (!introducerFLP) {

      return res.json({
        success: false,
        message:
          "VSH紹介者情報がありません。"
      });

    }


    //----------------------------------
    // 最新管理データ取得
    //----------------------------------

    const data =
      await loadAdmin();

    if (!Array.isArray(data.members)) {
      data.members = [];
    }

    if (!Array.isArray(data.flpList)) {
      data.flpList = [];
    }


    /* ==================================
       ケース1
       ルートID
    ================================== */

    if (
      String(data.introducerFLP || "") ===
      String(introducerFLP)
    ) {

      //----------------------------------
      // ルートSNS利用状態確認
      //----------------------------------

      if (data.rootSnsActive !== true) {

        return res.status(403).json({
          success: false,
          message:
            "このVSHは現在利用できません。"
        });

      }


      //----------------------------------
      // 未使用FLP番号取得
      //----------------------------------

      const availableFLPs =
        data.flpList
          .filter(
            item =>
              item &&
              item.status === "未使用" &&
              item.flp
          )
          .map(
            item =>
              String(item.flp)
          );


      if (availableFLPs.length === 0) {

        return res.status(400).json({
          success: false,
          message:
            "利用できる紹介用FLP番号がありません。"
        });

      }


      //----------------------------------
      // ルートID情報を返す
      //----------------------------------

      return res.json({

        success: true,

        source:
          "root",

        introducer: {

          name:
            data.introducerName,

          flp:
            data.introducerFLP,

          flpNumbers:
            availableFLPs

        }

      });

    }


    /* ==================================
       ケース2
       第一世代以降の一般FBO
    ================================== */

    const introducer =
      data.members.find(
        member =>
          String(member.flp) ===
          String(introducerFLP)
      );


    if (!introducer) {

      return res.status(404).json({
        success: false,
        message:
          "VSH紹介者が見つかりません。"
      });

    }


    //----------------------------------
    // VSH利用状態確認
    //----------------------------------

    if (
      introducer.status !== "登録済" ||
      introducer.vshActive !== true ||
      introducer.snsActive !== true
    ) {

      return res.status(403).json({
        success: false,
        message:
          "このVSHは現在利用できません。"
      });

    }


    //----------------------------------
    // FLP番号5件確認
    //----------------------------------

    if (
      !Array.isArray(
        introducer.flpNumbers
      ) ||
      introducer.flpNumbers.length !== 5
    ) {

      return res.status(400).json({
        success: false,
        message:
          "紹介用FLP番号5件がありません。"
      });

    }


    //----------------------------------
    // 一般FBO情報を返す
    //----------------------------------

    return res.json({

      success: true,

      source:
        "member",

      introducer: {

        name:
          introducer.name,

        flp:
          introducer.flp,

        flpNumbers:
          introducer.flpNumbers

      }

    });

  }

  catch (err) {

    console.error(
      "現在VSH紹介者取得エラー:",
      err
    );

    return res.status(500).json({
      success: false,
      message:
        "VSH紹介者情報取得エラー"
    });

  }

});
/* =====================================================
   次のFLP番号取得
   ルートVSH ＋ 譲渡VSH対応
   ※VSH側ではツリー管理を行わない
===================================================== */

app.get("/api/next-flp", async (req, res) => {

  try {

    console.log(
      "===== /api/next-flp ====="
    );

    //----------------------------------
    // 最新データ取得
    //----------------------------------

    const data =
      await cleanupExpiredPendingMembers();

    if (!Array.isArray(data.flpList)) {
      data.flpList = [];
    }

    if (!Array.isArray(data.members)) {
      data.members = [];
    }

    //----------------------------------
    // Cookie取得
    //----------------------------------

    const cookieHeader =
      req.headers.cookie || "";

    const cookies =
      Object.fromEntries(
        cookieHeader
          .split(";")
          .map(x => x.trim())
          .filter(Boolean)
          .map(x => {

            const index =
              x.indexOf("=");

            if (index === -1) {
              return [x, ""];
            }

            return [
              x.slice(0, index),
              decodeURIComponent(
                x.slice(index + 1)
              )
            ];

          })
      );

    const introducerFLP =
      cookies.vsh_introducer_flp;


    /* ==================================
       ケース1
       譲渡されたVSHから来た場合
    ================================== */

 if (
  introducerFLP &&
  String(introducerFLP) !==
    String(data.introducerFLP || "")
) {

      const introducer =
        data.members.find(
          member =>
            String(member.flp) ===
            String(introducerFLP)
        );

      if (!introducer) {

        return res.status(404).json({
          success: false,
          message:
            "VSH紹介者が見つかりません。"
        });

      }

      //----------------------------------
      // VSH利用可能状態確認
      //----------------------------------

      if (
        introducer.status !== "登録済" ||
        introducer.vshActive !== true ||
        introducer.snsActive !== true
      ) {

        return res.status(403).json({
          success: false,
          message:
            "このVSHは現在利用できません。"
        });

      }

      //----------------------------------
      // 紹介者本人の5件確認
      //----------------------------------

      if (
        !Array.isArray(
          introducer.flpNumbers
        ) ||
        introducer.flpNumbers.length !== 5
      ) {

        return res.status(400).json({
          success: false,
          message:
            "紹介用FLP番号5件がありません。"
        });

      }

      //----------------------------------
      // 既に登録に使われた番号を取得
      //----------------------------------

      const usedFLPs =
        new Set(
          data.members
            .filter(
              member =>
                String(
                  member.vshIntroducerFLP || ""
                ) ===
                String(introducer.flp)
            )
            .map(
              member =>
                String(member.flp)
            )
        );

      //----------------------------------
      // 5件から次の未使用番号を取得
      //----------------------------------

      const nextFLP =
        introducer.flpNumbers.find(
          flp =>
            !usedFLPs.has(
              String(flp)
            )
        );

      if (!nextFLP) {

        return res.status(404).json({
          success: false,
          message:
            "このVSHで使用できるFLP番号はありません。"
        });

      }

      console.log(
        "譲渡VSH 次FLP:",
        introducer.name,
        introducer.flp,
        nextFLP
      );

      //----------------------------------
      // Day7-2へ返す
      //----------------------------------

      return res.json({

        success: true,

        source:
          "member",

        introducerName:
          introducer.name,

        introducerFLP:
          introducer.flp,

        myFLP:
          nextFLP

      });

    }


    /* ==================================
       ケース2
       ルートVSH
    ================================== */

    const item =
      data.flpList.find(
        x =>
          x.status === "未使用"
      );

    if (!item) {

      return res.status(404).json({
        success: false,
        message:
          "未使用のFLP番号がありません。"
      });

    }

    console.log(
      "ルートVSH 次FLP:",
      data.introducerName,
      data.introducerFLP,
      item.flp
    );

    //----------------------------------
    // Day7-2へ返す
    //----------------------------------

    return res.json({

      success: true,

      source:
        "root",

      introducerName:
        data.introducerName,

      introducerFLP:
        data.introducerFLP,

      myFLP:
        item.flp

    });

  }

  catch (err) {

    console.error(
      "次FLP取得エラー:",
      err
    );

    return res.status(500).json({
      success: false,
      message:
        "FLP番号取得処理でエラーが発生しました。"
    });

  }

});

/* =====================================================
   FLP番号を使用中へ変更
   ルートVSH ＋ 譲渡VSH対応
   ※VSH側ではツリー管理を行わない
===================================================== */

app.post("/api/use-flp", async (req, res) => {

  try {

    const targetFLP =
      String(req.body.flp || "").trim();

    if (!targetFLP) {

      return res.status(400).json({
        success: false,
        message:
          "FLP番号がありません。"
      });

    }

    //----------------------------------
    // 最新管理データ取得
    //----------------------------------

    const data =
      await loadAdmin();

    if (!Array.isArray(data.flpList)) {
      data.flpList = [];
    }

    if (!Array.isArray(data.members)) {
      data.members = [];
    }

    //----------------------------------
    // Cookie取得
    //----------------------------------

    const cookieHeader =
      req.headers.cookie || "";

    const cookies =
      Object.fromEntries(
        cookieHeader
          .split(";")
          .map(x => x.trim())
          .filter(Boolean)
          .map(x => {

            const index =
              x.indexOf("=");

            if (index === -1) {
              return [x, ""];
            }

            return [
              x.slice(0, index),
              decodeURIComponent(
                x.slice(index + 1)
              )
            ];

          })
      );

    const introducerFLP =
      cookies.vsh_introducer_flp;


    /* ==================================
       ケース1
       譲渡されたVSH
    ================================== */

   if (
  introducerFLP &&
  String(introducerFLP) !==
    String(data.introducerFLP || "")
) {
      //----------------------------------
      // VSH所有者を検索
      //----------------------------------

      const introducer =
        data.members.find(
          member =>
            String(member.flp) ===
            String(introducerFLP)
        );

      if (!introducer) {

        return res.status(404).json({
          success: false,
          message:
            "VSH紹介者が見つかりません。"
        });

      }

      //----------------------------------
      // VSH利用可能状態確認
      //----------------------------------

      if (
        introducer.status !== "登録済" ||
        introducer.vshActive !== true ||
        introducer.snsActive !== true
      ) {

        return res.status(403).json({
          success: false,
          message:
            "このVSHは現在利用できません。"
        });

      }

      //----------------------------------
      // 紹介者の5件に含まれるか
      //----------------------------------

      if (
        !Array.isArray(
          introducer.flpNumbers
        ) ||
        !introducer.flpNumbers.some(
          flp =>
            String(flp) ===
            String(targetFLP)
        )
      ) {

        return res.status(400).json({
          success: false,
          message:
            "このVSHのFLP番号ではありません。"
        });

      }

      //----------------------------------
      // すでに登録済みか確認
      //----------------------------------

      const alreadyUsed =
        data.members.some(
          member =>
            String(member.flp) ===
              String(targetFLP)
        );

      if (alreadyUsed) {

        return res.status(409).json({
          success: false,
          message:
            "このFLP番号はすでに使用されています。"
        });

      }

      /*
       * 譲渡VSHの5件については、
       * RootのflpListを書き換えない。
       *
       * 実際の登録確定は /api/register で行う。
       */

      console.log(
        "譲渡VSH FLP使用開始:",
        introducer.name,
        introducer.flp,
        targetFLP
      );

      return res.json({

        success: true,

        source:
          "member",

        introducerName:
          introducer.name,

        introducerFLP:
          introducer.flp,

        flp:
          targetFLP

      });

    }


    /* ==================================
       ケース2
       ルートVSH
       従来処理を維持
    ================================== */

    const item =
      data.flpList.find(
        x =>
          String(x.flp) ===
          String(targetFLP)
      );

    if (!item) {

      return res.status(404).json({
        success: false,
        message:
          "FLP番号が見つかりません。"
      });

    }

    //----------------------------------
    // 未使用だけ使用中にする
    //----------------------------------

    if (item.status !== "未使用") {

      return res.status(409).json({
        success: false,
        message:
          "このFLP番号は現在使用できません。"
      });

    }

    item.status =
      "使用中";

    await saveAdmin(data);

    console.log(
      "ルートVSH FLP使用開始:",
      targetFLP
    );

    return res.json({

      success: true,

      source:
        "root",

      flp:
        targetFLP

    });

  }

  catch (err) {

    console.error(
      "FLP使用開始エラー:",
      err
    );

    return res.status(500).json({
      success: false,
      message:
        "FLP番号更新エラー"
    });

  }

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

    const data =
      await cleanupExpiredPendingMembers();

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
   第一世代登録確認
   確認中 → 登録済
========================= */

/* =========================
   第一世代登録確認
   確認中 → 登録済
   Day8 LINE送信
========================= */
/* =====================================================
   既存FBOへのVSH Day8直接譲渡準備
   ルートID専用

   Day0～Day7-3を通らず、
   既にFBO登録済みの方へ
   Day8からVSHを直接譲渡する

   ※LINEへの送信自体はルートIDが手動で行う
===================================================== */

/* =====================================================
   既存FBOへDay8直接譲渡
   ルートID専用
   Day8受取URL発行方式
===================================================== */

app.post("/api/direct-day8", async (req, res) => {

  try {

    //----------------------------------
    // 氏名・FLP番号取得
    //----------------------------------

    const name =
      String(
        req.body.name || ""
      ).trim();

    const flp =
      String(
        req.body.flp || ""
      ).trim();


    //----------------------------------
    // 入力確認
    //----------------------------------

    if (!name) {

      return res.status(400).json({
        success: false,
        message:
          "氏名を入力してください。"
      });

    }


    if (!/^\d{9}$/.test(flp)) {

      return res.status(400).json({
        success: false,
        message:
          "FLP番号は9桁の数字で入力してください。"
      });

    }


    //----------------------------------
    // 最新管理データ取得
    //----------------------------------

    const data =
      await loadAdmin();

    if (!Array.isArray(data.members)) {
      data.members = [];
    }


    //----------------------------------
    // 同じFLP番号の登録確認
    //----------------------------------

    let member =
      data.members.find(
        x =>
          String(x.flp) ===
          String(flp)
      );


    /* ==================================
       すでにVSH管理データにいる場合
    ================================== */

    if (member) {

      //----------------------------------
      // 登録済FBOのみ直接譲渡可能
      //----------------------------------

      if (member.status !== "登録済") {

        return res.status(409).json({
          success: false,
          message:
            "このFBOは現在「登録済」ではありません。"
        });

      }


      //----------------------------------
      // 本人専用Adminトークン
      // 既存なら再発行しない
      //----------------------------------

      if (!member.adminToken) {

        member.adminToken =
          createMemberAdminToken();

      }


      //----------------------------------
      // 氏名は今回入力値を保持
      //----------------------------------

      member.name =
        name;

    }


    /* ==================================
       VSH管理データにいない
       既存FBOの場合
    ================================== */

    else {

      member = {

        name:
          name,

        flp:
          flp,

        //--------------------------------
        // 既存FBOなので登録済
        //--------------------------------

        status:
          "登録済",

        //--------------------------------
        // ルートIDからの直接譲渡
        //--------------------------------

        vshIntroducerFLP:
          data.introducerFLP || "",

        vshIntroducerName:
          data.introducerName || "",

        //--------------------------------
        // VSH利用開始
        //--------------------------------

        vshActive:
          true,

        //--------------------------------
        // SNSはまだ開始しない
        // FLP番号5件登録後にON
        //--------------------------------

        snsActive:
          false,

        //--------------------------------
        // Day8直接譲渡
        //--------------------------------

        directDay8:
          true,

        //--------------------------------
        // LINE本人紐付け前
        //--------------------------------

        directDay8LineLinked:
          false,

        //--------------------------------
        // 登録日時
        //--------------------------------

        created:
          new Date().toISOString(),

        confirmed:
          new Date().toISOString(),

        //--------------------------------
        // 本人専用Admin
        //--------------------------------

        adminToken:
          createMemberAdminToken(),

        //--------------------------------
        // 本人の紹介用FLP番号
        //--------------------------------

        flpNumbers:
          [],

        //--------------------------------
        // VSH活動段階
        //
        // false = 第1段階
        // true  = 第2段階
        //--------------------------------

        faceToFaceActive:
          false,

        //--------------------------------
        // 使用済みFLP番号の履歴
        // 5人達成後も削除せず保存する
        //--------------------------------

        flpHistory:
          []

      };


      //----------------------------------
      // 第一世代登録者へ追加
      //----------------------------------

      data.members.push(
        member
      );

    }


    //----------------------------------
    // 直接譲渡情報を確定
    //----------------------------------

    member.directDay8 =
      true;

    member.vshActive =
      true;


    //----------------------------------
    // ルートIDを直接紹介者として記録
    //----------------------------------

    member.vshIntroducerFLP =
      data.introducerFLP || "";

    member.vshIntroducerName =
      data.introducerName || "";


    //----------------------------------
    // 5件未登録ならSNSは開始しない
    //----------------------------------

    if (
      !Array.isArray(member.flpNumbers) ||
      member.flpNumbers.length !== 5
    ) {

      member.snsActive =
        false;

    }


    //----------------------------------
    // LINE User IDがまだない場合
    // 本人紐付け待ち
    //----------------------------------

    if (!member.userId) {

      member.directDay8LineLinked =
        false;

    }


    //----------------------------------
    // 保存
    //----------------------------------

    await saveAdmin(data);


    //----------------------------------
    // 本人専用管理画面URL
    //----------------------------------

    const adminUrl =
      `https://vsh-server.onrender.com/member-admin/enter/${member.adminToken}`;


    //----------------------------------
    // Day8受取専用URL
    //
    // 次工程でこのURLのGET処理を作る
    //----------------------------------

    const day8ReceiveUrl =
      `https://vsh-server.onrender.com/vsh/direct-day8/${member.adminToken}`;


    //----------------------------------
    // LINE共有用の短い案内
    //----------------------------------

  const shareText =
`Vera Sky Harmony（VSH）を
Day8からあなたへ譲渡します。

下の専用URLを開いて、
Day8をご覧ください。

${day8ReceiveUrl}`;


    //----------------------------------
    // 正常終了
    //----------------------------------

    console.log(
      "既存FBO Day8直接譲渡URL発行:",
      member.name,
      member.flp
    );


    return res.json({

      success:
        true,

      name:
        member.name,

      flp:
        member.flp,

      adminUrl:
        adminUrl,

      day8ReceiveUrl:
        day8ReceiveUrl,

      shareText:
        shareText,

      directDay8:
        true

    });

  }


  catch (err) {

    console.error(
      "既存FBO Day8直接譲渡準備エラー:",
      err
    );


    return res.status(500).json({

      success:
        false,

      message:
        "Day8直接譲渡の準備でエラーが発生しました。"

    });

  }

});


/* =====================================================
   既存FBO Day8直接譲渡
   Day8専用WEB画面
   ※LINE User ID取得は行わない
===================================================== */

app.get(
  "/vsh/direct-day8/:adminToken",
  async (req, res) => {

    try {

      //----------------------------------
      // Adminトークン取得
      //----------------------------------

      const adminToken =
        String(
          req.params.adminToken || ""
        ).trim();


      if (!adminToken) {

        return res.status(400).send(
          "Day8受取情報がありません。"
        );

      }


      //----------------------------------
      // 最新管理データ取得
      //----------------------------------

      const data =
        await loadAdmin();


      if (!Array.isArray(data.members)) {

        data.members = [];

      }


      //----------------------------------
      // 直接譲渡した既存FBOを検索
      //----------------------------------

      const member =
        data.members.find(
          x =>
            x.adminToken &&
            String(x.adminToken) ===
              String(adminToken) &&
            x.directDay8 === true
        );


      if (!member) {

        return res.status(404).send(
          "Day8受取対象者が見つかりません。"
        );

      }


      //----------------------------------
      // 本人専用Admin URL
      //----------------------------------

      const adminUrl =
        `https://vsh-server.onrender.com/member-admin/enter/${member.adminToken}`;


      //----------------------------------
      // Day8 WEB画面
      //----------------------------------

      return res.send(`
<!DOCTYPE html>
<html lang="ja">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>
Vera Sky Harmony Day8
</title>

<style>

body {
  margin: 0;
  padding: 20px;
  background: #ffffff;
  color: #222222;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Helvetica Neue",
    "Yu Gothic",
    sans-serif;
  line-height: 1.8;
}

.container {
  max-width: 680px;
  margin: 0 auto;
}

.day8-image {
  width: 100%;
  height: auto;
  display: block;
  margin: 0 auto 25px auto;
  border-radius: 12px;
}

h1 {
  text-align: center;
  font-size: 25px;
  margin-bottom: 25px;
}

.section {
  margin: 28px 0;
}

.section-title {
  font-weight: bold;
  text-align: center;
  border-top: 1px solid #999999;
  border-bottom: 1px solid #999999;
  padding: 10px 0;
  margin: 25px 0 18px 0;
}

.admin-button {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin: 30px auto;
  padding: 16px 12px;
  text-align: center;
  text-decoration: none;
  background: #111111;
  color: #ffffff;
  font-size: 18px;
  font-weight: bold;
  border-radius: 8px;
}

.footer {
  text-align: center;
  margin-top: 35px;
  margin-bottom: 30px;
}

</style>

</head>

<body>

<div class="container">

<img
  class="day8-image"
  src="https://res.cloudinary.com/dxegzwukb/image/upload/v1787477831/vsh-day8-congratulations"
  alt="Vera Sky Harmony Day8"
>

<h1>
Vera Sky Harmony<br>
Day8
</h1>

<p>
${member.name} 様
</p>

<p>
あなたへ<br>
Vera Sky Harmony（VSH）を譲渡します。
</p>

<p>
ここから、あなた専用のVSHが始まります。
</p>


<div class="section-title">
FLPビジネスとは
</div>

<p>
FLPビジネスについてはこちらをご覧ください。
</p>

<p>
<a
  href="https://www.flpj.co.jp/business.html"
  target="_blank"
  rel="noopener noreferrer"
>
FLPビジネスを見る
</a>
</p>


<div class="section-title">
VSHの重要な目標
</div>

<p>
VSHでは、FBO登録後、
1か月以内を目標として、
最大2か月以内に
5人の新規登録者につなげることを
重要な運用条件としています。
</p>

<p>
これはFLPが定める
登録期限ではありません。
</p>

<p>
FLPのブレイクアウェイ方式による
報酬システムと、
ランクアップに伴う
ボーナスの仕組みを基礎として、
より早いランクアップを目指すために
VSHが設定した目標です。
</p>

<p>
※ランクアップや報酬額は、
FLP所定の資格・CC・組織実績などの
条件によって決まり、
一定のランクや収入を
保証するものではありません。
</p>


<div class="section-title">
最初で最後の作業
</div>

<p>
あなたが紹介する方のための
「あなたのFLP番号」
5人分を準備してください。
</p>

<p>
この作業が、
VSHで行う
最初で最後の作業です。
</p>


<div class="section-title">
手順①
</div>

<p>
FLP本社へ電話し、
スターターキットを
5冊注文してください。
</p>

<p>
<strong>FLP本社</strong><br>
0120-834-882
</p>

<p>
スターターキット<br>
1冊400円＋送料
</p>


<div class="section-title">
手順②
</div>

<p>
スターターキット内の
「エントリーガイド」にある
『フォーエバービジネスオーナー
（FBO）登録申請書』上部に記載されている
「あなたのFLP番号」を確認してください。
</p>

<p>
その番号を
あなたの管理画面へ
5人分登録してください。
</p>

<p>
「あなたのFLP番号」が
管理画面へ登録された時点から、
あなたへ譲渡された
Vera Sky Harmony（VSH）は、
SNS（YouTube・Instagram・X）による
紹介活動を開始します。
</p>


<div class="section-title">
重要 ― 最初の2か月
</div>

<p>
FBO登録後の最初の2か月は、
とても重要な期間です。
</p>

<p>
VSHでは、
1か月以内に5人、
遅くとも2か月以内に5人への連鎖を
目標とします。
</p>

<p>
FBO登録後は、
速やかにスターターキットを準備し、
5人分の「あなたのFLP番号」を
管理画面へ登録してください。
</p>

<p>
この作業が終わりましたら、
「エントリーガイド」
「商品販売ルール」をお読みください。
</p>


<div class="section-title">
あなたの管理画面
</div>

<p>
下のボタンから、
あなた専用の管理画面へ進んでください。
</p>

<a
  class="admin-button"
  href="${adminUrl}"
>
あなたの管理画面を開く
</a>


<div class="footer">
Vera Sky Harmony<br>
Version 1.1
</div>

</div>

</body>
</html>
      `);

    }


    catch (err) {

      console.error(
        "既存FBO Day8 WEB画面エラー:",
        err
      );


      return res.status(500).send(
        "Day8の表示でエラーが発生しました。"
      );

    }

  }
);
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
// 本人専用Adminトークン発行
// 既にある場合は再発行しない
//----------------------------------

if (!member.adminToken) {

  member.adminToken =
    createMemberAdminToken();

  console.log(
    "本人専用Adminトークン発行:",
    member.name,
    member.flp
  );

}
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
    },

    //----------------------------------
    // 本人専用管理画面ボタン
    //----------------------------------

    {
      type: "template",

      altText:
        "VSH あなたの管理画面",

      template: {

        type: "buttons",

        text:
          "スターターキットを受け取り、5人分の「あなたのFLP番号」を確認できましたら、下のボタンから管理画面へ進んでください。",

        actions: [

          {
            type: "uri",

            label:
              "あなたの管理画面を開く",

            uri:
              `https://vsh-server.onrender.com/member-admin/enter/${member.adminToken}`
          }

        ]

      }

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

/* =====================================================
   登録受付
   ルートVSH ＋ 譲渡VSH対応
   ※VSH側ではツリー管理を行わない
===================================================== */

app.post("/api/register", async (req, res) => {

  try {

    const name =
      String(req.body.name || "").trim();

    const flp =
      String(req.body.flp || "").trim();

    //----------------------------------
    // 基本確認
    //----------------------------------

    if (!name || !flp) {

      return res.status(400).json({
        success: false,
        message:
          "氏名またはFLP番号がありません。"
      });

    }

    //----------------------------------
    // 最新管理データ取得
    //----------------------------------

    const data =
      await loadAdmin();

    if (!Array.isArray(data.flpList)) {
      data.flpList = [];
    }

    if (!Array.isArray(data.members)) {
      data.members = [];
    }

    //----------------------------------
    // Cookie取得
    //----------------------------------

    const cookieHeader =
      req.headers.cookie || "";

    const cookies =
      Object.fromEntries(
        cookieHeader
          .split(";")
          .map(x => x.trim())
          .filter(Boolean)
          .map(x => {

            const index =
              x.indexOf("=");

            if (index === -1) {
              return [x, ""];
            }

            return [
              x.slice(0, index),
              decodeURIComponent(
                x.slice(index + 1)
              )
            ];

          })
      );

    const introducerFLP =
      cookies.vsh_introducer_flp;


    /* ==================================
       ケース1
       譲渡されたVSHからの登録
    ================================== */

    if (
  introducerFLP &&
  String(introducerFLP) !==
    String(data.introducerFLP || "")
) {

      //----------------------------------
      // 紹介者本人を確認
      //----------------------------------

      const introducer =
        data.members.find(
          member =>
            String(member.flp) ===
            String(introducerFLP)
        );

      if (!introducer) {

        return res.status(404).json({
          success: false,
          message:
            "VSH紹介者が見つかりません。"
        });

      }

      //----------------------------------
      // VSH利用状態確認
      //----------------------------------

      if (
        introducer.status !== "登録済" ||
        introducer.vshActive !== true ||
        introducer.snsActive !== true
      ) {

        return res.status(403).json({
          success: false,
          message:
            "このVSHは現在利用できません。"
        });

      }

      //----------------------------------
      // この紹介者の5件か確認
      //----------------------------------

      if (
        !Array.isArray(
          introducer.flpNumbers
        ) ||
        !introducer.flpNumbers.some(
          number =>
            String(number) ===
            String(flp)
        )
      ) {

        return res.status(400).json({
          success: false,
          message:
            "このVSHのFLP番号ではありません。"
        });

      }

      //----------------------------------
      // 同じFLP番号の重複登録防止
      //----------------------------------

      const alreadyRegistered =
        data.members.some(
          member =>
            String(member.flp) ===
            String(flp)
        );

      if (alreadyRegistered) {

        return res.status(409).json({
          success: false,
          message:
            "このFLP番号はすでに登録されています。"
        });

      }

      //----------------------------------
      // 新規登録者を保存
      //
      // vshIntroducerFLP は
      // このVSHの直接の紹介者を示すだけ。
      // ツリー管理には使用しない。
      //----------------------------------

      data.members.push({

        userId:
          req.body.userId || "",

        name:
          name,

        flp:
          flp,

        status:
          "確認中",

        vshIntroducerFLP:
          introducer.flp,

        vshIntroducerName:
          introducer.name,

        created:
          new Date().toISOString()

      });
     
      //----------------------------------
      // 永続保存
      //----------------------------------

      await saveAdmin(data);

      console.log(
        "譲渡VSH 登録受付:",
        introducer.name,
        introducer.flp,
        "→",
        name,
        flp
      );

      //----------------------------------
      // 登録成功を先に返す
      //----------------------------------

      res.json({

        success: true,

        source:
          "member",

        userName:
          name,

        userFLP:
          flp

      });

      //----------------------------------
      // 紹介者へのLINE通知
      // 失敗しても登録には影響させない
      //----------------------------------

      try {

        await pushToIntroducer(
          name,
          flp,
          req.body.userId
        );

      }
      catch (pushErr) {

        console.error(
          "紹介者LINE通知エラー:",
          pushErr
        );

      }

      return;

    }


    /* ==================================
       ケース2
       ルートVSH
       従来方式を維持
    ================================== */

    //----------------------------------
    // RootのFLP番号確認
    //----------------------------------

    const item =
      data.flpList.find(
        x =>
          String(x.flp) ===
          String(flp)
      );

    if (!item) {

      return res.status(404).json({
        success: false,
        message:
          "FLP番号が見つかりません。"
      });

    }

    //----------------------------------
    // 重複登録防止
    //----------------------------------

    const alreadyRegistered =
      data.members.some(
        member =>
          String(member.flp) ===
          String(flp)
      );

    if (alreadyRegistered) {

      return res.status(409).json({
        success: false,
        message:
          "このFLP番号はすでに登録されています。"
      });

    }

    //----------------------------------
    // Root FLPを使用済へ
    //----------------------------------

    item.status =
      "使用済";

    //----------------------------------
    // 登録者追加
    //----------------------------------

    data.members.push({

      userId:
        req.body.userId || "",

      name:
        name,

      flp:
        flp,

      status:
        "確認中",

      created:
        new Date().toISOString()

    });

    //----------------------------------
    // 永続保存
    //----------------------------------

    await saveAdmin(data);

    console.log(
      "ルートVSH 登録受付:",
      name,
      flp
    );

    //----------------------------------
    // 登録成功を先に返す
    //----------------------------------

    res.json({

      success: true,

      source:
        "root",

      userName:
        name,

      userFLP:
        flp

    });

    //----------------------------------
    // 紹介者へのLINE通知
    //----------------------------------

    try {

      await pushToIntroducer(
        name,
        flp,
        req.body.userId
      );

    }
    catch (pushErr) {

      console.error(
        "紹介者LINE通知エラー:",
        pushErr
      );

    }

  }

  catch (err) {

    console.error(
      "登録受付エラー:",
      err
    );

    if (!res.headersSent) {

      return res.status(500).json({
        success: false,
        message:
          "登録処理エラー"
      });

    }

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

/* =====================================================
   VSH 連続継承シミュレーション
   テスト専用
   ※本番データは一切変更しない
   ※LINEへは一切送信しない
   ※ツリー管理は行わない
===================================================== */

app.get("/api/test-vsh-chain", async (_req, res) => {

  try {

    const generations = [];

    //----------------------------------
    // テスト開始者
    //----------------------------------

    let introducer = {

      name: "TEST_ROOT",

      flp: "900000000",

      userId: "TEST_USER_000",

      status: "登録済",

      vshActive: true,

      snsActive: true

    };


    //----------------------------------
    // 10世代を順番に確認
    //----------------------------------

    for (let i = 1; i <= 10; i++) {

      //----------------------------------
      // この紹介者専用の
      // FLP番号5件を仮想作成
      //----------------------------------

      const flpNumbers = [];

      for (let n = 1; n <= 5; n++) {

        flpNumbers.push(
          String(
            900000000 +
            i * 10 +
            n
          )
        );

      }


      //----------------------------------
      // 5件登録完了
      //----------------------------------

      introducer.flpNumbers =
        flpNumbers;


      //----------------------------------
      // 次の登録者
      // 今回は5件のうち①を使用
      //----------------------------------

      const nextMember = {

        name:
          `TEST_MEMBER_${i}`,

        flp:
          flpNumbers[0],

        userId:
          `TEST_USER_${String(i).padStart(3, "0")}`,

        status:
          "確認中",

        //--------------------------------
        // 直接紹介者だけを記録
        //--------------------------------

        vshIntroducerFLP:
          introducer.flp,

        vshIntroducerName:
          introducer.name

      };


      //----------------------------------
      // 紹介者によるFBO登録確認
      //----------------------------------

      nextMember.status =
        "登録済";


      //----------------------------------
      // Day8後
      // VSH開始状態を再現
      //----------------------------------

      nextMember.vshActive =
        true;

      nextMember.snsActive =
        true;


      //----------------------------------
      // この世代の結果を保存
      // ※メモリ上のみ
      //----------------------------------

      generations.push({

        generation:
          i,

        introducer: {

          name:
            introducer.name,

          flp:
            introducer.flp,

          userId:
            introducer.userId

        },

        member: {

          name:
            nextMember.name,

          flp:
            nextMember.flp,

          userId:
            nextMember.userId,

          vshIntroducerFLP:
            nextMember.vshIntroducerFLP,

          status:
            nextMember.status,

          vshActive:
            nextMember.vshActive,

          snsActive:
            nextMember.snsActive

        },

        result:
          String(
            nextMember.vshIntroducerFLP
          ) ===
          String(
            introducer.flp
          )
            ? "OK"
            : "ERROR"

      });


      //----------------------------------
      // 次の世代では
      // 今登録した本人が紹介者になる
      //----------------------------------

      introducer =
        nextMember;

    }


    //----------------------------------
    // 全世代確認
    //----------------------------------

    const allOK =
      generations.every(
        x => x.result === "OK"
      );


    //----------------------------------
    // 結果
    //----------------------------------

    return res.json({

      success:
        allOK,

      test:
        "VSH連続継承10世代",

      generations:
        generations.length,

      lineSend:
        false,

      databaseSave:
        false,

      treeManagement:
        false,

      result:
        allOK
          ? "10世代すべて正常"
          : "異常あり",

      details:
        generations

    });

  }

  catch (err) {

    console.error(
      "VSH連続継承テストエラー:",
      err
    );

    return res.status(500).json({

      success: false,

      message:
        "VSH連続継承テストでエラーが発生しました。"

    });

  }

});
/* =====================================================
   VSH SNS自動解除シミュレーション
   テスト専用
   ※本番データは一切変更しない
   ※LINEへは一切送信しない
   ※既存10世代テストには影響しない
===================================================== */

app.get("/api/test-sns-auto-stop", async (_req, res) => {

  try {

    //----------------------------------
    // テスト用紹介者
    // 既FBOを想定
    //----------------------------------

    const introducer = {

      name:
        "TEST_EXISTING_FBO",

      flp:
        "922222222",

      status:
        "登録済",

      vshActive:
        true,

      snsActive:
        true

    };


    //----------------------------------
    // テスト用members
    // 本番data.membersは使用しない
    //----------------------------------

    const testMembers = [];


    //----------------------------------
    // 結果保存
    //----------------------------------

    const results = [];


    //----------------------------------
    // 直接紹介者5人を
    // 1人ずつ登録済にする
    //----------------------------------

    for (let i = 1; i <= 5; i++) {

      const member = {

        name:
          `TEST_DIRECT_${i}`,

        flp:
          String(
            930000000 + i
          ),

        status:
          "登録済",

        //--------------------------------
        // この人の直接紹介者
        //--------------------------------

        vshIntroducerFLP:
          introducer.flp,

        vshIntroducerName:
          introducer.name

      };


      //----------------------------------
      // テストmembersへ追加
      //----------------------------------

      testMembers.push(
        member
      );


      //----------------------------------
      // 本番と同じ条件で
      // 直接紹介の登録済人数を数える
      //----------------------------------

      const registeredDirectMembers =
        testMembers.filter(
          x =>
            String(
              x.vshIntroducerFLP || ""
            ) ===
              String(introducer.flp) &&
            x.status === "登録済"
        );


      //----------------------------------
      // 本番と同じ解除条件
      //----------------------------------

      if (
        registeredDirectMembers.length >= 5
      ) {

        introducer.snsActive =
          false;

        introducer.snsDeactivatedAt =
          new Date().toISOString();

      }


      //----------------------------------
      // 各段階を記録
      //----------------------------------

      results.push({

        registeredCount:
          registeredDirectMembers.length,

        snsActive:
          introducer.snsActive,

        result:
          (
            i < 5 &&
            introducer.snsActive === true
          ) ||
          (
            i === 5 &&
            introducer.snsActive === false
          )
            ? "OK"
            : "ERROR"

      });

    }


    //----------------------------------
    // 全段階確認
    //----------------------------------

    const allOK =
      results.every(
        x =>
          x.result === "OK"
      );


    //----------------------------------
    // 正常終了
    //----------------------------------

    return res.json({

      success:
        allOK,

      test:
        "VSH SNS自動解除",

      introducer: {

        name:
          introducer.name,

        flp:
          introducer.flp

      },

      databaseSave:
        false,

      lineSend:
        false,

      initialSnsActive:
        true,

      finalSnsActive:
        introducer.snsActive,

      registeredDirectMembers:
        testMembers.length,

      result:
        allOK
          ? "5人目でSNS自動解除・正常"
          : "SNS自動解除に異常あり",

      details:
        results

    });

  }


  catch (err) {

    console.error(
      "VSH SNS自動解除テストエラー:",
      err
    );


    return res.status(500).json({

      success:
        false,

      message:
        "SNS自動解除テストでエラーが発生しました。"

    });

  }

});
app.listen(Number(PORT || 10000), () => {
  console.log("=================================");
  console.log("VSH Stable Version Running");
  console.log("=================================");
});
