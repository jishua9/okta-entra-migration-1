type Ctx = Record<string, unknown>;

export function logEvent(event: string, ctx: Ctx = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...ctx }));
}
