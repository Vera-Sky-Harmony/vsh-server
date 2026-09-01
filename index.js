// ========================================
// Day7-2 LINE用
// 紹介者決定 ＋ FLP番号仮確保
// ========================================

async function createDay72LineAssignment(
  data,
  userId
) {

  if (!data || !userId) {
    return null;
  }

  if (!Array.isArray(data.members)) {
    data.members = [];
  }

  if (!Array.isArray(data.flpList)) {
    data.flpList = [];
  }

  if (!Array.isArray(data.day72LineAssignments)) {
    data.day72LineAssignments = [];
  }


  // =====================================
  // 既に7日以内の割当があれば
  // 新しい番号を発行しない
  // =====================================

  const existing =
    getDay72LineAssignment(
      data,
      userId
    );

  if (existing) {
    return existing;
  }


  // =====================================
  // 1. ルートID最優先
  // =====================================

  if (data.rootSnsActive === true) {

    const rootItem =
      data.flpList.find(
        item =>
          item &&
          item.flp &&
          item.status === "未使用"
      );

    if (rootItem) {

      //----------------------------------
      // Day7-2表示時点で使用中にする
      //----------------------------------

      rootItem.status = "使用中";

      const assignment = {

        userId:
          String(userId),

        introducerType:
          "root",

        introducerName:
          data.introducerName,

        introducerFLP:
          String(
            data.introducerFLP || ""
          ),

        myFLP:
          String(rootItem.flp),

        assignedAt:
          new Date().toISOString()

      };

      data.day72LineAssignments.push(
        assignment
      );

      await saveAdmin(data);

      console.log(
        "Day7-2 LINE割当・ルート:",
        assignment.introducerName,
        assignment.introducerFLP,
        assignment.myFLP
      );

      return assignment;
    }

  }


  // =====================================
  // 2. 一般FBO
  // =====================================

  const getRegisteredCount =
    introducer => {

      if (
        !Array.isArray(
          introducer.flpNumbers
        )
      ) {
        return 0;
      }

      const currentFLPSet =
        new Set(
          introducer.flpNumbers.map(
            number =>
              String(number)
          )
        );

      return data.members.filter(
        item =>
          String(
            item.vshIntroducerFLP || ""
          ) ===
            String(
              introducer.flp || ""
            ) &&
          item.status === "登録済" &&
          currentFLPSet.has(
            String(item.flp || "")
          )
      ).length;
    };


  const eligibleMembers =
    data.members.filter(
      member => {

        if (!member) {
          return false;
        }

        if (
          member.status !== "登録済" ||
          member.vshActive !== true ||
          member.snsActive !== true ||
          member.faceToFaceActive === true
        ) {
          return false;
        }

        if (
          !Array.isArray(
            member.flpNumbers
          ) ||
          member.flpNumbers.length !== 5
        ) {
          return false;
        }

        return (
          getRegisteredCount(member) < 5
        );
      }
    );


  if (eligibleMembers.length === 0) {
    return null;
  }


  // =====================================
  // 3. 現在集中紹介中のFBO
  // =====================================

  let selectedMember = null;

  if (data.vshAutoCurrentFLP) {

    selectedMember =
      eligibleMembers.find(
        member =>
          String(member.flp) ===
          String(
            data.vshAutoCurrentFLP
          )
      ) || null;

  }


  // =====================================
  // 4. 新しく選ぶ場合
  // 5件入力完了日時が早い順
  // =====================================

  if (!selectedMember) {

    const candidates =
      [...eligibleMembers].sort(
        (a, b) => {

          const aTime =
            new Date(
              a.flpNumbersRegisteredAt || 0
            ).getTime();

          const bTime =
            new Date(
              b.flpNumbersRegisteredAt || 0
            ).getTime();

          if (aTime !== bTime) {
            return aTime - bTime;
          }

          return String(
            a.flp || ""
          ).localeCompare(
            String(
              b.flp || ""
            )
          );

        }
      );

    selectedMember =
      candidates[0];

    data.vshAutoCurrentFLP =
      selectedMember.flp;

    data.vshAutoSelectedAt =
      new Date().toISOString();

  }


  // =====================================
  // 5. 使用可能なFLP番号を探す
  // =====================================

  const usedFLPs =
    new Set(
      data.members
        .filter(
          member =>
            String(
              member.vshIntroducerFLP || ""
            ) ===
            String(
              selectedMember.flp
            )
        )
        .map(
          member =>
            String(member.flp)
        )
    );


  const inUseFLPs =
    new Set(
      Array.isArray(
        selectedMember.flpInUse
      )
        ? selectedMember.flpInUse
            .filter(
              item =>
                item &&
                item.flp
            )
            .map(
              item =>
                String(item.flp)
            )
        : []
    );


  const nextFLP =
    selectedMember.flpNumbers.find(
      flp =>
        !usedFLPs.has(
          String(flp)
        ) &&
        !inUseFLPs.has(
          String(flp)
        )
    );


  if (!nextFLP) {
    return null;
  }


  // =====================================
  // 6. 一般FBOのFLPを仮確保
  // =====================================

  if (
    !Array.isArray(
      selectedMember.flpInUse
    )
  ) {
    selectedMember.flpInUse = [];
  }

  const assignedAt =
    new Date().toISOString();

  selectedMember.flpInUse.push({

    flp:
      String(nextFLP),

    usedAt:
      assignedAt

  });


  // =====================================
  // 7. LINE User IDと割当を保存
  // =====================================

  const assignment = {

    userId:
      String(userId),

    introducerType:
      "member",

    introducerName:
      selectedMember.name,

    introducerFLP:
      String(
        selectedMember.flp
      ),

    myFLP:
      String(nextFLP),

    assignedAt:
      assignedAt

  };


  data.day72LineAssignments.push(
    assignment
  );

  await saveAdmin(data);


  console.log(
    "Day7-2 LINE割当・一般FBO:",
    assignment.introducerName,
    assignment.introducerFLP,
    assignment.myFLP
  );


  return assignment;
}
