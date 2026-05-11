import EventSource from "eventsource";
import type { Logger } from "homebridge";

import {
  EVENT_STREAM_RECONNECT_DELAY_MS,
  EVENT_STREAM_PERIODIC_RECONNECT_DEFAULT_MIN,
} from "../settings.js";
import type { MieleApi } from "./api.js";
import type { MieleToken } from "./token.js";
import type { MieleDeviceState } from "./types.js";

/** A single device state update parsed off the all-devices SSE stream. */
export interface MieleDeviceEvent {
  serialNumber: string;
  state: MieleDeviceState;
}

export type MieleEventListener = (e: MieleDeviceEvent) => void;

interface EventStreamOpts {
  api: MieleApi;
  token: MieleToken;
  log: Logger;
  /** Multiplexed all-devices SSE path. */
  streamPath: string;
  /**
   * Self-initiated reconnect interval in minutes. Miele's upstream load
   * balancer silently drops long-lived streams; cycling proactively keeps
   * state fresh.
   */
  periodicReconnectMin?: number;
}

/**
 * MieleEventStream — single SSE connection multiplexing all device state
 * updates. The Miele payload arrives as a `devices` event whose JSON body is
 * a map of `{<serial>: {<state-fields>}}`; we fan-out one listener-call per
 * (serial, state) pair so each accessory can subscribe independently of how
 * many devices the account owns.
 */
export class MieleEventStream {
  private es: EventSource | null = null;
  private listeners = new Set<MieleEventListener>();
  private periodicTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly opts: EventStreamOpts) {}

  on(listener: MieleEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    this.closed = false;
    this.openConnection("initial");

    const everyMin =
      this.opts.periodicReconnectMin && this.opts.periodicReconnectMin > 0
        ? this.opts.periodicReconnectMin
        : EVENT_STREAM_PERIODIC_RECONNECT_DEFAULT_MIN;
    this.periodicTimer = setInterval(
      () => this.openConnection("periodic"),
      everyMin * 60 * 1000,
    );
  }

  stop(): void {
    this.closed = true;
    this.es?.close();
    this.es = null;
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private openConnection(reason: "initial" | "periodic" | "recover"): void {
    if (this.closed) return;
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    const auth = this.opts.token.getAuthorizationHeader();
    if (!auth) {
      this.opts.log.warn(
        "Miele event stream: no auth token available — deferring reconnect.",
      );
      this.scheduleReconnect();
      return;
    }
    const url = this.opts.api.buildEventsUrl(this.opts.streamPath);
    this.opts.log.debug(
      `Miele event stream: opening (${reason}) → ${url}`,
    );

    // `eventsource@2` accepts an init bag with headers; the @types still
    // describes the older single-string signature, so cast through unknown.
    const init = {
      headers: { Authorization: auth, Accept: "text/event-stream" },
    } as unknown as EventSourceInit;
    this.es = new EventSource(url, init);

    this.es.addEventListener("devices", (raw) => {
      const ev = raw as MessageEvent;
      try {
        const payload = JSON.parse(ev.data) as Record<string, MieleDeviceState>;
        for (const [serialNumber, state] of Object.entries(payload)) {
          for (const listener of this.listeners) {
            try {
              listener({ serialNumber, state });
            } catch (e) {
              this.opts.log.error(
                `Miele event listener threw on ${serialNumber}: ${String(e)}`,
              );
            }
          }
        }
      } catch (e) {
        this.opts.log.error(
          `Miele event stream: malformed payload: ${String(e)}`,
        );
      }
    });

    // Miele sends `actions` events when allowed-actions change. Plugin doesn't
    // currently react to these (we re-fetch lazily on user input) but we log
    // them at debug so they're visible during development.
    this.es.addEventListener("actions", (raw) => {
      this.opts.log.debug(`Miele actions event: ${(raw as MessageEvent).data}`);
    });

    this.es.addEventListener("ping", () => {
      /* keep-alive — nothing to do */
    });

    this.es.onopen = () => {
      this.opts.log.info(`Miele event stream: connected (${reason}).`);
    };

    this.es.onerror = (err) => {
      // EventSource raises an empty error object when Miele closes the
      // connection on their end (no fault); only treat objects carrying a
      // numeric `status` as a real error.
      const status = (err as unknown as { status?: number }).status;
      if (status) {
        this.opts.log.error(
          `Miele event stream: server error status=${status}; reconnecting.`,
        );
      } else {
        this.opts.log.debug(
          "Miele event stream: upstream closed the connection; reconnecting.",
        );
      }
      this.es?.close();
      this.es = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openConnection("recover");
    }, EVENT_STREAM_RECONNECT_DELAY_MS);
  }
}
