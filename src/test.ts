import {
  TracerScheduler,
  TaskGenerator,
  run,
  runNoExcept,
  race,
  raceNoExcept,
  subNoExcept,
  sub,
} from "./scheduler";

async function work(_depth: number, _work: number) {
  console.log("depth:", _depth, "work:", _work, "start");
  await new Promise<void>((r) => setTimeout(r, 100));
  console.log("depth:", _depth, "work:", _work, "finished");
}

async function* depthNoExcept(_depth: number): TaskGenerator<string> {
  if (_depth === 4) {
    throw new Error("depth reached 4");
    // return "ok";
  }

  console.log("depth:", _depth, "start");
  const startAt = Date.now();

  try {
    for (let i = 0; i < 3; i++) {
      const { failed, error } = yield* runNoExcept(
        work.bind(undefined, _depth, i)
      );
      if (failed) {
        console.log("stop at:", _depth, "work:", i, "error:", error);
        return "not ok";
      }
    }

    const { failed, error, result } = yield* subNoExcept(
      depthNoExcept.bind(undefined, _depth + 1)
    );
    if (failed) {
      console.log("stop at:", _depth, "error:", error);
      return "not ok";
    }

    return result;
  } finally {
    console.log("depth:", _depth, "usage:", Date.now() - startAt);
  }
}

async function* depth(_depth: number): TaskGenerator<string> {
  if (_depth === 4) {
    throw new Error("depth reached 4");
    // return "ok";
  }

  console.log("depth:", _depth, "start");
  const startAt = Date.now();

  try {
    for (let i = 0; i < 3; i++) {
      yield* run(work.bind(undefined, _depth, i));
    }

    return yield* sub(depth.bind(undefined, _depth + 1));
  } finally {
    console.log("depth:", _depth, "usage:", Date.now() - startAt);
  }
}

const scheduler = new TracerScheduler();

scheduler
  .run(depth(0))
  .then((result) => {
    console.log("run return:", result);
  })
  .catch((error) => {
    console.log("run catch:", error);
  });

setTimeout(() => {
  console.log("canceled");
  scheduler.abort("canceled");
}, 777);
