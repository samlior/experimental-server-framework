import LinkedList, { Node } from "yallist";

function toNode<T>(value: T): Node<T> {
  return {
    prev: null,
    next: null,
    value,
  };
}

export type Result<T> =
  | {
      ok: false;
      error: any;
      result?: T;
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

function mergeResults<T>(
  ok: boolean,
  error: any,
  result?: Result<T>
): Result<T> {
  if (!ok) {
    if (result && !result.ok) {
      return result;
    } else {
      return { ok, error, result: result?.result };
    }
  } else {
    return result!;
  }
}

export function toNoExcept<T>(promise: Promise<T>): Promise<Result<T>> {
  return promise
    .then((result) => {
      return { ok: true, error: undefined, result };
    })
    .catch((error) => {
      return { ok: false, error };
    });
}

export function fromNoExcept<T>(promise: Promise<Result<T>>): Promise<T> {
  return promise.then(({ ok, error, result }) => {
    if (!ok) {
      throw error;
    }
    return result;
  });
}

export async function* runNoExcept<T>(
  promise: Promise<Result<T>>
): AsyncGenerator<Result<T>, Result<T>, Result<Result<T>>> {
  try {
    const { ok, error, result } = yield await promise;
    return mergeResults(ok, error, result);
  } catch (error) {
    return { ok: false, error };
  }
}

export async function* run<T>(
  promise: Promise<T>
): AsyncGenerator<T, T, Result<T>> {
  const { ok, error, result } = yield await promise;
  if (!ok) {
    throw error;
  }
  return result;
}

export async function* raceNoExcept<T>(
  promise: Promise<Result<T>>
): AsyncGenerator<RaceRequest<Result<T>>, Result<T>, Result<Result<T>>> {
  const { ok, error, result } = yield new RaceRequest<Result<T>>(promise);
  return mergeResults(ok, error, result);
}

export async function* race<T>(
  promise: Promise<T>
): AsyncGenerator<RaceRequest<T>, T, Result<T>> {
  const { ok, error, result } = yield new RaceRequest<T>(promise);
  if (!ok) {
    throw error;
  }
  return result;
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

export type ReturnTypeIs<T> = AsyncGenerator<any, T, Result<any>>;

export class Scheduler {
  private readonly races = LinkedList.create<(result: RaceResolved) => void>();
  private reason: any = undefined;

  abort(reason: any) {
    if (reason === undefined) {
      throw new Error("undefined reason");
    }
    this.reason = reason;
    for (const resolve of this.races) {
      resolve([undefined, undefined]);
    }
  }

  resume() {
    this.reason = undefined;
  }

  async execNoExcept<T>(
    generator: ReturnTypeIs<Result<T>>
  ): Promise<Result<T>> {
    try {
      let error: any = undefined;
      let result: any = undefined;
      while (true) {
        const { value, done } = await generator.next({
          ok: !error && !this.reason,
          error: error ?? this.reason,
          result,
        });
        if (done) {
          return mergeResults(
            !error && !this.reason,
            error ?? this.reason,
            value
          );
        }
        if (value instanceof RaceRequest) {
          let resolve!: (result: RaceResolved) => void;
          const taskFinishedOrAborted = new Promise<RaceResolved>((r) => {
            resolve = r;
          });
          const node = toNode(resolve);
          this.races.pushNode(node);
          value.promise
            .then((result) => {
              resolve([undefined, result]);
            })
            .catch((error) => {
              resolve([error, undefined]);
            });
          [error, result] = await taskFinishedOrAborted;
          this.races.removeNode(node);
        } else {
          [error, result] = [undefined, value];
        }
      }
    } catch (error) {
      return { ok: false, error };
    }
  }

  async exec<T>(generator: ReturnTypeIs<T>): Promise<T> {
    let error: any = undefined;
    let result: any = undefined;
    while (true) {
      const { value, done } = await generator.next({
        ok: !error && !this.reason,
        error: error ?? this.reason,
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
        const node = toNode(resolve);
        this.races.pushNode(node);
        value.promise
          .then((result) => {
            resolve([undefined, result]);
          })
          .catch((error) => {
            resolve([error, undefined]);
          });
        [error, result] = await taskFinishedOrAborted;
        this.races.removeNode(node);
      } else {
        [error, result] = [undefined, value];
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

  async execNoExcept<T>(
    generator: ReturnTypeIs<Result<T>>
  ): Promise<Result<T>> {
    try {
      this.tracer.increase();
      return await super.execNoExcept(generator);
    } finally {
      this.tracer.decrease();
    }
  }

  async exec<T>(generator: ReturnTypeIs<T>): Promise<T> {
    try {
      this.tracer.increase();
      return await super.exec(generator);
    } finally {
      this.tracer.decrease();
    }
  }
}
