type TaskNext<T> =
  | {
      error: any;
      result: null;
    }
  | {
      error: null;
      result: T;
    };

type RaceResolved = [any, null] | [null, any];

class RaceRequest<T = any> {
  readonly promise: Promise<T>;

  constructor(promise: Promise<T>) {
    this.promise = promise;
  }
}

async function* runNoExcept<T>(
  fn: () => Promise<T>
): AsyncGenerator<T, TaskNext<T>, TaskNext<T>> {
  try {
    return yield await fn();
  } catch (error) {
    return { error, result: null };
  }
}

async function* run<T>(
  fn: () => Promise<T>
): AsyncGenerator<T, T, TaskNext<T>> {
  const { error, result } = yield await fn();
  if (error) {
    throw error;
  }
  return result!;
}

async function* race<T>(
  fn: () => Promise<T>
): AsyncGenerator<RaceRequest<T>, T, TaskNext<T>> {
  const { error, result } = yield new RaceRequest<T>(fn());
  if (error) {
    throw error;
  }
  return result!;
}

class TaskScheduler {
  private readonly races = new Set<(result: RaceResolved) => void>();
  private reason: any = null;

  abort(reason: any) {
    if (reason === undefined || reason === null) {
      throw new Error("invalid reason, undefined or null");
    }
    this.reason = reason;
    for (const resolve of this.races) {
      resolve([null, null]);
    }
  }

  async run<T>(generator: AsyncGenerator<any, T, any>): Promise<T> {
    let latestError: any = null;
    let latestResult: any = null;
    while (true) {
      const iterResult: any = await generator.next({
        error: latestError ?? this.reason,
        result: latestResult,
      });
      latestError = null;
      latestResult = null;
      const { value, done } = iterResult;
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
            resolve([null, result]);
          })
          .catch((error) => {
            resolve([error, null]);
          });
        [latestError, latestResult] = await taskFinishedOrAborted;
        this.races.delete(resolve);
      } else {
        [latestError, latestResult] = [null, value];
      }
    }
  }
}

const scheduler = new TaskScheduler();

class MyClass {}

async function myAsyncWork1() {
  await new Promise<void>((r) => setTimeout(r, 222));
  if (4 % 2 === 0) {
    throw new Error("error");
  }
  return "wuhu";
}

async function myAsyncWork2() {
  await new Promise<void>((r) => setTimeout(r, 222));
  return 123;
}

async function myAsyncWork3() {
  await new Promise<void>((r) => setTimeout(r, 222));
  return new MyClass();
}

async function* myTask(): AsyncGenerator<any, number, TaskNext<any>> {
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
    const result = yield* run(myAsyncWork3);
    console.log("2 result:", result);
  } catch (err) {
    console.log("2 error:", err);
  }

  return 1;
}

setTimeout(() => {
  console.log("=== outer canceled");
  scheduler.abort("canceled");
}, 480);

scheduler.run(myTask());
