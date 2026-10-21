import { TRAKT_CLIENT_ID, TRAKT_CLIENT_SECRET } from "../../config.js";
// Trakt authenticates the Nuvio application with the configuration supplied by
// the build, as upstream does. Old per-profile overrides must not shadow it.
// Keep the read accessor for callers; leave legacy storage and tokens untouched.
export const TraktClientSettingsStore = {
  get() {
    return { clientId: TRAKT_CLIENT_ID, clientSecret: TRAKT_CLIENT_SECRET };
  }
};

export function getTraktClientCredentials() {
  return TraktClientSettingsStore.get();
}
