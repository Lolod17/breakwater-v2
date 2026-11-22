// PASS 14b: weapon wheel logic. Hold Tab on foot to open it: the simulation
// runs at 20 % speed, the mouse (or 1-9 / the scroll wheel) picks a sector
// among the weapons held right now, and letting go of Tab equips the pick.
// Pure state; hud.js draws it, main.js feeds input and the time scale.
import * as Weapons from './weapons.js';

export const WHEEL_KEY = 'Tab';
export const WHEEL_TIME_SCALE = 0.2;
const DEADZONE = 18;       // px of mouse travel before the pointer picks a sector

export class WeaponWheel {
  constructor() { this.reset(); }

  reset() {
    this.open = false;
    this.options = [];
    this.hover = -1;
    this.px = this.py = 0;
  }

  get timeScale() { return this.open ? WHEEL_TIME_SCALE : 1; }

  show() {
    if (this.open) return;
    this.open = true;
    this.options = Weapons.held();
    this.hover = Math.max(0, this.options.indexOf(Weapons.equipped().id));
    this.px = this.py = 0;
  }

  // Mouse travel picks the sector the pointer points at (sector 0 at the top, clockwise).
  point(dx, dy) {
    if (!this.open || !this.options.length) return;
    this.px += dx; this.py += dy;
    const r = Math.hypot(this.px, this.py);
    if (r < DEADZONE) return;
    if (r > 120) { this.px *= 120 / r; this.py *= 120 / r; }
    const a = (Math.atan2(this.px, -this.py) + Math.PI * 2) % (Math.PI * 2);
    const n = this.options.length;
    this.hover = Math.round(a / (Math.PI * 2 / n)) % n;
  }

  step(dir) {
    if (!this.open || !this.options.length) return;
    const n = this.options.length;
    this.hover = ((this.hover + Math.sign(dir)) % n + n) % n;
  }

  // Highlight a weapon by id (tools, number keys). False if it is not on the wheel.
  select(id) {
    const i = this.options.indexOf(id);
    if (!this.open || i < 0) return false;
    this.hover = i;
    return true;
  }

  // Release: equip the highlighted weapon (Weapons.equip refuses anything not held).
  close() {
    if (!this.open) return null;
    const id = this.options[this.hover] ?? null;
    const ok = id !== null && Weapons.equip(id);
    this.reset();
    return ok ? id : null;
  }

  state() {
    return { open: this.open, options: this.options.slice(), hover: this.hover,
      highlighted: this.options[this.hover] ?? null, timeScale: this.timeScale, equipped: Weapons.equipped().id };
  }
}
