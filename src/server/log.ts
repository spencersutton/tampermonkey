// Logging to stderr with a timestamp, like the Python server's.
let verbose = false;

export function setVerbose(on: boolean) {
  verbose = on;
}

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export const log = {
  debug: (message: string) => {
    if (verbose) {
      console.error(`${stamp()} DEBUG ${message}`);
    }
  },
  info: (message: string) => console.error(`${stamp()} INFO ${message}`),
  warn: (message: string) => console.error(`${stamp()} WARNING ${message}`),
  error: (message: string, e?: unknown) =>
    console.error(`${stamp()} ERROR ${message}`, ...(e === undefined ? [] : [e])),
};

/**
 * Like Python's threading.Event for a background loop: wake() makes the next (or current) wait()
 * return.
 */
export class Waker {
  private pending = false;
  private resolve: (() => void) | null = null;

  wake() {
    this.pending = true;
    this.resolve?.();
  }

  /** Wait for wake(), or `ms` if given; clears the wake-up either way. */
  async wait(ms?: number): Promise<void> {
    if (!this.pending) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await new Promise<void>(resolve => {
        this.resolve = resolve;
        if (ms !== undefined) {
          timer = setTimeout(resolve, ms);
        }
      });
      clearTimeout(timer);
      this.resolve = null;
    }
    this.pending = false;
  }
}
