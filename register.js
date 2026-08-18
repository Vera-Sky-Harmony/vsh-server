export function registerRoutes(app) {

  // 仮ルート（動作確認用）

  app.get("/register-test", (_req, res) => {

    res.send("register.js OK");

  });

}
export function registerRoutes(app) {

  app.get("/register-test", (_req, res) => {
    res.send("register.js OK");
  });

  app.post("/api/register", async (req, res) => {
    res.json({
      success: true,
      message: "register.js connected"
    });
  });

}
