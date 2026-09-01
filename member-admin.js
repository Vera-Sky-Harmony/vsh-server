// ========================================
// member-admin.js
// Vera Sky Harmony Version 1.0
// 新規登録者本人用管理画面
// ========================================

let currentMember = null;


// ========================================
// 第1段階・第2段階
// 画面表示切替
// ========================================

function updateVSHStageDisplay() {

  const friendAddCard =
    document.getElementById(
      "friendAddCard"
    );

  const stage1Keyword =
    document.getElementById(
      "stage1Keyword"
    );


  //----------------------------------
  // 第2段階
  //----------------------------------

  if (
    currentMember &&
    currentMember.faceToFaceActive === true
  ) {

    if (friendAddCard) {

      friendAddCard.style.display =
        "block";

    }

    if (stage1Keyword) {

      stage1Keyword.style.display =
        "none";

    }

    return;

  }


  //----------------------------------
  // 第1段階
  //----------------------------------

  if (friendAddCard) {

    friendAddCard.style.display =
      "none";

  }

  if (stage1Keyword) {

    stage1Keyword.style.display =
      "";

  }

}


// ========================================
// 初期表示・本人確認
// ========================================

window.addEventListener(
  "DOMContentLoaded",
  async () => {

    const saveButton =
      document.getElementById(
        "saveButton"
      );

    saveButton.addEventListener(
      "click",
      saveFLPNumbers
    );


    //----------------------------------
    // 本人情報取得
    //----------------------------------

    try {

      const response =
        await fetch(
          "/api/member-admin/me",
          {
            method: "GET",
            credentials: "same-origin"
          }
        );

      const result =
        await response.json();

      if (
        !response.ok ||
        !result.success
      ) {

        document.getElementById(
          "memberName"
        ).textContent =
          "本人確認できません";

        document.getElementById(
          "memberFLP"
        ).textContent =
          "－";

        saveButton.disabled =
          true;

        alert(
          result.message ||
          "本人確認ができませんでした。"
        );

        return;

      }


      //----------------------------------
      // 本人情報保存
      //----------------------------------

      currentMember =
        result.member;


      //----------------------------------
      // 第1段階・第2段階
      // 表示制御
      //----------------------------------

      updateVSHStageDisplay();


      //----------------------------------
      // 本人情報表示
      //----------------------------------

      document.getElementById(
        "memberName"
      ).textContent =
        currentMember.name;

      document.getElementById(
        "memberFLP"
      ).textContent =
        currentMember.flp;


      //----------------------------------
      // 保存済みFLP番号5件を再表示
      //----------------------------------

      if (
        Array.isArray(
          currentMember.flpNumbers
        ) &&
        currentMember.flpNumbers.length === 5
      ) {

        for (
          let i = 1;
          i <= 5;
          i++
        ) {

          const input =
            document.getElementById(
              `flp${i}`
            );

          input.value =
            currentMember
              .flpNumbers[i - 1];

          input.disabled =
            true;

        }

        document.getElementById(
          "statusCount"
        ).textContent =
          "5 / 5 件";

        document.getElementById(
          "completeBox"
        ).style.display =
          "block";

        saveButton.textContent =
          "登録完了";

        saveButton.disabled =
          true;

      }

    }

    catch (err) {

      console.error(
        "本人情報取得エラー:",
        err
      );

      document.getElementById(
        "memberName"
      ).textContent =
        "本人確認エラー";

      document.getElementById(
        "memberFLP"
      ).textContent =
        "－";

      saveButton.disabled =
        true;

      return;

    }


    updateStatus();


    //----------------------------------
    // 紹介した方の登録状況取得
    //----------------------------------

    await loadIntroducedMembers();

  }
);


// ========================================
// FLP番号取得
// ========================================

function getFLPNumbers() {

  const numbers = [];

  for (
    let i = 1;
    i <= 5;
    i++
  ) {

    const value =
      document
        .getElementById(
          `flp${i}`
        )
        .value
        .trim();

    numbers.push(
      value
    );

  }

  return numbers;

}


// ========================================
// 登録状況表示
// ========================================

function updateStatus() {

  const numbers =
    getFLPNumbers();

  const count =
    numbers.filter(
      x => x !== ""
    ).length;

  document.getElementById(
    "statusCount"
  ).textContent =
    `${count} / 5 件`;

}
// ========================================
// 入力変更時
// ========================================

for (let i = 1; i <= 5; i++) {

  document.addEventListener(
    "DOMContentLoaded",
    () => {

      const input =
        document.getElementById(
          `flp${i}`
        );

      input.addEventListener(
        "input",
        updateStatus
      );

    }
  );

}


// ========================================
// FLP番号登録
// ========================================

async function saveFLPNumbers() {

  const numbers =
    getFLPNumbers();


  //----------------------------------
  // 空欄確認
  //----------------------------------

  if (
    numbers.some(
      x => x === ""
    )
  ) {

    alert(
      "5人分のFLP番号をすべて入力してください。"
    );

    return;

  }


  //----------------------------------
  // FLP番号 9桁確認
  //----------------------------------

  const invalid =
    numbers.some(
      x => !/^[0-9]{9}$/.test(x)
    );

  if (invalid) {

    alert(
      "FLP番号は9桁の数字で入力してください。"
    );

    return;

  }


  //----------------------------------
  // 同一番号の重複確認
  //----------------------------------

  const uniqueNumbers =
    new Set(numbers);

  if (
    uniqueNumbers.size !== 5
  ) {

    alert(
      "同じFLP番号が重複しています。確認してください。"
    );

    return;

  }


  //----------------------------------
  // 本人確認
  //----------------------------------

  if (!currentMember) {

    alert(
      "本人確認ができていません。"
    );

    return;

  }


  //----------------------------------
  // 登録前の最終確認
  //----------------------------------

  const confirmed =
    confirm(
      "5件のFLP番号を登録します。\n\n" +
      "登録完了後は通常変更できません。\n" +
      "よろしいですか？"
    );

  if (!confirmed) {

    return;

  }


  //----------------------------------
  // 保存ボタンを一時停止
  //----------------------------------

  const saveButton =
    document.getElementById(
      "saveButton"
    );

  saveButton.disabled =
    true;

  saveButton.textContent =
    "登録中...";


  //----------------------------------
  // 保存APIへ送信
  //----------------------------------

  try {

    const response =
      await fetch(
        "/api/member-admin/flp",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          credentials:
            "same-origin",

          body:
            JSON.stringify({
              numbers: numbers
            })
        }
      );

    const result =
      await response.json();


    //----------------------------------
    // 保存失敗
    //----------------------------------

    if (
      !response.ok ||
      !result.success
    ) {

      alert(
        result.message ||
        "FLP番号を登録できませんでした。"
      );

      saveButton.disabled =
        false;

      saveButton.textContent =
        "5件を登録する";

      return;

    }


    //----------------------------------
    // 保存成功
    //----------------------------------

    for (
      let i = 1;
      i <= 5;
      i++
    ) {

      const input =
        document.getElementById(
          `flp${i}`
        );

      input.disabled =
        true;

    }

    document.getElementById(
      "statusCount"
    ).textContent =
      "5 / 5 件";

    document.getElementById(
      "completeBox"
    ).style.display =
      "block";

    saveButton.textContent =
      "登録完了";

    saveButton.disabled =
      true;

    alert(
      "5件のFLP番号を登録しました。"
    );

  }


  //----------------------------------
  // 通信エラー
  //----------------------------------

  catch (err) {

    console.error(
      "FLP番号登録エラー:",
      err
    );

    alert(
      "通信エラーが発生しました。"
    );

    saveButton.disabled =
      false;

    saveButton.textContent =
      "5件を登録する";

  }

}
// ========================================
// 紹介した方の登録状況を取得
// ========================================

async function loadIntroducedMembers() {

  const area =
    document.getElementById(
      "introducedMembers"
    );

  if (!area) {

    return;

  }

  try {

    const response =
      await fetch(
        "/api/member-admin/introduced-members",
        {
          method: "GET",
          credentials: "same-origin"
        }
      );

    const result =
      await response.json();

    if (
      !response.ok ||
      !result.success
    ) {

      area.innerHTML =
        "<p>登録状況を取得できませんでした。</p>";

      return;

    }


    const members =
      Array.isArray(
        result.members
      )
        ? result.members
        : [];


    //----------------------------------
    // 使用済FLP番号表示更新
    //----------------------------------

    updateUsedFLPDisplay(
  members,
  Array.isArray(result.reservedFLPs)
    ? result.reservedFLPs
    : []
);


    //----------------------------------
    // 紹介者がまだいない場合
    //----------------------------------

    if (
      members.length === 0
    ) {

      area.innerHTML =
        "<p>現在、登録確認待ちの方はいません。</p>";

      return;

    }


    area.innerHTML =
      "";


    //----------------------------------
    // 紹介した方を1人ずつ表示
    //----------------------------------

    members.forEach(
      member => {

        const box =
          document.createElement(
            "div"
          );

        box.style.padding =
          "15px 0";

        box.style.borderBottom =
          "1px solid #ddd";


        //----------------------------------
        // 氏名
        //----------------------------------

        const name =
          document.createElement(
            "div"
          );

        name.innerHTML =
          '<span class="label">氏名</span><br>';

        const nameValue =
          document.createElement(
            "strong"
          );

        nameValue.textContent =
          member.name || "－";

        name.appendChild(
          nameValue
        );


        //----------------------------------
        // FLP番号
        //----------------------------------

        const flp =
          document.createElement(
            "div"
          );

        flp.style.marginTop =
          "10px";

        flp.innerHTML =
          '<span class="label">FLP番号</span><br>';

        const flpValue =
          document.createElement(
            "strong"
          );

        flpValue.textContent =
          member.flp || "－";

        flp.appendChild(
          flpValue
        );


        //----------------------------------
        // 状態
        //----------------------------------

        const status =
          document.createElement(
            "div"
          );

        status.style.marginTop =
          "10px";

        status.innerHTML =
          '<span class="label">状態</span><br>';

        const statusValue =
          document.createElement(
            "strong"
          );

        statusValue.textContent =
          member.status ||
          "確認中";

        status.appendChild(
          statusValue
        );


        box.appendChild(
          name
        );

        box.appendChild(
          flp
        );

        box.appendChild(
          status
        );


        //----------------------------------
        // 確認中の場合だけ
        // FBO登録確認ボタンを表示
        //----------------------------------

        if (
          member.status !== "登録済"
        ) {

          const confirmButton =
            document.createElement(
              "button"
            );

          confirmButton.className =
            "button";

          confirmButton.textContent =
            "登録確認";


          confirmButton.addEventListener(
            "click",
            async () => {

              //----------------------------------
              // 最終確認
              //----------------------------------

              const confirmed =
                confirm(
                  `${member.name}さんのFBO登録を\n` +
                  `FLP本体システムで確認しましたか？\n\n` +
                  `FLP番号：${member.flp}\n\n` +
                  `確認するとDay8が本人のLINEへ送信されます。`
                );

              if (!confirmed) {

                return;

              }


              //----------------------------------
              // 二重押下防止
              //----------------------------------

              confirmButton.disabled =
                true;

              confirmButton.textContent =
                "確認処理中...";


              try {

                //----------------------------------
                // 本人Admin専用確認API
                //----------------------------------

                const response =
                  await fetch(
                    "/api/member-admin/confirm-member",
                    {
                      method:
                        "POST",

                      headers: {
                        "Content-Type":
                          "application/json"
                      },

                      credentials:
                        "same-origin",

                      body:
                        JSON.stringify({
                          flp:
                            member.flp
                        })
                    }
                  );

                const result =
                  await response.json();


                //----------------------------------
                // エラー
                //----------------------------------

                if (
                  !response.ok ||
                  !result.success
                ) {

                  alert(
                    result.message ||
                    "FBO登録確認ができませんでした。"
                  );

                  confirmButton.disabled =
                    false;

                  confirmButton.textContent =
                    "登録確認";

                  return;

                }

                //----------------------------------
                // 正常終了
                //----------------------------------

                alert(
                  `${member.name}さんのFBO登録を確認しました。\n\n` +
                  `Day8を本人のLINEへ送信しました。`
                );


                //----------------------------------
                // 一覧を再読み込み
                //----------------------------------

                await loadIntroducedMembers();


                //----------------------------------
                // 本人情報を再取得
                // 5人達成による第2段階移行を反映
                //----------------------------------

                try {

                  const meResponse =
                    await fetch(
                      "/api/member-admin/me",
                      {
                        method:
                          "GET",

                        credentials:
                          "same-origin"
                      }
                    );

                  const meResult =
                    await meResponse.json();


                  if (
                    meResponse.ok &&
                    meResult.success &&
                    meResult.member
                  ) {

                    //----------------------------------
                    // 最新の本人情報へ更新
                    //----------------------------------

                    currentMember =
                      meResult.member;


                    //----------------------------------
                    // 第1段階・第2段階
                    // 表示を最新状態へ更新
                    //----------------------------------

                    updateVSHStageDisplay();


                    //----------------------------------
                    // 第2段階移行時
                    // 次の5件を入力できる状態へ更新
                    //----------------------------------

                    if (
                      currentMember.faceToFaceActive === true &&
                      Array.isArray(
                        currentMember.flpNumbers
                      ) &&
                      currentMember.flpNumbers.length === 0
                    ) {

                      for (
                        let i = 1;
                        i <= 5;
                        i++
                      ) {

                        const input =
                          document.getElementById(
                            `flp${i}`
                          );

                        if (input) {

                          input.value =
                            "";

                          input.disabled =
                            false;

                        }

                      }


                      const saveButton =
                        document.getElementById(
                          "saveButton"
                        );

                      if (saveButton) {

                        saveButton.textContent =
                          "5件を登録する";

                        saveButton.disabled =
                          false;

                      }


                      const statusCount =
                        document.getElementById(
                          "statusCount"
                        );

                      if (statusCount) {

                        statusCount.textContent =
                          "0 / 5 件";

                      }


                      const completeBox =
                        document.getElementById(
                          "completeBox"
                        );

                      if (completeBox) {

                        completeBox.style.display =
                          "none";

                      }

                    }

                  }

                }

                catch (err) {

                  console.error(
                    "第2段階状態再取得エラー:",
                    err
                  );

                }

              }


              //----------------------------------
              // FBO登録確認 通信エラー
              //----------------------------------

              catch (err) {

                console.error(
                  "FBO登録確認エラー:",
                  err
                );

                alert(
                  "通信エラーが発生しました。"
                );

                confirmButton.disabled =
                  false;

                confirmButton.textContent =
                  "登録確認";

              }

            }
          );


          box.appendChild(
            confirmButton
          );

        }


        area.appendChild(
          box
        );

      }
    );

  }


  //----------------------------------
  // 紹介者登録状況取得エラー
  //----------------------------------

  catch (err) {

    console.error(
      "紹介者登録状況取得エラー:",
      err
    );

    area.innerHTML =
      "<p>登録状況を取得できませんでした。</p>";

  }

}


// ========================================
// 使用済FLP番号の表示
// ========================================

function updateUsedFLPDisplay(
  members,
  reservedFLPs
) {

  const usedFLPs =
    new Set([
      ...(
        Array.isArray(members)
          ? members
              .map(
                member =>
                  String(
                    member.flp || ""
                  )
              )
              .filter(Boolean)
          : []
      ),

      ...(
        Array.isArray(reservedFLPs)
          ? reservedFLPs
              .map(
                flp =>
                  String(flp || "")
              )
              .filter(Boolean)
          : []
      )
    ]);

  for (
    let i = 1;
    i <= 5;
    i++
  ) {

    const input =
      document.getElementById(
        `flp${i}`
      );

    if (!input) {

      continue;

    }


    const row =
      input.closest(
        ".flpRow"
      );

    if (!row) {

      continue;

    }


    const oldBadge =
      row.querySelector(
        ".usedBadge"
      );

    if (oldBadge) {

      oldBadge.remove();

    }


    if (
      usedFLPs.has(
        String(
          input.value
        ).trim()
      )
    ) {

      const badge =
        document.createElement(
          "span"
        );

      badge.className =
        "usedBadge";

      badge.textContent =
        "使用済";

      badge.style.whiteSpace =
        "nowrap";

      badge.style.fontWeight =
        "bold";

      badge.style.color =
        "#b26a00";

      row.appendChild(
        badge
      );

    }

  }

}
// ========================================
// 第2段階
// VSHともだち追加
// ========================================

const friendAddButton =
  document.getElementById(
    "friendAddButton"
  );


if (friendAddButton) {

  friendAddButton.addEventListener(
    "click",
    () => {

      //----------------------------------
      // 本人情報確認
      //----------------------------------

      if (
        !currentMember ||
        !currentMember.flp
      ) {

        alert(
          "本人情報を確認できません。"
        );

        return;

      }


      //----------------------------------
      // 第2段階利用状態確認
      //----------------------------------

      if (
        currentMember.faceToFaceActive !== true
      ) {

        alert(
          "現在、Face to Faceでの紹介は利用できません。"
        );

        return;

      }


      //----------------------------------
      // 本人専用VSH紹介入口へ進む
      //----------------------------------

      window.location.href =
        `/vsh/invite/${encodeURIComponent(
          currentMember.flp
        )}`;

    }
  );

}
