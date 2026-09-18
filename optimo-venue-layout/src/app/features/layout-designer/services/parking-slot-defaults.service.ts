import { Injectable, signal } from '@angular/core';

import { ParkingVehicleType } from '../models/layout-element.model';

export interface ParkingSlotDefaults {
  /** How far the vehicle pulls into the slot, metres. */
  lengthM: number;
  /** Slot width — the pitch between adjacent slots along a row, metres. */
  widthM: number;
  /** Driving-lane clearance this vehicle type needs, metres. */
  aisleWidthM: number;
}

/** Starting placeholders only — fully editable from the "Change default sizes" panel. */
export const BUILT_IN_PARKING_SLOT_DEFAULTS: Record<ParkingVehicleType, ParkingSlotDefaults> = {
  car: { lengthM: 5.0, widthM: 2.5, aisleWidthM: 6.0 },
  bus: { lengthM: 12.0, widthM: 3.5, aisleWidthM: 9.0 },
  wheelchair: { lengthM: 5.0, widthM: 3.6, aisleWidthM: 6.0 },
  ev: { lengthM: 5.0, widthM: 2.7, aisleWidthM: 6.0 },
  bike: { lengthM: 2.0, widthM: 0.8, aisleWidthM: 1.8 },
};

const STORAGE_KEY = 'optimo-parking-slot-defaults';

/**
 * Global, app-wide default slot sizes per vehicle type — shared by every parking area
 * the user creates, editable from the parking workspace, persisted to localStorage.
 */
@Injectable({ providedIn: 'root' })
export class ParkingSlotDefaultsService {
  readonly defaults = signal<Record<ParkingVehicleType, ParkingSlotDefaults>>(this.load());

  update(type: ParkingVehicleType, patch: Partial<ParkingSlotDefaults>): void {
    this.defaults.update((current) => {
      const next = { ...current, [type]: { ...current[type], ...patch } };
      this.persist(next);
      return next;
    });
  }

  resetToBuiltIn(type?: ParkingVehicleType): void {
    this.defaults.update((current) => {
      const next = type
        ? { ...current, [type]: BUILT_IN_PARKING_SLOT_DEFAULTS[type] }
        : { ...BUILT_IN_PARKING_SLOT_DEFAULTS };
      this.persist(next);
      return next;
    });
  }

  private load(): Record<ParkingVehicleType, ParkingSlotDefaults> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { ...BUILT_IN_PARKING_SLOT_DEFAULTS };
      }
      const saved = JSON.parse(raw) as Partial<Record<ParkingVehicleType, Partial<ParkingSlotDefaults>>>;
      const merged = { ...BUILT_IN_PARKING_SLOT_DEFAULTS };
      for (const type of Object.keys(merged) as ParkingVehicleType[]) {
        merged[type] = { ...merged[type], ...saved[type] };
      }
      return merged;
    } catch {
      return { ...BUILT_IN_PARKING_SLOT_DEFAULTS };
    }
  }

  private persist(value: Record<ParkingVehicleType, ParkingSlotDefaults>): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }
}
