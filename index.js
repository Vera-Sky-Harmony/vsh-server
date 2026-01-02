import express from "express";
import { middleware, Client } from "@line/bot-sdk";

const app = express();

const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN
};

const client = new Client(config);

app.get("/", (req, res) => {
  res.send("VSH server is running");
});

app.post("/webhook", middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch(() => res.status(500).end());
});

function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "Vera Sky Harmony へようこそ"
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`VSH server running on port ${port}`);
});
