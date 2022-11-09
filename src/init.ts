import { createDB, initData, destroyDB } from "./db";

(async () => {
  const db = await createDB(true);
  try {
    await initData(db);
    console.log("初始化完成");
  } catch (err) {
    console.log("catch error:", err);
  } finally {
    await destroyDB(db);
  }
})();
