//========================================
// day7-2.js
// Vera Sky Harmony Version1.2
//========================================

//----------------------------------------
// LIFF UserID
//----------------------------------------

let lineUserId = "";

//----------------------------------------
// 初期表示
//----------------------------------------

document.addEventListener("DOMContentLoaded", async () => {

    try {

        //----------------------------------------
        // LIFF初期化
        //----------------------------------------

        await liff.init({
    liffId: "2010988787-rxE0MS83"
});
        if (liff.isLoggedIn()) {

            const profile = await liff.getProfile();

            lineUserId = profile.userId;

        } else {

           

            return;

        }

        //----------------------------------------
        // 紹介者情報取得
        //----------------------------------------

        const res = await fetch("/api/next-flp");

        const data = await res.json();

        if (!data.success) {

            alert(data.message);

            return;

        }

        document.getElementById("name").textContent =
            data.introducerName;

        document.getElementById("flp").textContent =
            data.introducerFLP;

        document.getElementById("myflp").textContent =
            data.myFLP;

    } catch (err) {

        console.error(err);

        alert("初期データの取得に失敗しました。");

    }

});

//----------------------------------------
// 登録完了
//----------------------------------------

document.getElementById("sendButton").addEventListener("click", async () => {

    const name = prompt("あなたの氏名を入力してください");

    if (!name || name.trim() === "") {

        alert("氏名を入力してください。");

        return;

    }

    //----------------------------------------
    // LINE UserID確認
    //----------------------------------------

    if (!lineUserId) {

        alert("LINE情報を取得できませんでした。");

        return;

    }

    const flp =
        document.getElementById("myflp").textContent;

    try {

        const response = await fetch("/api/register", {

            method: "POST",

            headers: {

                "Content-Type": "application/json"

            },

            body: JSON.stringify({

                name: name.trim(),

                flp: flp,

                userId: lineUserId

            })

        });

        if (!response.ok) {

            alert("HTTPエラー：" + response.status);

            return;

        }

        const data = await response.json();

        if (!data.success) {

            alert(data.message);

            return;

        }

        //----------------------------------------
        // Day7-3はLINEへ送信
        //----------------------------------------

        alert("LINEをご確認ください。");

liff.closeWindow();

return;

    } catch (err) {

        console.error(err);

        alert("通信エラーが発生しました。");

    }

});
