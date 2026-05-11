import { promises as fs } from "node:fs";
import * as path from "node:path";
import { URLSearchParams } from "node:url";
import type { Logger } from "homebridge";

import {
  MIELE_API_BASE,
  PATH_TOKEN,
  TOKEN_REFRESH_CHECK_INTERVAL_MS,
  TOKEN_STORAGE_FILE,
} from "../settings.js";
import type { MielePersistedToken, MieleTokenResponse } from "./types.js";

export interface MieleTokenOptions {
  clientID: string;
  clientSecret: string;
  /** Storage directory (typically `api.user.persistPath()`). */
  storageDir: string;
  log: Logger;
  /**
   * Fallback token from config.json. Only used if the persisted file is
   * missing or invalid — the persisted store is otherwise authoritative.
   */
  fallback?: { accessToken?: string; refreshToken?: string };
}

/**
 * MieleToken — minimal OAuth refresh-token state machine.
 *
 * Miele issues 30-day access tokens (plus a refresh token) via a separate
 * pairing flow; this plugin assumes the user already has a token pair from
 * Miele's developer portal and just keeps it fresh. We poll every 30 min and
 * refresh proactively when the access token is within one poll-window of
 * expiry.
 *
 * State persists to `<storageDir>/MieleConnect.Token.json` so a refresh
 * survives Homebridge restarts.
 */
export class MieleToken {
  private state: MielePersistedToken | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: MieleTokenOptions) {}

  /** Filename for the persisted token blob. */
  private get storagePath(): string {
    return path.join(this.opts.storageDir, TOKEN_STORAGE_FILE);
  }

  /** Load from disk, fall back to config-supplied seed if disk is empty. */
  async init(): Promise<void> {
    try {
      const raw = await fs.readFile(this.storagePath, "utf8");
      const parsed = JSON.parse(raw) as MielePersistedToken;
      if (parsed?.access_token && parsed?.refresh_token) {
        this.state = parsed;
        this.opts.log.info("Loaded Miele OAuth token from persistent storage.");
      } else {
        throw new Error("persisted token blob missing required fields");
      }
    } catch {
      const seed = this.opts.fallback;
      if (seed?.accessToken && seed?.refreshToken) {
        this.opts.log.warn(
          "No persisted Miele token found; seeding from plugin config. " +
            "Will refresh aggressively in case the config value is stale.",
        );
        this.state = {
          access_token: seed.accessToken,
          refresh_token: seed.refreshToken,
          // Force quick refresh — we can't know the real remaining life.
          expires_in: 60,
          created_at: new Date().toISOString(),
        };
        await this.persist();
      } else {
        this.opts.log.error(
          "No Miele token available — neither persisted nor in config. " +
            "Pair the plugin via the Miele developer portal and set " +
            "`accessToken` + `refreshToken` in config.json.",
        );
      }
    }

    // Schedule recurring refresh checks.
    this.timer = setInterval(() => {
      void this.maybeRefresh();
    }, TOKEN_REFRESH_CHECK_INTERVAL_MS);
  }

  /** Stop the refresh timer (call from platform shutdown if you wire that up). */
  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Bearer-format header value, or null when no token is loaded. */
  getAuthorizationHeader(): string | null {
    return this.state ? `Bearer ${this.state.access_token}` : null;
  }

  /** True if the persisted access token is within one refresh window of expiry. */
  isNearlyExpired(): boolean {
    if (!this.state) return true;
    const created = Date.parse(this.state.created_at);
    if (Number.isNaN(created)) return true;
    const expiresAt = created + this.state.expires_in * 1000;
    const refreshDeadline = Date.now() + TOKEN_REFRESH_CHECK_INTERVAL_MS;
    return refreshDeadline >= expiresAt;
  }

  /** Force a refresh now; safe to call manually after a 401. */
  async refreshNow(): Promise<void> {
    if (!this.state) {
      this.opts.log.error("Cannot refresh Miele token: no state loaded.");
      return;
    }
    const body = new URLSearchParams({
      client_id: this.opts.clientID,
      client_secret: this.opts.clientSecret,
      refresh_token: this.state.refresh_token,
      grant_type: "refresh_token",
    });

    let res: Response;
    try {
      res = await fetch(MIELE_API_BASE + PATH_TOKEN, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json;charset=utf-8",
        },
        body,
      });
    } catch (err) {
      this.opts.log.error(`Miele token refresh: network error: ${String(err)}`);
      return;
    }

    if (!res.ok) {
      this.opts.log.error(
        `Miele token refresh failed: HTTP ${res.status} ${res.statusText}`,
      );
      return;
    }

    const data = (await res.json()) as MieleTokenResponse;
    this.state = {
      ...data,
      created_at: new Date().toISOString(),
    };
    await this.persist();
    this.opts.log.info("Miele OAuth token refreshed and persisted.");
  }

  private async maybeRefresh(): Promise<void> {
    if (this.isNearlyExpired()) {
      await this.refreshNow();
    }
  }

  private async persist(): Promise<void> {
    if (!this.state) return;
    try {
      await fs.mkdir(this.opts.storageDir, { recursive: true });
      await fs.writeFile(this.storagePath, JSON.stringify(this.state, null, 2), {
        mode: 0o600,
      });
    } catch (err) {
      this.opts.log.error(`Failed to persist Miele token: ${String(err)}`);
    }
  }
}
