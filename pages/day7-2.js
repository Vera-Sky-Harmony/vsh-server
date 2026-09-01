// ========================================
// Day7-2.js
// Vera Sky Harmony Version 2.0
// 完全差し替え版
// ========================================

let myFLP = "";


// ========================================
// 初期表示
// ========================================

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
    // 保存ボタンを一時停止
    //----------------------------------

    const button =
        document.getElementById(
            "sendButton"
        );

    button.disabled = true;


    try {

        //----------------------------------
        // FLP番号使用開始
        //----------------------------------

        const useRes =
            await fetch(
                "/api/use-flp",
                {

                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    credentials:
                        "same-origin",

                    body:
                        JSON.stringify({

                            flp:
                                myFLP

                        })

                }
            );

        const useResult =
            await useRes.json();

        if (
            !useRes.ok ||
            !useResult.success
        ) {

            alert(
                useResult.message ||
                "FLP番号更新エラー"
            );

            button.disabled = false;

            return;
        }


        //----------------------------------
        // 登録データ保存
        //----------------------------------

        const registerRes =
            await fetch(
                "/api/register",
                {

                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    credentials:
                        "same-origin",

                    body:
                        JSON.stringify({

                            name:
                                name,

                            flp:
                                myFLP

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

            button.disabled = false;

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
        // VSH公式LINEを開く
        //
        // window.open は使用しない
        // 同じ画面からLINEへ移動する
        //----------------------------------

        const lineURL =
            "https://line.me/R/oaMessage/@591tvejt/?"
            + encodeURIComponent(
                introducerText
            );

        window.location.assign(
            lineURL
        );

    }

    catch (err) {

        console.error(
            "Day7-2 登録処理エラー:",
            err
        );

        alert(
            "通信エラーが発生しました。"
        );

        button.disabled = false;

    }

}
