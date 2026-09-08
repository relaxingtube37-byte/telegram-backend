import { randomBytes } from 'crypto';

/** Opaque correlation id for partner attribution (no PII). */
export function createClickId(): string {
  return `clk_${randomBytes(12).toString('hex')}`;
}
