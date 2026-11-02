/**
 * How the demo walk-through starts its browser: in Croatian, as a Croatian
 * teacher's browser would, so a native date field shows "dd. mm. gggg." and not
 * "mm/dd/yyyy". `--lang` is an argument of Chromium alone; WebKit and Firefox
 * refuse to start with it, so they get the environment only (DAN-232).
 */
export function demoLaunchOptions(browserName: string, source: Record<string, string | undefined>) {
  const env = Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return {
    ...(browserName === "chromium" ? { args: ["--lang=hr-HR"] } : {}),
    env: { ...env, LANG: "hr_HR.UTF-8", LANGUAGE: "hr" },
  };
}
