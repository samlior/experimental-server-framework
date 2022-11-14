export type Result<T> =
  | {
      ok: false;
      error: any;
      result?: undefined;
    }
  | {
      ok: true;
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
): AsyncGenerator<T, Result<T>, Result<T>> {
  try {
    return yield await fn();
  } catch (error) {
    return { ok: false, error };
  }
}

export async function* run<T>(
  fn: () => Promise<T>
): AsyncGenerator<T, T, Result<T>> {
  const { ok, error, result } = yield await fn();
  if (!ok) {
    throw error;
  }
  return result;
}

export async function* raceNoExcept<T>(
  fn: () => Promise<T>
): AsyncGenerator<RaceRequest<T>, Result<T>, Result<T>> {
  return yield new RaceRequest<T>(fn());
}

export async function* race<T>(
  fn: () => Promise<T>
): AsyncGenerator<RaceRequest<T>, T, Result<T>> {
  const { ok, error, result } = yield new RaceRequest<T>(fn());
  if (!ok) {
    throw error;
  }
  return result;
}

export async function* subNoExcept<T>(
  fn: () => TaskGenerator<T>
): AsyncGenerator<any, Result<T>, Result<any>> {
  try {
    return {
      ok: true,
      result: yield* fn(),
    };
  } catch (error) {
    return {
      ok: false,
      error,
    };
  }
}

export async function* sub<T>(
  fn: () => TaskGenerator<T>
): AsyncGenerator<any, T, Result<any>> {
  return yield* fn();
}

export async function* checkNoExcept(): AsyncGenerator<
  void,
  Result<void>,
  Result<any>
> {
  return yield await Promise.resolve();
}

export async function* check(): AsyncGenerator<
  void,
  Result<void>,
  Result<any>
> {
  const { ok, error, result } = yield await Promise.resolve();
  if (!ok) {
    throw error;
  }
  return result;
}

export type TaskGenerator<T> = AsyncGenerator<any, T, Result<any>>;

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
        ok: !error,
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

  get parallels() {
    return this.count;
  }

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

  get parallels() {
    return this.tracer.parallels;
  }

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
