import { MINUTE } from '../shared/constants';
// Item types: a short plain name for what each lot is ("pressure washer",
// "area rug"), so the app can sort lots by type and make a category of one type
// in a click (a port of the Python server's itemtypes.py).
//
// An LLM behind any OpenAI-compatible chat completions API names them (by
// default Ministral 3 14B on nano-gpt.com). Types are stored by brand/model,
// with exact-title fallback when either identity is missing, so a relisted lot
// costs nothing, and labelling runs in its own loop after each pull. Titles go
// in batches from one site category at a time, alphabetically, with the types
// that category already uses, so the same kind of item gets the same name. A
// failed request leaves the rest for the next run; lots without a type yet just
// sort and categorize by title as before.
import { brandModelKey } from '../shared/identity';
import { cleanType } from '../shared/itemtype';
import type { Lot } from '../shared/lot';
import { byCode } from '../shared/sortKey';
import { prop } from './json';
import { log, Waker } from './log';
import { USER_AGENT } from './site';
import type { Store } from './store';
import '../shared/arrayToSet';

export const DEFAULT_URL = 'https://nano-gpt.com/api/v1';
export const DEFAULT_MODEL = 'mistralai/ministral-14b-instruct-2512';
const BATCH = 40; // titles per request
const VOCAB = 100; // types already in use sent with each request
const RETRY_MS = 15 * MINUTE; // how often to try again after a failure, with no pull to wake it
const TIMEOUT_MS = MINUTE;

const PROMPT = `You name the kind of item in lot titles from a liquidation auction (customer returns and overstock from home improvement and big-box stores).

For each numbered title, reply with the same number and its item type: the plain, generic name a shopper would use for what the item is, so that every lot of the same kind gets exactly the same name.

Rules:
- Lowercase, singular, usually 1 to 3 words: "pressure washer", "area rug", "garbage disposal", "ceiling fan", "mini fridge", "toilet seat".
- Leave out brand, model, size, capacity, voltage, power source (cordless, electric, battery, gas), color, finish, material, style, quantity and pack count ("wall cabinet", not "plywood cabinet"; "lawn mower", not "electric lawn mower"). Keep a qualifier only when it makes a different kind of item ("mini fridge" is not a "refrigerator", "hammer drill" is not a "drill driver").
- Use the usual store name, not slang or a variant: "string trimmer", not "weed wacker"; "battery", not "battery pack".
- For parts and accessories, name the part, not what it fits, adding what it's for only when the part's name alone is vague: "surface cleaner", "drill bit set", "vacuum filter", "faucet cartridge", "band saw blade", "diamond blade".
- A power tool sold with batteries, a charger or a bag is still that tool: "Drill/Driver Kit with 2 Batteries" is a "drill driver". Batteries sold with a charger ("Battery and Charger Starter Kit") are a "battery". Two or more different power tools sold together are a "power tool combo kit".
- A set of bits, blades or hand tools is named for what's in it: "Drill & Drive Set (42-Pieces)" is a "drill bit set"; also "socket set", "screwdriver set".
- No slashes: "drill driver", not "drill/driver".
- Reuse a type from "Types already in use" whenever the item is that kind of thing; make up a new type only for a different kind of item.

Reply with one line per title, like "3: area rug", and nothing else.`;

export class LabelError extends Error {}

/** {index: type} from lines like "3: area rug", for indexes 1..n. */
export function parseReply(reply: string, n: number): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of reply.split(/\r\n|\r|\n/)) {
    const m = /^\s*(\d+)\s*[:.)-]\s*(.+)/.exec(line);
    const i = Number(m?.[1]);
    const t = m?.[2] ? cleanType(m[2]) : '';
    if (i >= 1 && i <= n && t) {
      out.set(i, t);
    }
  }
  return out;
}

export class Labeller {
  private readonly url: string;
  private readonly waker = new Waker();

  constructor(
    private readonly store: Pick<Store, 'untypedItems' | 'commonTypes' | 'saveLotTypes'>,
    private readonly key: string,
    url = DEFAULT_URL,
    private readonly model = DEFAULT_MODEL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.url = `${url.replace(/\/+$/, '')}/chat/completions`;
  }

  wake(): void {
    this.waker.wake();
  }

  async runForever(): Promise<never> {
    for (;;) {
      try {
        await this.labelAll();
      } catch (e) {
        log.error('item type labelling crashed', e); // keep the loop alive no matter what
      }
      await this.waker.wait(RETRY_MS);
    }
  }

  /** Label items not covered by a saved identity or title fallback. */
  async labelAll(): Promise<void> {
    const byCategory = new Map<string | null, Lot[]>();
    const labels = new Map<string | null, string>();
    const seen = new Set<string>();
    for (const lot of await this.store.untypedItems()) {
      const identity = brandModelKey(lot);
      const key = identity ? `identity\n${identity}` : `title\n${lot.title}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const { value } = lot.category;
      byCategory.getOrInsertComputed(value, () => []).push(lot);
      labels.set(value, lot.category.label || 'Other');
    }
    const total = byCategory.values().sumBy(items => items.length);
    if (!total) {
      return;
    }
    log.info(`labelling item types for ${total} titles`);
    let done = 0;
    try {
      for (const [value, items] of byCategory) {
        items.sort((a, b) => byCode(a.title.toLowerCase(), b.title.toLowerCase()));
        for (let start = 0; start < items.length; start += BATCH) {
          const batch = items.slice(start, start + BATCH);
          const types = await this.ask(
            labels.get(value) ?? 'Other',
            batch.map(lot => lot.title),
            await this.store.commonTypes(value, VOCAB),
          );
          await this.store.saveLotTypes(
            types.entries().map(([i, t]): [Lot, string] => [batch[i - 1]!, t]),
          );
          done += types.size;
        }
      }
    } catch (e) {
      if (!(e instanceof LabelError)) {
        throw e;
      }
      log.warn(`item type labelling stopped after ${done} of ${total} titles: ${e.message}`);
      return;
    }
    log.info(`labelled ${done} of ${total} titles`);
  }

  /** {1-based index into titles: type} from the model. */
  async ask(category: string, titles: string[], vocab: string[]): Promise<Map<number, string>> {
    const user = [
      `Site category: ${category}`,
      `Types already in use: ${vocab.length ? vocab.join(', ') : '(none yet)'}`,
      '',
      'Titles:',
      ...titles.map((t, i) => `${i + 1}: ${t}`),
    ].join('\n');
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: user },
      ],
      temperature: 0,
      max_tokens: 16 * titles.length + 50,
    };
    return parseReply(await this.complete(body), titles.length);
  }

  private async complete(body: unknown): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new LabelError(String(e));
    }
    if (!res.ok) {
      throw new LabelError(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    let d: unknown;
    try {
      d = await res.json();
    } catch (e) {
      throw new LabelError(String(e));
    }
    const choices = prop(d, 'choices');
    const content = prop(prop(Array.isArray(choices) ? choices[0] : null, 'message'), 'content');
    if (content === null || typeof content === 'string') {
      return content ?? '';
    }
    throw new LabelError('unexpected reply shape');
  }
}
