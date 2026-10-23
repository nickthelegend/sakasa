import { Types, createComponent } from '@iwsdk/core';

/** A pinchable room surface (real plane or labelled paper stand-in). */
export const RoomSurface = createComponent('RoomSurface', {
  surfaceId: { type: Types.String, default: '' },
  /** Gravity direction (core Dir 0..5) when this surface is pinched. */
  dir: { type: Types.Int8, default: 3 },
  real: { type: Types.Boolean, default: true },
});

/** A sandbox body. */
export const Toy = createComponent('Toy', {
  kind: { type: Types.String, default: 'cube' },
  slot: { type: Types.Int16, default: 0 },
});

/** The glowing marble (puzzle piece; also the hero toy in the sandbox). */
export const Marble = createComponent('Marble', {});

/** The goal ring of the current puzzle. */
export const GoalCup = createComponent('GoalCup', {});

/** A generated paper block of the current puzzle (static collider). */
export const PaperBlock = createComponent('PaperBlock', {});

/** Static collider built from the room model (walls, floor, ceiling, furniture). */
export const RoomCollider = createComponent('RoomCollider', {
  solidId: { type: Types.String, default: '' },
});
