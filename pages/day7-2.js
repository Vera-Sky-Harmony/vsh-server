//========================================
// day7-2.js
// Vera Sky Harmony Version1.0
//========================================

//----------------------------------------
// 初期表示
//----------------------------------------

document.addEventListener("DOMContentLoaded", async () => {

    try {

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
// 「登録完了をLINEで送信する」
//----------------------------------------

document.getElementById("sendButton").addEventListener("click", async () => {

    const name = prompt("あなたの氏名を入力してください");

    if (!name || name.trim() === "") {

        alert("氏名を入力してください。");

        return;

    }

    const flp = document.getElementById("myflp").textContent;

    try {

        const response = await fetch("/api/register", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({

                name: name.trim(),

                flp: flp

            })

        });
if (!response.ok) {
    alert("HTTPエラー：" + response.status);
}
        const data = await response.json();

        if (!data.success) {

            alert(data.message);

            return;

        }

        alert(
`【登録完了】

氏名：${data.userName}

FLP番号：${data.userFLP}`
        );

        // Day7-3へ移動
        window.location.href = "/pages/day7-3.html";

    } catch (err) {

        console.error(err);

        alert("通信エラーが発生しました。");

    }

});
