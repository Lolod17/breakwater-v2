// PASS 13b — living world probe (Node, no browser). Advances the real clock and
// life support, watches events start/end, accepts/ignores encounters against the
// real wallet, and checks NPC reaction data (gunfire -> flee).
import assert from 'node:assert/strict';
import { SAVE_KEY } from '../game/src/save.js';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

try {
  const Time = await import('../game/src/env/time.js');
  const Life = await import('../game/src/world/life.js');
  const wallet = await import('../game/src/econ/wallet.js');
  const { on } = await import('../game/src/core/events.js');

  const lifeEvents = [], offered = [], resolved = [], money = [];
  on('life:event', (e) => lifeEvents.push(e));
  on('encounter:offered', (e) => offered.push(e));
  on('encounter:resolved', (e) => resolved.push(e));
  on('money:changed', (e) => money.push(e));

  const DUSK = 19 * 60 + 20;
  const ctx = { x: 32.2, z: 150, wanted: 0, driving: false, speed: 0 };
  const chaseSamples = new Map();
  let maxEvents = 0;
  const step = (seconds, dt = 1) => {
    for (let t = 0; t < seconds; t += dt) {
      Time.advance(dt);
      Life.update(dt, ctx);
      const active = Life.activeEvents();
      maxEvents = Math.max(maxEvents, active.length);
      assert.ok(active.length <= 4, 'event cap holds');
      for (const e of active) {
        assert.ok(Life.EVENT_KINDS.includes(e.kind), 'known event kind');
        assert.ok(e.left >= 0 && Number.isFinite(e.left), 'active event has time left');
        if (e.kind === 'police_chase') {
          assert.ok(e.progress >= 0 && e.progress <= 1, 'chase progress in [0,1]');
          if (!chaseSamples.has(e.id)) chaseSamples.set(e.id, []);
          chaseSamples.get(e.id).push({ x: e.x, z: e.z, p: e.progress });
        }
      }
    }
  };
  const starts = () => lifeEvents.filter((e) => e.phase === 'start');
  const ends = () => lifeEvents.filter((e) => e.phase === 'end');
  const runSchedule = (seed, seconds) => {
    Time.restore({ minutes: DUSK });
    Life.init(seed);
    lifeEvents.length = 0; offered.length = 0; resolved.length = 0;
    chaseSamples.clear(); maxEvents = 0;
    step(seconds);
    return starts().map((e) => [e.kind, e.x, e.z, e.hour]);
  };

  // ---- 1. events start and end as time advances (dusk -> next midday) --------
  const RUN = 20000;
  const schedA = runSchedule(1337, RUN);
  assert.equal(wallet.balance(), 250, 'unanswered encounters never pay');
  assert.ok(resolved.every((r) => r.amount === 0), 'expired offers pay nothing');
  const kinds = Life.EVENT_KINDS;
  const started = {}, ended = {};
  for (const k of kinds) {
    started[k] = starts().filter((e) => e.kind === k).length;
    ended[k] = ends().filter((e) => e.kind === k).length;
    assert.ok(started[k] >= 1, `${k} must start within the run`);
    assert.ok(ended[k] >= 1, `${k} must end within the run`);
  }
  const activeNow = Life.activeEvents();
  for (const k of kinds) {
    const still = activeNow.filter((e) => e.kind === k).length;
    assert.ok(ended[k] >= started[k] - still, `${k}: every finished event emitted an end`);
  }
  for (const e of starts()) {
    if (e.kind === 'market_crowd') assert.ok(e.hour >= 7 && e.hour < 19, 'market crowd only by day');
    if (e.kind === 'quiet_streets') assert.ok(e.hour >= 0 && e.hour < 5, 'quiet streets only late at night');
  }
  let chaseMoved = 0;
  for (const samples of chaseSamples.values()) {
    if (samples.length >= 2 && samples.some((s) => s.x !== samples[0].x || s.z !== samples[0].z)) chaseMoved++;
  }
  assert.ok(chaseMoved >= 1, 'a police chase actually passes by (position advances)');
  assert.ok(maxEvents >= 2, 'events overlap');

  // ---- 2. seeded determinism --------------------------------------------------
  const schedB = runSchedule(1337, RUN);
  assert.deepEqual(schedB, schedA, 'same seed gives the same event schedule');
  const schedC = runSchedule(9001, RUN);
  assert.notDeepEqual(schedC, schedA, 'different seed gives a different schedule');

  // ---- 3. encounters: accept pays, ignore does not ----------------------------
  Time.restore({ minutes: DUSK });
  Life.init(1337);
  lifeEvents.length = 0; offered.length = 0; resolved.length = 0; money.length = 0;
  const before = wallet.balance();
  const ride = Life.forceOffer('ride');
  assert.ok(ride && ride.phase === 'offered', 'ride offered');
  assert.equal(offered.length, 1, 'encounter:offered emitted');
  assert.ok(ride.amount >= 25 && ride.amount <= 60, 'fare in range');
  assert.equal(Life.accept(ride.id), true, 'accept succeeds');
  assert.equal(Life.encounterState().phase, 'accepted');
  step(13);
  const rideRes = resolved.find((r) => r.id === ride.id);
  assert.ok(rideRes, 'encounter:resolved emitted');
  assert.equal(rideRes.outcome, 'paid');
  assert.equal(rideRes.amount, ride.amount);
  assert.equal(wallet.balance(), before + ride.amount, 'ride pays through wallet.earn');
  assert.equal(money.at(-1).reason, 'life:ride');
  assert.equal(money.at(-1).delta, ride.amount);

  const b2 = wallet.balance();
  const dropped = Life.forceOffer('wallet');
  assert.equal(Life.ignore(dropped.id), true, 'ignore succeeds');
  assert.equal(wallet.balance(), b2, 'ignoring pays nothing');
  const dropRes = resolved.find((r) => r.id === dropped.id);
  assert.equal(dropRes.outcome, 'ignored');
  assert.equal(dropRes.amount, 0);

  const b3 = wallet.balance();
  const stale = Life.forceOffer('ride');
  step(31);
  assert.equal(resolved.find((r) => r.id === stale.id).outcome, 'expired', 'unanswered offer expires');
  assert.equal(wallet.balance(), b3, 'expiry pays nothing');

  // ---- 4. mugging: faction rep up, persisted, routed when factions attaches ---
  const mug = Life.forceOffer('mugging');
  const repBefore = Life.factionRep()[mug.faction] ?? 0;
  assert.equal(Life.accept(mug.id), true);
  const mugRes = resolved.find((r) => r.id === mug.id);
  assert.equal(mugRes.outcome, 'stopped');
  assert.equal(mugRes.rep, 10);
  assert.equal(Life.factionRep()[mug.faction], repBefore + 10, 'stopping a mugging raises faction rep');
  assert.equal(wallet.balance(), b3, 'mugging pays no money');
  const saved = JSON.parse(store.get(SAVE_KEY));
  assert.equal(saved.factions[mug.faction], repBefore + 10, 'rep persists in the save factions section');
  const calls = [];
  Life.attachFactions({ adjust: (f, d) => calls.push({ f, d }) });
  const mug2 = Life.forceOffer('mugging');
  Life.accept(mug2.id);
  assert.deepEqual(calls, [{ f: mug2.faction, d: 10 }], 'rep routes through the factions module when present');
  Life.attachFactions(null);

  // ---- 5. NPC reactions as data -----------------------------------------------
  Time.restore({ minutes: DUSK });
  Life.init(1337);
  Object.assign(ctx, { x: 32.2, z: 150, wanted: 0, driving: false, speed: 0 });
  Life.update(0.1, ctx);
  const near = { x: ctx.x + 6, z: ctx.z + 2 };
  const far = { x: ctx.x + 120, z: ctx.z + 120 };
  assert.equal(Life.reactionFor(near, Life.playerState()).kind, 'none', 'calm street: no reaction');
  Life.reportGunfire(ctx.x, ctx.z);
  const shotState = Life.playerState();
  const flee = Life.reactionFor(near, shotState);
  assert.equal(flee.kind, 'flee', 'gunfire makes nearby NPCs flee');
  assert.ok(Math.abs(Math.hypot(flee.x, flee.z) - 1) < 1e-6, 'flee direction is a unit vector');
  assert.ok(flee.x * 6 + flee.z * 2 > 0, 'flee points away from the gunfire');
  assert.equal(Life.reactionFor(far, shotState).kind, 'none', 'distant NPCs unaffected');
  step(5);
  assert.equal(Life.reactionFor(near, Life.playerState()).kind, 'none', 'gunfire reaction expires');
  Life.reportCrash(ctx.x, ctx.z);
  assert.equal(Life.reactionFor(near, Life.playerState()).kind, 'flee', 'a crash makes nearby NPCs flee');
  step(4);
  assert.equal(Life.reactionFor(near, Life.playerState()).kind, 'none');
  ctx.wanted = 4; Life.update(0.1, ctx);
  const avoid = Life.reactionFor(near, Life.playerState());
  assert.equal(avoid.kind, 'avoid', 'high wanted level: NPCs keep distance');
  assert.ok(avoid.x * 6 + avoid.z * 2 > 0, 'avoid points away from the player');
  assert.equal(Life.reactionFor(far, Life.playerState()).kind, 'none');
  ctx.wanted = 0; Life.update(0.1, ctx);

  const spot = { x: 0, z: 180 };                       // dockside district
  const greetMug = Life.forceOffer('mugging', spot);
  assert.equal(greetMug.faction, 'dockers');
  Life.accept(greetMug.id);
  Object.assign(ctx, { x: spot.x, z: spot.z, wanted: 0, driving: false, speed: 0 });
  Life.update(0.1, ctx);
  assert.equal(Life.reactionFor({ x: spot.x + 3, z: spot.z + 2 }, Life.playerState()).kind, 'greet', 'friendly district greets');
  ctx.driving = true; Life.update(0.1, ctx);
  assert.equal(Life.reactionFor({ x: spot.x + 3, z: spot.z + 2 }, Life.playerState()).kind, 'none', 'no greeting from a speeding car');
  Object.assign(ctx, { x: 0, z: -100, driving: false }); Life.update(0.1, ctx);   // northside, rep 0
  assert.equal(Life.reactionFor({ x: 2, z: -98 }, Life.playerState()).kind, 'none', 'unfriendly district does not greet');

  console.log(JSON.stringify({
    runSeconds: RUN,
    events: Object.fromEntries(kinds.map((k) => [k, { started: started[k], ended: ended[k] }])),
    maxConcurrent: maxEvents, chasesPassed: chaseMoved,
    deterministic: true, differentSeedDiffers: true,
    ride: { fare: ride.amount, outcome: rideRes.outcome, balanceAfter: before + ride.amount },
    ignoredPaid: 0, expiredPaid: 0,
    mugging: { faction: mug.faction, rep: Life.factionRep()[mug.faction], routed: calls.length === 1 },
    reactions: { gunfire: 'flee', crash: 'flee', wanted: 'avoid', friendly: 'greet' },
    pass: true,
  }));
  process.exit(0);
} catch (e) {
  console.error(JSON.stringify({ pass: false, failed: e.message }));
  process.exit(1);
}
