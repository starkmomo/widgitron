import { collapsedWidgetContentHeight } from "./widgetContentHeight.ts";

/** Minimum for one complete collapsed card, independent of scrolling/expanded timelines. */
export function observeFloatingContentMinimum(shell: HTMLElement, onHeight: (height: number) => void) {
  let active = true;
  let natural: HTMLElement | null = null;
  let viewport: HTMLElement | null = null;
  let card: HTMLElement | null = null;
  let previous: number | undefined;
  const px = (value: string) => Number.parseFloat(value) || 0;

  const measure = () => {
    if (!active || !natural || !viewport || !card) return;
    const shellRect = shell.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    if (shellRect.width <= 0 || cardRect.height <= 0) return;
    const viewportStyle = getComputedStyle(viewport);
    let bottomInset = 0;
    for (let node: HTMLElement | null = viewport; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      bottomInset += px(style.paddingBottom) + px(style.borderBottomWidth);
      if (node === shell) break;
      bottomInset += px(style.marginBottom);
    }
    // Header/banners and outer framing are above the stable scroll viewport.
    // Subtract the natural content's top so scrolling cannot change the limit.
    const height = Math.ceil(viewport.getBoundingClientRect().top - shellRect.top
      + px(viewportStyle.borderTopWidth) + px(viewportStyle.paddingTop)
      + cardRect.top - natural.getBoundingClientRect().top + collapsedWidgetContentHeight(card) + bottomInset) + 1;
    if (!Number.isFinite(height) || height <= 0 || height === previous) return;
    previous = height;
    onHeight(height);
  };
  const resize = new ResizeObserver(measure);
  const connect = () => {
    if (!active) return;
    const nextNatural = shell.querySelector<HTMLElement>("[data-widget-natural-content]");
    const nextCard = nextNatural?.querySelector<HTMLElement>("[data-widget-minimum-card], [data-widget-surface=\"empty\"]") ?? null;
    if (nextNatural === natural && nextCard === card) { measure(); return; }
    resize.disconnect();
    natural = nextNatural;
    viewport = natural?.parentElement ?? null;
    card = nextCard;
    if (!natural || !viewport || !card) return;
    resize.observe(shell);
    resize.observe(viewport);
    resize.observe(natural);
    resize.observe(card);
    measure();
  };
  const mutation = new MutationObserver(connect);
  mutation.observe(shell, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["open"] });
  connect();
  return () => { active = false; resize.disconnect(); mutation.disconnect(); };
}
