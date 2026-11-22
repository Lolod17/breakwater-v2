// PASS 7: title screen. The live city renders behind it (main.js drives a slow
// cinematic camera and sends a car past); this module owns the menu: rows that
// share one focus state for mouse and keyboard (Up/Down or W/S, Enter/Space),
// Continue only when a save exists, and the fade into play.
const $ = (id) => document.getElementById(id);

// Camera drift: a slow dolly between two poses on the avenue (eased ping-pong,
// period 48 s) with a small breathing sway on top. t: seconds on the title.
const DRIFT = {
  period: 48,
  // the waterfront promenade looking west into the sunset: harbour on the left
  // (under the menu), the waterfront street and lit blocks on the right
  from: { eye: [106.0, 6.6, 203.4], look: [-4.0, 4.6, 224.0] },
  to: { eye: [93.0, 5.9, 203.7], look: [-14.0, 5.3, 221.0] },
  fov: 52,
};

export function titleCamera(camera, t) {
  const u = 0.5 - 0.5 * Math.cos((t / DRIFT.period) * Math.PI * 2);
  const mix = (a, b) => a.map((v, i) => v + (b[i] - v) * u);
  const e = mix(DRIFT.from.eye, DRIFT.to.eye), l = mix(DRIFT.from.look, DRIFT.to.look);
  e[1] += Math.sin(t * 0.37) * 0.08;
  l[0] += Math.sin(t * 0.23) * 0.35;
  camera.position.set(e[0], e[1], e[2]);
  camera.lookAt(l[0], l[1], l[2]);
  if (camera.fov !== DRIFT.fov) { camera.fov = DRIFT.fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
  return l;
}

export class Title {
  constructor({ gesture } = {}) {
    this.root = $('start');
    this.rows = [$('continue'), $('play')];
    this.active = false;
    this.focused = null;
    this.gesture = gesture;
    for (const r of this.rows) {
      r.addEventListener('mouseenter', () => this.focus(r));
      r.addEventListener('focus', () => this.focus(r));
      r.addEventListener('blur', () => { if (this.focused === r) r.classList.remove('is-focus'); this.focused = null; });
    }
    // capture phase: menu keys never reach the game's input while the title is up
    addEventListener('keydown', (e) => this.key(e), true);
  }
  visibleRows() { return this.rows.filter((r) => !r.hidden && !r.disabled); }
  focus(row) {
    if (!row) return;
    for (const r of this.rows) r.classList.toggle('is-focus', r === row);
    this.focused = row;
    if (document.activeElement !== row) row.focus({ preventScroll: true });
  }
  move(step) {
    const rows = this.visibleRows();
    if (!rows.length) return;
    const i = rows.indexOf(this.focused);
    this.focus(rows[i < 0 ? 0 : (i + step + rows.length) % rows.length]);
  }
  key(e) {
    if (!this.active) return;
    const c = e.code;
    if (c === 'F3') return;                      // perf readout stays available
    if (c === 'ArrowDown' || c === 'KeyS' || (c === 'Tab' && !e.shiftKey)) this.move(1);
    else if (c === 'ArrowUp' || c === 'KeyW' || (c === 'Tab' && e.shiftKey)) this.move(-1);
    else if (c === 'Enter' || c === 'NumpadEnter' || c === 'Space') {
      if (!e.repeat && this.focused) { this.gesture?.(); this.focused.click(); }
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  show() {
    this.active = true;
    document.body.classList.add('title-on');
    this.root.classList.remove('leaving');
    this.root.hidden = false;
    // Continue first when there is a save to continue, else Start
    this.focus(this.visibleRows()[0]);
  }
  hide() {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove('title-on');
    for (const r of this.rows) r.classList.remove('is-focus');
    this.focused = null;
    document.activeElement?.blur?.();
    this.root.hidden = true;          // at once: the HUD fades in over the first half second of play
  }
  state() {
    return { active: this.active, hidden: this.root.hidden, focused: this.focused?.id ?? null,
      rows: this.rows.map((r) => ({ id: r.id, visible: !r.hidden, text: r.textContent.replace(/\s+/g, ' ').trim(), focus: r.classList.contains('is-focus') })) };
  }
}
