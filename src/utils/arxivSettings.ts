import type { ArxivConfig } from "../types/config";

const normalize = (values: string[] | undefined) => [...new Set((values ?? [])
  .map(value => value.trim().replace(/^"|"$/g, "").toLowerCase()).filter(Boolean))].sort();

/** Display preferences and polling frequency do not change the paper query. */
export function arxivQueryChanged(previous: ArxivConfig, next: ArxivConfig): boolean {
  return JSON.stringify([normalize(previous.categories), normalize(previous.keywords)])
    !== JSON.stringify([normalize(next.categories), normalize(next.keywords)]);
}
