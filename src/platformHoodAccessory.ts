import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";

import { PlatformAccessoryBase } from "./platformAccessoryBase.js";
import type { MielePlatform } from "./platform.js";
import type { MieleDeviceState } from "./miele/types.js";

/** Miele light enum: 1 = on, 2 = off. */
const MIELE_LIGHT_ON = 1;
const MIELE_LIGHT_OFF = 2;

/**
 * Hood — exposes:
 *   - `Fan` service with `Active` + `RotationSpeed` mapped to ventilationStep 0..4
 *     at 25-percent increments (so HomeKit's 0..100 slider snaps to Miele steps).
 *   - `Lightbulb` service mapped to the hood light (Miele 1/2 encoding).
 */
export class HoodAccessory extends PlatformAccessoryBase {
  private fan: Service;
  private light: Service;

  constructor(platform: MielePlatform, accessory: PlatformAccessory) {
    super(platform, accessory);

    this.fan = this.useService(this.platform.Service.Fanv2, this.device.displayName, "hood-fan");
    this.fan.setCharacteristic(this.platform.Characteristic.Name, this.device.displayName);
    this.fan
      .getCharacteristic(this.platform.Characteristic.Active)
      .onSet((v) => this.handleFanActiveSet(v));
    this.fan
      .getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 25 })
      .onSet((v) => this.handleFanSpeedSet(v));

    this.light = this.useService(
      this.platform.Service.Lightbulb,
      `${this.device.displayName} Light`,
      "hood-light",
    );
    this.light.setCharacteristic(
      this.platform.Characteristic.Name,
      `${this.device.displayName} Light`,
    );
    this.light
      .getCharacteristic(this.platform.Characteristic.On)
      .onSet((v) => this.handleLightSet(v));
  }

  applyState(state: MieleDeviceState): void {
    const step = state.ventilationStep?.value_raw ?? 0;
    this.fan.updateCharacteristic(
      this.platform.Characteristic.Active,
      step > 0
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE,
    );
    this.fan.updateCharacteristic(
      this.platform.Characteristic.RotationSpeed,
      Math.max(0, Math.min(100, step * 25)),
    );

    if (state.light !== undefined) {
      this.light.updateCharacteristic(
        this.platform.Characteristic.On,
        state.light === MIELE_LIGHT_ON,
      );
    }
  }

  private async handleFanActiveSet(value: CharacteristicValue): Promise<void> {
    const turnOn = value === this.platform.Characteristic.Active.ACTIVE;
    if (turnOn) {
      // HomeKit doesn't supply a step on the Active toggle alone; default to
      // step 2 (mid speed) so toggling on from a paired widget still does
      // something useful. The user can then dial it via RotationSpeed.
      await this.tryPut({ ventilationStep: 2 }, "hood fan on");
    } else {
      await this.tryPut({ ventilationStep: 0 }, "hood fan off");
    }
  }

  private async handleFanSpeedSet(value: CharacteristicValue): Promise<void> {
    const pct = Math.max(0, Math.min(100, Number(value)));
    const step = Math.round(pct / 25);
    await this.tryPut({ ventilationStep: step }, `hood ventilationStep=${step}`);
  }

  private async handleLightSet(value: CharacteristicValue): Promise<void> {
    const lightCode = value ? MIELE_LIGHT_ON : MIELE_LIGHT_OFF;
    await this.tryPut({ light: lightCode }, `hood light ${value ? "on" : "off"}`);
  }

  private async tryPut(
    body: Parameters<typeof this.platform.api.putAction>[1],
    descr: string,
  ): Promise<void> {
    try {
      await this.platform.api.putAction(this.device.serialNumber, body);
    } catch (err) {
      this.platform.log.error(`${this.device.displayName}: ${descr} failed: ${String(err)}`);
    }
  }
}
