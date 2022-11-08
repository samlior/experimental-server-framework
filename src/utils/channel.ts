export class ChannelAbortError extends Error {}

export interface ChannelOption<T> {
  /**
   * Max channel size,
   * if the channel size is greater than this number,
   * it will drop the fisrt value
   */
  max?: number;
  /**
   * Drop callback,
   * it will be called when drop a value
   */
  drop?: (data: T) => void;
}

/**
 * An asynchronous queue, order by the order in which the elements are pushed
 */
export class Channel<T = any> {
  private aborted = false;
  private _array: T[] = [];
  private max?: number;
  private drop?: (data: T) => void;
  private resolve?: (data: T) => void;
  private reject?: (reason?: any) => void;

  /**
   * Get all data in the channel
   */
  get array() {
    return [...this._array];
  }

  constructor(options?: ChannelOption<T>) {
    this.max = options?.max;
    this.drop = options?.drop;
  }

  /**
   * Push data to channel
   * If the channel is waiting, resolve the promise
   * If the channel isn't waiting, push data to `_array` and cache it
   * @param data - Data
   * @returns `true` if successfully pushed, `false` if not
   */
  push(data: T) {
    if (this.aborted) {
      this.drop && this.drop(data);
      return false;
    }
    if (this.resolve) {
      this.resolve(data);
      this.reject = undefined;
      this.resolve = undefined;
    } else {
      this._array.push(data);
      if (this.max && this._array.length > this.max) {
        if (this.drop) {
          while (this._array.length > this.max) {
            this.drop(this._array.shift()!);
          }
        } else {
          this._array.splice(0, this._array.length - this.max);
        }
      }
    }
    return true;
  }

  /**
   * Get next element in channel
   * If channel is empty, it will wait until new element pushed or the channel is aborted
   * @returns Next element
   */
  next() {
    return this._array.length > 0
      ? Promise.resolve(this._array.shift()!)
      : new Promise<T>((resolve, reject) => {
          this.resolve = resolve;
          this.reject = reject;
        });
  }

  /**
   * Abort channel
   */
  abort() {
    if (this.reject) {
      this.reject(new ChannelAbortError());
      this.reject = undefined;
      this.resolve = undefined;
    }
    this.aborted = true;
    this.clear();
  }

  /**
   * Reset channel
   */
  reset() {
    this.aborted = false;
  }

  /**
   * Clear channel and drop all data
   */
  clear() {
    if (this.drop) {
      for (const data of this._array) {
        this.drop(data);
      }
    }
    this._array = [];
  }

  /**
   * Cancel a data
   * @param data - Data
   * @returns Whether the cancellation was successful
   */
  cancel(data: T) {
    const index = this._array.indexOf(data);
    if (index !== -1) {
      this._array.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Return an async generator to fetch the data in channel
   */
  async *[Symbol.asyncIterator]() {
    try {
      while (!this.aborted) {
        yield await this.next();
      }
    } catch (err) {
      if (!(err instanceof ChannelAbortError)) {
        throw err;
      }
    }
  }
}
