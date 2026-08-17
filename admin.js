// admin.js
// Vera Sky Harmony Version1.2
// 完全版（PART1）
//
// 以下からコード開始
// ========================================

//----------------------------------------
// FLP入力欄30件作成
//----------------------------------------

const flpList = document.getElementById("flpList");

for (let i = 1; i <= 30; i++) {

    const row = document.createElement("div");

    row.className = "flpRow";

    row.innerHTML = `
        <label>${i}件目</label>
        <input
            type="text"
            id="flp${i}"
            placeholder="FLP番号">
    `;

    flpList.appendChild(row);

}

//----------------------------------------
// 管理データ読込み
//----------------------------------------

async function loadAdmin() {

    try {

        const res =
            await fetch("/api/admin");

        const data =
            await res.json();

        document.getElementById("introducerName").value =
            data.introducerName || "";

        document.getElementById("introducerFLP").value =
            data.introducerFLP || "";

        if (data.flpList) {

            data.flpList.forEach((item, index) => {

                const box =
                    document.getElementById(`flp${index + 1}`);

                if (!box) return;

                if (item.status === "使用済") {

                    box.value =
                        item.flp + "　【使用済】";

                    box.style.background =
                        "#d9d9d9";

                }

                else if (item.status === "使用中") {

                    box.value =
                        item.flp + "　【使用中】";

                    box.style.background =
                        "#fff3cd";

                }

                else {

                    box.value =
                        item.flp;

                    box.style.background =
                        "#ffffff";

                }

            });

        }

    }

    catch (err) {

        console.error(err);

        alert("管理データ読込みエラー");

    }

}

//----------------------------------------
// 第一世代登録者
//----------------------------------------

async function loadMembers() {

    try {

        const res =
            await fetch("/api/members");

        const data =
            await res.json();

        if (!data.success) return;

        const members =
            data.members.filter(
                x => x.status === "登録完了"
            );

        document.getElementById("memberCount").textContent =
            members.length;

        const tbody =
            document.getElementById("memberTable");

        tbody.innerHTML = "";

        members.forEach(member => {

            const tr =
                document.createElement("tr");

            tr.innerHTML = `
                <td>${member.name}</td>
                <td>${member.flp}</td>
            `;

            tbody.appendChild(tr);

        });

    }

    catch (err) {

        console.error(err);

    }

}

//----------------------------------------
// バックアップ保存
//----------------------------------------

document
.getElementById("backupButton")
.addEventListener("click", backupSave);

async function backupSave() {

    try {

        const old =
            await fetch("/api/admin");

        const oldData =
            await old.json();

        const flpArray = [];

        for (let i = 1; i <= 30; i++) {

            const value =
                document
                .getElementById(`flp${i}`)
                .value
                .replace("　【使用済】","")
                .replace("　【使用中】","")
                .trim();

            if (value === "") continue;

            const oldItem =
                oldData.flpList.find(
                    x => x.flp === value
                );

            flpArray.push({

                flp: value,

                status:
                    oldItem
                        ? oldItem.status
                        : "未使用"

            });

        }

        const body = {

            introducerName:
                document
                .getElementById("introducerName")
                .value,

            introducerFLP:
                document
                .getElementById("introducerFLP")
                .value,

            flpList:
                flpArray,

            members:
                oldData.members || []

        };

        //--------------------------------
        // root-admin.json 保存
        //--------------------------------

        const res =
            await fetch("/api/admin",{

                method:"POST",

                headers:{
                    "Content-Type":
                    "application/json"
                },

                body:
                JSON.stringify(body)

            });

        const result =
            await res.json();

        if(!result.success){

            alert("保存エラー");

            return;

        }

        //--------------------------------
        // バックアップ保存
        //--------------------------------

        const blob =
            new Blob(

                [
                    JSON.stringify(
                        body,
                        null,
                        2
                    )
                ],

                {
                    type:"application/json"
                }

            );

        const url =
            URL.createObjectURL(blob);

        const a =
            document.createElement("a");

        a.href = url;

        a.download =
            "root-admin-backup.json";

        a.click();

        URL.revokeObjectURL(url);

        alert(
            "バックアップを保存しました。"
        );

        loadAdmin();

        loadMembers();

    }

    catch(err){

        console.error(err);

        alert("バックアップ保存エラー");

    }

}

//----------------------------------------
// バックアップ読込
//----------------------------------------

document
.getElementById("restoreButton")
.addEventListener("click",()=>{

    document
    .getElementById("restoreFile")
    .click();

});

document
.getElementById("restoreFile")
.addEventListener("change",restoreBackup);

async function restoreBackup(e){

    try{

        const file =
            e.target.files[0];

        if(!file) return;

        const text =
            await file.text();

        const data =
            JSON.parse(text);

        const res =
            await fetch("/api/admin",{

                method:"POST",

                headers:{
                    "Content-Type":
                    "application/json"
                },

                body:
                JSON.stringify(data)

            });

        const result =
            await res.json();

        if(!result.success){

            alert("復元エラー");

            return;

        }

        alert("バックアップを復元しました。");

        loadAdmin();

        loadMembers();

    }

    catch(err){

        console.error(err);

        alert("バックアップ読込エラー");

    }

}

//----------------------------------------
// 初期表示
//----------------------------------------

loadAdmin();

loadMembers();

//----------------------------------------
// VSHともだち追加
//----------------------------------------

document
.getElementById("friendButton")
.addEventListener("click",async()=>{

    const url =
        "https://line.me/R/ti/p/@591tvejt";

    try{

        await navigator
        .clipboard
        .writeText(url);

        alert(`VSH公式LINEをコピーしました。

① LINEを開く
② 友だち又はグループ
③ 貼り付けて送信

${url}`);

    }

    catch{

        prompt(
            "下記URLをコピーしてください。",
            url
        );

    }

});
