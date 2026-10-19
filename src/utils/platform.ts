export const isMacOS = typeof navigator !== "undefined" && /Macintosh|MacIntel|MacPPC|Mac68K/i.test(navigator.userAgent);
export const isWindows = typeof navigator !== "undefined" && /Windows NT/i.test(navigator.userAgent);
export const supportsFloatingGlass = isMacOS || isWindows;
