import { defineComponents } from '@iwsdk/core';
import {
  GoalCup,
  Marble,
  PaperBlock,
  RoomCollider,
  RoomSurface,
  Toy,
} from './game/components.js';

export default defineComponents([RoomSurface, Toy, Marble, GoalCup, PaperBlock, RoomCollider]);
