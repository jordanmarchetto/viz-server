import type { Answers } from "./storage.ts";

export interface AnswerSubscription {
  promise: Promise<Answers | null>;
  cancel(): void;
}

type Resolve = (answers: Answers | null) => void;

/** In-memory wakeups only. Durable answer state remains in the JSON sidecar. */
export class AnswerWaiters {
  private readonly waiting = new Map<string, Set<Resolve>>();

  subscribe(id: string, timeoutMs: number): AnswerSubscription {
    let active = true;
    let resolvePromise: Resolve = () => {};
    const promise = new Promise<Answers | null>((resolve) => {
      resolvePromise = resolve;
    });
    const listeners = this.waiting.get(id) ?? new Set<Resolve>();
    this.waiting.set(id, listeners);

    const finish = (answers: Answers | null) => {
      if (!active) return;
      active = false;
      clearTimeout(timer);
      listeners.delete(finish);
      if (listeners.size === 0) this.waiting.delete(id);
      resolvePromise(answers);
    };
    listeners.add(finish);
    const timer = setTimeout(() => finish(null), timeoutMs);

    return { promise, cancel: () => finish(null) };
  }

  notify(id: string, answers: Answers): void {
    for (const resolve of [...(this.waiting.get(id) ?? [])]) resolve(answers);
  }
}
