import cluster, { Worker } from "node:cluster";
import { cpus } from "node:os";
import process from "node:process";
import net from "node:net";
import { createServer } from "node:http";
import express from "express";
import { createDB, limitedDoSomething, destroyDB } from "./db";
import { Limited } from "./limited";
import { TracerScheduler } from "./scheduler";

const port = Number(process.env.SRV_PORT);

if (cluster.isPrimary) {
  // setup
  cluster.setupPrimary({
    serialization: "advanced",
  } as any);

  const workers: { worker: Worker; promise: Promise<void> }[] = [];

  // start workers
  for (let i = 0; i < cpus().length - 1; i++) {
    const worker = cluster.fork();
    workers.push({
      worker,
      promise: new Promise<void>((resolve, reject) => {
        worker
          .on("error", reject)
          .on("exit", resolve)
          .on("online", () => {
            console.log("worker:", worker.id, "is online");
          });
      }),
    });
  }

  // start http server
  const server = createServer();

  server.on("error", (err) => console.log("http server error:", err));

  server.on("listening", () => console.log("http server listening at:", port));

  let index = 0;
  function nextIndex() {
    const result = index++;
    if (index === workers.length) {
      index = 0;
    }
    return result;
  }

  server.on("connection", (socket) => {
    const { worker } = workers[nextIndex()];
    socket.on("data", (buffer) => {
      const data = buffer.toString();
      socket.pause();
      worker.send({ method: "socket", data }, socket);
    });
  });

  // handle signal
  let exiting = false;
  process.on("SIGINT", () => {
    if (!exiting) {
      console.log("exiting...");
      exiting = true;
      server.close();
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

  server.listen(port);
} else {
  (async () => {
    try {
      const db = await createDB(false);

      const app = express();

      const server = createServer(app);

      const limited = new Limited(1000, 2000);

      app.get("/", (req, res) => {
        const scheduler = new TracerScheduler();
        scheduler
          .exec(limitedDoSomething(limited, db))
          .then(() => res.send(`ok, worker:${cluster.worker!.id}`))
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

      process.on(
        "message",
        (
          { method, data }: { method: string; data: string },
          socket: net.Socket
        ) => {
          if (method === "exit") {
            setTimeout(async () => {
              // close server
              server.close();
              await destroyDB(db);
              cluster.worker!.destroy();
            }, 100);
          } else if (method === "socket") {
            server.emit("connection", socket);
            socket.emit("data", Buffer.from(data));
            socket.resume();
          }
        }
      );
    } catch (err) {
      console.log("catch error:", err);
    }
  })();
}
