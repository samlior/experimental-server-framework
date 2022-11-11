import { TracerScheduler, TaskGenerator, runNoExcept, Next } from "./scheduler";

async function work(_depth: number, _work: number) {
  await new Promise<void>((r) => setTimeout(r, 100));
  return `result of depth: ${_depth} work: ${_work}`;
}

async function* depth(_depth: number): TaskGenerator<Next<string>> {
  console.log("depth:", _depth, "start");
  const startAt = Date.now();

  let _work = 0;
  async function* doWork() {
    {
      return yield* runNoExcept(work.bind(undefined, _depth, _work++));
    }
  }

  try {
    {
      const { failed, error, result } = yield* doWork();
      if (failed) {
        console.log("stop at:", _depth, "work:", _work, "error:", error);
        return { failed, error, result };
      }
      console.log(result);
    }

    {
      const { failed, error, result } = yield* depth(_depth + 1);
      if (failed) {
        return { failed, error, result };
      }
    }

    {
      const { failed, error, result } = yield* doWork();
      if (failed) {
        console.log("stop at:", _depth, "work:", _work, "error:", error);
        return { failed, error, result };
      }
      console.log(result);
    }

    return { failed: false, error: undefined, result: "ok" };
  } finally {
    console.log("depth:", _depth, "usage:", Date.now() - startAt);
  }
}

const scheduler = new TracerScheduler();

scheduler.run(depth(0));

setTimeout(() => {
  console.log("canceled");
  scheduler.abort("canceled");
}, 222);
