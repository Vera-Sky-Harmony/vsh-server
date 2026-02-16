import express from "express";
import crypto from "crypto";
import { Client } from "@line/bot-sdk";

const {
  CHANNEL_ACCESS_TOKEN,
  CHANNEL_SECRET,
  INTRODUCER_NAME,
  INTRODUCER_FLP,
  ADMIN_NOTIFY_USER_ID,
  ADMIN_TOKEN,
  DAY7_1_IMAGE_URL, // 黄色
  DAY7_2_IMAGE_URL, // 青色
  FLP_OFFICIAL_URL,
  ENTRY_GUIDE_URL,
  PORT,
} = process.env;

const app = express();
const client = new Client({ channelAccessToken: CHANNEL_ACCESS_TOKEN });

let flpUnused = [];
let flpAssigned = new Map();
let flpConsumed = new Map();
const threePointsState = new Map();

app.get("/", (_req, res) => res.send("VSH server running"));

app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const signature = req.headers["x-line-signature"];
    const hash = crypto
      .createHmac("sha256", CHANNEL_SECRET)
      .update(req.body)
      .digest("base64");

    if (signature !== hash) return res.status(401).end();

    const body = JSON.parse(req.body.toString());
    await handleWebhook(body);
    res.status(200).end();
  } catch (e) {
    console.error(e);
    res.status(200).end();
  }
});

async function handleWebhook(body) {
  for (const ev of body.events || []) {
    if (!ev?.source?.userId) continue;
    const userId = ev.source.userId;

    if (ev.type === "message" && ev.message.type === "text") {
      const text = ev.message.text.trim();

      // 第一段階：黄色表示
      if (text === "登録希望") {
        await showYellowStep(userId);
        return;
      }

      // 第二段階：確定処理
      if (text === "登録確定") {
        await executeRegistration(userId);
        return;
      }

      if (text === "3点返信開始") {
        await startThreePointsFlow(userId);
        return;
      }

      await handleThreePointsConversation(userId, text);
    }

    if (ev.type === "message" && ev.message.type === "image") {
      await handleScreenshot(userId, ev.message.id);
    }
  }
}

async function showYellowStep(userId) {
  await client.pushMessage(userId, [
    {
      type: "text",
      text:
        "🌟1週間ありがとうございました！\n\n" +
        "あなたが登録すると、この✨Vera.Sky.Harmony✨があなたにプレゼントされます。\n" +
        "AIが紹介・登録・教育・拡散を自動化します。\n\n" +
        "下の黄色ボタンを押してください。",
    },
    buildYellowFlex(),
  ]);
}

function buildYellowFlex() {
  return {
    type: "flex",
    altText: "登録希望",
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url: DAY7_1_IMAGE_URL,
        size: "full",
        aspectMode: "cover",
        aspectRatio: "20:13",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            action: {
              type: "message",
              label: "登録希望",
              text: "登録確定",
            },
          },
        ],
      },
    },
  };
}

async function executeRegistration(userId) {
  if (flpUnused.length === 0) {
    await client.pushMessage(userId, {
      type: "text",
      text:
        "現在、受付準備中です。紹介者へご連絡ください。\n" +
        "※未使用FLP番号がありません。",
    });
    return;
  }

  const assignedFlp = flpUnused.shift();
  flpAssigned.set(userId, assignedFlp);

  await client.pushMessage(userId, [
    buildBlueFlex(),
    {
      type: "text",
      text:
        "あなたが登録するのに必要な3点をお送りします。\n\n" +
        `① 紹介者氏名：${INTRODUCER_NAME}\n` +
        `② 紹介者FLP番号：${INTRODUCER_FLP}\n` +
        `③ あなたのFLP番号：${assignedFlp}\n\n` +
        "登録完了後、青ボタンを押してください。",
    },
    {
      type: "text",
      text:
        "📘 登録手順書\n" +
        ENTRY_GUIDE_URL + "\n\n" +
        "🌐 FLP公式サイト\n" +
        FLP_OFFICIAL_URL,
    },
  ]);

  await client.pushMessage(ADMIN_NOTIFY_USER_ID, {
    type: "text",
    text:
      "【登録確定】\n" +
      `userId: ${userId}\n` +
      `割当FLP: ${assignedFlp}`,
  });
}

function buildBlueFlex() {
  return {
    type: "flex",
    altText: "3点返信開始",
    contents: {
      type: "bubble",
      hero: {
        type: "image",
        url: DAY7_2_IMAGE_URL,
        size: "full",
        aspectMode: "cover",
        aspectRatio: "20:13",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            action: {
              type: "message",
              label: "3点をLINEで返信する",
              text: "3点返信開始",
            },
          },
        ],
      },
    },
  };
}

async function startThreePointsFlow(userId) {
  threePointsState.set(userId, { step: 1 });
  await client.pushMessage(userId, {
    type: "text",
    text: "① 氏名を入力してください",
  });
}

async function handleThreePointsConversation(userId, text) {
  const state = threePointsState.get(userId);
  if (!state) return;

  if (state.step === 1) {
    state.name = text;
    state.step = 2;
    await client.pushMessage(userId, {
      type: "text",
      text: "② あなたのFLP番号を入力してください",
    });
    return;
  }

  if (state.step === 2) {
    state.flp = text;
    state.step = 3;
    await client.pushMessage(userId, {
      type: "text",
      text: "③ 購入画面スクリーンショットを送ってください",
    });
  }
}

async function handleScreenshot(userId, messageId) {
  const state = threePointsState.get(userId);
  if (!state || state.step !== 3) return;

  threePointsState.delete(userId);

  const assigned = flpAssigned.get(userId);

  flpAssigned.delete(userId);
  flpConsumed.set(userId, assigned);

  await client.pushMessage(ADMIN_NOTIFY_USER_ID, {
    type: "text",
    text:
      "【3点完了】\n" +
      `氏名:${state.name}\n` +
      `入力FLP:${state.flp}\n` +
      `割当FLP:${assigned}\n` +
      `スクショID:${messageId}`,
  });

  await client.pushMessage(userId, {
    type: "text",
    text: "確認完了しました。ありがとうございます。",
  });
}

app.listen(Number(PORT || 10000), () => {
  console.log("VSH Day7 two-step system running");
});
