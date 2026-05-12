import { HomebridgePluginUiServer } from "@homebridge/plugin-ui-utils";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const STORAGE_FILE = "MieleConnect.Token.json";
const MIELE_AUTH = "https://api.mcs3.miele.com/thirdparty/login/";
const MIELE_TOKEN = "https://api.mcs3.miele.com/thirdparty/token";

/**
 * Non-routable redirect target. Miele redirects the user's browser here after
 * consent; the page intentionally never loads (no listener) and the user
 * reads the `code` query parameter off the URL bar. What matters for the
 * token exchange is that the `redirect_uri` sent in step 2 matches the one
 * sent in step 1.
 */
const REDIRECT_URI = "http://localhost:8581/miele-callback";

class MieleConnectUi extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.onRequest("/start", async (payload) => {
      const { clientID, vg } = payload || {};
      if (!clientID) throw new Error("clientID is required");
      const state = randomUUID();
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

      // Auth codes copied from the redirect URL bar are URL-encoded. Decode
      // once — URLSearchParams below will encode again on the way out, so
      // without this we'd send `%2B` as `%252B` and Miele would reject the
      // code as `invalid_client`.
      let decodedCode = code;
      try { decodedCode = decodeURIComponent(code); } catch { /* leave as-is */ }

      const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientID,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code: decodedCode,
      });

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 15_000);
      let res;
      try {
        res = await fetch(MIELE_TOKEN, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body,
          signal: controller.signal,
        });
      } catch (err) {
        throw new Error(`Miele token exchange network error: ${String(err)}`);
      } finally {
        clearTimeout(t);
      }
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
      const storagePath = join(storageDir, STORAGE_FILE);
      const out = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        token_type: tokens.token_type,
        created_at: new Date().toISOString(),
      };
      await mkdir(storageDir, { recursive: true });
      await writeFile(storagePath, JSON.stringify(out, null, 2), { mode: 0o600 });

      // Don't return the tokens to the UI — they're persisted server-side.
      return { ok: true, expires_in: tokens.expires_in };
    });

    this.ready();
  }
}

new MieleConnectUi();
