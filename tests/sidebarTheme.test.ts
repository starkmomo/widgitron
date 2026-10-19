import assert from "node:assert/strict";
import test from "node:test";
import { duplicateSidebarTheme, removeSidebarTheme, resolveSidebarTheme, selectSidebarTheme } from "../src/utils/sidebarTheme.ts";

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
