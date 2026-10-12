import { httpRequest } from "../../../core/network/httpClient.js";
import { requestAddonData } from "../../../core/network/vidaaAddonTransport.js";

export const CatalogApi = {
  async getCatalog(url, options = {}) {
    return requestAddonData(url, "catalog", options, (directOptions) =>
      httpRequest(url, {
        ...directOptions,
        includeSessionAuth: false
      })
    );
  }
};
