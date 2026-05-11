# homebridge-miele-connect

Homebridge platform plugin for [Miele@home](https://www.miele.com/) appliances. Talks to Miele's 3rd-party cloud API (REST + Server-Sent Events) and exposes the following device classes to HomeKit:

| Miele device type      | HomeKit service(s)                                    |
| ---------------------- | ----------------------------------------------------- |
| Washer / Washer-Dryer / Dishwasher | `Valve` (water-faucet) + `TemperatureSensor` |
| Dryer                  | `Valve` (water-faucet)                                |
| Fridge / Freezer / Fridge-Freezer | `TemperatureSensor` per zone + `Switch` (Super-mode) |
| Hood                   | `Fanv2` (Active + RotationSpeed) + `Lightbulb`        |
| Coffee System          | `Switch` (power)                                      |

> This is a clean-room re-implementation of [`homebridge-mieleathome`](https://github.com/QuickSander/homebridge-mieleathome) (Apache-2.0), modernised for Homebridge 2.0:
>
> - ES modules, Node 18+, TypeScript strict mode
> - Built-in `fetch` (no axios / request)
> - Single multiplexed SSE connection (`/v1/devices/all/events`) instead of one stream per device
> - Token persistence via Homebridge's `api.user.persistPath()` (no `node-persist` dependency)
> - DynamicPlatformPlugin pattern with cached-accessory restore and stale-accessory pruning

## Configuration

```json
{
  "platform": "MieleConnect",
  "name": "Miele Connect",
  "clientID": "<from miele developer portal>",
  "clientSecret": "<from miele developer portal>",
  "accessToken": "<initial seed; only used until persisted store is populated>",
  "refreshToken": "<initial seed; only used until persisted store is populated>",
  "language": "en",
  "reconnectEventStreamMinutes": 60
}
```

After the first successful refresh the token pair lives in `<homebridge-config-dir>/MieleConnect.Token.json` and the `accessToken` / `refreshToken` fields in config can be removed.

## Getting Miele credentials

### 1. Get `clientID` + `clientSecret`

Register at <https://developer.miele.com/> ("Get Involved" section). Activate via the email link, then copy the `clientID` and `clientSecret` from the portal.

### 2. Pair via Homebridge UI (recommended)

The plugin ships a custom Homebridge UI that handles the OAuth code exchange. In Homebridge Config UI X:

1. Open the **Miele Connect** plugin settings.
2. Fill in `clientID` and `clientSecret` in the form.
3. In the **Miele OAuth pairing** card above the form, set `vg` (default `CH-de`) and click **Start pairing**.
4. Click the **Open Miele authorize page** link, log in with your Miele@home account, approve the requested scope.
5. The browser will fail to load `http://localhost:8581/miele-callback?code=…` — that's expected. Copy the `code` query parameter from the URL bar.
6. Paste it into the **Authorization code** field and click **Complete pairing**.

The access/refresh token pair is persisted to `<homebridge-config-dir>/MieleConnect.Token.json` (mode 0600) and refreshed automatically. The tokens never appear in `config.json`.

### 2-alt. Pair via CLI (headless setups)

If you don't have access to the Homebridge UI, the same exchange is available as a one-shot Node helper:

```sh
npm run bootstrap-oauth -- \
  --client-id     <YOUR_CLIENT_ID> \
  --client-secret <YOUR_CLIENT_SECRET>
  # add --vg DE-de / US-en / ... if you're outside CH-de
```

It opens a localhost listener, prints the authorize URL, captures the redirect, exchanges the code, and prints the tokens for you to paste into the `accessToken` / `refreshToken` config fields.

## Status

Early. The reference plugin it replaces was unmaintained since 2022 and didn't run cleanly on Homebridge 2.x; this is a fresh take aiming to match scope (same device types, same REST/SSE surface) with a cleaner internal layout.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
