/** Stable, dependency-free id generation. */
let counter = 0;

export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 100000;
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${counter.toString(36)}${rand}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}
