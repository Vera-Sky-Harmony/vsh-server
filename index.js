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
   VSH紹介テスト入口
   SNS完成前の動作確認用
   ※ツリー管理は行わない
===================================================== */

app.get("/vsh/invite/:flp", async (req, res) => {

  try {

    const introducerFLP =
      String(req.params.flp || "").trim();

    //----------------------------------
    // 管理データ取得
    //----------------------------------

    const data =
      await loadAdmin();

    if (!Array.isArray(data.members)) {
      data.members = [];
    }

    //----------------------------------
    // このVSHの紹介者を確認
    //----------------------------------

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
    // VSH利用可能状態確認
    //----------------------------------

    if (
      introducer.status !== "登録済" ||
      introducer.vshActive !== true ||
      introducer.snsActive !== true
    ) {

      return res.status(403).send(
        "このVSHは現在利用できません。"
      );

    }

    //----------------------------------
    // 紹介用FLP番号5件確認
    //----------------------------------

    if (
      !Array.isArray(introducer.flpNumbers) ||
      introducer.flpNumbers.length !== 5
    ) {

      return res.status(403).send(
        "紹介用FLP番号が準備されていません。"
      );

    }

    //----------------------------------
    // このスマホに
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
      "VSH紹介入口:",
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
      "VSH紹介入口エラー:",
      err
    );

    return res.status(500).send(
      "VSH紹介入口エラー"
    );

  }

});
/* =====================================================
   VSH紹介者情報取得API
   VSH紹介者識別用
   ※ツリー管理は行わない
===================================================== */
app.get("/api/vsh-introducer/:flp", async (req, res) => {

  try {

    const introducerFLP =
      String(req.params.flp || "").trim();

    //----------------------------------
    // FLP番号確認
    //----------------------------------

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

    //----------------------------------
    // 紹介者を検索
    //----------------------------------

    const introducer =
      data.members.find(
        member =>
          String(member.flp) ===
            introducerFLP
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
    // VSH開始済みか確認
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
    // 5件確認
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
    // 正常
    //----------------------------------

    return res.json({

      success: true,

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
    // 管理データ取得
    //----------------------------------

    const data =
      await loadAdmin();

    if (!Array.isArray(data.members)) {
      data.members = [];
    }

    //----------------------------------
    // 紹介者検索
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
    // 5件確認
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
    // 正常
    //----------------------------------

    return res.json({

      success: true,

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
