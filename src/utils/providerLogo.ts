// Cursor's source SVG is white, so it needs a dark tone on light cards.
export const providerLogoToneClass = (provider: string, lightBackground: boolean) =>
  provider === "cursor" && lightBackground ? "brightness-0" : "";
