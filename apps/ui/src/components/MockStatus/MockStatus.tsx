import { StatusDot } from "@/components/ds";

export function MockStatus({ status }: { status: "running" | "paused" }) {
  return status === "running" ? <StatusDot tone="ok" label="Running" /> : <StatusDot tone="warn" label="Paused" />;
}
