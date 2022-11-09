import { createServer } from "node:http";

const server = createServer((req, res) => {
  req.on("readable", () => {
    let body: Buffer = Buffer.alloc(0);
    let chunk: Buffer;
    while (!req.closed && null !== (chunk = req.read())) {
      body = Buffer.concat([body, chunk]);
    }

    let timeout: NodeJS.Timeout | null = setTimeout(() => {
      timeout = null;
      res.end(`Response from master`);
    }, 3000);

    req.socket.on("close", () => {
      if (timeout === null) {
        return;
      }

      console.log("request canceled");
      clearTimeout(timeout);
    });
  });
});

server.on("error", (err) => console.log("http server error:", err));

server.on("listening", () => console.log("http server listening at:", 3000));

server.listen(3000);
