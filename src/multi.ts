import cluster, { Worker } from "node:cluster";
import { cpus } from "node:os";
import process from "node:process";
import { Server } from "node:http";
import express from "express";
import { createDB, limitedDoSomething, destroyDB } from "./db";
import { Limited } from "./limited";
import { TracerScheduler } from "./scheduler";

if (cluster.isPrimary) {
  // setup
  cluster.setupPrimary({
    serialization: "advanced",
  } as any);

  const port = Number(process.env.SRV_PORT);
  const workers: { worker: Worker; promise: Promise<void> }[] = [];

  // start workers
  for (let i = 0; i < cpus().length - 1; i++) {
    const worker = cluster.fork();
    const workerIndex = i;
    workers.push({
      worker,
      promise: new Promise<void>((resolve, reject) => {
        worker
          .on("error", reject)
          .on("exit", resolve)
          .on("online", () => {
            console.log("worker:", worker.id, "is online");
          })
          .on("message", ({ method }: { method: string }) => {
            if (method === "ready") {
              worker.send({ method: "start", port: port + workerIndex });
            }
          });
      }),
    });
  }

  // handle signal
  let exiting = false;
  process.on("SIGINT", () => {
    if (!exiting) {
      console.log("exiting...");
      exiting = true;
      // notify all workers to exit
      for (const { worker } of workers) {
        worker.send({ method: "exit" });
      }
      const timeout = setTimeout(() => {
        console.log("timeout");
        process.exit(1);
      }, 5000);
      // waiting for worker exits
      Promise.all(workers.map(({ promise }) => promise))
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
} else {
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
          .then(() => res.send(`ok, worker: ${cluster.worker!.id}`))
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

      let server: Server | undefined;

      process.on(
        "message",
        ({ method, port }: { method: string; port: number }) => {
          if (method === "exit") {
            setTimeout(async () => {
              server?.close();
              await destroyDB(db);
              cluster.worker!.destroy();
            }, 100);
          } else if (method === "start") {
            server = app.listen(port, () => {
              console.log(`server listening on port ${port}`);
            });
          }
        }
      );

      process.send!({ method: "ready" });
    } catch (err) {
      console.log("catch error:", err);
    }
  })();
}
