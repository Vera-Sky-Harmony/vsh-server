export async function pushToIntroducer(client, introducerUserId) {

  if (!introducerUserId) return;

  await client.pushMessage(introducerUserId, {
    type: "text",
    text:
`【Vera Sky Harmony】

新しい登録申請が届きました。

あなたの管理画面をご確認ください。

FLP本体システムで登録を確認後、
「登録確認」を押してください。`
  });

}
