/**
 * 球员认领码：6 位，去掉易混淆字符（I / O / 0 / 1），便于口头转告或手抄。
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateClaimCode(): string {
  const c = globalThis.crypto;
  const bytes = new Uint8Array(6);

  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/** 归一化用户输入的认领码：去空格、转大写。 */
export function normalizeClaimCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** 展示用：ABC123 → ABC-123 */
export function formatClaimCode(code: string): string {
  if (code.length !== 6) return code;
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}
