import { createServer } from "node:http";
import { createDB, doSomething, destroyDB } from "./db";

const port = Number(process.env.SRV_PORT);

(async () => {
  try {
    // create
    const db = await createDB(false);

    const server = createServer((req, res) => {
      doSomething(db)
        .then(() => {
          res.end("Response from master");
        })
        .catch((err) => {
          res.end("Response from master, err: " + err.message);
        });
    });

    server.on("error", (err) => console.log("http server error:", err));

    server.on("listening", () =>
      console.log("http server listening at:", port)
    );

    server.listen(port);

    // handle signal
    let exiting = false;
    process.on("SIGINT", () => {
      if (!exiting) {
        console.log("exiting...");
        exiting = true;
        // waiting
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
