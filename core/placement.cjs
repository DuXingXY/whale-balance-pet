'use strict';
const clamp = (v, min, max) => Math.max(min, Math.min(v, max));
// Bounds describe the visible silhouette in the square character frame.
function placePet(anchor, size, work, { snap = false, width = 340, height = 470, bounds = { left: 45 / 610, top: 10 / 610, right: 1, bottom: 1 } } = {}) {
  const leftInset = size * bounds.left, topInset = size * bounds.top, rightExtent = size * bounds.right, bottomExtent = size * bounds.bottom;
  const right = work.x + work.width - Math.max(0, width - 340), bottom = work.y + work.height - Math.max(0, height - 470);
  let x = clamp(anchor.x, work.x - leftInset, right - rightExtent), y = clamp(anchor.y, work.y - topInset, bottom - bottomExtent);
  let dockX = '', dockY = '';
  if (snap) {
    const l = x + leftInset - work.x, r = right - x - rightExtent, t = y + topInset - work.y, b = bottom - y - bottomExtent;
    if (Math.min(l, r) <= 32) { dockX = l <= r ? 'left' : 'right'; x = dockX === 'left' ? work.x - leftInset : right - rightExtent; }
    if (Math.min(t, b) <= 32) { dockY = t <= b ? 'top' : 'bottom'; y = dockY === 'top' ? work.y - topInset : bottom - bottomExtent; }
  }
  if (Math.abs(x + leftInset - work.x) < .1) dockX = 'left';
  if (Math.abs(right - x - rightExtent) < .1) dockX = 'right';
  if (Math.abs(y + topInset - work.y) < .1) dockY = 'top';
  if (Math.abs(bottom - y - bottomExtent) < .1) dockY = 'bottom';
  // Match the supplied composition: the thought bubble sits beside the hair,
  // rather than leaving its full height as empty space above the character.
  const aboveOffset = 140;
  const below = y + topInset - work.y < aboveOffset;
  const defaultLeft = 340 - size;
  const wx = Math.round(clamp(x - defaultLeft, work.x, work.x + work.width - width));
  const wy = Math.round(clamp(below ? y : y - (470 - size - 17), work.y, work.y + work.height - height));
  const cy = y - wy;
  return { anchor: { x, y }, window: { x: wx, y: wy }, character: { x: x - wx, y: cy },
    bubble: { left: clamp(x - wx - defaultLeft, -22, 60), top: clamp(below ? cy + size + 10 : cy + topInset - aboveOffset, 0, 244), below },
    origin: { x: dockX === 'left' ? '0%' : dockX === 'right' ? '100%' : '50%', y: dockY === 'top' ? '0%' : dockY === 'bottom' ? '100%' : '95%' } };
}
module.exports = { placePet };
