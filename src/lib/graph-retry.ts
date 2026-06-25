const RETRYABLE = new Set([429, 503, 504]);

function statusOf(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null) {
    const o = e as { statusCode?: number; status?: number };
    return o.statusCode ?? o.status;
  }
  return undefined;
}

export interface RetryOpts { retries?: number; baseMs?: number }

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseMs = opts.baseMs ?? 500;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const status = statusOf(e);
      if (status === undefined || !RETRYABLE.has(status) || attempt >= retries) throw e;
      const delay = baseMs * Math.pow(2, attempt);
      attempt++;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
  }
}
