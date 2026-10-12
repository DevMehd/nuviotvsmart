import { httpRequest } from "../../../core/network/httpClient.js";
import { requestAddonData } from "../../../core/network/vidaaAddonTransport.js";

export const MetaApi = {
  async getMeta(url, options = {}) {
    return requestAddonData(url, "meta", options, (directOptions) =>
      httpRequest(url, {
        ...directOptions,
        includeSessionAuth: false
      })
    );
  }
};
