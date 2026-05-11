import type { Logger } from "homebridge";

import { MIELE_API_BASE, PATH_DEVICES, REST_TIMEOUT_MS } from "../settings.js";
import type { MieleToken } from "./token.js";
import type {
  MieleActionBody,
  MieleAllowedActions,
  MieleDevicesResponse,
} from "./types.js";

export class MieleApi {
  constructor(
    private readonly token: MieleToken,
    private readonly log: Logger,
    /** Optional Miele Accept-Language header to localise enum strings. */
    private readonly language: string = "",
  ) {}

  /** GET /v1/devices — full device list. */
  async listDevices(): Promise<MieleDevicesResponse> {
    const url =
      MIELE_API_BASE +
      PATH_DEVICES +
      (this.language ? `?language=${encodeURIComponent(this.language)}` : "");
    return await this.json<MieleDevicesResponse>("GET", url);
  }

  /** GET /v1/devices/<id>/actions — what's allowed right now. */
  async getAllowedActions(serialNumber: string): Promise<MieleAllowedActions> {
    const url = `${MIELE_API_BASE}${PATH_DEVICES}/${encodeURIComponent(serialNumber)}/actions`;
    return await this.json<MieleAllowedActions>("GET", url);
  }

  /** PUT /v1/devices/<id>/actions — fire an action. Returns nothing useful on success. */
  async putAction(serialNumber: string, body: MieleActionBody): Promise<void> {
    const url = `${MIELE_API_BASE}${PATH_DEVICES}/${encodeURIComponent(serialNumber)}/actions`;
    await this.json("PUT", url, body);
  }

  /** Build an absolute SSE URL the EventSource constructor can hit. */
  buildEventsUrl(path: string): string {
    return MIELE_API_BASE + path;
  }

  /**
   * One-shot fetch wrapper that:
   *  - injects the OAuth bearer header
   *  - times out at REST_TIMEOUT_MS
   *  - refreshes the token + retries once on 401
   *  - parses JSON when the response carries any
   */
  private async json<T>(
    method: "GET" | "PUT" | "POST" | "DELETE",
    url: string,
    body?: unknown,
    attempt = 0,
  ): Promise<T> {
    const auth = this.token.getAuthorizationHeader();
    if (!auth) {
      throw new Error("Miele API: no auth token available");
    }

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(`Miele API ${method} ${url}: ${String(err)}`);
    } finally {
      clearTimeout(t);
    }

    // Token expired mid-flight: refresh and retry once.
    if (res.status === 401 && attempt === 0) {
      this.log.info(`Miele API 401 on ${method} ${url} — refreshing token and retrying.`);
      await this.token.refreshNow();
      return await this.json<T>(method, url, body, attempt + 1);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Miele API ${method} ${url} → HTTP ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`,
      );
    }

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      // Endpoints like PUT actions return 204 No Content.
      return undefined as unknown as T;
    }
    return (await res.json()) as T;
  }
}
