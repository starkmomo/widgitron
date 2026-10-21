import type { WidgetMaterial } from "../types/theme";
import { isMacOS, isWindows } from "./platform";

export const LIQUID_GLASS_BACKGROUND = { color: "#000000", opacity: 0.08 };
export const LIQUID_GLASS_CARD_BACKGROUND = { color: "#000000", opacity: 0.08 };

export function isGlassMaterial(material?: WidgetMaterial): material is WidgetMaterial {
  return material === "native-glass" || material === "native-liquid-glass";
}

/** Keep saved themes compatible while each platform uses its own glass renderer. */
export function platformGlassMaterial(material?: WidgetMaterial): WidgetMaterial | undefined {
  if (isMacOS && isGlassMaterial(material)) return "native-liquid-glass";
  if (isWindows && material === "native-liquid-glass") return "native-glass";
  return material;
}

/** The separate trial preset now aliases the existing Glass preset. */
export function canonicalGlassPresetId(id: string): string {
  return id.replace(/^theme-(gpu|deadline|arxiv|quota)-liquid$/, "theme-$1-glass");
}
