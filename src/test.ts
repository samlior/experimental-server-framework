import { TracerScheduler, TaskGenerator, runNoExcept } from "./scheduler";

async function work(depth: number, work: number) {
  await new Promise<void>((r) => setTimeout(r, 100));
  return `result of depth: ${depth} work: ${work}`;
}

async function* depth(depth: number): TaskGenerator<void> {
  console.log("depth:", depth, "start");
  const startAt = Date.now();
  let index = 0;
  try {
    {
      const workerIndex = index++;
      const { failed, error, result } = yield* runNoExcept(
        work.bind(undefined, depth, workerIndex)
      );
      if (failed) {
        console.log("stop at:", depth, "work:", workerIndex, "error:", error);
        return;
      }
      console.log(result);
    }

    {
      const workerIndex = index++;
      const { failed, error, result } = yield* runNoExcept(
        work.bind(undefined, depth, workerIndex)
      );
      if (failed) {
        console.log("stop at:", depth, "work:", workerIndex, "error:", error);
        return;
      }
      console.log(result);
    }

    {
      const workerIndex = index++;
      const { failed, error, result } = yield* runNoExcept(
        work.bind(undefined, depth, workerIndex)
      );
      if (failed) {
        console.log("stop at:", depth, "work:", workerIndex, "error:", error);
        return;
      }
      console.log(result);
    }

    {
      const workerIndex = index++;
      const { failed, error, result } = yield* runNoExcept(
        work.bind(undefined, depth, workerIndex)
      );
      if (failed) {
        console.log("stop at:", depth, "work:", workerIndex, "error:", error);
        return;
      }
      console.log(result);
    }
  } finally {
    console.log("depth:", depth, "usage:", Date.now() - startAt);
  }
}

const scheduler = new TracerScheduler();

scheduler.run(depth(0));

setTimeout(() => {
  console.log("canceled");
  scheduler.abort("canceled");
}, 222);
