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

1. Register an application at <https://www.miele.com/developer/>.
2. Note the `clientID` and `clientSecret`.
3. Follow Miele's OAuth pairing flow to obtain an initial access + refresh token pair for your Miele@home account.
4. Drop those into the plugin config — the plugin refreshes automatically from there.

## Status

Early. The reference plugin it replaces was unmaintained since 2022 and didn't run cleanly on Homebridge 2.x; this is a fresh take aiming to match scope (same device types, same REST/SSE surface) with a cleaner internal layout.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
