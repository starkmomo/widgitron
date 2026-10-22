import assert from "node:assert/strict";
import test from "node:test";
import { duplicateSidebarTheme, removeSidebarTheme, resolveSidebarTheme, selectSidebarTheme, updateSidebarTheme } from "../src/utils/sidebarTheme.ts";

test("follow tracks main appearance while explicit and legacy choices stay independent", () => {
  const follow = selectSidebarTheme(undefined, "follow");
  assert.equal(resolveSidebarTheme(follow, "light").background, "#ffffff");
  assert.equal(resolveSidebarTheme(follow, "dark").background, "#050814");
  assert.equal(resolveSidebarTheme({ preset: "light" }, "dark").background, "#ffffff");
  assert.equal(resolveSidebarTheme({ preset: "midnight" }, "light").background, "#050814");
  assert.equal(resolveSidebarTheme({ active_theme_id: "transparent" }).id, "light");
});

test("custom glass copies retain the material through editing and JSON persistence", () => {
  const copied = duplicateSidebarTheme({ active_theme_id: "glass" }, "glass", "light");
  const saved = JSON.parse(JSON.stringify(copied.config));
  const resolved = resolveSidebarTheme(saved, "dark");
  assert.equal(resolved.preset, "custom");
  assert.equal(resolved.material, "native-glass");
  assert.equal(resolved.card_opacity, 0.30);
  assert.equal(removeSidebarTheme(saved, resolved.id).active_theme_id, "light");
});

test("copying follow freezes the displayed appearance rather than the main window setting", () => {
  const copied = duplicateSidebarTheme({ active_theme_id: "follow" }, "follow", "dark");
  assert.equal(resolveSidebarTheme(copied.config, "light").background, "#050814");
  assert.equal(resolveSidebarTheme(copied.config, "light").preset, "custom");
});

test("sidebar glass saves card background independently and preserves zero opacity", () => {
  const copied = duplicateSidebarTheme({ active_theme_id: "glass" }, "glass");
  const edited = updateSidebarTheme(copied.config, copied.theme.id, {
    card_background: { color: "#123456", opacity: 0 }, card_opacity: 0,
  });
  const restored = resolveSidebarTheme(JSON.parse(JSON.stringify(edited)));
  assert.deepEqual(restored.card_background, { color: "#123456", opacity: 0 });
  const duplicate = duplicateSidebarTheme(edited, restored.id);
  assert.deepEqual(duplicate.theme.card_background, restored.card_background);
  duplicate.theme.card_background!.opacity = 0.75;
  assert.equal(restored.card_background!.opacity, 0);
});
