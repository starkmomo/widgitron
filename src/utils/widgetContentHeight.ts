/** Expanded timelines scroll inside the existing viewport, without raising its size limits. */
export function collapsedWidgetContentHeight(content: HTMLElement): number {
  let height = content.getBoundingClientRect().height;
  for (const details of content.querySelectorAll<HTMLElement>("details[data-widget-scroll-expansion][open]")) {
    const summary = details.querySelector<HTMLElement>("summary");
    if (summary) height -= Math.max(0, details.getBoundingClientRect().height - summary.getBoundingClientRect().height);
  }
  return Math.max(0, height);
}
