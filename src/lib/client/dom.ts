export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/** The display face as a canvas font-family list. */
export function mapFont() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim();
  return `${v ? `${v}, ` : ''}"Arial Narrow", sans-serif`;
}
