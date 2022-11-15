import {
  TracerScheduler,
  ReturnTypeIs,
  Result,
  run,
  runNoExcept,
  race,
  raceNoExcept,
  subNoExcept,
} from "./scheduler";

async function work(_id: number, _depth: number, _work: number) {
  console.log("id:", _id, "depth:", _depth, "work:", _work, "start");
  await new Promise<void>((r) => setTimeout(r, 100));
  console.log("id:", _id, "depth:", _depth, "work:", _work, "finished");
  return "ok";
}

async function workNoExcept(
  _id: number,
  _depth: number,
  _work: number
): Promise<Result<string>> {
  console.log("id:", _id, "depth:", _depth, "work:", _work, "start");
  await new Promise<void>((r) => setTimeout(r, 100));
  console.log("id:", _id, "depth:", _depth, "work:", _work, "finished");
  return { ok: true, result: "ok" };
}

async function* task(_id: number, _depth: number): ReturnTypeIs<string> {
  for (let i = 0; i < 10; i++) {
    yield* run(work.bind(undefined, _id, _depth, i));
  }
  return "ok";
}

async function* taskNoExcept(
  _id: number,
  _depth: number
): ReturnTypeIs<Result<string>> {
  for (let i = 0; i < 10; i++) {
    const { ok, error } = yield* runNoExcept(
      workNoExcept.bind(undefined, _id, _depth, i)
    );
    if (!ok) {
      return { ok, error };
    }
  }
  return { ok: true, result: "ok" };
}

async function* multiTask(): ReturnTypeIs<string> {
  for (let i = 0; i < 10; i++) {
    yield* task(i, 0);
  }
  return "ok";
}

async function* multiTaskNoExcept(): ReturnTypeIs<Result<string>> {
  for (let i = 0; i < 10; i++) {
    const { ok, error } = yield* taskNoExcept(i, 0);
    if (!ok) {
      return { ok, error };
    }
  }
  return { ok: true, result: "ok" };
}

async function main() {
  const scheduler = new TracerScheduler();
  scheduler
    .exec(multiTask())
    .catch((error) => error as string)
    .then((result) => {
      console.log("exec result:", result);
    });
  setTimeout(() => {
    console.log("cancel");
    scheduler.abort("cancel");
  }, 333);
}

async function mainNoExcept() {
  const scheduler = new TracerScheduler();
  scheduler.execNoExcept(multiTaskNoExcept()).then(({ error, result }) => {
    console.log("exec result:", result, "error:", error);
  });
  setTimeout(() => {
    console.log("cancel");
    scheduler.abort("cancel");
  }, 333);
}

// main();
mainNoExcept();
