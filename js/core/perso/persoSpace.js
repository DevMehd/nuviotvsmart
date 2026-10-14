// Personal space shared with the Android app (Docs/parite-plateformes.fr.md, "Espace perso").
// Same storage key, alphabet and hash as Android so codes and channels match byte for byte.
import { LocalStore } from "../storage/localStore.js";

const KEY = "nuvio.perso.perso_space";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PERSO_CODE_LENGTH = 12;
export const DEFAULT_SYNC_SERVER = "https://ntfy.sh";

function randomIndex(max) {
  const cryptoApi = typeof window !== "undefined" ? window.crypto || window.msCrypto : null;
  if (cryptoApi?.getRandomValues) {
    const values = new Uint32Array(1);
    cryptoApi.getRandomValues(values);
    return values[0] % max;
  }
  return Math.floor(Math.random() * max);
}

export function randomPersoCode(length = PERSO_CODE_LENGTH) {
  let code = "";
  for (let i = 0; i < length; i += 1) code += ALPHABET[randomIndex(ALPHABET.length)];
  return code;
}

// FNV-1a 64-bit over UTF-8 bytes, computed on two 32-bit halves (no BigInt on older TVs).
export function fnv1a64Hex(value) {
  const bytes = unescape(encodeURIComponent(String(value)));
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  for (let i = 0; i < bytes.length; i += 1) {
    lo = (lo ^ bytes.charCodeAt(i)) >>> 0;
    // (hi, lo) * 0x100000001b3 mod 2^64 = lo*0x1b3 + ((hi*0x1b3 + (lo << 8)) << 32)
    const product = lo * 0x1b3; // < 2^41, exact in a double
    const newLo = product % 4294967296;
    const carry = Math.floor(product / 4294967296);
    const newHi = (Math.imul(hi, 0x1b3) + Math.imul(lo, 0x100) + carry) >>> 0;
    hi = newHi;
    lo = newLo;
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

export const PersoSpace = {
  get() {
    const stored = LocalStore.get(KEY, null) || {};
    return {
      spaceCode: String(stored.spaceCode || ""),
      deviceId: String(stored.deviceId || ""),
      deviceName: String(stored.deviceName || ""),
      receiveHandoff: stored.receiveHandoff !== false,
      remoteControl: stored.remoteControl !== false,
      server: String(stored.server || DEFAULT_SYNC_SERVER)
    };
  },
  set(patch) {
    const next = { ...this.get(), ...patch };
    next.spaceCode = String(next.spaceCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!next.deviceId) next.deviceId = randomPersoCode(16).toLowerCase();
    LocalStore.set(KEY, next);
    return next;
  },
  ensureCode() {
    const current = this.get();
    if (current.spaceCode) return current.spaceCode;
    return this.set({ spaceCode: randomPersoCode() }).spaceCode;
  },
  handoffTopic(code = this.get().spaceCode) {
    return `nuvio-handoff-v1-${fnv1a64Hex(String(code).toUpperCase())}`;
  },
  remoteTopic(code = this.get().spaceCode) {
    return `nuvio-remote-v1-${fnv1a64Hex(String(code).toUpperCase())}`;
  }
};
