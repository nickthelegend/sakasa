import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { synth } from './game/audio.js';
import { GravitySystem } from './game/gravity-system.js';
import { installHooks } from './game/hooks.js';
import { PerfEndSystem, PerfStartSystem, installRenderProbe } from './game/perf.js';
import { PlaySystem } from './game/play-system.js';
import { RoomSystem } from './game/room-system.js';
import { loadPersisted } from './game/store.js';
import { SurfaceSystem } from './game/surface-system.js';
import { UiSystem } from './game/ui-system.js';

loadPersisted();

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions)
  .then((world) => {
    world.registerSystem(PerfStartSystem, { priority: -1000 });
    world.registerSystem(RoomSystem);
    world.registerSystem(GravitySystem);
    world.registerSystem(PlaySystem, { priority: 5 });
    world.registerSystem(SurfaceSystem, { priority: 6 });
    world.registerSystem(UiSystem, { priority: 7 });
    world.registerSystem(PerfEndSystem, { priority: 1000 });
    installRenderProbe(world.renderer);
    installHooks(world);

    const splash = document.getElementById('splash');
    const enter = document.getElementById('enter');
    enter?.addEventListener('click', () => {
      synth.resume();
      world.launchXR();
    });
    world.visibilityState.subscribe((v) => {
      if (splash) splash.style.display = v === VisibilityState.NonImmersive ? 'flex' : 'none';
      if (v !== VisibilityState.NonImmersive) synth.resume();
    });
  })
  .catch((error: unknown) => {
    console.error('[sakasa] failed to start', error);
    const status = document.getElementById('status');
    if (status) status.textContent = `Sakasa could not start: ${error instanceof Error ? error.message : String(error)}`;
  });
