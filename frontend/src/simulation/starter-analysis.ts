import { starterValues, type ProcessStarterDraft } from './starter';

/** Explicit upper bounds for the starter, never a substitute for the real simulation. */
export class ProcessStarterAnalysis {
  readonly values: ReturnType<typeof starterValues>;
  readonly throughputPerHour: number;
  readonly hourlyOperatingCost: number;
  readonly overloaded: boolean;

  constructor(draft: ProcessStarterDraft) {
    this.values = starterValues(draft);
    const value = this.values;
    const slotLimit = Math.min(
      ...value.steps.map((step) => (step.capacity * 3600) / step.processingSeconds),
    );
    const sharedTime = value.steps
      .filter((step) => step.usesSharedResource)
      .reduce((sum, step) => sum + step.processingSeconds, 0);
    const resourceLimit =
      draft.sharedResource && sharedTime > 0
        ? (value.resourceCapacity * 3600) / sharedTime
        : Infinity;
    this.throughputPerHour = Math.min(slotLimit, resourceLimit);
    this.hourlyOperatingCost =
      value.steps.reduce((sum, step) => sum + step.capacity * step.costPerHour, 0) +
      value.resourceCapacity * value.resourceCostPerHour;
    this.overloaded =
      draft.arrivalMode === 'regular' && value.arrivalsPerHour > this.throughputPerHour;
  }
}
