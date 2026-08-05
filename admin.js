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

    const body = {

        introducerName:
            document.getElementById(
                "introducerName"
            ).value,

        introducerFLP:
            document.getElementById(
                "introducerFLP"
            ).value,

        flpList: flpArray

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

        }

    }

    catch (err) {

        console.error(err);

        alert("保存エラー");

    }

}

//----------------------------------------
// 第一世代一覧
//----------------------------------------

function loadMembers() {

    document.getElementById(
        "memberCount"
    ).textContent = "0";

    document.getElementById(
        "memberTable"
    ).innerHTML = "";

}

//----------------------------------------

loadAdmin();

loadMembers();
