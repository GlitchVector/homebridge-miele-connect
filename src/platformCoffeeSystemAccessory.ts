import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";

import { PlatformAccessoryBase } from "./platformAccessoryBase.js";
import type { MielePlatform } from "./platform.js";
import { MieleProgramState, type MieleDeviceState } from "./miele/types.js";

/**
 * Coffee system — minimal exposure as a single HomeKit Switch.
 *
 * Brewing programs vary wildly per model and the Miele API doesn't expose
 * "start espresso" generically; what's universally available is power on/off,
 * so that's what this surfaces. Pairs nicely with an Automation that "turns
 * the coffee machine on" in the morning.
 */
export class CoffeeSystemAccessory extends PlatformAccessoryBase {
  private power: Service;

  constructor(platform: MielePlatform, accessory: PlatformAccessory) {
    super(platform, accessory);

    this.power = this.useService(this.platform.Service.Switch, this.device.displayName);
    this.power.setCharacteristic(this.platform.Characteristic.Name, this.device.displayName);
    this.power
      .getCharacteristic(this.platform.Characteristic.On)
      .onSet((v) => this.handlePowerSet(v));
  }

  applyState(state: MieleDeviceState): void {
    const status = state.status?.value_raw ?? MieleProgramState.NotConnected;
    const isOn =
      status !== MieleProgramState.Off &&
      status !== MieleProgramState.NotConnected &&
      status !== MieleProgramState.StandBy;
    this.power.updateCharacteristic(this.platform.Characteristic.On, isOn);
  }

  private async handlePowerSet(value: CharacteristicValue): Promise<void> {
    const turnOn = Boolean(value);
    try {
      const allowed = await this.platform.api.getAllowedActions(this.device.serialNumber);
      if (turnOn && !allowed.powerOn) {
        this.platform.log.info(
          `${this.device.displayName}: ignoring powerOn — Miele reports it's not currently allowed.`,
        );
        return;
      }
      if (!turnOn && !allowed.powerOff) {
        this.platform.log.info(
          `${this.device.displayName}: ignoring powerOff — Miele reports it's not currently allowed.`,
        );
        return;
      }
      await this.platform.api.putAction(
        this.device.serialNumber,
        turnOn ? { powerOn: true } : { powerOff: true },
      );
    } catch (err) {
      this.platform.log.error(
        `${this.device.displayName}: coffee-machine power write failed: ${String(err)}`,
      );
    }
  }
}
