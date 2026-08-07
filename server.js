// ========================================
// server.js
// Vera Sky Harmony Version1.0
// ========================================

const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const app = express();

app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

//========================================
// LINE設定
//========================================

const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;

//========================================
// root-admin.json
//========================================

const ROOT_ADMIN_FILE = path.join(__dirname, "root-admin.json");

function loadRootAdmin() {
    return JSON.parse(
        fs.readFileSync(ROOT_ADMIN_FILE, "utf8")
    );
}

function saveRootAdmin(data) {
    fs.writeFileSync(
        ROOT_ADMIN_FILE,
        JSON.stringify(data, null, 2),
        "utf8"
    );
}
//========================================
// Express基本設定
//========================================

const PORT = process.env.PORT || 3000;

// ホーム
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Day7-2
app.get("/pages/day7-2.html", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "pages", "day7-2.html"));
});

// Day7-3
app.get("/pages/day7-3.html", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "pages", "day7-3.html"));
});

// Day8
app.get("/pages/day8.html", (req, res) => {
   res.sendFile(path.join(__dirname, "public", "pages", "day8.html"));
});
//========================================
// LIFF 招待ページ
//========================================

app.get("/liff/invite", (req, res) => {
    res.sendFile(
        path.join(__dirname, "pages", "invite.html")
    );
});

app.get("/liff/invite.js", (req, res) => {
    res.sendFile(
        path.join(__dirname, "pages", "invite.js")
    );
});
// サーバー確認
app.get("/test", (req, res) => {
    //========================================
// 紹介者登録
//========================================

app.post("/api/introducer", (req, res) => {

    try {

        const { userId, displayName } = req.body;

        const admin = loadRootAdmin();

        admin.introducerUserId = userId;
        admin.introducerName = displayName;

        saveRootAdmin(admin);

        res.json({
            success: true
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: "紹介者登録エラー"
        });

    }

});
    res.json({
        success: true,
        message: "VSH Server Running"
    });
});
//========================================
// GET /api/next-flp
// 未使用のFLP番号を1件取得
//========================================

app.get("/api/next-flp", (req, res) => {

    try {

        const admin = loadRootAdmin();

        const next = admin.flpList.find(
            item => item.status === "未使用"
        );

        if (!next) {

            return res.json({
                success: false,
                message: "未使用のFLP番号がありません。"
            });

        }

        res.json({

            success: true,

            introducerName: admin.introducerName,

            introducerFLP: admin.introducerFLP,

            myFLP: next.flp

        });

    } catch (err) {

        console.error(err);

        res.status(500).json({

            success: false,

            message: "root-admin.json の読込みに失敗しました。"

        });

    }

});
//========================================
// POST /api/use-flp
// FLP番号を「使用済」に変更
//========================================

app.post("/api/use-flp", (req, res) => {

    try {

        const { flp } = req.body;

        const admin = loadRootAdmin();

        const target = admin.flpList.find(
            item => item.flp === flp
        );

        if (!target) {

            return res.json({

                success: false,

                message: "FLP番号が見つかりません。"

            });

        }

        if (target.status === "使用済") {

            return res.json({

                success: false,

                message: "既に使用済です。"

            });

        }

        target.status = "使用済";

        saveRootAdmin(admin);

        res.json({

            success: true

        });

    } catch (err) {

        console.error(err);

        res.status(500).json({

            success: false,

            message: "FLP番号更新エラー"

        });

    }

});
//========================================
// POST /api/register
// 新規登録受付
//========================================

app.post("/api/register", async (req, res) => {

    try {

        const { name, flp } = req.body;

        // 入力チェック
        if (!name || !flp) {

            return res.json({
                success: false,
                message: "氏名またはFLP番号がありません。"
            });

        }

        // root-admin.json読込み
        const admin = loadRootAdmin();

        // FLP番号検索
        const target = admin.flpList.find(
            item => item.flp === flp
        );

        if (!target) {

            return res.json({
                success: false,
                message: "FLP番号が存在しません。"
            });

        }

        // 既に使用済みか確認
        if (target.status === "使用済") {

            return res.json({
                success: false,
                message: "このFLP番号は既に使用済です。"
            });

        }

        // 使用済へ変更
        target.status = "使用済";

        // 保存
        saveRootAdmin(admin);

        // 紹介者へPush Message
        try {

            await pushRegisterComplete(name, flp);

        } catch (err) {

            console.error("Push Message Error:", err);

        }

        // 新規登録者へ結果を返す
        return res.json({

            success: true,

            message: "登録受付が完了しました。",

            introducerName: admin.introducerName,

            introducerFLP: admin.introducerFLP,

            userName: name,

            userFLP: flp

        });

    } catch (err) {

        console.error(err);

        return res.status(500).json({

            success: false,

            message: "登録処理エラー"

        });

    }

});
//========================================
// LINE Webhook
//========================================

app.post("/webhook", async (req, res) => {

    try {

        const events = req.body.events || [];

        for (const event of events) {

            // メッセージ以外は無視
            if (event.type !== "message") continue;

            if (event.message.type !== "text") continue;

            const userId = event.source.userId;

            const text = event.message.text.trim();

            //----------------------------------
            // 管理者登録
            //----------------------------------

            if (text === "管理者登録") {

                const admin = loadRootAdmin();

                admin.introducerUserId = userId;

                saveRootAdmin(admin);

                await axios.post(
                    "https://api.line.me/v2/bot/message/reply",
                    {
                        replyToken: event.replyToken,
                        messages: [
                            {
                                type: "text",
                                text:
"管理者登録が完了しました。"
                            }
                        ]
                    },
                    {
                        headers: {
                            "Content-Type":
                                "application/json",
                            "Authorization":
                                `Bearer ${CHANNEL_ACCESS_TOKEN}`
                        }
                    }
                );

                continue;

            }

            //----------------------------------
            // その他
            //----------------------------------

            await axios.post(
                "https://api.line.me/v2/bot/message/reply",
                {
                    replyToken: event.replyToken,
                    messages: [
                        {
                            type: "text",
                            text:
"Vera Sky Harmonyをご利用いただきありがとうございます。"
                        }
                    ]
                },
                {
                    headers: {
                        "Content-Type":
                            "application/json",
                        "Authorization":
                            `Bearer ${CHANNEL_ACCESS_TOKEN}`
                    }
                }
            );

        }

        res.sendStatus(200);

    } catch (err) {

        console.error(err);

        res.sendStatus(500);

    }

});
//========================================
// LINE Push Message
// 紹介者へ【登録完了】を送信
//========================================

async function pushRegisterComplete(userName, userFLP) {

    try {

        const admin = loadRootAdmin();

        // 管理者登録されていない場合
        if (!admin.introducerUserId) {

            console.log("紹介者LINE User ID未登録");

            return;

        }

        const message =
`【登録完了】

氏名：${userName}

FLP番号：${userFLP}`;

        await axios.post(

            "https://api.line.me/v2/bot/message/push",

            {

                to: admin.introducerUserId,

                messages: [

                    {

                        type: "text",

                        text: message

                    }

                ]

            },

            {

                headers: {

                    "Content-Type": "application/json",

                    "Authorization":
                        `Bearer ${CHANNEL_ACCESS_TOKEN}`

                }

            }

        );

        console.log("紹介者へPush Message送信完了");

    } catch (err) {

        console.error("Push Message Error:", err.response?.data || err.message);

    }

}
//========================================
// サーバー起動
//========================================

app.listen(PORT, () => {

    console.log("========================================");
    console.log("Vera Sky Harmony Version1.0");
    console.log("Server Started");
    console.log(`Port : ${PORT}`);
    console.log("========================================");

});


