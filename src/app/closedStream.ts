/** Read the server's closed-lot pages without waiting for the entire response. */
export type ClosedCounts = Partial<Record<'won' | 'lost', number>>;

export async function readClosedStream<T>(
  response: Response,
  onPage: (lots: T[], count: number, counts: ClosedCounts) => void,
  onUnauthorized: () => void,
): Promise<T[]> {
  if (!response.body) {
    throw new Error('The server did not send closed lots.');
  }
  const out: T[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let complete = false;
  let readFailed = false;
  try {
    for (;;) {
      const { value, done } = await reader.read().catch((error: unknown) => {
        readFailed = true;
        throw error;
      });
      pending += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        const record: { lots: T[]; count: number; done: boolean; counts: ClosedCounts } | { error: string; status: number } = JSON.parse(line);
        if ('error' in record) {
          if (record.status === 401) {
            onUnauthorized();
          }
          throw new Error(record.error);
        }
        out.push(...record.lots);
        onPage([...out], record.count, record.counts);
        complete = record.done;
      }
      if (done) {
        break;
      }
    }
    if (!complete || pending) {
      throw new Error('The closed-lot response ended unexpectedly.');
    }
    return out;
  } catch (error) {
    if (!readFailed) {
      try {
        await reader.cancel();
      } catch (cancelError) {
        console.warn('Could not cancel the closed-lot response:', cancelError);
      }
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}
