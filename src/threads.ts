import {
  Worker,
  isMainThread,
  MessageChannel,
  MessagePort,
  parentPort,
  threadId,
} from "node:worker_threads";
import { cpus } from "node:os";
import { createServer } from "node:http";
import { createDB, doSomething, destroyDB } from "./db";

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

  // handle signal
  let exiting = false;
  process.on("SIGINT", () => {
    if (!exiting) {
      console.log("exiting...");
      exiting = true;
      // notify all workers to exit
      for (const { worker } of workers) {
        worker.postMessage({ method: "exit" });
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

  server.on("request", async (req, res) => {
    const { worker } = workers[nextIndex()];
    const { port1, port2 } = new MessageChannel();
    worker.postMessage({ method: "request", port: port2 }, [port2]);
    port1.on("message", (response) => {
      res.end(response);
      port1.close();
    });
  });

  server.listen(3000);
} else {
  (async () => {
    try {
      const db = await createDB(false);

      parentPort!.on(
        "message",
        ({ method, port }: { method: string; port: MessagePort }) => {
          if (method === "exit") {
            setTimeout(async () => {
              await destroyDB(db);
              process.exit(0);
            }, 100);
          } else if (method === "request") {
            doSomething(db)
              .then(() => {
                port.postMessage(`Response from worker: ${threadId}`);
              })
              .catch((err) => {
                port.postMessage(
                  `Response from worker: ${threadId}` + err.message
                );
              });
          }
        }
      );
    } catch (err) {
      console.log("catch error:", err);
    }
  })();
}
