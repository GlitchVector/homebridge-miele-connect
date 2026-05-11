import type { API } from "homebridge";

import { MielePlatform } from "./platform.js";
import { PLATFORM_NAME } from "./settings.js";

/**
 * Homebridge entry point — registers the Miele Connect platform.
 */
export default (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, MielePlatform);
};
