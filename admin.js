// ========================================
// admin.js
// Vera Sky Harmony Version1.4
// Root Admin 管理画面
// ========================================


//----------------------------------------
// FLP入力欄30件作成
//----------------------------------------

const flpList =
    document.getElementById("flpList");

for (let i = 1; i <= 30; i++) {

    const row =
        document.createElement("div");

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
// 管理データ保持
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

        const res =
            await fetch("/api/admin");

        if (!res.ok) {
            throw new Error(
                `管理データ取得エラー HTTP ${res.status}`
            );
        }

        const data =
            await res.json();

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
        // 紹介者情報
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
        // FLP番号30件
        //--------------------------------

        for (let i = 1; i <= 30; i++) {

            const box =
                document.getElementById(
                    `flp${i}`
                );

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
            box ? box.value : "";

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


        const oldItem =
            adminData.flpList.find(
                x => Number(x.no) === i
            )
            ||
            adminData.flpList[i - 1];


        let status =
            oldItem?.status ||
            "未使用";


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
// 管理データ保存
//----------------------------------------

document
.getElementById("saveButton")
.addEventListener(
    "click",
    saveAdmin
);


async function saveAdmin() {

    try {

        //--------------------------------
        // 最新データ取得
        //--------------------------------

        const oldRes =
            await fetch("/api/admin");

        if (!oldRes.ok) {

            throw new Error(
                `保存前データ取得エラー HTTP ${oldRes.status}`
            );

        }

        const oldData =
            await oldRes.json();


        //--------------------------------
        // 保存データ
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
                createFLPArray(),

            members:
                Array.isArray(
                    oldData.members
                )
                ? oldData.members
                : []

        };


        //--------------------------------
        // Supabaseへ保存
        //--------------------------------

        const res =
            await fetch(
                "/api/admin",
                {

                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(body)

                }
            );


        const result =
            await res.json();


        if (
            !res.ok ||
            !result.success
        ) {

            throw new Error(
                "管理データ保存失敗"
            );

        }


        adminData = body;

        alert(
            "保存しました。"
        );

        await loadAdmin();
        await loadMembers();

    }

    catch (err) {

        console.error(
            "管理データ保存エラー:",
            err
        );

        alert(
            "保存エラー"
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


        //--------------------------------
        // FBO登録者だけ表示
        //--------------------------------

       const members =
    sourceMembers.filter(
        member =>
            member.name &&
            member.flp &&
            member.directDay8 !== true
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


            //--------------------------------
            // 登録月日
            //--------------------------------

            let registeredDate = "";

            if (member.created) {

                const date =
                    new Date(member.created);

                registeredDate =
                    date.toLocaleDateString(
                        "ja-JP",
                        {
                            timeZone:
                                "Asia/Tokyo"
                        }
                    );

            }


            //--------------------------------
            // ステイタス
            //--------------------------------

            let status =
                member.status || "確認中";

            // 旧データ「登録完了」は
            // 新仕様では「確認中」と表示
            if (status === "登録完了") {

                status = "確認中";

            }


            //--------------------------------
            // ステイタス欄
            //--------------------------------

            let statusHTML = "";

            if (status === "登録済") {

                statusHTML =
                    `<strong>登録済</strong>`;

            }

            else {

                statusHTML = `
                    <strong>確認中</strong>
                    <br>
                    <button
                        class="confirmButton"
                        data-flp="${member.flp}">
                        登録確認
                    </button>
                `;

            }


            tr.innerHTML = `

                <td>
                    ${member.name || ""}
                </td>

                <td>
                    ${member.flp || ""}
                </td>

                <td>
                    ${registeredDate}
                </td>

                <td>
                    ${statusHTML}
                </td>

            `;

            tbody.appendChild(tr);

        });


        //--------------------------------
        // 登録確認ボタン
        //--------------------------------

        document
        .querySelectorAll(
            ".confirmButton"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    const flp =
                        button.dataset.flp;

                    confirmMember(flp);

                }
            );

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
// 登録確認
//----------------------------------------

async function confirmMember(flp) {

    const ok =
        confirm(
            "FLP本体システムで登録を確認しましたか？"
        );

    if (!ok) return;


    try {

        const res =
            await fetch(
                "/api/confirm-member",
                {

                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            flp: flp
                        })

                }
            );


        const result =
            await res.json();


        if (
            !res.ok ||
            !result.success
        ) {

            alert(
                result.message ||
                "登録確認エラー"
            );

            return;

        }


        alert(
            "登録済にしました。"
        );

        await loadAdmin();
        await loadMembers();

    }

    catch (err) {

        console.error(
            "登録確認エラー:",
            err
        );

        alert(
            "登録確認エラー"
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

// ========================================
// 既存FBOへDay8直接譲渡
// ルートID専用
// LINE直接起動版
// ========================================

document
.getElementById("directDay8Button")
.addEventListener(
    "click",
    directDay8
);


async function directDay8() {

    //----------------------------------------
    // 入力取得
    //----------------------------------------

    const name =
        document
        .getElementById("directDay8Name")
        .value
        .trim();

    const flp =
        document
        .getElementById("directDay8FLP")
        .value
        .trim();


    //----------------------------------------
    // 入力確認
    //----------------------------------------

    if (!name) {

        alert(
            "FBO氏名を入力してください。"
        );

        return;

    }


    if (!/^\d{9}$/.test(flp)) {

        alert(
            "FLP番号は9桁の数字で入力してください。"
        );

        return;

    }


    //----------------------------------------
    // 最終確認
    //----------------------------------------

    const ok =
        confirm(
`${name} さん

FLP番号：${flp}

この方へVSHを
Day8から直接譲渡しますか？`
        );


    if (!ok) {

        return;

    }


    //----------------------------------------
    // ボタン一時停止
    //----------------------------------------

    const button =
        document.getElementById(
            "directDay8Button"
        );

    button.disabled = true;


    try {

        //----------------------------------------
        // Day8直接譲渡準備API
        //----------------------------------------

        const res =
            await fetch(
                "/api/direct-day8",
                {

                    method: "POST",

                    headers: {

                        "Content-Type":
                            "application/json"

                    },

                    body:
                        JSON.stringify({

                            name: name,

                            flp: flp

                        })

                }
            );


        const result =
            await res.json();


        //----------------------------------------
        // APIエラー
        //----------------------------------------

        if (
            !res.ok ||
            !result.success
        ) {

            alert(
                result.message ||
                "Day8直接譲渡の準備に失敗しました。"
            );

            return;

        }


        //----------------------------------------
        // LINE共有用文章確認
        //----------------------------------------

        if (!result.shareText) {

            alert(
                "Day8受取URLを取得できませんでした。"
            );

            return;

        }


        //----------------------------------------
        // LINE共有URL作成
        //
        // Day8全文ではなく
        // 本人専用Day8受取URLを送る
        //----------------------------------------

        const lineUrl =
            "https://line.me/R/share?text=" +
            encodeURIComponent(
                result.shareText
            );


        //----------------------------------------
        // 入力欄クリア
        //----------------------------------------

        document
        .getElementById(
            "directDay8Name"
        )
        .value = "";

        document
        .getElementById(
            "directDay8FLP"
        )
        .value = "";


        //----------------------------------------
        // 管理画面更新
        //----------------------------------------

        if (
            typeof loadAdmin ===
            "function"
        ) {

            await loadAdmin();

        }


        if (
            typeof loadMembers ===
            "function"
        ) {

            await loadMembers();

        }


        //----------------------------------------
// Day8案内＋専用URLをコピー
//----------------------------------------

try {

    await navigator
        .clipboard
        .writeText(
            result.shareText
        );

    alert(
`Day8の案内と専用URLをコピーしました。

① LINEを開く
② 送信するFBOのトークを開く
③ メッセージ入力欄に貼り付け
④ 送信してください。`
    );

}

catch {

    prompt(
        "下記のDay8案内をコピーしてください。",
        result.shareText
    );

}

    }


    catch (err) {

        console.error(
            "Day8直接譲渡エラー:",
            err
        );

        alert(
            "Day8直接譲渡で通信エラーが発生しました。"
        );

    }


    finally {

        button.disabled = false;

    }

}
// ========================================
// ルートID SNS手動管理
// SNS連携・SNS解除
// ========================================


//----------------------------------------
// SNS状態表示
//----------------------------------------

async function loadRootSnsStatus() {

    try {

        const res =
            await fetch(
                "/api/root-sns-status"
            );

        const result =
            await res.json();

        if (
            !res.ok ||
            !result.success
        ) {

            document
            .getElementById("snsStatus")
            .textContent =
                "取得できません";

            return;

        }


        document
        .getElementById("snsStatus")
        .textContent =
            result.snsActive
                ? "SNS連携中"
                : "SNS解除中";

    }

    catch (err) {

        console.error(
            "SNS状態取得エラー:",
            err
        );

        document
        .getElementById("snsStatus")
        .textContent =
            "取得できません";

    }

}


//----------------------------------------
// SNS連携
//----------------------------------------

async function startRootSns() {

    const ok =
        confirm(
            "ルートIDのSNS連携を開始しますか？"
        );

    if (!ok) {
        return;
    }


    try {

        const res =
            await fetch(
                "/api/root-sns-start",
                {
                    method: "POST"
                }
            );


        const result =
            await res.json();


        if (
            !res.ok ||
            !result.success
        ) {

            alert(
                result.message ||
                "SNS連携に失敗しました。"
            );

            return;

        }


        alert(
            "SNS連携を開始しました。"
        );


        await loadRootSnsStatus();

    }

    catch (err) {

        console.error(
            "SNS連携エラー:",
            err
        );

        alert(
            "SNS連携で通信エラーが発生しました。"
        );

    }

}


//----------------------------------------
// SNS解除
//----------------------------------------

async function stopRootSns() {

    const ok =
        confirm(
            "ルートIDのSNS連携を解除しますか？"
        );

    if (!ok) {
        return;
    }


    try {

        const res =
            await fetch(
                "/api/root-sns-stop",
                {
                    method: "POST"
                }
            );


        const result =
            await res.json();


        if (
            !res.ok ||
            !result.success
        ) {

            alert(
                result.message ||
                "SNS解除に失敗しました。"
            );

            return;

        }


        alert(
            "SNS連携を解除しました。"
        );


        await loadRootSnsStatus();

    }

    catch (err) {

        console.error(
            "SNS解除エラー:",
            err
        );

        alert(
            "SNS解除で通信エラーが発生しました。"
        );

    }

}


//----------------------------------------
// ボタン接続
//----------------------------------------

const snsStartButton =
    document.getElementById(
        "snsStartButton"
    );

const snsStopButton =
    document.getElementById(
        "snsStopButton"
    );


if (snsStartButton) {

    snsStartButton.addEventListener(
        "click",
        startRootSns
    );

}


if (snsStopButton) {

    snsStopButton.addEventListener(
        "click",
        stopRootSns
    );

}


//----------------------------------------
// 管理画面表示時に現在状態取得
//----------------------------------------

loadRootSnsStatus();
