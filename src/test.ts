import {
  TracerScheduler,
  TaskGenerator,
  runNoExcept,
  Next,
  raceNoExcept,
} from "./scheduler";

async function work(_depth: number, _work: number) {
  console.log("depth:", _depth, "work:", _work, "start");
  await new Promise<void>((r) => setTimeout(r, 100));
  console.log("depth:", _depth, "work:", _work, "finished");
}

async function* depth(_depth: number): TaskGenerator<Next<string>> {
  if (_depth === 4) {
    return { failed: false, result: "ok" };
  }

  console.log("depth:", _depth, "start");
  const startAt = Date.now();

  try {
    for (let i = 0; i < 3; i++) {
      const { failed, error, result } = yield* raceNoExcept(
        work.bind(undefined, _depth, i)
      );
      if (failed) {
        console.log("stop at:", _depth, "work:", i, "error:", error);
        return { failed, error, result };
      }
    }

    return yield* depth(_depth + 1);
  } finally {
    console.log("depth:", _depth, "usage:", Date.now() - startAt);
  }
}

const scheduler = new TracerScheduler();

scheduler.run(depth(0)).then(({ failed, error, result }) => {
  console.log("run return:", failed, error, result);
});

setTimeout(() => {
  console.log("canceled");
  scheduler.abort("canceled");
}, 777);
