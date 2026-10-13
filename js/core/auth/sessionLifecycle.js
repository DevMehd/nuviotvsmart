const teardownHandlers = new Set();
const pendingSessionRequests = new Map();

export function registerSessionTeardownHandler(handler) {
  if (typeof handler !== "function") {
    return () => {};
  }
  teardownHandlers.add(handler);
  return () => teardownHandlers.delete(handler);
}

export async function notifySessionTeardownHandlers(options = {}) {
  const handlers = [...teardownHandlers];
  if (!handlers.length) {
    return true;
  }
  const results = await Promise.allSettled(
    handlers.map((handler) => Promise.resolve().then(() => handler(options)))
  );
  results.forEach((result) => {
    if (result.status === "rejected") {
      console.warn("Session lifecycle handler failed", result.reason);
    }
  });
  return results.every((result) => result.status === "fulfilled" && result.value !== false);
}

export function trackSessionRequest(request) {
  let cancel;
  const promise = new Promise((resolve, reject) => {
    cancel = () => {
      const error = new Error("Account session request cancelled");
      error.name = "AbortError";
      error.code = "SESSION_CANCELLED";
      reject(error);
    };
    Promise.resolve(request).then(resolve, reject);
  });
  pendingSessionRequests.set(promise, cancel);
  promise.then(
    () => pendingSessionRequests.delete(promise),
    () => pendingSessionRequests.delete(promise)
  );
  return promise;
}

export function cancelPendingSessionRequests() {
  // A rejected token can start sign-out from inside a tracked request. Reject
  // its callers before draining sync work, otherwise each waits on the other.
  // Logical cancellation also works on TVs without AbortController.
  pendingSessionRequests.forEach((cancel) => cancel());
}

export async function waitForPendingSessionRequests() {
  // A sync operation can issue its next page/request from the continuation of
  // the previous one. Drain until a full pass stays empty so a server switch
  // cannot leave a follow-up request from the old configuration behind.
  while (pendingSessionRequests.size) {
    const pending = [...pendingSessionRequests.keys()];
    await Promise.allSettled(pending);
    await Promise.resolve();
  }
  return true;
}
