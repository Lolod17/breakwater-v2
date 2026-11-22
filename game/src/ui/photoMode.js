// PASS 15b: photo mode. P freezes the simulation (main.js stops stepping it and
// suspends the audio clock) and detaches a free-fly camera from the game camera:
//   WASD fly · Space / E up · Q / Ctrl down · Shift fast · Alt slow
//   mouse (locked or dragged) or arrow keys look · Z / C roll · X level the horizon
//   wheel or - / = field of view · [ / ] depth of field · , / . focus (F = auto, on the player)
//   1-4 or T filter (neutral, noir, warm film, neon) · H hide the panel · Enter save a PNG · P / Esc leave
// The game HUD is hidden for the whole session. Leaving restores the render
// camera's pose and FOV; the simulation was never stepped, so the player, the
// traffic and the clock are exactly where they were.
import * as THREE from '../../vendor/three.min.js';

export const FILTERS = ['neutral', 'noir', 'warm film', 'neon'];
const RANGE = 60;          // the free camera stays within this many metres (horizontal) of where photo mode began
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _p = new THREE.Vector3();

export class PhotoMode {
  constructor({ ground }) {
    this.ground = ground;
    this.active = false;
    this.pos = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.fov = 60; this.dof = 0.35; this.focus = 0;     // focus 0 = auto (distance to the subject)
    this.filter = 0;
    this.uiHidden = false;
    this.anchor = new THREE.Vector3();                   // where photo mode began (camera leash centre)
    this.subject = new THREE.Vector3();                  // the player or their car (auto focus)
    this.saved = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 60 };
    this.shotPending = false;
    this.shots = 0;
    this.lastShot = null;
    this.el = { panel: $('photo'), fov: $('photo-fov'), dof: $('photo-dof'), focus: $('photo-focus'), fovV: $('photo-fov-v'), dofV: $('photo-dof-v'),
      focusV: $('photo-focus-v'), filters: [...document.querySelectorAll('#photo-filters button')], flash: $('photo-flash'), note: $('photo-note') };
    const e = this.el;
    // sliders: usable with the mouse when the pointer is free; they give focus back to the page at once
    const bind = (el, fn) => { el.addEventListener('input', () => { fn(Number(el.value)); this.sync(); }); el.addEventListener('change', () => el.blur()); };
    bind(e.fov, (v) => { this.fov = v; });
    bind(e.dof, (v) => { this.dof = v / 100; });
    bind(e.focus, (v) => { this.focus = v; });
    e.filters.forEach((b, i) => b.addEventListener('click', (ev) => { ev.stopPropagation(); this.setFilter(i); b.blur(); }));
  }

  enter(camera, subject) {
    if (this.active) return false;
    this.active = true;
    this.saved.pos.copy(camera.position); this.saved.quat.copy(camera.quaternion); this.saved.fov = camera.fov;
    this.pos.copy(camera.position);
    _e.setFromQuaternion(camera.quaternion, 'YXZ');
    this.yaw = _e.y; this.pitch = _e.x; this.roll = 0;
    this.fov = camera.fov;
    this.anchor.copy(camera.position);
    this.subject.copy(subject);
    this.uiHidden = false;
    this.shotPending = false;
    document.body.classList.add('photo-on');
    document.body.classList.remove('photo-clean');
    this.el.panel.hidden = false;
    this.flash('enter');
    this.sync();
    return true;
  }
  exit(camera) {
    if (!this.active) return false;
    this.active = false;
    camera.position.copy(this.saved.pos); camera.quaternion.copy(this.saved.quat);
    camera.fov = this.saved.fov; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    document.body.classList.remove('photo-on', 'photo-clean');
    this.el.panel.hidden = true;
    return true;
  }
  setFilter(i) { this.filter = ((i % FILTERS.length) + FILTERS.length) % FILTERS.length; this.sync(); }
  setUiHidden(on) { this.uiHidden = !!on; document.body.classList.toggle('photo-clean', this.uiHidden); }

  // Edge-triggered keys, once per fixed step. Returns 'exit' when the player leaves.
  step(input) {
    if (input.tap('KeyP', 'Escape', 'Backspace')) return 'exit';
    for (let i = 0; i < 4; i++) if (input.tap(`Digit${i + 1}`, `Numpad${i + 1}`)) this.setFilter(i);
    if (input.tap('KeyT')) this.setFilter(this.filter + 1);
    if (input.tap('KeyH')) this.setUiHidden(!this.uiHidden);
    if (input.tap('KeyX')) this.roll = 0;
    if (input.tap('KeyF')) { this.focus = 0; this.sync(); }
    if (input.tap('Enter', 'NumpadEnter', 'KeyK')) this.shotPending = true;
    return null;
  }

  // Every rendered frame: fly and aim the render camera (real time, so it is smooth at any frame rate).
  frame(camera, dt, look, input) {
    dt = Math.min(dt, 0.1);
    const k = (c) => input.down(c);
    const zoom = this.fov / 60;
    this.yaw -= look.x * 0.0022 * zoom; this.pitch -= look.y * 0.0022 * zoom;
    const turn = 1.3 * zoom * dt;
    if (k('ArrowLeft')) this.yaw += turn;
    if (k('ArrowRight')) this.yaw -= turn;
    if (k('ArrowUp')) this.pitch += turn;
    if (k('ArrowDown')) this.pitch -= turn;
    this.pitch = clamp(this.pitch, -1.5, 1.5);
    if (k('KeyZ')) this.roll += 0.9 * dt;
    if (k('KeyC')) this.roll -= 0.9 * dt;
    this.roll = clamp(this.roll, -1.2, 1.2);
    let fov = this.fov + look.wheel * 3;
    if (k('Minus') || k('NumpadSubtract')) fov -= 30 * dt;
    if (k('Equal') || k('NumpadAdd')) fov += 30 * dt;
    this.fov = clamp(fov, 15, 100);
    if (k('BracketLeft')) this.dof = clamp(this.dof - 0.6 * dt, 0, 1);
    if (k('BracketRight')) this.dof = clamp(this.dof + 0.6 * dt, 0, 1);
    if (k('Comma') || k('Period')) {
      const f = this.focus || this.autoFocus();
      this.focus = clamp(f * (1 + (k('Period') ? 1.2 : -1.2) * dt), 0.5, 300);
    }
    // fly: W/S along the view, A/D strafe, Space/E and Q/Ctrl straight up and down
    const speed = 7 * (k('ShiftLeft') || k('ShiftRight') ? 3.5 : 1) * (k('AltLeft') || k('AltRight') ? 0.25 : 1) * dt;
    _f.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0), side = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    const up = (k('Space') || k('KeyE') ? 1 : 0) - (k('KeyQ') || k('ControlLeft') || k('ControlRight') ? 1 : 0);
    this.pos.addScaledVector(_f, fwd * speed).addScaledVector(_r, side * speed);
    this.pos.y += up * speed;
    // leash: a short way round the scene, never under the ground
    const dx = this.pos.x - this.anchor.x, dz = this.pos.z - this.anchor.z, d = Math.hypot(dx, dz);
    if (d > RANGE) { this.pos.x = this.anchor.x + dx / d * RANGE; this.pos.z = this.anchor.z + dz / d * RANGE; }
    this.pos.y = clamp(this.pos.y, this.ground(this.pos.x, this.pos.z) + 0.25, this.anchor.y + 45);
    camera.position.copy(this.pos);
    camera.quaternion.setFromEuler(_e.set(this.pitch, this.yaw, this.roll, 'YXZ'));
    if (camera.fov !== this.fov) { camera.fov = this.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    if ((this._syncT = (this._syncT ?? 0) + dt) > 0.1) { this._syncT = 0; this.sync(); }
  }
  autoFocus() { return Math.max(0.5, this.pos.distanceTo(this.subject)); }
  // Post-pass parameters for this frame. Auto focus hands the shader the subject's
  // screen position (it reads the depth there); off screen it falls back to the distance.
  params(camera) {
    let focusUV = null;
    if (!this.focus && camera) {
      _p.copy(this.subject).y += 0.9;
      _p.project(camera);
      if (Math.abs(_p.x) < 0.98 && Math.abs(_p.y) < 0.98 && _p.z < 1) focusUV = [_p.x * 0.5 + 0.5, _p.y * 0.5 + 0.5];
    }
    return { focus: this.focus || this.autoFocus(), focusUV, strength: this.dof, filter: this.filter };
  }

  // Called right after the frame is drawn (same task), so the drawing buffer still holds it.
  capture(canvas) {
    this.shotPending = false;
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const name = `breakwater-photo-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${++this.shots}.png`;
    const shot = { name, width: canvas.width, height: canvas.height, filter: FILTERS[this.filter], bytes: 0, saved: false };
    this.lastShot = shot;
    canvas.toBlob((blob) => {
      if (!blob) { shot.error = 'encode failed'; return; }
      shot.bytes = blob.size;
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; a.style.display = 'none';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      shot.saved = true;
      if (this.el.note) this.el.note.textContent = `Saved ${name}`;
    }, 'image/png');
    this.flash('shot');
  }
  flash(kind) {
    const f = this.el.flash;
    if (!f) return;
    f.className = '';
    void f.offsetWidth;
    f.className = kind === 'shot' ? 'shot' : 'enter';
  }

  // Panel readouts (cheap: only when shown values change).
  sync() {
    const e = this.el, f = Math.round(this.fov), dof = Math.round(this.dof * 100), focus = this.focus ? `${this.focus.toFixed(1)} m` : `AUTO ${this.autoFocus().toFixed(1)} m`;
    const key = `${f}|${dof}|${focus}|${this.filter}`;
    if (key === this._key) return;
    this._key = key;
    if (document.activeElement !== e.fov) e.fov.value = f;
    if (document.activeElement !== e.dof) e.dof.value = dof;
    if (document.activeElement !== e.focus) e.focus.value = Math.round(this.focus);
    e.fovV.textContent = `${f}°`; e.dofV.textContent = `${dof}%`; e.focusV.textContent = focus;
    e.filters.forEach((b, i) => b.classList.toggle('on', i === this.filter));
  }
  state() {
    return { active: this.active, filter: FILTERS[this.filter], filterIndex: this.filter, fov: +this.fov.toFixed(2), dof: +this.dof.toFixed(3),
      focus: this.focus ? +this.focus.toFixed(2) : 'auto', focusDistance: +this.params().focus.toFixed(2), uiHidden: this.uiHidden,
      camera: { x: +this.pos.x.toFixed(3), y: +this.pos.y.toFixed(3), z: +this.pos.z.toFixed(3), yaw: +this.yaw.toFixed(4), pitch: +this.pitch.toFixed(4), roll: +this.roll.toFixed(4) },
      shots: this.shots, lastShot: this.lastShot && { ...this.lastShot } };
  }
}
