import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";

import { PlatformAccessoryBase } from "./platformAccessoryBase.js";
import type { MielePlatform } from "./platform.js";
import {
  MieleDeviceType,
  MieleProcessAction,
  type MieleDeviceState,
} from "./miele/types.js";

/**
 * Fridge / Freezer / FridgeFreezer. Exposes:
 *   - one TemperatureSensor per reported temperature zone
 *   - a `Super Mode` switch wired to StartSuper{Cooling,Freezing} /
 *     StopSuper{Cooling,Freezing} (selected by the device type)
 *
 * Target-temperature writes are intentionally NOT bound to a HomeKit
 * thermostat: HomeKit's thermostat model wants a heating/cooling threshold
 * setpoint that doesn't map cleanly onto fridge zones, and the legacy plugin
 * already learned this the hard way.
 */
export class FridgeAccessory extends PlatformAccessoryBase {
  private readonly tempServices: Service[] = [];
  private superSwitch: Service;
  private readonly isFreezerSide: boolean;

  constructor(platform: MielePlatform, accessory: PlatformAccessory) {
    super(platform, accessory);

    this.isFreezerSide =
      this.device.rawType === MieleDeviceType.Freezer ||
      this.device.rawType === MieleDeviceType.FridgeFreezer;

    // One TemperatureSensor service per zone, subtyped by index so cached
    // services restore correctly across restarts.
    for (let i = 0; i < 2; i++) {
      const subtype = `zone-${i}`;
      const name =
        i === 0
          ? this.device.displayName
          : `${this.device.displayName} Freezer`;
      const svc = this.useService(
        this.platform.Service.TemperatureSensor,
        name,
        subtype,
      );
      svc.setCharacteristic(this.platform.Characteristic.Name, name);
      svc
        .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .setProps({ minValue: -40, maxValue: 40, minStep: 0.1 });
      this.tempServices.push(svc);
    }

    this.superSwitch = this.useService(
      this.platform.Service.Switch,
      `${this.device.displayName} Super ${this.isFreezerSide ? "Freezing" : "Cooling"}`,
      "super-mode",
    );
    this.superSwitch.setCharacteristic(
      this.platform.Characteristic.Name,
      `${this.device.displayName} Super ${this.isFreezerSide ? "Freezing" : "Cooling"}`,
    );
    this.superSwitch
      .getCharacteristic(this.platform.Characteristic.On)
      .onSet((v) => this.handleSuperSet(v));
  }

  applyState(state: MieleDeviceState): void {
    const temps = state.temperature ?? [];
    temps.forEach((entry, i) => {
      const svc = this.tempServices[i];
      if (!svc || entry.value_raw === undefined || entry.value_raw === -32768) return;
      const celsius =
        Math.abs(entry.value_raw) > 200 ? entry.value_raw / 100 : entry.value_raw;
      svc.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        Math.max(-40, Math.min(40, celsius)),
      );
    });
  }

  private async handleSuperSet(value: CharacteristicValue): Promise<void> {
    const turnOn = Boolean(value);
    const action = this.isFreezerSide
      ? turnOn
        ? MieleProcessAction.StartSuperFreezing
        : MieleProcessAction.StopSuperFreezing
      : turnOn
        ? MieleProcessAction.StartSuperCooling
        : MieleProcessAction.StopSuperCooling;
    try {
      const allowed = await this.platform.api.getAllowedActions(this.device.serialNumber);
      if (!allowed.processAction?.includes(action)) {
        this.platform.log.info(
          `${this.device.displayName}: ignoring Super-mode write — Miele reports allowed=` +
            `${JSON.stringify(allowed.processAction)} in the current state.`,
        );
        return;
      }
      await this.platform.api.putAction(this.device.serialNumber, { processAction: action });
    } catch (err) {
      this.platform.log.error(
        `${this.device.displayName}: Super-mode write failed: ${String(err)}`,
      );
    }
  }
}
