// ========================================
// member-admin.js
// Vera Sky Harmony Version 1.0
// 新規登録者本人用管理画面
// ========================================

let currentMember = null;


// ========================================
// 初期表示
// ========================================

window.addEventListener("DOMContentLoaded", async () => {

  const saveButton =
    document.getElementById("saveButton");

  saveButton.addEventListener(
    "click",
    saveFLPNumbers
  );

  //----------------------------------
  // 現段階ではAPI未接続
  //----------------------------------

  document.getElementById(
    "memberName"
  ).textContent = "本人確認待ち";

  document.getElementById(
    "memberFLP"
  ).textContent = "本人確認待ち";

  updateStatus();

});


// ========================================
// FLP番号取得
// ========================================

function getFLPNumbers() {

  const numbers = [];

  for (let i = 1; i <= 5; i++) {

    const value =
      document
        .getElementById(`flp${i}`)
        .value
        .trim();

    numbers.push(value);

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
  // 数字確認
  //----------------------------------

  const invalid =
    numbers.some(
      x => !/^[0-9]+$/.test(x)
    );

  if (invalid) {

    alert(
      "FLP番号は数字のみで入力してください。"
    );

    return;

  }


  //----------------------------------
  // 同一番号の重複確認
  //----------------------------------

  const uniqueNumbers =
    new Set(numbers);

  if (uniqueNumbers.size !== 5) {

    alert(
      "同じFLP番号が重複しています。確認してください。"
    );

    return;

  }


  //----------------------------------
  // 本人確認
  // API接続後に有効化
  //----------------------------------

  if (!currentMember) {

    alert(
      "現在、本人確認APIの接続前です。"
    );

    return;

  }


  //----------------------------------
  // 次工程で保存APIを接続
  //----------------------------------

  alert(
    "本人確認後にFLP番号を保存します。"
  );

}
