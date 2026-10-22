import { isWindows } from "../utils/platform";

// Model the native sibling layer over the settings preview's reference scene.
// Its opacity affects the material only, keeping all foreground text opaque.
export function NativeGlassPreview({ dark }: { dark: boolean }) {
  return isWindows ? <div aria-hidden="true" className="windows-glass-preview-material" style={{ opacity: dark ? 0.16 : 0.12 }} /> : null;
}
