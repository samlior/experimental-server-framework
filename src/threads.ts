import {
  Worker,
  isMainThread,
  MessageChannel,
  MessagePort,
  parentPort,
  threadId,
} from "node:worker_threads";
import { cpus } from "node:os";
import express from "express";
import { createDB, doSomething, destroyDB } from "./db";
import { Limited, TracerScheduler } from "./utils";

const port = Number(process.env.SRV_PORT);

if (isMainThread) {
  const workers: { worker: Worker; promise: Promise<void> }[] = [];
  for (let i = 0; i < cpus().length - 1; i++) {
    const worker = new Worker(__filename);
    workers.push({
      worker,
      promise: new Promise<void>((resolve, reject) => {
        worker
          .on("error", reject)
          .on("exit", resolve)
          .on("online", () => {
            console.log("worker:", worker.threadId, "is online");
          });
      }),
    });
  }

  // start http server
  const app = express();

  let index = 0;
  function nextIndex() {
    const result = index++;
    if (index === workers.length) {
      index = 0;
    }
    return result;
  }

  app.get("/", (req, res) => {
    const { worker } = workers[nextIndex()];
    const { port1, port2 } = new MessageChannel();
    worker.postMessage({ method: "request", port: port2 }, [port2]);
    port1.on("message", (response) => {
      res.end(response);
      port1.close();
    });
    req.socket.on("close", () => {
      port1.close();
    });
  });

  const server = app.listen(port);

  // handle signal
  let exiting = false;
  process.on("SIGINT", () => {
    if (!exiting) {
      console.log("exiting...");
      exiting = true;
      server.close();
      // notify all workers to exit
      for (const { worker } of workers) {
        worker.postMessage({ method: "exit" });
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
      const db = await createDB(false);

      const limited = new Limited(1000, 2000);

      parentPort!.on(
        "message",
        ({ method, port }: { method: string; port: MessagePort }) => {
          if (method === "exit") {
            setTimeout(async () => {
              await destroyDB(db);
              process.exit(0);
            }, 100);
          } else if (method === "request") {
            const scheduler = new TracerScheduler();
            scheduler
              .exec(doSomething(limited, db))
              .then(() => port.postMessage(`ok, worker: ${threadId}`))
              .catch((error) => {
                console.log("request error:", error);
                port.postMessage("failed");
              });
            port.on("close", () => {
              if (scheduler.parallels > 0) {
                scheduler.abort("canceled");
              }
            });
          }
        }
      );
    } catch (err) {
      console.log("catch error:", err);
    }
  })();
}
