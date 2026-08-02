export type StaffSectionSwipeDirection = "left" | "right";

export interface StaffSectionSwipeBase<Mode extends string> {
  mode: Mode;
  index: number;
}

export interface StaffSectionSwipeSelection<Mode extends string> {
  baseMode: Mode;
  baseIndex: number;
  nextMode: Mode;
  settledIndex: number;
}

export function reconcileStaffSectionSwipePendingTarget<Mode extends string>(
  renderedMode: Mode,
  pendingTarget: Mode | null,
): Mode | null {
  return pendingTarget === renderedMode ? null : pendingTarget;
}

export function resolveStaffSectionSwipeBase<Mode extends string>(
  modes: readonly Mode[],
  renderedMode: Mode,
  pendingTarget: Mode | null,
): StaffSectionSwipeBase<Mode> {
  const mode = pendingTarget ?? renderedMode;
  const index = modes.indexOf(mode);

  if (index < 0) {
    throw new Error(`Swipe mode is not included in the configured modes: ${mode}`);
  }

  return { mode, index };
}

export function selectNextStaffSectionSwipeMode<Mode extends string>(
  modes: readonly Mode[],
  renderedMode: Mode,
  pendingTarget: Mode | null,
  direction: StaffSectionSwipeDirection,
): StaffSectionSwipeSelection<Mode> {
  if (modes.length === 0) {
    throw new Error("Swipe modes must not be empty");
  }

  const base = resolveStaffSectionSwipeBase(modes, renderedMode, pendingTarget);
  const delta = direction === "left" ? 1 : -1;
  const settledIndex = (base.index + delta + modes.length) % modes.length;

  return {
    baseMode: base.mode,
    baseIndex: base.index,
    nextMode: modes[settledIndex],
    settledIndex,
  };
}
