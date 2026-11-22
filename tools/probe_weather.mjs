import assert from 'node:assert/strict';

try {
  const Time = await import('../game/src/env/time.js');
  const Weather = await import('../game/src/env/weather.js');
  const { on } = await import('../game/src/core/events.js');

  const STATES = ['clear', 'overcast', 'rain', 'fog'];
  const sum = (w) => STATES.reduce((a, s) => a + w[s], 0);
  const checkWeights = (w) => {
    for (const s of STATES) assert.ok(Number.isFinite(w[s]) && w[s] >= 0 && w[s] <= 1, `weight ${s} in [0,1]`);
    assert.ok(Math.abs(sum(w) - 1) < 1e-6, `weights sum to 1 (got ${sum(w)})`);
  };
  const step = (seconds, dt = 1) => {
    for (let t = 0; t < seconds; t += dt) { Time.advance(dt); Weather.update(dt); }
  };

  Weather.init(1337);
  assert.equal(Weather.current(), 'clear', 'starts clear');
  assert.equal(Weather.wetness(), 0, 'starts dry');
  checkWeights(Weather.weights());

  const events = [];
  on('weather:changed', (p) => events.push(p));
  let transitions = 0;
  const stepped = (seconds) => {
    for (let t = 0; t < seconds; t++) {
      const before = Weather.current();
      Time.advance(1); Weather.update(1);
      if (Weather.current() !== before) transitions++;
      checkWeights(Weather.weights());
    }
  };

  Weather.set('rain');
  stepped(90);
  const rainWetness = Weather.wetness();
  assert.ok(rainWetness > 0.5, `wetness rises during rain (got ${rainWetness})`);
  assert.equal(Weather.current(), 'rain', 'rain becomes dominant');
  assert.ok(Weather.weights().rain > 0.9, 'rain weight blends up');
  assert.equal(events.length, transitions, 'one event per dominant change');
  assert.deepEqual(events[0], { state: 'rain', from: 'clear' }, 'event carries state and from');

  Weather.set('clear');
  stepped(120);
  const driedWetness = Weather.wetness();
  assert.ok(driedWetness < rainWetness, `wetness dries after rain (${rainWetness} -> ${driedWetness})`);
  assert.equal(Weather.current(), 'clear', 'clear becomes dominant again');
  assert.equal(events.length, transitions, 'no spurious events while dominant holds');

  const goalBefore = Weather.target();
  assert.equal(Weather.set('storm'), false, 'unknown state rejected');
  assert.deepEqual(Weather.target(), goalBefore, 'rejected set leaves target alone');

  Weather.set('overcast');
  let last = Weather.weights().overcast;
  for (let i = 0; i < 12; i++) {
    step(1);
    const w = Weather.weights().overcast;
    assert.ok(w > last, 'weights blend smoothly toward the target');
    last = w;
  }

  const HOUR_SECONDS = 60 * 20;
  const run = (seed) => {
    Weather.init(seed);
    const seq = [];
    let prev = null;
    for (let t = 0; t < 48 * HOUR_SECONDS; t++) {
      Time.advance(1); Weather.update(1);
      const g = Weather.target();
      checkWeights(Weather.weights());
      const wet = Weather.wetness();
      assert.ok(wet >= 0 && wet <= 1, 'wetness stays in [0,1]');
      const state = STATES.find((s) => g[s] === 1);
      if (state !== prev) { seq.push({ at: t, state }); prev = state; }
    }
    return seq;
  };

  const a = run(1337);
  const b = run(1337);
  const c = run(9001);
  assert.ok(a.length >= 10, `schedule changes every few in-game hours (got ${a.length - 1} changes in 48h)`);
  assert.ok(a[1].at >= 2 * HOUR_SECONDS - 20, 'first change is at least 2 in-game hours in');
  assert.deepEqual(b.map((e) => e.state), a.map((e) => e.state), 'same seed gives the same schedule');
  assert.notDeepEqual(c.map((e) => e.state), a.map((e) => e.state), 'different seed gives a different schedule');

  // save round trip: a restored weather (with the restored clock) continues the exact same schedule
  Weather.init(4242);
  for (let t = 0; t < 7 * HOUR_SECONDS; t++) { Time.advance(1); Weather.update(1); }
  const snapW = Weather.serialize(), snapT = Time.serialize();
  const tail = () => { const seq = []; for (let t = 0; t < 30 * HOUR_SECONDS; t += 5) { Time.advance(5); Weather.update(5); seq.push(Weather.current()); } return seq; };
  const first = tail();
  Weather.init(1); Time.reset();
  Time.restore(snapT); Weather.restore(JSON.parse(JSON.stringify(snapW)));
  assert.deepEqual(tail(), first, 'restored weather continues the same schedule');
  assert.ok(new Set(first).size >= 2, 'the continued schedule actually changes weather');

  console.log(JSON.stringify({ pass: true, roundTrip: true, rainWetness: +rainWetness.toFixed(3), driedWetness: +driedWetness.toFixed(3),
    events: events.length, scheduleChanges: a.length - 1, firstChangeAt: a[1].at }));
  process.exit(0);
} catch (e) {
  console.error(JSON.stringify({ pass: false, failed: e.message }));
  process.exit(1);
}
