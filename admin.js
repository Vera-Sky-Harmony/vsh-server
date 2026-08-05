// ========================================
// admin.js
// Vera Sky Harmony Version1.0
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
                    document.getElementById(
                        `flp${index + 1}`
                    );

                if (box) {

                    box.value = item.flp;

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

    const flpArray = [];

    for (let i = 1; i <= 30; i++) {

        const value =
            document.getElementById(
                `flp${i}`
            ).value.trim();

        if (value !== "") {

            flpArray.push({

                flp: value,

                status: "未使用"

            });

        }

    }
const old = await fetch("/api/admin");
const oldData = await old.json();

const body = {

    introducerName:
        document.getElementById(
            "introducerName"
        ).value,

    introducerFLP:
        document.getElementById(
            "introducerFLP"
        ).value,

    flpList: flpArray,

    members: oldData.members || []

};

    try {

        const res = await fetch(

            "/api/admin",

            {

                method: "POST",

                headers: {

                    "Content-Type":
                    "application/json"

                },

                body: JSON.stringify(body)

            }

        );

        const data =
            await res.json();

        if (data.success) {

            alert("保存しました。");
loadMembers();
        }

    }

    catch (err) {

        console.error(err);

        alert("保存エラー");

    }

}



//----------------------------------------

loadAdmin();
loadMembers();
/* =========================
   第一世代登録者一覧
========================= */

async function loadMembers() {

    try {

        const res = await fetch("/api/members");

        const data = await res.json();

        if (!data.success) return;

        const count = document.getElementById("memberCount");
        const tbody = document.getElementById("memberTable");

        count.textContent = data.members.length;

        tbody.innerHTML = "";

        data.members.forEach(member => {

            const tr = document.createElement("tr");

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

document
.getElementById("friendButton")
.addEventListener("click", async () => {

    alert("この機能は次に実装します。");

});
