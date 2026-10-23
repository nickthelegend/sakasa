// Print window.__sakasa.state() (compact) from the app frame.
export default async function run({ frame }) {
  return await frame.evaluate(() => {
    const s = window.__sakasa?.state();
    if (!s) return { error: 'no hooks' };
    return { ...s, room: s.room && { ...s.room, surfaces: s.room.surfaces.map((x) => `${x.id}:${x.kind}:${x.real ? 'real' : 'paper'}@${x.center.join(',')}`) } };
  });
}
