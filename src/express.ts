import process from "node:process";
import express from "express";
import { TracerScheduler, TaskGenerator, run, race } from "./scheduler";

const app = express();
const port = 3000;

async function doWork() {
  console.log("work start");
  await new Promise<void>((r) => setTimeout(r, 1000));
  console.log("work finished");
}

async function* doSomething(): TaskGenerator<string> {
  console.log("req start");
  try {
    for (let i = 0; i < 5; i++) {
      yield* race(doWork);
    }
    return "finished!";
  } finally {
    console.log("req finished\n");
  }
}

app.get("/", (req, res) => {
  const scheduler = new TracerScheduler();
  scheduler
    .run(doSomething())
    .then((resps) => res.send(resps))
    .catch((err) => console.log("req catch:", err));
  req.socket.on("close", () => {
    if (scheduler.parallels > 0) {
      scheduler.abort("canceled");
    }
  });
});

const server = app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

process.on("SIGINT", () => {
  server.close(() => {
    console.log("HTTP server closed");
  });
});
