import cluster, { Worker } from "node:cluster";
import { cpus } from "node:os";
import process from "node:process";
import { createServer } from "node:http";
import { createDB, doSomething, destroyDB } from "./db";

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
} else {
  (async () => {
    try {
      const db = await createDB(false);

      process.on(
        "message",
        ({ method, port }: { method: string; port: number }) => {
          if (method === "exit") {
            setTimeout(async () => {
              await destroyDB(db);
              cluster.worker!.destroy();
            }, 100);
          } else if (method === "start") {
            // start http server
            const server = createServer((req, res) => {
              doSomething(db)
                .then(() => {
                  res.end(`Response from worker: ${cluster.worker!.id}`);
                })
                .catch((err) => {
                  res.end(
                    `Response from worker: ${cluster.worker!.id}, err:` +
                      err.message
                  );
                });
            });

            server.on("error", (err) => console.log("http server error:", err));

            server.on("listening", () =>
              console.log(
                `worker: ${
                  cluster.worker!.id
                }, http server listening at: ${port}`
              )
            );

            server.listen(port);
          }
        }
      );

      process.send!({ method: "ready" });
    } catch (err) {
      console.log("catch error:", err);
    }
  })();
}
