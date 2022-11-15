import express from "express";
import { createDB, doSomething2, destroyDB } from "./db";
import { TracerScheduler } from "./scheduler";

const port = Number(process.env.SRV_PORT);

(async () => {
  try {
    // create
    const db = await createDB(false);

    const app = express();

    app.get("/", (req, res) => {
      const scheduler = new TracerScheduler();
      scheduler
        .exec(doSomething2(db))
        .then(() => res.send("ok"))
        .catch((error) => console.log("request error:", error));
      req.socket.on("close", () => {
        if (scheduler.parallels > 0) {
          scheduler.abort("canceled");
        }
      });
    });

    const server = app.listen(port, () => {
      console.log(`server listening on port ${port}`);
    });

    // handle signal
    let exiting = false;
    process.on("SIGINT", () => {
      if (!exiting) {
        console.log("exiting...");
        exiting = true;
        // close server
        server.close(() => {
          console.log("server closed");
        });
        // close database
        destroyDB(db)
          .then(() => {
            console.log("finished");
            process.exit(0);
          })
          .catch((err) => {
            console.log("catch error when server exits:", err);
            setTimeout(() => process.exit(1), 2000);
          });
      } else {
        console.log("please waiting for exiting");
      }
    });
  } catch (err) {
    console.log("catch error:", err);
  }
})();
