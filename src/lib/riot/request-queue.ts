type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Sleep = (milliseconds: number) => Promise<void>;

/** Serial sliding-window request queue used by large Riot API crawls. */
export class RiotRequestQueue {
  private readonly timestamps: number[] = [];
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly limit = 100,
    private readonly windowMs = 120_000,
    private readonly sleep: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Request queue limit must be a positive integer.");
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error("Request queue window must be positive.");
  }

  async fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    let release = () => {};
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      while (true) {
        const current = this.now();
        while (this.timestamps.length && current - this.timestamps[0] >= this.windowMs) this.timestamps.shift();
        if (this.timestamps.length < this.limit) break;
        await this.sleep(Math.max(1, this.timestamps[0] + this.windowMs - current));
      }
      this.timestamps.push(this.now());
      return await this.fetchImpl(input, init);
    } finally { release(); }
  }
}
