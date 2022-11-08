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
    req.on("readable", () => {
      let body: Buffer = Buffer.alloc(0);
      let chunk: Buffer;
      while (!req.closed && null !== (chunk = req.read())) {
        body = Buffer.concat([body, chunk]);
      }

      const { worker } = workers[nextIndex()];
      const { port1, port2 } = new MessageChannel();
      worker.postMessage({ method: "request", body, port: port2 }, [port2]);
      port1.on("message", (response) => {
        res.end(response);
        port1.close();
      });

      req.socket.on("close", () => {
        port1.close();
      });
    });
  });

  server.listen(3000);
} else {
  parentPort!.on(
    "message",
    ({
      method,
      body,
      port,
    }: {
      method: string;
      body: Buffer;
      port: MessagePort;
    }) => {
      if (method === "exit") {
        setTimeout(() => process.exit(0), 100);
      } else if (method === "request") {
        let timeout: NodeJS.Timeout | null = setTimeout(() => {
          timeout = null;
          port.postMessage(`Response from worker: ${threadId}`);
        }, 3000);

        port.on("close", () => {
          if (timeout === null) {
            return;
          }

          console.log("request canceled");
          clearTimeout(timeout);
        });
      }
    }
  );
}
