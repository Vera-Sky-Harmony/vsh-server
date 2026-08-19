export async function pushToIntroducer(client, introducerUserId) {

  if (!introducerUserId) return;

  await client.pushMessage(introducerUserId, {
    type: "text",
    text:
`登録を受け付けました。

紹介者がFLP本体システムで登録を確認後、
VSHを譲渡いたします。

Day7-3`
  });

}
