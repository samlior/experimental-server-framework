export const NO_ERROR = Symbol("NO_ERROR");
export const NO_RESULT = Symbol("NO_RESULT");

type Next<T> =
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

export function isError<T>(next: Next<T>): next is {
  error: any;
  result: typeof NO_RESULT;
} {
  return next.result === NO_RESULT;
}

export async function* runNoExcept<T>(
  fn: () => Promise<T>
): AsyncGenerator<T, Next<T>, Next<T>> {
  try {
    return yield await fn();
  } catch (error) {
    return { error, result: NO_RESULT };
  }
}

export async function* run<T>(
  fn: () => Promise<T>
): AsyncGenerator<T, T, Next<T>> {
  const { error, result } = yield await fn();
  if (result !== NO_RESULT) {
    return result;
  }
  throw error;
}

export async function* raceNoExcept<T>(
  fn: () => Promise<T>
): AsyncGenerator<RaceRequest<T>, Next<T>, Next<T>> {
  return yield new RaceRequest<T>(fn());
}

export async function* race<T>(
  fn: () => Promise<T>
): AsyncGenerator<RaceRequest<T>, T, Next<T>> {
  const { error, result } = yield new RaceRequest<T>(fn());
  if (result !== NO_RESULT) {
    return result;
  }
  throw error;
}

export type TaskGenerator<T> = AsyncGenerator<any, T, Next<T>>;

export class Scheduler {
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

  async run<T>(generator: TaskGenerator<T>): Promise<T> {
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
