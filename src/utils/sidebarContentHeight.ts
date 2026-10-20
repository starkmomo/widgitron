/** Track intrinsic content even when the widget initially waits for its theme. */
export function observeSidebarContentHeight(section: HTMLElement, onHeight: (height: number, expanded: boolean) => void) {
  let active = true;
  let content: HTMLElement | null = null;
  let viewport: HTMLElement | null = null;
  let previousHeight: number | undefined;
  let previousExpanded: boolean | undefined;

  const measure = () => {
    if (!active || !content || !viewport) return;
    const px = (value: string) => Number.parseFloat(value) || 0;
    const viewportStyle = getComputedStyle(viewport);
    let bottomInset = 0;
    for (let node: HTMLElement | null = viewport; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      bottomInset += px(style.paddingBottom) + px(style.borderBottomWidth);
      if (node === section) break;
      bottomInset += px(style.marginBottom);
    }
    // The scroll area's top is stable while its contents scroll. Measuring
    // the content's top would incorrectly shrink a scrolled card's limit.
    const height = Math.ceil(viewport.getBoundingClientRect().top - section.getBoundingClientRect().top
      + px(viewportStyle.borderTopWidth) + px(viewportStyle.paddingTop)
      + content.getBoundingClientRect().height + bottomInset);
    const expanded = Boolean(section.querySelector("details[open]"));
    if (height === previousHeight && expanded === previousExpanded) return;
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
