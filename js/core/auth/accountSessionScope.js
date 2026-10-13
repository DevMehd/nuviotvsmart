import { ServerConfigurationStore } from "../../data/local/serverConfigurationStore.js";
import { snapshotAccountLocalData } from "./accountLocalDataReset.js";

export const ACCOUNT_BACKEND_KEY = "nuvioAccountBackendV1";
export const ACCOUNT_ARCHIVE_PREFIX = "nuvioAccountArchiveV1:";
const LEGACY_BACKEND_KEY = "nuvioSharedBackendV1";

function normalize(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
    .toLowerCase();
}

function tokenBackend(storage) {
  try {
    const token = storage?.getItem?.("access_token");
    const payload = String(token || "").split(".")[1];
    if (!payload || typeof atob !== "function") return "";
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const issuer = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")))?.iss;
    return normalize(String(issuer || "").replace(/\/auth\/v1\/?$/, ""));
  } catch (_) {
    return "";
  }
}

export function getPreviousAccountBackend(storage = globalThis.localStorage) {
  return (
    normalize(storage?.getItem?.(ACCOUNT_BACKEND_KEY)) ||
    normalize(storage?.getItem?.(LEGACY_BACKEND_KEY)) ||
    tokenBackend(storage)
  );
}

export function isSessionForActiveBackend(storage = globalThis.localStorage) {
  const active = normalize(ServerConfigurationStore.getActive().backendUrl);
  const previous = getPreviousAccountBackend(storage);
  const issuer = tokenBackend(storage);
  if (!previous && (storage?.getItem?.("access_token") || storage?.getItem?.("refresh_token"))) {
    return false;
  }
  return Boolean(active && (!previous || previous === active) && (!issuer || issuer === active));
}

export function bindSessionToActiveBackend(storage = globalThis.localStorage) {
  storage.setItem(ACCOUNT_BACKEND_KEY, normalize(ServerConfigurationStore.getActive().backendUrl));
}

export function archivePreviousAccountData(storage = globalThis.localStorage) {
  const backendUrl = getPreviousAccountBackend(storage) || "unknown";
  const key = `${ACCOUNT_ARCHIVE_PREFIX}${encodeURIComponent(backendUrl)}`;
  if (storage.getItem(key) !== null) return key;
  const backup = JSON.stringify({
    version: 1,
    backendUrl,
    savedAt: Date.now(),
    data: snapshotAccountLocalData(storage)
  });
  storage.setItem(key, backup);
  if (storage.getItem(key) !== backup) throw new Error("Unable to preserve previous account data");
  return key;
}

export function finishAccountBackendMigration(storage = globalThis.localStorage) {
  bindSessionToActiveBackend(storage);
  storage.removeItem(LEGACY_BACKEND_KEY);
  // A fresh official login is required after replacing the previous backend.
  storage.removeItem("skipAuthQrGate");
}
