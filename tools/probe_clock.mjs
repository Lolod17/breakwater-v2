import assert from 'node:assert/strict';
import { advance, hour, minutes, dayNumber, totalMinutes, serialize, restore, reset } from '../game/src/env/time.js';

try {
  const before = { hour: hour(), minutes: minutes(), day: dayNumber() };
  assert.equal(before.hour, 19, 'clock must start at dusk 19:20');
  assert.equal(before.minutes, 20, 'clock must start at dusk 19:20');
  assert.equal(before.day, 1, 'clock starts on day 1');

  // 20 real seconds per game minute: one minute of play is 3 game minutes
  advance(60);
  assert.equal(totalMinutes(), 19 * 60 + 23, '60 s of play = 3 game minutes');
  advance(-60);

  advance(6 * 60 * 20);
  const after = { hour: hour(), minutes: minutes(), day: dayNumber() };
  assert.notEqual(after.hour, before.hour, 'hour must change after advancing 6 hours');
  assert.equal(after.hour, 1, '19:20 + 6h = 01:20');
  assert.equal(after.minutes, 20, 'minute component must be preserved');
  assert.equal(after.day, 2, 'passing midnight starts day 2');

  // a full day later: same time, day 3
  advance(24 * 60 * 20);
  assert.deepEqual([hour(), minutes(), dayNumber()], [1, 20, 3], 'a full day returns to the same time, next day');

  // bad input is ignored
  const t0 = totalMinutes();
  advance(NaN); advance(Infinity);
  assert.equal(totalMinutes(), t0, 'non-finite advance is ignored');

  // save round trip
  const snap = serialize();
  assert.deepEqual(snap, { minutes: t0, day: 3 }, 'serialize carries minutes and day');
  reset();
  assert.deepEqual([hour(), minutes(), dayNumber()], [19, 20, 1], 'reset returns to the dusk start');
  restore(snap);
  assert.deepEqual([totalMinutes(), dayNumber()], [t0, 3], 'restore brings the saved clock back');
  restore({ minutes: 600 });
  assert.equal(dayNumber(), 1, 'an old save without a day restores day 1');

  console.log(JSON.stringify({ before, after, advancedSeconds: 6 * 60 * 20, dayAfterRollover: 2, roundTrip: true, pass: true }));
  process.exit(0);
} catch (e) {
  console.error(JSON.stringify({ pass: false, failed: e.message }));
  process.exit(1);
}
