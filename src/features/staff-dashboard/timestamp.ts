export function timestampToMillis(value: unknown): number | null {
  const date = toDate(value);
  return date ? date.getTime() : null;
}

export function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return new Date((value as { toMillis: () => number }).toMillis());
  }
  if (typeof value === "string") {
    const date = new Date(value.replace(/-/g, "/"));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}
