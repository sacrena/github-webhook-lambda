/**
 * Derives the worker lifetime from the original persisted intake timestamp.
 * Provisioning, timeout delivery and schedule registration share this clock
 * so retries cannot extend resource lifetime or disagree about expiry.
 * Rounding upward to a whole second matches Scheduler's expression format
 * without dispatching a timeout before the resource's tagged deadline.
 *
 * @throws When the stored intake timestamp cannot be parsed.
 */
export function requestDeadline(receivedAt: string): string {
  const received = Date.parse(receivedAt);
  if (!Number.isFinite(received)) throw new Error("Invalid tracked request timestamp");
  return new Date(Math.ceil((received + 30 * 60 * 1000) / 1000) * 1000).toISOString();
}
