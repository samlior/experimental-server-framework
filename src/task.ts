enum TaskErrorCode {
  Canceled = 30001,
  TaskError = 30002,
  Unknown = 30003,
}

class TaskError extends Error {
  readonly error?: any;
  readonly errorCode: number;

  constructor(errorCode: number, message?: string, error?: any) {
    super(message);
    this.error = error;
    this.errorCode = errorCode;
  }

  get isCanceled() {
    return this.errorCode === TaskErrorCode.Canceled;
  }

  get isTaskError() {
    return this.errorCode === TaskErrorCode.TaskError;
  }

  get isUnknown() {
    return this.errorCode === TaskErrorCode.Unknown;
  }

  getErrorToThrow() {
    if (this.isTaskError) {
      return this.error ?? this;
    } else {
      return this;
    }
  }

  rethrow() {
    throw this.getErrorToThrow();
  }
}

type TaskReturn<T> =
  | {
      error: TaskError;
      result: null;
    }
  | {
      error: null;
      result: T;
    };

class RaiseRequest<T = any> {
  readonly promise: Promise<T>;

  constructor(promise: Promise<T>) {
    this.promise = promise;
  }
}

async function* asyncRunNoExcept<T>(
  fn: () => Promise<T>
): AsyncGenerator<T, TaskReturn<T>, TaskReturn<T>> {
  try {
    return yield await fn();
  } catch (error) {
    if (error instanceof TaskError) {
      return { error, result: null };
    } else {
      return {
        error: new TaskError(TaskErrorCode.TaskError, undefined, error),
        result: null,
      };
    }
  }
}

async function* asyncRun<T>(
  fn: () => Promise<T>
): AsyncGenerator<T, TaskReturn<T>, TaskReturn<T>> {
  return yield await fn();
}

async function* asyncRunRaise<T>(
  fn: () => Promise<T>
): AsyncGenerator<RaiseRequest<T>, TaskReturn<T>, TaskReturn<T>> {
  const res = yield new RaiseRequest<T>(fn());
  if (res?.error?.isTaskError) {
    throw res.error.getErrorToThrow();
  }
  return res;
}

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

async function* myTask(): AsyncGenerator<any, number, TaskReturn<any>> {
  {
    const { error, result } = yield* asyncRunNoExcept(myAsyncWork1);
    console.log("error:", error, "result:", result);
    if (!error) {
      result.repeat(1);
    }
  }

  {
    const { error, result } = yield* asyncRun(myAsyncWork2);
    console.log("error:", error, "result:", result);
  }

  {
    const { error, result } = yield* asyncRun(myAsyncWork3);
    console.log("error:", error, "result:", result);
  }

  return 1;
}

type RaiseReturn = [TaskError, null] | [null, any];

class TaskScheduler {
  private readonly raises = new Set<(result: RaiseReturn) => void>();
  private reason: TaskError | null = null;

  abort(reason?: string | number | TaskError | any, message?: string) {
    if (reason === undefined) {
      this.reason = new TaskError(TaskErrorCode.Unknown);
    } else if (typeof reason === "string") {
      this.reason = new TaskError(TaskErrorCode.Unknown, message);
    } else if (typeof reason === "number") {
      this.reason = new TaskError(reason, message);
    } else if (reason instanceof TaskError) {
      this.reason = reason;
    } else {
      this.reason = new TaskError(TaskErrorCode.Unknown, message, reason);
    }
    for (const resolve of this.raises) {
      resolve([this.reason, null]);
    }
  }

  async run<T>(generator: AsyncGenerator<any, T, any>): Promise<T> {
    let latestError: TaskError | null = null;
    let latestResult: any = null;
    while (true) {
      const { value, done } = (await generator.next({
        error: latestError ?? this.reason,
        result: latestResult,
      })) as any;
      if (done) {
        return value;
      }
      if (value instanceof RaiseRequest) {
        let resolve!: (result: RaiseReturn) => void;
        const taskFinishedOrAborted = new Promise<RaiseReturn>((r) => {
          resolve = r;
        });
        this.raises.add(resolve);
        value.promise
          .then((result) => {
            resolve([null, result]);
          })
          .catch((err) => {
            resolve([
              new TaskError(TaskErrorCode.TaskError, undefined, err),
              null,
            ]);
          });
        [latestError, latestResult] = await taskFinishedOrAborted;
        this.raises.delete(resolve);
      } else {
        [latestError, latestResult] = [null, value];
      }
    }
  }
}

const scheduler = new TaskScheduler();

setTimeout(() => {
  console.log("=== outer canceled");
  scheduler.abort(TaskErrorCode.Canceled);
}, 480);

scheduler.run(myTask());
