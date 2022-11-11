const NO_ERROR = Symbol("NO_ERROR");
const NO_RESULT = Symbol("NO_RESULT");

type TaskNext<T> =
  | {
      error: any;
      result: typeof NO_RESULT;
    }
  | {
      error: typeof NO_ERROR;
      result: T;
    };

type RaceResolved = [any, typeof NO_RESULT] | [typeof NO_ERROR, any];

class RaceRequest<T = any> {
  readonly promise: Promise<T>;

  constructor(promise: Promise<T>) {
    this.promise = promise;
  }
}

function isError<T>(next: TaskNext<T>): next is {
  error: any;
  result: typeof NO_RESULT;
} {
  return next.result === NO_RESULT;
}

async function* runNoExcept<T>(
  fn: () => Promise<T>
): AsyncGenerator<T, TaskNext<T>, TaskNext<T>> {
  try {
    return yield await fn();
  } catch (error) {
    return { error, result: NO_RESULT };
  }
}

async function* run<T>(
  fn: () => Promise<T>
): AsyncGenerator<T, T, TaskNext<T>> {
  const { error, result } = yield await fn();
  if (result !== NO_RESULT) {
    return result;
  }
  throw error;
}

async function* raceNoExcept<T>(
  fn: () => Promise<T>
): AsyncGenerator<RaceRequest<T>, TaskNext<T>, TaskNext<T>> {
  return yield new RaceRequest<T>(fn());
}

async function* race<T>(
  fn: () => Promise<T>
): AsyncGenerator<RaceRequest<T>, T, TaskNext<T>> {
  const { error, result } = yield new RaceRequest<T>(fn());
  if (result !== NO_RESULT) {
    return result;
  }
  throw error;
}

class TaskScheduler {
  private readonly races = new Set<(result: RaceResolved) => void>();
  private reason: any = NO_ERROR;

  abort(reason: any) {
    if (reason === NO_ERROR) {
      throw new Error("invalid reason");
    }
    this.reason = reason;
    for (const resolve of this.races) {
      resolve([reason, NO_RESULT]);
    }
  }

  resume() {
    this.reason = NO_ERROR;
  }

  async run<T>(generator: AsyncGenerator<any, T, any>): Promise<T> {
    let latestError: any = NO_ERROR;
    let latestResult: any = NO_RESULT;
    while (true) {
      const { value, done } = await generator.next({
        error: latestError !== NO_ERROR ? latestError : this.reason,
        result: latestResult,
      });
      if (done) {
        return value;
      }
      if (value instanceof RaceRequest) {
        let resolve!: (result: RaceResolved) => void;
        const taskFinishedOrAborted = new Promise<RaceResolved>((r) => {
          resolve = r;
        });
        this.races.add(resolve);
        value.promise
          .then((result) => {
            resolve([NO_ERROR, result]);
          })
          .catch((error) => {
            resolve([error, NO_RESULT]);
          });
        [latestError, latestResult] = await taskFinishedOrAborted;
        this.races.delete(resolve);
      } else {
        [latestError, latestResult] = [NO_ERROR, value];
      }
    }
  }
}

const scheduler = new TaskScheduler();

class MyClass {}

async function myAsyncWork1() {
  await new Promise<void>((r) => setTimeout(r, 222));
  console.log("work1 awake");
  if (4 % 2 === 0) {
    throw new Error("error");
  }
  return "wuhu";
}

async function myAsyncWork2() {
  await new Promise<void>((r) => setTimeout(r, 222));
  console.log("work2 awake");
  return 123;
}

async function myAsyncWork3() {
  await new Promise<void>((r) => setTimeout(r, 222));
  console.log("work3 awake");
  return new MyClass();
}

async function* myTask(): AsyncGenerator<any, number, TaskNext<any>> {
  const startAt = Date.now();

  try {
    {
      const { error, result } = yield* runNoExcept(myAsyncWork1);
      console.log("0 result:", result);
      console.log("0 error:", error);
    }

    try {
      const result = yield* run(myAsyncWork2);
      console.log("1 result:", result);
    } catch (err) {
      console.log("1 error:", err);
    }

    try {
      const result = yield* race(myAsyncWork3);
      console.log("2 result:", result);
    } catch (err) {
      console.log("2 error:", err);
    }
  } finally {
    console.log("usage:", Date.now() - startAt);
  }

  return 1;
}

setTimeout(() => {
  console.log("=== canceled");
  scheduler.abort("canceled");
}, 480);

scheduler.run(myTask());
