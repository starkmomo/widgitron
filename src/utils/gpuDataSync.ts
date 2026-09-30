import type { Dispatch, SetStateAction } from "react";
import type { GpuInfo, ServerGpuData, SlurmQueueJob, SlurmStep } from "../types/config";
import { tauriListen } from "./tauriListen";

function gpuInfoEqual(a: GpuInfo, b: GpuInfo): boolean {
  return (
    a.name === b.name &&
    a.mem_used === b.mem_used &&
    a.mem_total === b.mem_total &&
    a.util === b.util &&
    a.temp === b.temp &&
    a.power === b.power &&
    a.job_id === b.job_id &&
    a.node === b.node
  );
}

function slurmQueueJobEqual(a: SlurmQueueJob, b: SlurmQueueJob): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.user === b.user &&
    a.state === b.state &&
    a.time === b.time &&
    a.nodelist === b.nodelist
  );
}

function slurmQueueJobsEqual(
  a: SlurmQueueJob[] | null | undefined,
  b: SlurmQueueJob[] | null | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((job, index) => slurmQueueJobEqual(job, b[index]));
}

function slurmStepEqual(a: SlurmStep, b: SlurmStep): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.time === b.time &&
    a.command === b.command
  );
}

function recordOfStringsEqual(
  a: Record<string, string> | null | undefined,
  b: Record<string, string> | null | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => a[key] === b[key]);
}

function recordOfStepsEqual(
  a: Record<string, SlurmStep[]> | null | undefined,
  b: Record<string, SlurmStep[]> | null | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => {
    const stepsA = a[key] || [];
    const stepsB = b[key] || [];
    if (stepsA.length !== stepsB.length) return false;
    return stepsA.every((step, index) => slurmStepEqual(step, stepsB[index]));
  });
}

function systemMetricsEqual(
  a: ServerGpuData["system"],
  b: ServerGpuData["system"]
): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.cpu_percent === b.cpu_percent &&
    a.memory_used_bytes === b.memory_used_bytes &&
    a.memory_total_bytes === b.memory_total_bytes
  );
}

export function gpuServerDataEqual(
  a: ServerGpuData,
  b: ServerGpuData
): boolean {
  if (
    a.host !== b.host ||
    a.is_online !== b.is_online ||
    a.error !== b.error ||
    !systemMetricsEqual(a.system, b.system)
  ) {
    return false;
  }

  if (a.gpu_list.length !== b.gpu_list.length) {
    return false;
  }
  for (let index = 0; index < a.gpu_list.length; index += 1) {
    if (!gpuInfoEqual(a.gpu_list[index], b.gpu_list[index])) {
      return false;
    }
  }

  return (
    recordOfStringsEqual(a.slurm_nodelists, b.slurm_nodelists) &&
    recordOfStringsEqual(a.slurm_times, b.slurm_times) &&
    recordOfStepsEqual(a.slurm_steps, b.slurm_steps) &&
    slurmQueueJobsEqual(a.slurm_queue_jobs, b.slurm_queue_jobs)
  );
}

export function mergeGpuServerUpdate(
  prev: ServerGpuData[],
  item: ServerGpuData
): ServerGpuData[] {
  const index = prev.findIndex((s) => s.host === item.host);
  if (index === -1) return [...prev, item];
  const existing = prev[index];
  if (gpuServerDataEqual(existing, item)) {
    return prev;
  }
  const next = [...prev];
  next[index] = item;
  return next;
}

export async function listenGpuDataSync(
  setter: Dispatch<SetStateAction<ServerGpuData[]>>,
  isActive: () => boolean
): Promise<() => void> {
  const unsubs: (() => void)[] = [];

  const uClear = await tauriListen("gpu_clear", () => {
    if (!isActive()) return;
    setter([]);
  });
  unsubs.push(uClear);

  const uPrune = await tauriListen("gpu_prune", (event) => {
    if (!isActive()) return;
    const host = event.payload;
    setter((prev) => prev.filter((s) => s.host !== host));
  });
  unsubs.push(uPrune);

  return () => unsubs.forEach((f) => f());
}
