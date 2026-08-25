// ========================================
// Day7-2.js
// Vera Sky Harmony Version2.0
// 完成版（全面差し替え）
// ========================================

let myFLP = "";


// ========================================
// 初期表示
// ========================================

window.onload = async () => {

    try {

        const res =
            await fetch("/api/next-flp");

        if (!res.ok) {
            throw new Error("API Error");
        }

        const data =
            await res.json();

        if (!data.success) {

            alert(
                "未使用のFLP番号がありません。"
            );

            return;
        }

        document
            .getElementById("name")
            .textContent =
                data.introducerName;

        document
            .getElementById("flp")
            .textContent =
                data.introducerFLP;

        document
            .getElementById("myflp")
            .textContent =
                data.myFLP;

        myFLP =
            data.myFLP;

    }

    catch (err) {

        console.error(err);

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
// LINE送信
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
    // ボタン一時停止
    //----------------------------------

    const button =
        document.getElementById(
            "sendButton"
        );

    button.disabled = true;

    //----------------------------------
    // 氏名入力
    //----------------------------------

    const userName =
        prompt(
            "あなたの氏名を入力してください。"
        );

    if (!userName) {

        button.disabled = false;

        return;
    }

    try {

        //----------------------------------
        // FLP番号を使用中へ変更
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

                    body:
                        JSON.stringify({

                            flp:
                                myFLP

                        })

                }
            );

        const useResult =
            await useRes.json();

        if (!useResult.success) {

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

                    body:
                        JSON.stringify({

                            name:
                                userName,

                            flp:
                                myFLP

                        })

                }
            );

        const registerResult =
            await registerRes.json();

        if (!registerResult.success) {

            alert(
                registerResult.message ||
                "登録処理エラー"
            );

            button.disabled = false;

            return;
        }


        //----------------------------------
        // LINE送信用メッセージ
        //----------------------------------

        const introducerText =

`【登録完了】

氏名：${userName}

FLP番号：${myFLP}`;


        //----------------------------------
        // LINEを開く
        // window.open は使用しない
        //----------------------------------

        window.location.href =
            "https://line.me/R/oaMessage/@591tvejt/?"
            + encodeURIComponent(
                introducerText
            );

    }

    catch (err) {

        console.error(err);

        alert(
            "通信エラーが発生しました。"
        );

        button.disabled = false;

    }

}
