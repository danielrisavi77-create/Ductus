/** Index of the tab a key moves to in a horizontal tab list (WAI-ARIA tabs pattern); null for other keys. */
export function nextTab(index: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
      return (index + 1) % count;
    case "ArrowLeft":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
