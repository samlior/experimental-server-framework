import cluster, { Worker } from "node:cluster";
import { cpus } from "node:os";
import process from "node:process";
import { createServer } from "node:http";
import net from "node:net";
import { createDB, doSomething, destroyDB } from "./db";

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
      // waiting
      Promise.all(workers.map(({ promise }) => promise))
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

  // start http server
  const server = createServer();

  server.on("error", (err) => console.log("http server error:", err));

  server.on("listening", () => console.log("http server listening at:", 3000));

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

  server.listen(3000);
} else {
  (async () => {
    try {
      const db = await createDB(false);

      const server = createServer((req, res) => {
        doSomething(db)
          .then(() => {
            res.end(`Response from worker: ${cluster.worker!.id}`);
          })
          .catch((err) => {
            res.end(
              `Response from worker: ${cluster.worker!.id}, err:` + err.message
            );
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
