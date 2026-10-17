import tauriConfig from "../src-tauri/tauri.conf.json";

export const APP_VERSION = `v${tauriConfig.version}`;
export const IS_TEST_BUILD = import.meta.env.VITE_TEST_BUILD === "true";
export const APP_NAME = IS_TEST_BUILD ? "Widgitron 测试版" : "Widgitron";
