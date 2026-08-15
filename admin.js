// ========================================
// admin.js
// Vera Sky Harmony Version1.1
// 完成版
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

        const res = await fetch("/api/admin");
        const data = await res.json();

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

                    box.style.background = "#d9d9d9";

                }

                else if (item.status === "使用中") {

                    box.value =
                        item.flp + "　【使用中】";

                    box.style.background = "#fff3cd";

                }

                else {

                    box.value = item.flp;

                    box.style.background = "#ffffff";

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
// 保存
//----------------------------------------

document
.getElementById("saveButton")
.addEventListener("click", saveAdmin);

async function saveAdmin() {

    const old =
        await fetch("/api/admin");

    const oldData =
        await old.json();

    const flpArray = [];

    for (let i = 1; i <= 30; i++) {

        const value =
            document.getElementById(`flp${i}`)
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
            document.getElementById("introducerName").value,

        introducerFLP:
            document.getElementById("introducerFLP").value,

        flpList: flpArray,

        members:
            oldData.members || []

    };

    try {

        const res =
            await fetch("/api/admin",{

                method:"POST",

                headers:{
                    "Content-Type":"application/json"
                },

                body:JSON.stringify(body)

            });

        const data =
            await res.json();

        if(data.success){

            alert("保存しました。");

            loadAdmin();

            loadMembers();
alert("admin.js 読み込み完了");

        }

    }

    catch(err){

        console.error(err);

        alert("保存エラー");

    }

}

//----------------------------------------
// 第一世代登録者一覧
//----------------------------------------

async function loadMembers() {

    try {

        const res =
            await fetch("/api/members");

        const data =
            await res.json();

        if(!data.success) return;

        const members =
    data.members.filter(
        x => x.status === "登録完了"
    );

document.getElementById("memberCount")
    .textContent =
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

    catch(err){

        console.error(err);

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

        await navigator.clipboard.writeText(url);

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
