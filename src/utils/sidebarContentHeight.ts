/** Track intrinsic content even when the widget initially waits for its theme. */
export function observeSidebarContentHeight(section: HTMLElement, onHeight: (height: number, expanded: boolean, minimumHeight?: number) => void) {
  let active = true;
  let content: HTMLElement | null = null;
  let viewport: HTMLElement | null = null;
  let firstCard: HTMLElement | null = null;
  let previousHeight: number | undefined;
  let previousExpanded: boolean | undefined;
  let previousMinimumHeight: number | undefined;

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
    const sectionRect = section.getBoundingClientRect();
    if (sectionRect.width <= 0) return;
    const contentRect = content.getBoundingClientRect();
    const framing = viewport.getBoundingClientRect().top - sectionRect.top
      + px(viewportStyle.borderTopWidth) + px(viewportStyle.paddingTop) + bottomInset;
    const height = Math.ceil(framing + contentRect.height);
    const firstRect = firstCard?.getBoundingClientRect();
    // Both the card and natural content move when the list scrolls. Their
    // relative position keeps the first-card minimum independent of scrolling,
    // later cards, and the user's current viewport height.
    const minimumHeight = firstRect && firstRect.height > 0
      ? Math.ceil(framing + firstRect.top - contentRect.top + firstRect.height
          + px(getComputedStyle(content).paddingBottom)) + 1
      : undefined;
    const expanded = Boolean(section.querySelector("details[open]"));
    if (height === previousHeight && expanded === previousExpanded && minimumHeight === previousMinimumHeight) return;
    previousHeight = height;
    previousExpanded = expanded;
    previousMinimumHeight = minimumHeight;
    onHeight(height, expanded, minimumHeight);
  };
  const resizeObserver = new ResizeObserver(measure);
  const connect = () => {
    if (!active) return;
    const nextContent = section.querySelector<HTMLElement>("[data-widget-natural-content]");
    const nextFirstCard = nextContent?.querySelector<HTMLElement>("[data-widget-minimum-card], [data-widget-surface=\"empty\"]") ?? null;
    if (nextContent === content && nextFirstCard === firstCard) { measure(); return; }
    resizeObserver.disconnect();
    content = nextContent;
    firstCard = nextFirstCard;
    viewport = content?.parentElement ?? null;
    if (!content || !viewport) return;
    resizeObserver.observe(section);
    resizeObserver.observe(viewport);
    resizeObserver.observe(content);
    if (firstCard) resizeObserver.observe(firstCard);
    measure();
  };
  // Theme loading can initially return null; observe insertion/replacement of
  // the list instead of giving up when it does not exist on the first commit.
  const mutationObserver = new MutationObserver(connect);
  mutationObserver.observe(section, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["open"] });
  connect();

  return () => {
    active = false;
    mutationObserver.disconnect();
    resizeObserver.disconnect();
  };
}
