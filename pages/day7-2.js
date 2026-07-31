// ========================================
// Day7-2.js
// Vera Sky Harmony Version1.0
// ========================================

let myFLP = "";

//==============================
// 初期表示
//==============================

window.onload = async function () {

    alert("① onload開始");

    try {

        const res = await fetch("/api/next-flp");

        alert("② API取得成功");

        const data = await res.json();

        alert("③ myFLP = " + data.myFLP);

        if (!data.success) {

            alert("未使用のFLP番号がありません。");

            return;

        }

        document.getElementById("name").textContent =
            data.introducerName;

        document.getElementById("flp").textContent =
            data.introducerFLP;

        document.getElementById("myflp").textContent =
            data.myFLP;

        myFLP = data.myFLP;

    } catch (err) {

        console.error(err);

        alert("サーバーへ接続できません。");

    }

};

//==============================
// LINE送信ボタン
//==============================

document
    .getElementById("sendButton")
    .addEventListener("click", startLINE);

//==============================
// LINE送信
//==============================

async function startLINE() {

    alert("startLINEが呼ばれました");

    // FLP番号取得確認
    if (!myFLP) {

        alert("FLP番号が取得できていません。ページを再読み込みしてください。");

        return;

    }

    // 二重クリック防止
    const button = document.getElementById("sendButton");

    button.disabled = true;

    const userName =
        prompt("あなたの氏名を入力してください。");

    if (!userName) {

        button.disabled = false;

        return;

    }

    try {

        //----------------------------------
        // FLP番号を使用中へ変更
        //----------------------------------

        const res = await fetch("/api/use-flp", {

            method: "POST",

            headers: {

                "Content-Type": "application/json"

            },

            body: JSON.stringify({

                flp: myFLP

            })

        });

        const result = await res.json();

        if (!result.success) {

            button.disabled = false;

            alert("FLP番号の更新に失敗しました。");

            return;

        }

        //----------------------------------
        // LINEメッセージ作成
        //----------------------------------

        const text =
`【VSH登録完了】

氏名：${userName}

FLP番号：${myFLP}

登録ありがとうございます。

紹介者がFBO登録完了を確認後、

Day8（VSH譲渡）を送信します。`;

        //----------------------------------
        // LINE起動
        //----------------------------------

        window.open(
            "https://line.me/R/oaMessage/@591tvejt/?"
            + encodeURIComponent(text),
            "_blank"
        );

        setTimeout(() => {

            window.location.href = "/pages/day7-3.html";

        }, 1000);

    } catch (err) {

        button.disabled = false;

        console.error(err);

        alert("通信エラーが発生しました。");

    }

