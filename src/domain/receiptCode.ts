/**
 * The QR code printed on each receipt. Staff scan it before a machine runs for that order, so a
 * machine can only be started by someone holding the order's receipt. How many starts it allows
 * is not stored in the code: it is the order's washer and dryer allowance (one each per load).
 *
 * The code is "LPOS1:<order id>:<token>", where the token is random per order so a code cannot
 * be made up from the order number alone.
 */
export const RECEIPT_CODE_PREFIX = 'LPOS1';

/**
 * TEMPORARY, until the receipt printer arrives: this one code is accepted for every open order.
 * Anyone holding it can start machines for any order, so delete it (and its uses) before the
 * shop relies on receipt codes.
 */
export const TEST_RECEIPT_CODE = 'LPOS1:TEST';

const TOKEN_BYTES = 16;
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export function newReceiptToken(randomBytes: (length: number) => Uint8Array): string {
  return Array.from(randomBytes(TOKEN_BYTES), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function receiptCodeFor(orderId: string, token: string): string {
  return `${RECEIPT_CODE_PREFIX}:${orderId}:${token}`;
}

export type ScannedCode = { kind: 'test' } | { kind: 'order'; orderId: string; token: string } | { kind: 'invalid' };

export function parseReceiptCode(scanned: string): ScannedCode {
  const text = scanned.trim();
  if (text === TEST_RECEIPT_CODE) return { kind: 'test' };
  const [prefix, orderId, token, ...rest] = text.split(':');
  if (prefix !== RECEIPT_CODE_PREFIX || !orderId || !token || rest.length > 0 || !TOKEN_PATTERN.test(token)) {
    return { kind: 'invalid' };
  }
  return { kind: 'order', orderId, token };
}

/** Compares without stopping at the first different character. */
export function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length || !TOKEN_PATTERN.test(a)) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
