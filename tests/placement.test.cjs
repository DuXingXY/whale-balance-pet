'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { placePet } = require('../core/placement.cjs');
const skins = require('../assets/skins.json');

test('pet faces toward the center of its own display, including negative display coordinates', () => {
  for (const work of [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: -1920, y: -200, width: 1920, height: 1080 }, { x: 1920, y: 0, width: 1280, height: 1024 }]) {
    const middle = work.x + work.width / 2;
    for (const size of [150, 190, 230]) {
      for (const [offset, facing] of [[-1, 'right'], [0, 'left'], [1, 'left']]) {
        const anchor = { x: middle - size / 2 + offset, y: work.y + 300 };
        const layout = placePet(anchor, size, work);
        assert.equal(layout.facing, facing);
        assert.deepEqual(placePet(layout.anchor, size, work), layout, 'repeated layout must not shift or reverse the character');
      }
    }
  }
});

test('each skin snaps its visible mirrored silhouette to the display edges at every size', () => {
  const work = { x: -1920, y: 30, width: 1920, height: 1080 };
  for (const skin of Object.values(skins)) for (const size of [150, 190, 230]) {
    for (const side of ['left', 'right']) {
      const anchor = { x: side === 'left' ? work.x - 500 : work.x + work.width + 500, y: work.y + 200 };
      const layout = placePet(anchor, size, work, { snap: true, bounds: skin.bounds });
      assert.equal(layout.facing, side === 'left' ? 'right' : 'left');
      const edge = side === 'left' ? layout.anchor.x + size * (1 - skin.bounds.right) : layout.anchor.x + size * skin.bounds.right;
      assert(Math.abs(edge - (side === 'left' ? work.x : work.x + work.width)) < 1e-8);
      assert.equal(layout.origin.x, side === 'left' ? '0%' : '100%');
      assert(Math.abs(layout.window.x + layout.character.x - layout.anchor.x) < 1e-8);
      assert.deepEqual(placePet(layout.anchor, size, work, { snap: true, bounds: skin.bounds }), layout);
    }
  }
});
