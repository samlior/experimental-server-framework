export type Next<T> =
  | {
      failed: true;
      error: any;
      result?: undefined;
    }
  | {
      failed: false;
      error?: undefined;
      result: T;
    };

type RaceResolved = [any, any];

class RaceRequest<T = any> {
  readonly promise: Promise<T>;

  constructor(promise: Promise<T>) {
    this.promise = promise;
  }
}

export async function* runNoExcept<T>(
  fn: () => Promise<T>
): AsyncGenerator<T, Next<T>, Next<T>> {
  try {
    return yield await fn();
  } catch (error) {
    return { failed: true, error };
  }
}

export async function* run<T>(
  fn: () => Promise<T>
): AsyncGenerator<T, T, Next<T>> {
  const { failed, error, result } = yield await fn();
  if (failed) {
    throw error;
  }
  return result;
}

export async function* raceNoExcept<T>(
  fn: () => Promise<T>
): AsyncGenerator<RaceRequest<T>, Next<T>, Next<T>> {
  return yield new RaceRequest<T>(fn());
}

export async function* race<T>(
  fn: () => Promise<T>
): AsyncGenerator<RaceRequest<T>, T, Next<T>> {
  const { failed, error, result } = yield new RaceRequest<T>(fn());
  if (failed) {
    throw error;
  }
  return result;
}

export async function* subNoExcept<T>(
  fn: () => TaskGenerator<T>
): AsyncGenerator<any, Next<T>, Next<any>> {
  try {
    return {
      failed: false,
      result: yield* fn(),
    };
  } catch (error) {
    return {
      failed: true,
      error,
    };
  }
}

export async function* sub<T>(
  fn: () => TaskGenerator<T>
): AsyncGenerator<any, T, Next<any>> {
  return yield* fn();
}

export async function* checkNoExcept(): AsyncGenerator<
  void,
  Next<void>,
  Next<any>
> {
  return yield await Promise.resolve();
}

export async function* check(): AsyncGenerator<void, Next<void>, Next<any>> {
  const { failed, error, result } = yield await Promise.resolve();
  if (failed) {
    throw error;
  }
  return result;
}

export type TaskGenerator<T> = AsyncGenerator<any, T, Next<any>>;

export class Scheduler {
  private readonly races = new Set<(result: RaceResolved) => void>();
  private reason: any = undefined;

  abort(reason: any) {
    if (reason === undefined) {
      throw new Error("undefined reason");
    }
    this.reason = reason;
    for (const resolve of this.races) {
      resolve([reason, undefined]);
    }
  }

  resume() {
    this.reason = undefined;
  }

  async run<T>(generator: TaskGenerator<T>): Promise<T> {
    let latestError: any = undefined;
    let latestResult: any = undefined;
    while (true) {
      const error = latestError ?? this.reason;
      const result = error ? undefined : latestResult;
      const { value, done } = await generator.next({
        failed: !!error,
        error,
        result,
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
            resolve([undefined, result]);
          })
          .catch((error) => {
            resolve([error, undefined]);
          });
        [latestError, latestResult] = await taskFinishedOrAborted;
        this.races.delete(resolve);
      } else {
        [latestError, latestResult] = [undefined, value];
      }
    }
  }
}

export class CountTracer {
  // TODO: maybe Number.MIN_SAFE_INTEGER?
  private count = 0;
  private resolve?: () => void;
  private promise?: Promise<void>;

  private create() {
    this.promise = new Promise<void>((r) => (this.resolve = r));
  }

  private destroy() {
    this.resolve!();
    this.resolve = undefined;
    this.promise = undefined;
  }

  increase(i: number = 1) {
    this.count += i;
    if (this.count - i === 0) {
      this.create();
    }
  }

  decrease(i: number = 1) {
    if (i > this.count) {
      i = this.count;
    }
    this.count -= i;
    if (this.count === 0) {
      this.destroy();
    }
  }

  wait() {
    return this.promise ?? Promise.resolve();
  }
}

export class TracerScheduler extends Scheduler {
  private tracer = new CountTracer();

  abortAndWait(reason: any) {
    super.abort(reason);
    return this.tracer.wait();
  }

  async run<T>(generator: TaskGenerator<T>): Promise<T> {
    try {
      this.tracer.increase();
      return await super.run(generator);
    } finally {
      this.tracer.decrease();
    }
  }
}
