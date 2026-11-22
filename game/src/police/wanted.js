import { emit } from '../core/events.js';

const THRESHOLDS = [0, 0.01, 20, 45, 70, 95];
const HEAT = { collision: 5, pedestrian: 19, shot: 4, cruiser: 24, assault: 8 };

export class Wanted {
  constructor() { this.reset(); }

  reset() {
    this.heat = 0;
    this.unseen = 0;
    this.report = null;
    this.cooldowns = {};
  }

  get level() {
    for (let i = 5; i > 0; i--) if (this.heat >= THRESHOLDS[i]) return i;
    return 0;
  }

  force(level, position) {
    const from = this.level;
    this.reset();
    this.heat = THRESHOLDS[level] + (level ? 1 : 0);
    if (level) this.report = { x: position.x, z: position.z };
    if (this.level > from) emit('wanted:changed', { level: this.level, from, x: position.x, z: position.z, cause: 'forced' });
  }

  crime(kind, position, time) {
    if (kind !== 'shot' && time < (this.cooldowns[kind] ?? 0)) return;
    this.cooldowns[kind] = time + 1.1;
    const from = this.level;
    this.heat = Math.min(100, this.heat + HEAT[kind]);
    this.unseen = 0;
    this.report = { x: position.x, z: position.z };
    if (this.level > from) emit('wanted:changed', { level: this.level, from, x: position.x, z: position.z, cause: kind });
  }

  // PASS 14b: one star off (a disguise change while out of sight). The heat drops
  // to the bottom of the next level down; from one star the record clears.
  dropStar(position) {
    const from = this.level;
    if (!from) return false;
    if (from === 1) this.reset();
    else { this.heat = THRESHOLDS[from - 1]; this.unseen = 0; }
    emit('wanted:changed', { level: this.level, from, x: position.x, z: position.z, cause: 'disguise' });
    return true;
  }

  update(dt, seen) {
    if (!this.heat) return;
    this.unseen = seen ? 0 : this.unseen + dt;
    if (this.unseen > 9) this.heat = Math.max(0, this.heat - dt * 4);
    if (!this.level) this.reset();
  }
}
