export function registerRoutes(app) {

  // 仮ルート（動作確認用）

  app.get("/register-test", (_req, res) => {

    res.send("register.js OK");

  });

}
