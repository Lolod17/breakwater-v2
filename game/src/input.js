// Keyboard + mouse state. Pointer lock gives free-look; without it, dragging
// with the left button orbits. A "virtual" override lets tools drive the player.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.taps = new Set();   // key presses not yet consumed by the fixed step
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.dragging = false;
    this.locked = false;
    this.buttons = new Set();
    this.lastLookTime = -1e9;
    this.virtual = null; // { x, y, sprint, walk, jump }

    addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.taps.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.dragging = true;
      this.buttons.add(e.button);
    });
    addEventListener('mouseup', (e) => { this.buttons.delete(e.button); this.dragging = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (this.locked || this.dragging || this.buttons.has(2)) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
        this.lastLookTime = performance.now();
      }
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.buttons.clear();
    });
  }

  requestLock() {
    if (this.canvas.requestPointerLock) {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  }

  down(code) { return this.keys.has(code); }

  // Movement intent in input space: x = strafe right, y = forward.
  move() {
    if (this.virtual) return { x: this.virtual.x || 0, y: this.virtual.y || 0 };
    let x = 0, y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }
  sprint() { return this.virtual ? !!this.virtual.sprint : this.down('ShiftLeft') || this.down('ShiftRight'); }
  // PASS 14b: C is the crouch toggle now (stealth.js); Alt / Ctrl still walk
  walk() { return this.virtual ? !!this.virtual.walk : this.down('AltLeft') || this.down('ControlLeft'); }
  jump() { return this.virtual ? !!this.virtual.jump : this.down('Space'); }

  // Edge-triggered press: true once per physical key press.
  tap(...codes) {
    let hit = false;
    for (const c of codes) if (this.taps.delete(c)) hit = true;
    return hit;
  }
  clearTaps() { this.taps.clear(); }

  // Driving controls: throttle, brake/reverse, steer (+ = right), handbrake, horn.
  drive() {
    const k = (c) => this.keys.has(c);
    return {
      throttle: k('KeyW') || k('ArrowUp') ? 1 : 0,
      brake: k('KeyS') || k('ArrowDown') ? 1 : 0,
      steer: (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0),
      handbrake: k('Space'),
      horn: k('KeyH'),
    };
  }

  consumeLook() {
    const d = { x: this.mouseDX, y: this.mouseDY, wheel: this.wheel };
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
    return d;
  }
}
