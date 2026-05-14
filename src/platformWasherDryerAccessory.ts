import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";

import { PlatformAccessoryBase } from "./platformAccessoryBase.js";
import type { MielePlatform } from "./platform.js";
import {
  MieleProcessAction,
  MieleProgramState,
  type MieleDeviceState,
} from "./miele/types.js";

const MAX_REMAINING_SECONDS = 8 * 3600;

/**
 * Maps Miele washer / washer-dryer / dishwasher / dryer state onto a HomeKit
 * `Valve (Water Faucet)` service:
 *   - `Active`: ON when the program is Running or Pause; OFF in idle/done states.
 *     Writing ON → Miele Start, OFF → Miele Stop (subject to allowed-actions).
 *   - `InUse`: tracks `Running` only.
 *   - `RemainingDuration`: in seconds.
 *
 * Optionally also exposes a `TemperatureSensor` for the program's target temp
 * (washers) or live drum temp (dryers).
 */
export class WasherDryerAccessory extends PlatformAccessoryBase {
  private valve: Service;
  private tempService: Service | undefined;
  private firstStateLogged = false;

  constructor(
    platform: MielePlatform,
    accessory: PlatformAccessory,
    private readonly opts: { exposeTemperature: boolean },
  ) {
    super(platform, accessory);

    this.valve = this.useService(this.platform.Service.Valve, this.device.displayName);
    this.valve.setCharacteristic(this.platform.Characteristic.Name, this.device.displayName);
    this.valve.setCharacteristic(
      this.platform.Characteristic.ValveType,
      this.platform.Characteristic.ValveType.WATER_FAUCET,
    );

    this.valve
      .getCharacteristic(this.platform.Characteristic.Active)
      .onSet((v) => this.handleActiveSet(v));

    this.valve
      .getCharacteristic(this.platform.Characteristic.RemainingDuration)
      .setProps({ minValue: 0, maxValue: MAX_REMAINING_SECONDS, minStep: 1 });

    if (this.opts.exposeTemperature) {
      this.tempService = this.useService(
        this.platform.Service.TemperatureSensor,
        this.device.displayName,
      );
      this.tempService.setCharacteristic(this.platform.Characteristic.Name, this.device.displayName);
      this.tempService
        .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .setProps({ minValue: 0, maxValue: 110 });
    } else {
      const existing = this.accessory.getService(this.platform.Service.TemperatureSensor);
      if (existing) {
        this.accessory.removeService(existing);
      }
    }
  }

  applyState(state: MieleDeviceState): void {
    const programRaw = state.status?.value_raw ?? MieleProgramState.NotConnected;
    const isActive =
      programRaw === MieleProgramState.Running ||
      programRaw === MieleProgramState.Pause ||
      programRaw === MieleProgramState.ProgramSelected ||
      programRaw === MieleProgramState.ProgramProgrammed;
    const isRunning = programRaw === MieleProgramState.Running;

    this.valve.updateCharacteristic(
      this.platform.Characteristic.Active,
      isActive
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE,
    );
    this.valve.updateCharacteristic(
      this.platform.Characteristic.InUse,
      isRunning
        ? this.platform.Characteristic.InUse.IN_USE
        : this.platform.Characteristic.InUse.NOT_IN_USE,
    );

    const remaining = state.remainingTime
      ? state.remainingTime[0] * 3600 + state.remainingTime[1] * 60
      : 0;
    this.valve.updateCharacteristic(
      this.platform.Characteristic.RemainingDuration,
      Math.min(remaining, MAX_REMAINING_SECONDS),
    );

    if (this.tempService) {
      if (!this.firstStateLogged &&
        ((state.temperature?.length ?? 0) > 0 || (state.targetTemperature?.length ?? 0) > 0)) {
        this.platform.log.info(
          `${this.device.displayName} first temp payload: state=${programRaw} ` +
          `temperature=${JSON.stringify(state.temperature)} ` +
          `targetTemperature=${JSON.stringify(state.targetTemperature)}`,
        );
        this.firstStateLogged = true;
      }
      // Miele keeps reporting the last-selected program's target temp
      // even when the appliance is idle/done, which surfaces in HomeKit
      // as a permanently "warm" tile (e.g. 30°C forever). Only display
      // a temperature while a cycle is actually live; otherwise zero
      // out so the tile reads as "off". ProgramSelected/Programmed are
      // intentionally excluded — those are pre-start setpoints the
      // user already saw on the appliance and doesn't need duplicated
      // in HomeKit.
      const isLive =
        programRaw === MieleProgramState.Running ||
        programRaw === MieleProgramState.Pause;
      if (!isLive) {
        this.tempService.updateCharacteristic(
          this.platform.Characteristic.CurrentTemperature,
          0,
        );
      } else {
        const target = state.targetTemperature?.[0];
        const current = state.temperature?.[0];
        const entry =
          target && target.value_raw !== undefined && target.value_raw !== -32768
            ? target
            : current;
        if (entry && entry.value_raw !== undefined && entry.value_raw !== -32768) {
          // Prefer value_localized (appliance-displayed number); fall
          // back to /100 per the documented centi-degree spec.
          let celsius: number;
          if (
            typeof entry.value_localized === "number" &&
            Number.isFinite(entry.value_localized)
          ) {
            celsius = entry.unit === "Fahrenheit"
              ? (entry.value_localized - 32) * 5 / 9
              : entry.value_localized;
          } else {
            celsius = entry.value_raw / 100;
          }
          this.tempService.updateCharacteristic(
            this.platform.Characteristic.CurrentTemperature,
            Math.max(0, Math.min(110, celsius)),
          );
        }
      }
    }
  }

  private async handleActiveSet(value: CharacteristicValue): Promise<void> {
    const wantActive = value === this.platform.Characteristic.Active.ACTIVE;
    const action = wantActive ? MieleProcessAction.Start : MieleProcessAction.Stop;
    try {
      const allowed = await this.platform.api.getAllowedActions(this.device.serialNumber);
      if (!allowed.processAction?.includes(action)) {
        this.platform.log.info(
          `${this.device.displayName}: ignoring ${wantActive ? "Start" : "Stop"} — ` +
            `Miele reports allowed=${JSON.stringify(allowed.processAction)} in the current state.`,
        );
        return;
      }
      await this.platform.api.putAction(this.device.serialNumber, { processAction: action });
    } catch (err) {
      this.platform.log.error(
        `${this.device.displayName}: action ${wantActive ? "Start" : "Stop"} failed: ${String(err)}`,
      );
    }
  }
}
