import express from "express";
import { createDB, limitedDoSomething, destroyDB } from "./db";
import { Limited } from "./limited";
import { TracerScheduler } from "./scheduler";

const port = Number(process.env.SRV_PORT);

(async () => {
  try {
    // create
    const db = await createDB(false);

    const app = express();

    const limited = new Limited(1000, 2000);

    app.get("/", (req, res) => {
      const scheduler = new TracerScheduler();
      scheduler
        .exec(limitedDoSomething(limited, db))
        .then(() => res.send("ok"))
        .catch((error) => {
          console.log("request error:", error);
          if (!req.socket.closed) {
            res.statusCode = 500;
            res.send("failed");
          }
        });
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
        const timeout = setTimeout(() => {
          console.log("timeout");
          process.exit(1);
        }, 5000);
        // close database
        destroyDB(db)
          .then(() => {
            console.log("finished");
          })
          .catch((err) => {
            console.log("catch error when server exits:", err);
          })
          .finally(() => clearTimeout(timeout));
      } else {
        console.log("please waiting for exiting");
      }
    });
  } catch (err) {
    console.log("catch error:", err);
  }
})();
