/**
 * Today's date on the signed-in home (#802 part B, pocetna.dc.html), in
 * Croatian and in Zagreb's time, whatever zone the server runs in:
 * "Nedjelja, 25. 10. 2026.".
 */
export function homeDate(at: Date): string {
  const parts = new Intl.DateTimeFormat("hr-HR", {
    timeZone: "Europe/Zagreb",
    weekday: "long",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  // Without leading zeros, whatever the ICU data pads to.
  const number = (type: Intl.DateTimeFormatPartTypes) => String(Number(part(type)));
  const weekday = part("weekday");
  return `${weekday.charAt(0).toLocaleUpperCase("hr-HR")}${weekday.slice(1)}, ${number("day")}. ${number("month")}. ${number("year")}.`;
}
