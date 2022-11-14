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

async function work(_id: number, _depth: number, _work: number) {
  console.log("id:", _id, "depth:", _depth, "work:", _work, "start");
  await new Promise<void>((r) => setTimeout(r, 100));
  console.log("id:", _id, "depth:", _depth, "work:", _work, "finished");
}

async function* depthNoExcept(
  _id: number,
  _depth: number
): TaskGenerator<string> {
  if (_depth === 4) {
    throw new Error("depth reached 4");
    // return "ok";
  }

  console.log("id:", _id, "depth:", _depth, "start");
  const startAt = Date.now();

  try {
    for (let i = 0; i < 3; i++) {
      const { ok, error } = yield* runNoExcept(
        work.bind(undefined, _id, _depth, i)
      );
      if (!ok) {
        console.log("stop at, id:", _id, "depth", _depth, "error:", error);
        return "not ok";
      }
    }

    const { ok, error, result } = yield* subNoExcept(
      depthNoExcept.bind(undefined, _id, _depth + 1)
    );
    if (!ok) {
      console.log("stop at, id:", _id, "depth", _depth, "error:", error);
      return "not ok";
    }

    return result;
  } finally {
    console.log("id:", _id, "depth:", _depth, "usage:", Date.now() - startAt);
  }
}

async function* depth(_id: number, _depth: number): TaskGenerator<string> {
  if (_depth === 4) {
    throw new Error("depth reached 4");
    // return "ok";
  }

  console.log("id:", _id, "depth:", _depth, "start");
  const startAt = Date.now();

  try {
    for (let i = 0; i < 3; i++) {
      yield* run(work.bind(undefined, _id, _depth, i));
    }

    return yield* sub(depth.bind(undefined, _id, _depth + 1));
  } catch (error) {
    console.log("stop at, id:", _id, "depth", _depth, "error:", error);
    throw error;
  } finally {
    console.log("id:", _id, "depth:", _depth, "usage:", Date.now() - startAt);
  }
}

const scheduler = new TracerScheduler();

for (let i = 0; i < 3; i++) {
  scheduler
    .run(depthNoExcept(i, 0))
    .then((result) => {
      console.log("run return:", result);
    })
    .catch((error) => {
      console.log("run catch:", error);
    });
}

setTimeout(async () => {
  console.log("canceled");
  await scheduler.abortAndWait("canceled");
  console.log("wait finished");
}, 777);
