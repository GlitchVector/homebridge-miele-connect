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

1. Register an application at <https://developer.miele.com/> ("Get Involved" section). Once activated, the portal gives you a `clientID` and `clientSecret`.
2. Run the one-time OAuth bootstrap helper locally to convert those into the initial access/refresh token pair:

   ```sh
   npm run bootstrap-oauth -- \
     --client-id     <YOUR_CLIENT_ID> \
     --client-secret <YOUR_CLIENT_SECRET>
     # add --vg CH-de / DE-de / US-en / ... if you're outside CH-de
   ```

   The script spins a localhost listener, prints the Miele authorize URL, captures the redirect after you log in with your Miele@home account, exchanges the code, and prints the tokens.

3. Paste the four values into Homebridge config.json. After the first successful refresh the plugin migrates the seeds into `<homebridge-config-dir>/MieleConnect.Token.json` and the `accessToken` / `refreshToken` fields can be removed.

## Status

Early. The reference plugin it replaces was unmaintained since 2022 and didn't run cleanly on Homebridge 2.x; this is a fresh take aiming to match scope (same device types, same REST/SSE surface) with a cleaner internal layout.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
