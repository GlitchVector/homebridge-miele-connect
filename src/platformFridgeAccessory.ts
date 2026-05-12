import type { CharacteristicValue, PlatformAccessory, Service } from "homebridge";

import { PlatformAccessoryBase } from "./platformAccessoryBase.js";
import type { MielePlatform } from "./platform.js";
import {
  MieleDeviceType,
  MieleProcessAction,
  MieleProgramState,
  type MieleDeviceState,
} from "./miele/types.js";

/**
 * Fridge / Freezer / FridgeFreezer.
 *
 * Exposes:
 *   - one `TemperatureSensor` per reported zone (up to 2: fridge + freezer)
 *   - a `Super Cooling` switch on devices with a fridge compartment
 *   - a `Super Freezing` switch on devices with a freezer compartment
 *
 * Super-cool / super-freeze are Miele's rapid-chill modes — the compressor
 * runs at max for ~6h to bring warm groceries down quickly, then returns to
 * normal. Both modes auto-stop on the appliance side; the switch's read-back
 * state derives from `state.status.value_raw`:
 *
 *   - Supercooling (14)   → super-cool switch ON
 *   - Superfreezing (13)  → super-freeze switch ON
 *   - any other value     → both switches OFF
 *
 * Limitation: when both modes are simultaneously active on a FridgeFreezer,
 * Miele only surfaces one of them in `status` at a time. Toggling both
 * still works (each switch fires its own action), but in HomeKit only the
 * mode reflected in `status` will read as ON.
 */
export class FridgeAccessory extends PlatformAccessoryBase {
  private readonly tempServices: Service[] = [];
  private readonly hasFridge: boolean;
  private readonly hasFreezer: boolean;
  private readonly coolSwitch: Service | null;
  private readonly freezeSwitch: Service | null;

  constructor(platform: MielePlatform, accessory: PlatformAccessory) {
    super(platform, accessory);

    this.hasFridge =
      this.device.rawType === MieleDeviceType.Fridge ||
      this.device.rawType === MieleDeviceType.FridgeFreezer;
    this.hasFreezer =
      this.device.rawType === MieleDeviceType.Freezer ||
      this.device.rawType === MieleDeviceType.FridgeFreezer;

    // One TemperatureSensor service per zone, subtyped by index so cached
    // services restore correctly across restarts.
    const zoneNames = this.zoneNames();
    for (let i = 0; i < zoneNames.length; i++) {
      const subtype = `zone-${i}`;
      const svc = this.useService(
        this.platform.Service.TemperatureSensor,
        zoneNames[i],
        subtype,
      );
      svc.setCharacteristic(this.platform.Characteristic.Name, zoneNames[i]);
      svc
        .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .setProps({ minValue: -40, maxValue: 40, minStep: 0.1 });
      this.tempServices.push(svc);
    }

    // Drop legacy services from earlier plugin versions. Sweep any Switch
    // whose subtype isn't in the current allow-list — covers v0.1's
    // single-switch "super-mode" subtype and any future renames.
    const wantedSwitchSubtypes = new Set(["super-cool", "super-freeze"]);
    for (const svc of [...this.accessory.services]) {
      if (svc.UUID !== this.platform.Service.Switch.UUID) continue;
      if (!svc.subtype || !wantedSwitchSubtypes.has(svc.subtype)) {
        this.platform.log.info(
          `${this.device.displayName}: removing stale Switch subtype=${svc.subtype}`,
        );
        this.accessory.removeService(svc);
      }
    }

    this.coolSwitch = this.hasFridge
      ? this.makeSuperSwitch("super-cool", "Super Cooling", (v) =>
          this.handleSuperSet(v, /* freezer */ false),
        )
      : null;
    if (!this.hasFridge) this.removeServiceIfPresent(this.platform.Service.Switch, "super-cool");

    this.freezeSwitch = this.hasFreezer
      ? this.makeSuperSwitch("super-freeze", "Super Freezing", (v) =>
          this.handleSuperSet(v, /* freezer */ true),
        )
      : null;
    if (!this.hasFreezer) this.removeServiceIfPresent(this.platform.Service.Switch, "super-freeze");
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

    const status = state.status?.value_raw ?? MieleProgramState.NotConnected;
    if (this.coolSwitch) {
      this.coolSwitch.updateCharacteristic(
        this.platform.Characteristic.On,
        status === MieleProgramState.Supercooling,
      );
    }
    if (this.freezeSwitch) {
      this.freezeSwitch.updateCharacteristic(
        this.platform.Characteristic.On,
        status === MieleProgramState.Superfreezing,
      );
    }
  }

  private zoneNames(): string[] {
    if (this.hasFridge && this.hasFreezer) {
      return [this.device.displayName, `${this.device.displayName} Freezer`];
    }
    return [this.device.displayName];
  }

  private makeSuperSwitch(
    subtype: string,
    name: string,
    onSet: (v: CharacteristicValue) => Promise<void>,
  ): Service {
    const svc = this.useService(this.platform.Service.Switch, name, subtype);
    svc.setCharacteristic(this.platform.Characteristic.Name, name);
    svc.getCharacteristic(this.platform.Characteristic.On).onSet(onSet);
    return svc;
  }

  private removeServiceIfPresent(
    serviceCtor: Parameters<typeof this.accessory.getServiceById>[0],
    subtype: string,
  ): void {
    const existing = this.accessory.getServiceById(serviceCtor, subtype);
    if (existing) this.accessory.removeService(existing);
  }

  private async handleSuperSet(value: CharacteristicValue, freezer: boolean): Promise<void> {
    const turnOn = Boolean(value);
    const action = freezer
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
          `${this.device.displayName}: ignoring ${freezer ? "Super Freezing" : "Super Cooling"}=${turnOn} — ` +
            `Miele reports allowed=${JSON.stringify(allowed.processAction)} right now.`,
        );
        return;
      }
      await this.platform.api.putAction(this.device.serialNumber, { processAction: action });
    } catch (err) {
      this.platform.log.error(
        `${this.device.displayName}: ${freezer ? "Super Freezing" : "Super Cooling"} write failed: ${String(err)}`,
      );
    }
  }
}
