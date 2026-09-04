// ========================================
// Day7-2.js
// Vera Sky Harmony Version 2.0
// LINE専用token方式・完全版
// ========================================

let myFLP = "";


// ========================================
// 初期表示
// LINEで決定済みのDay7-2割当を表示
// ========================================

window.onload = async () => {

    try {

        //----------------------------------
        // LINEから渡された専用token取得
        //----------------------------------

        const params =
            new URLSearchParams(
                window.location.search
            );

        const token =
            String(
                params.get("t") || ""
            ).trim();


        if (!token) {

            alert(
                "Day7-2の確認情報がありません。\nLINEの「Day7-2を開く」から進んでください。"
            );

            return;
        }


        //----------------------------------
        // LINEで決定済みの割当を取得
        //----------------------------------

        const res =
            await fetch(
                "/api/day7-2-assignment?t=" +
                encodeURIComponent(token),
                {
                    credentials:
                        "same-origin"
                }
            );

        const data =
            await res.json();


       if (
    !res.ok ||
    !data.success
) {

    alert(
        data.message ||
        "Day7-2の情報を取得できません。"
    );

    //----------------------------------
    // 登録済みなら再登録ボタンを無効化
    //----------------------------------

    if (data.blocked === true) {

        const button =
            document.getElementById(
                "sendButton"
            );

        if (button) {
            button.disabled = true;
        }
    }

    return;
}


        //----------------------------------
        // 紹介者氏名
        //----------------------------------

        document
            .getElementById("name")
            .textContent =
                data.introducerName;


        //----------------------------------
        // 紹介者FLP番号
        //----------------------------------

        document
            .getElementById("flp")
            .textContent =
                data.introducerFLP;


        //----------------------------------
        // あなたのFLP番号
        //----------------------------------

        document
            .getElementById("myflp")
            .textContent =
                data.myFLP;


        myFLP =
            String(
                data.myFLP || ""
            ).trim();

    }

    catch (err) {

        console.error(
            "Day7-2 初期表示エラー:",
            err
        );

        alert(
            "サーバーへ接続できません。"
        );

    }

};


// ========================================
// ボタン
// ========================================

document
    .getElementById("sendButton")
    .addEventListener(
        "click",
        startLINE
    );


// ========================================
// 登録完了をLINEで送信
// Day7-2 LINE専用token方式
// ========================================

async function startLINE() {

    //----------------------------------
    // FLP番号確認
    //----------------------------------

    if (!myFLP) {

        alert(
            "FLP番号が取得できていません。"
        );

        return;
    }


    //----------------------------------
    // URLからDay7-2 token取得
    //----------------------------------

    const params =
        new URLSearchParams(
            window.location.search
        );

    const token =
        String(
            params.get("t") || ""
        ).trim();


    if (!token) {

        alert(
            "Day7-2の確認情報がありません。\nLINEの「Day7-2を開く」から進んでください。"
        );

        return;
    }


    //----------------------------------
    // 氏名入力
    //----------------------------------

    const userName =
        prompt(
            "あなたの氏名を入力してください。"
        );


    if (!userName) {
        return;
    }


    const name =
        userName.trim();


    if (!name) {
        return;
    }


    //----------------------------------
    // ボタンを一時停止
    //----------------------------------

    const button =
        document.getElementById(
            "sendButton"
        );


    if (button) {
        button.disabled = true;
    }


    try {

        //----------------------------------
        // LINE専用tokenで登録受付
        //----------------------------------

        const registerRes =
            await fetch(
                "/api/day7-2-register",
                {

                    method:
                        "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    credentials:
                        "same-origin",

                    body:
                        JSON.stringify({

                            token:
                                token,

                            name:
                                name

                        })

                }
            );


        const registerResult =
            await registerRes.json();


        if (
            !registerRes.ok ||
            !registerResult.success
        ) {

            alert(
                registerResult.message ||
                "登録処理エラー"
            );


           //----------------------------------
// 登録済みならボタンを無効のままにする
//----------------------------------

if (button) {

    if (registerResult.blocked === true) {
        button.disabled = true;
    } else {
        button.disabled = false;
    }

}


            return;
        }


        //----------------------------------
        // LINEへ渡す登録完了メッセージ
        //----------------------------------

        const introducerText =

`【登録完了】

氏名：${name}

FLP番号：${myFLP}`;


        //----------------------------------
        // VSH公式LINEへ戻る
        //
        // window.open は使用しない
        // 同じ画面からLINEへ移動する
        //----------------------------------

        const lineURL =
            "https://line.me/R/oaMessage/@591tvejt/?"
            +
            encodeURIComponent(
                introducerText
            );


        window.location.assign(
            lineURL
        );

    }

    catch (err) {

        console.error(
            "Day7-2 LINE登録処理エラー:",
            err
        );


        alert(
            "通信エラーが発生しました。"
        );


        if (button) {
            button.disabled = false;
        }

    }

}
