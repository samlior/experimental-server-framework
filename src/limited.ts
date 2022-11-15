import LinkedList, { Node } from "yallist";

export enum TokenStatus {
  Idle,
  Working,
  Stopped,
}

export class Token {
  readonly limited: Limited;

  status: TokenStatus = TokenStatus.Idle;

  constructor(limited: Limited) {
    this.limited = limited;
  }

  async invoke<T>(promise: Promise<T>): Promise<T> {
    if (this.status !== TokenStatus.Stopped) {
      throw new Error("invalid token status");
    }

    try {
      this.status = TokenStatus.Working;
      return await promise;
    } finally {
      this.status = TokenStatus.Stopped;
    }
  }

  async *invoke2<T = unknown, TReturn = any, TNext = unknown>(
    generator: AsyncGenerator<T, TReturn, TNext>
  ): AsyncGenerator<T, TReturn, TNext> {
    if (this.status !== TokenStatus.Stopped) {
      throw new Error("invalid token status");
    }

    try {
      this.status = TokenStatus.Working;
      return yield* generator;
    } finally {
      this.status = TokenStatus.Stopped;
    }
  }
}

export enum RequestStatus {
  Queued,
  Finished,
  Canceled,
}

export type RequestValue = {
  status: RequestStatus;
  resolve: (token: Token) => void;
  reject: (reason?: any) => void;
};

export type Request = Node<RequestValue>;

function toNode<T>(value: T) {
  return {
    prev: null,
    next: null,
    value,
  };
}

export class Limited {
  private idle = LinkedList.create<Token>();
  private queue = LinkedList.create<RequestValue>();

  constructor(tokens: number) {
    for (let i = 0; i < tokens; i++) {
      this.idle.push(new Token(this));
    }
  }

  get(): { getToken: Promise<Token>; request?: Request } {
    if (this.idle.length > 0) {
      const token = this.idle.shift()!;
      token.status = TokenStatus.Stopped;
      return { getToken: Promise.resolve(token) };
    } else {
      let resolve!: (token: Token) => void;
      let reject!: (reason?: any) => void;
      const getToken = new Promise<Token>((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
      });
      const requestValue: RequestValue = {
        status: RequestStatus.Queued,
        resolve,
        reject,
      };
      const request = toNode(requestValue);
      this.queue.pushNode(request);
      return { getToken, request };
    }
  }

  put(token: Token) {
    if (token.limited !== this || token.status !== TokenStatus.Stopped) {
      throw new Error("invalid token");
    }
    if (this.queue.length > 0) {
      const request = this.queue.shift()!;
      request.status = RequestStatus.Finished;
      request.resolve(token);
    } else {
      token.status = TokenStatus.Idle;
      this.idle.push(token);
    }
  }

  cancel(request: Request, reason?: any) {
    if (
      request.list !== this.queue ||
      request.value.status !== RequestStatus.Queued
    ) {
      throw new Error("invalid request");
    }
    this.queue.removeNode(request);
    request.value.status = RequestStatus.Canceled;
    request.value.reject(reason);
  }
}
