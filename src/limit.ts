export enum TokenStatus {
  Idle,
  Working,
  Stop,
}

export class Token {
  lc: LimitedConcurrency;
  status: TokenStatus = TokenStatus.Idle;

  constructor(lc: LimitedConcurrency) {
    this.lc = lc;
  }

  async invoke<T>(fn: () => Promise<T>): Promise<T> {
    if (this.status !== TokenStatus.Stop) {
      throw new Error("invalid token status");
    }

    try {
      this.status = TokenStatus.Working;
      return await fn();
    } finally {
      this.status = TokenStatus.Stop;
    }
  }

  async *invoke2<T>(fn: () => AsyncGenerator<any, T>): AsyncGenerator<any, T> {
    if (this.status !== TokenStatus.Stop) {
      throw new Error("invalid token status");
    }

    try {
      this.status = TokenStatus.Working;
      return yield* fn();
    } finally {
      this.status = TokenStatus.Stop;
    }
  }
}

type TokenGetter = {
  resolve: (token: Token) => void;
  reject: (reason?: any) => void;
};

export class LimitedConcurrency {
  private idle = new Set<Token>();
  private busy = new Set<Token>();
  private queue: TokenGetter[] = [];

  async getToken() {
    let token: Token;
    if (this.idle.size > 0) {
      const { value }: { value: Token } = this.idle.values().next();
      this.idle.delete(value);
      token = value;
      token.status = TokenStatus.Stop;
    } else {
      token = await new Promise<Token>((resolve, reject) => {
        this.queue.push({ resolve, reject });
      });
    }
    this.busy.add(token);
    return token;
  }

  putToken(token: Token) {
    if (
      token.lc !== this ||
      token.status !== TokenStatus.Stop ||
      !this.busy.delete(token)
    ) {
      throw new Error("invalid token");
    }

    if (this.queue.length > 0) {
      const { resolve } = this.queue.shift()!;
      resolve(token);
    } else {
      this.idle.add(token);
      token.status = TokenStatus.Idle;
    }
  }
}
