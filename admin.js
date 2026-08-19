// admin.js
// Vera Sky Harmony Version1.3
// Root Admin 永続保存対応 完成版
//
// ========================================
// 既存機能を維持したまま
// FLP番号30件を確実にSupabaseへ保存
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
// 読み込んだ管理データを保持
//----------------------------------------

let adminData = {

    introducerName: "",
    introducerFLP: "",
    introducerUserId: "",
    flpList: [],
    members: []

};


//----------------------------------------
// 管理データ読込み
//----------------------------------------

async function loadAdmin() {

    try {

        const res = await fetch("/api/admin");

        if (!res.ok) {
            throw new Error(
                `管理データ取得エラー HTTP ${res.status}`
            );
        }

        const data = await res.json();

        adminData = {

            introducerName:
                data.introducerName || "",

            introducerFLP:
                data.introducerFLP || "",

            introducerUserId:
                data.introducerUserId || "",

            flpList:
                Array.isArray(data.flpList)
                    ? data.flpList
                    : [],

            members:
                Array.isArray(data.members)
                    ? data.members
                    : []

        };


        //--------------------------------
        // 紹介者情報表示
        //--------------------------------

        document
        .getElementById("introducerName")
        .value =
            adminData.introducerName;

        document
        .getElementById("introducerFLP")
        .value =
            adminData.introducerFLP;


        //--------------------------------
        // FLP番号30件表示
        //--------------------------------

        for (let i = 1; i <= 30; i++) {

            const box =
                document.getElementById(`flp${i}`);

            if (!box) continue;

            const item =
                adminData.flpList.find(
                    x => Number(x.no) === i
                )
                ||
                adminData.flpList[i - 1];

            if (!item) {

                box.value = "";
                box.style.background =
                    "#ffffff";

                continue;

            }

            const flp =
                item.flp || "";

            const status =
                item.status || "未使用";


            if (status === "使用済") {

                box.value =
                    flp + "　【使用済】";

                box.style.background =
                    "#d9d9d9";

            }

            else if (status === "使用中") {

                box.value =
                    flp + "　【使用中】";

                box.style.background =
                    "#fff3cd";

            }

            else {

                box.value = flp;

                box.style.background =
                    "#ffffff";

            }

        }

    }

    catch (err) {

        console.error(
            "管理データ読込みエラー:",
            err
        );

        alert(
            "管理データ読込みエラー"
        );

    }

}


//----------------------------------------
// 第一世代登録者
//----------------------------------------

async function loadMembers() {

    try {

        const res =
            await fetch("/api/members");

        if (!res.ok) {

            throw new Error(
                `登録者取得エラー HTTP ${res.status}`
            );

        }

        const data =
            await res.json();

        if (!data.success) return;


        const sourceMembers =
            Array.isArray(data.members)
                ? data.members
                : [];


        const members =
            sourceMembers.filter(
                x =>
                    x.status ===
                    "登録完了"
            );


        document
        .getElementById("memberCount")
        .textContent =
            members.length;


        const tbody =
            document.getElementById(
                "memberTable"
            );

        tbody.innerHTML = "";


        members.forEach(member => {

            const tr =
                document.createElement("tr");

            tr.innerHTML = `
                <td>${member.name || ""}</td>
                <td>${member.flp || ""}</td>
            `;

            tbody.appendChild(tr);

        });

    }

    catch (err) {

        console.error(
            "第一世代登録者読込みエラー:",
            err
        );

    }

}


//----------------------------------------
// FLP番号30件を保存用配列へ変換
//----------------------------------------

function createFLPArray() {

    const result = [];

    for (let i = 1; i <= 30; i++) {

        const box =
            document.getElementById(
                `flp${i}`
            );

        let value =
            box
            ? box.value
            : "";

        value =
            value
            .replace(
                "　【使用済】",
                ""
            )
            .replace(
                "　【使用中】",
                ""
            )
            .trim();


        //--------------------------------
        // 現在の状態を保持
        //--------------------------------

        const oldItem =
            adminData.flpList.find(
                x => Number(x.no) === i
            )
            ||
            adminData.flpList[i - 1];


        let status =
            oldItem?.status ||
            "未使用";


        //--------------------------------
        // 画面表示からも状態確認
        //--------------------------------

        if (
            box &&
            box.value.includes(
                "【使用済】"
            )
        ) {

            status = "使用済";

        }

        else if (
            box &&
            box.value.includes(
                "【使用中】"
            )
        ) {

            status = "使用中";

        }


        result.push({

            no: i,

            flp: value,

            status: status

        });

    }

    return result;

}


//----------------------------------------
// バックアップ保存
//----------------------------------------

document
.getElementById("backupButton")
.addEventListener(
    "click",
    backupSave
);


async function backupSave() {

    try {

        //--------------------------------
        // 現在のサーバーデータ取得
        //--------------------------------

        const old =
            await fetch("/api/admin");

        if (!old.ok) {

            throw new Error(
                `保存前データ取得エラー HTTP ${old.status}`
            );

        }

        const oldData =
            await old.json();


        //--------------------------------
        // FLP番号30件を必ず取得
        //--------------------------------

        const flpArray =
            createFLPArray();


        //--------------------------------
        // 保存データ作成
        //--------------------------------

        const body = {

            introducerName:
                document
                .getElementById(
                    "introducerName"
                )
                .value
                .trim(),

            introducerFLP:
                document
                .getElementById(
                    "introducerFLP"
                )
                .value
                .trim(),

            introducerUserId:
                oldData.introducerUserId
                ||
                adminData.introducerUserId
                ||
                "",

            flpList:
                flpArray,

            members:
                Array.isArray(
                    oldData.members
                )
                ? oldData.members
                : (
                    Array.isArray(
                        adminData.members
                    )
                    ? adminData.members
                    : []
                )

        };


        //--------------------------------
        // Supabaseへ保存
        //--------------------------------

        const res =
            await fetch(
                "/api/admin",
                {

                    method:
                        "POST",

                    headers: {

                        "Content-Type":
                            "application/json"

                    },

                    body:
                        JSON.stringify(
                            body
                        )

                }
            );


        let result;

        try {

            result =
                await res.json();

        }

        catch {

            throw new Error(
                `保存応答エラー HTTP ${res.status}`
            );

        }


        if (
            !res.ok ||
            !result.success
        ) {

            throw new Error(
                `管理データ保存失敗 HTTP ${res.status}`
            );

        }


        //--------------------------------
        // 保存成功後
        // ローカル保持データ更新
        //--------------------------------

        adminData = body;


        //--------------------------------
        // JSONバックアップ作成
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
                    type:
                        "application/json"
                }
            );


        const url =
            URL.createObjectURL(
                blob
            );


        const a =
            document.createElement(
                "a"
            );

        a.href = url;

        a.download =
            "root-admin-backup.json";

        a.click();


        setTimeout(
            () => {

                URL.revokeObjectURL(
                    url
                );

            },
            1000
        );


        alert(
            "バックアップを保存しました。"
        );


        //--------------------------------
        // 保存内容を再読込み
        //--------------------------------

        await loadAdmin();

        await loadMembers();

    }

    catch (err) {

        console.error(
            "バックアップ保存エラー:",
            err
        );

        alert(
            "バックアップ保存エラー"
        );

    }

}


//----------------------------------------
// バックアップ読込
//----------------------------------------

document
.getElementById("restoreButton")
.addEventListener(
    "click",
    () => {

        document
        .getElementById(
            "restoreFile"
        )
        .click();

    }
);


document
.getElementById("restoreFile")
.addEventListener(
    "change",
    restoreBackup
);


async function restoreBackup(e) {

    try {

        const file =
            e.target.files[0];

        if (!file) return;


        const text =
            await file.text();


        const data =
            JSON.parse(text);


        //--------------------------------
        // 基本データ確認
        //--------------------------------

        if (
            !data ||
            typeof data !==
                "object"
        ) {

            throw new Error(
                "バックアップ形式エラー"
            );

        }


        //--------------------------------
        // FLPリスト形式を維持
        //--------------------------------

        if (
            !Array.isArray(
                data.flpList
            )
        ) {

            data.flpList = [];

        }


        if (
            !Array.isArray(
                data.members
            )
        ) {

            data.members = [];

        }


        //--------------------------------
        // Supabaseへ復元
        //--------------------------------

        const res =
            await fetch(
                "/api/admin",
                {

                    method:
                        "POST",

                    headers: {

                        "Content-Type":
                            "application/json"

                    },

                    body:
                        JSON.stringify(
                            data
                        )

                }
            );


        const result =
            await res.json();


        if (
            !res.ok ||
            !result.success
        ) {

            alert(
                "復元エラー"
            );

            return;

        }


        alert(
            "バックアップを復元しました。"
        );


        //--------------------------------
        // 復元内容を再読込み
        //--------------------------------

        await loadAdmin();

        await loadMembers();


        //--------------------------------
        // 同じファイルを
        // 再選択可能にする
        //--------------------------------

        e.target.value = "";

    }

    catch (err) {

        console.error(
            "バックアップ読込エラー:",
            err
        );

        alert(
            "バックアップ読込エラー"
        );

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
.addEventListener(
    "click",
    async () => {

        const url =
            "https://line.me/R/ti/p/@591tvejt";

        try {

            await navigator
            .clipboard
            .writeText(url);


            alert(
`VSH公式LINEをコピーしました。

① LINEを開く
② 友だち又はグループ
③ 貼り付けて送信

${url}`
            );

        }

        catch {

            prompt(
                "下記URLをコピーしてください。",
                url
            );

        }

    }
);
