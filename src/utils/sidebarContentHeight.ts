/** Track intrinsic content even when the widget initially waits for its theme. */
export function observeSidebarContentHeight(section: HTMLElement, onHeight: (height: number, expanded: boolean) => void) {
  let active = true;
  let content: HTMLElement | null = null;
  let viewport: HTMLElement | null = null;
  let previousHeight: number | undefined;
  let previousExpanded: boolean | undefined;

  const measure = () => {
    if (!active || !content || !viewport) return;
    // The scroll area's top is stable while its contents scroll. Measuring
    // the content's top would incorrectly shrink a scrolled card's limit.
    const height = Math.ceil(viewport.getBoundingClientRect().top - section.getBoundingClientRect().top
      + content.getBoundingClientRect().height + 18);
    const expanded = Boolean(section.querySelector("details[open]"));
    if (previousHeight !== undefined && Math.abs(height - previousHeight) < 2 && expanded === previousExpanded) return;
    previousHeight = height;
    previousExpanded = expanded;
    onHeight(height, expanded);
  };
  const resizeObserver = new ResizeObserver(measure);
  const connect = () => {
    if (!active) return;
    const nextContent = section.querySelector<HTMLElement>("[data-widget-natural-content]");
    if (nextContent === content) { measure(); return; }
    resizeObserver.disconnect();
    content = nextContent;
    viewport = content?.parentElement ?? null;
    if (!content || !viewport) return;
    resizeObserver.observe(section);
    resizeObserver.observe(viewport);
    resizeObserver.observe(content);
    measure();
  };
  // Theme loading can initially return null; observe insertion/replacement of
  // the list instead of giving up when it does not exist on the first commit.
  const mutationObserver = new MutationObserver(connect);
  mutationObserver.observe(section, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
  connect();

  return () => {
    active = false;
    mutationObserver.disconnect();
    resizeObserver.disconnect();
  };
}
