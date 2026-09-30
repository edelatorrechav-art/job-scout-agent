/** Maps with at most `limit` calls in flight; results keep input order. */
export async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export class DeadlineError extends Error {}

/** Rejects with DeadlineError if `promise` hasn't settled by `deadline` (epoch ms). */
export function beforeDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const ms = deadline - Date.now();
  if (ms <= 0) return Promise.reject(new DeadlineError());
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DeadlineError()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Limits how many calls run at once across independent callers. */
export function createLimiter(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
