#!/usr/bin/env node
/**
 * Miele OAuth bootstrap helper.
 *
 * Runs the one-time authorization-code exchange to produce the initial
 * access_token + refresh_token pair the plugin needs in its config.json.
 *
 * Run this LOCALLY on your own machine (not through any AI shell session — the
 * tokens this prints are secrets and chat transcripts persist).
 *
 *   node scripts/miele-oauth-bootstrap.mjs \
 *     --client-id   <YOUR_CLIENT_ID> \
 *     --client-secret <YOUR_CLIENT_SECRET> \
 *     [--vg CH-de]                # country-language pair, default CH-de
 *     [--port 8765]                # local loopback port for the redirect
 *
 * Flow:
 *   1. Boots a localhost HTTP listener on --port.
 *   2. Prints the Miele authorize URL — open it in a browser.
 *   3. Log in with your Miele@home account, approve the scopes.
 *   4. Browser redirects to http://localhost:<port>/callback?code=...
 *   5. Script captures the code, exchanges it for tokens, prints them.
 *
 * Once the plugin is configured with the printed tokens it persists state
 * to <homebridge>/MieleConnect.Token.json and you can clear the seeds from
 * config.json.
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const args = (() => {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    out[a.slice(2)] = argv[i + 1];
    i++;
  }
  return out;
})();

const clientID = args["client-id"] ?? process.env.MIELE_CLIENT_ID;
const clientSecret = args["client-secret"] ?? process.env.MIELE_CLIENT_SECRET;
const vg = args.vg ?? "CH-de";
const port = Number(args.port ?? 8765);

if (!clientID || !clientSecret) {
  console.error(
    "usage: node scripts/miele-oauth-bootstrap.mjs " +
      "--client-id <X> --client-secret <Y> [--vg CH-de] [--port 8765]\n" +
      "       (or set MIELE_CLIENT_ID + MIELE_CLIENT_SECRET in the env)",
  );
  process.exit(2);
}

const state = randomUUID();
const redirectUri = `http://localhost:${port}/callback`;

const authorizeUrl =
  "https://api.mcs3.miele.com/thirdparty/login/" +
  "?response_type=code" +
  "&client_id=" + encodeURIComponent(clientID) +
  "&redirect_uri=" + encodeURIComponent(redirectUri) +
  "&state=" + encodeURIComponent(state) +
  "&vg=" + encodeURIComponent(vg);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", redirectUri);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end("not found");
    return;
  }

  const gotState = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  if (gotState !== state) {
    res.writeHead(400).end("state mismatch — possible CSRF, aborting");
    console.error(`state mismatch: got "${gotState}", expected "${state}"`);
    process.exit(1);
  }
  if (!code) {
    res.writeHead(400).end("no code in callback");
    console.error("no code in callback URL");
    process.exit(1);
  }

  try {
    const tokenRes = await fetch("https://api.mcs3.miele.com/thirdparty/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientID,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const detail = await tokenRes.text().catch(() => "");
      res.writeHead(500).end(`token exchange failed: ${tokenRes.status}\n${detail}`);
      console.error(`token exchange HTTP ${tokenRes.status}: ${detail}`);
      process.exit(1);
    }

    const tokens = await tokenRes.json();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
      "<html><body style='font-family:sans-serif'>" +
        "<h1>Miele OAuth: done.</h1>" +
        "<p>Return to your terminal &mdash; the tokens are printed there. " +
        "Close this tab.</p></body></html>",
    );

    console.log("\n--- Paste into Homebridge config.json under the platform block ---\n");
    console.log(
      JSON.stringify(
        {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
        },
        null,
        2,
      ),
    );
    console.log(`\n(expires_in: ${tokens.expires_in} seconds — the plugin auto-refreshes)\n`);

    server.close();
    // Give the response a beat to flush, then exit cleanly.
    setTimeout(() => process.exit(0), 250);
  } catch (err) {
    res.writeHead(500).end(String(err));
    console.error("token exchange failed:", err);
    process.exit(1);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Listening on ${redirectUri}`);
  console.log("\nOpen this URL in your browser:\n");
  console.log(authorizeUrl);
  console.log(
    "\nAfter you approve, the browser will redirect back here and the tokens will print below.\n",
  );
});
