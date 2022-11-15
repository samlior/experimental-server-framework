import {
  TracerScheduler,
  ReturnTypeIs,
  run,
  runNoExcept,
  race,
  raceNoExcept,
  subNoExcept,
  Result,
} from "./scheduler";

async function work(_id: number, _depth: number, _work: number) {
  console.log("id:", _id, "depth:", _depth, "work:", _work, "start");
  await new Promise<void>((r) => setTimeout(r, 100));
  console.log("id:", _id, "depth:", _depth, "work:", _work, "finished");
}
