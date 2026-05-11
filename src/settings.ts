/**
 * Platform / plugin identifiers. PLATFORM_NAME goes into config.json under the
 * `platforms[].platform` key; PLUGIN_NAME matches package.json.
 */
export const PLATFORM_NAME = "MieleConnect";
export const PLUGIN_NAME = "homebridge-miele-connect";

/** Miele 3rd-party REST + SSE API base. */
export const MIELE_API_BASE = "https://api.mcs3.miele.com";

/** Resource paths (relative to MIELE_API_BASE). */
export const PATH_DEVICES = "/v1/devices";
export const PATH_TOKEN = "/thirdparty/token";
/**
 * All-devices SSE event stream. The legacy plugin opened one stream per
 * device; the umbrella endpoint multiplexes every appliance through a single
 * connection, which keeps Miele's per-app concurrent-connection limit safe
 * even with many devices.
 */
export const PATH_EVENTS_ALL = "/v1/devices/all/events";

/** Persistent storage filename (joined with `api.user.persistPath()`). */
export const TOKEN_STORAGE_FILE = `${PLATFORM_NAME}.Token.json`;

/** Token-refresh poll. Miele tokens last 30 days; checking every 30 min is plenty. */
export const TOKEN_REFRESH_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** Backoff after a transient SSE error. */
export const EVENT_STREAM_RECONNECT_DELAY_MS = 60 * 1000;

/** Self-initiated periodic reconnect (some load balancers idle out long streams). */
export const EVENT_STREAM_PERIODIC_RECONNECT_DEFAULT_MIN = 60;

/** HTTP request timeout for REST calls. */
export const REST_TIMEOUT_MS = 15_000;
