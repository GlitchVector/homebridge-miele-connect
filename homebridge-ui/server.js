"use strict";
const { HomebridgePluginUiServer } = require("@homebridge/plugin-ui-utils");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const STORAGE_FILE = "MieleConnect.Token.json";
const MIELE_AUTH = "https://api.mcs3.miele.com/thirdparty/login/";
const MIELE_TOKEN = "https://api.mcs3.miele.com/thirdparty/token";

/**
 * Non-routable redirect target. Miele will redirect the user's browser here
 * after consent; the page intentionally never loads (no listener), and the
 * user reads the `code` query parameter from the URL bar back into our UI.
 * What matters for the token exchange is that the redirect_uri value sent
 * here matches what was sent in the authorize step.
 */
const REDIRECT_URI = "http://localhost:8581/miele-callback";

class MieleConnectUi extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.onRequest("/start", async (payload) => {
      const { clientID, vg } = payload || {};
      if (!clientID) {
        throw new Error("clientID is required");
      }
      const state = crypto.randomUUID();
      const url = new URL(MIELE_AUTH);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", clientID);
      url.searchParams.set("redirect_uri", REDIRECT_URI);
      url.searchParams.set("state", state);
      url.searchParams.set("vg", vg || "CH-de");
      return { authorizeUrl: url.toString(), state, redirectUri: REDIRECT_URI };
    });

    this.onRequest("/exchange", async (payload) => {
      const { clientID, clientSecret, redirectUri, code } = payload || {};
      if (!clientID || !clientSecret || !redirectUri || !code) {
        throw new Error("clientID, clientSecret, redirectUri and code are all required");
      }

      const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientID,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      });
      const res = await fetch(MIELE_TOKEN, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Miele token exchange HTTP ${res.status}: ${detail || res.statusText}`);
      }
      const tokens = await res.json();
      if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error("Miele token response missing access_token or refresh_token");
      }

      const storageDir = this.homebridgeStoragePath;
      if (!storageDir) {
        throw new Error("Homebridge storage path not available from plugin UI runtime");
      }
      const storagePath = path.join(storageDir, STORAGE_FILE);
      const payloadOut = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        token_type: tokens.token_type,
        created_at: new Date().toISOString(),
      };
      await fs.mkdir(storageDir, { recursive: true });
      await fs.writeFile(storagePath, JSON.stringify(payloadOut, null, 2), { mode: 0o600 });

      // Don't return the tokens to the UI — they're persisted server-side.
      return { ok: true, expires_in: tokens.expires_in };
    });

    this.ready();
  }
}

new MieleConnectUi();
