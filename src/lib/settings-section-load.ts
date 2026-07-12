export type SettingsSectionLoadResult<T> =
  | { status: "loaded"; value: T }
  | { status: "error"; error: Error };

export async function loadIndependentSettingsSections<First, Second>(
  firstLoader: () => Promise<First>,
  secondLoader: () => Promise<Second>,
): Promise<[
  SettingsSectionLoadResult<First>,
  SettingsSectionLoadResult<Second>,
]> {
  const [first, second] = await Promise.allSettled([
    firstLoader(),
    secondLoader(),
  ]);

  return [toLoadResult(first), toLoadResult(second)];
}

export function allSettingsSectionsLoaded(
  ...sections: readonly SettingsSectionLoadResult<unknown>[]
): boolean {
  return sections.every((section) => section.status === "loaded");
}

export function assertSettingsSectionsLoaded(
  sections: Readonly<Record<string, boolean>>,
): void {
  const failedSections = Object.entries(sections)
    .filter(([, loaded]) => !loaded)
    .map(([name]) => name);

  if (failedSections.length > 0) {
    throw new Error(
      `設定を読み込めていないため保存できません: ${failedSections.join(", ")}`,
    );
  }
}

function toLoadResult<T>(
  result: PromiseSettledResult<T>,
): SettingsSectionLoadResult<T> {
  return result.status === "fulfilled"
    ? { status: "loaded", value: result.value }
    : { status: "error", error: normalizeError(result.reason) };
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
