export type LimiterDecision<State> = {
  allowed: boolean;
  reason: 'within_limit' | 'limit_exhausted';
  remaining: number;
  resetAtMs: number;
  retryAfterMs: number;
  state: State;
};

export type Limiter<State> = {
  check(key: string): LimiterDecision<State>;
};
