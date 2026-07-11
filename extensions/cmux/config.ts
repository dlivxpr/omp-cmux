export type NotifyLevel = "all" | "medium" | "low" | "disabled";

export function getNotifyLevel(): NotifyLevel {
  const env = process.env.OMP_CMUX_NOTIFY_LEVEL?.toLowerCase();
  if (
    env === "all" ||
    env === "medium" ||
    env === "low" ||
    env === "disabled"
  ) {
    return env;
  }
  return "medium";
}

export function shouldNotify(
  level: NotifyLevel,
  type: "waiting" | "complete" | "error"
): boolean {
  if (level === "disabled") return false;
  if (level === "all") return true;
  if (level === "medium") return type !== "waiting";
  if (level === "low") return type === "error";
  return false;
}

export function getNumberFromEnv(name: string, fallback: number): number {
	const raw = process.env[name]?.trim();
	if (!raw) return fallback;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
