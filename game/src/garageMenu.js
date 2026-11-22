// PASS 10c: BREAKWATER CUSTOMS, the garage at the waterfront door door-3-4-0-0
// (south side of the z = 120 street, x 63). There is no garage interior, so the
// shop is a roller door, a neon sign and a turntable in the kerb lane outside it.
// Drive a car onto the bay, stop, press G: the simulation pauses, the car rides
// the turntable under a fixed camera and the menu lists the eight categories.
// Browsing previews an option on the car; Enter buys it through garage.customise
// (which pays with wallet.spend); leaving puts the car back as installed.
// The site is two meshes (a vertex-coloured shell and the sign), drawn only in view.
import * as THREE from '../vendor/three.min.js';
import * as Garage from './econ/garage.js';
import { CATEGORIES, rowOptions } from './econ/customs.js';
import { applyRecord } from './vehicles/customParts.js';

export const SITE = { x: 63.1, z: 122.6, doorZ: 130, bayZ: 124.85, bayYaw: Math.PI / 2, radius: 4.6 };
const SPIN = 0.32;            // turntable rad/s
const HIDE_R = 7.5;           // other cars this close to the turntable are not drawn while the menu is up

function siteGeometry() {
  const pos = [], nor = [], col = [];
  const unit = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const add = (g, hex) => {
    c.set(hex);
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    for (let i = 0; i < P.length; i += 3) { pos.push(P[i], P[i + 1], P[i + 2]); nor.push(N[i], N[i + 1], N[i + 2]); col.push(c.r, c.g, c.b); }
  };
  const box = (x, y, z, w, h, d, hex) => add(unit.clone().applyMatrix4(m.makeScale(w, h, d).setPosition(x, y, z)), hex);
  const { x, doorZ: dz } = SITE;
  // roller door: frame, slats, a lit threshold
  box(x, 1.7, dz - 0.12, 6.0, 3.6, 0.2, '#1a1b1e');
  for (let i = 0; i < 16; i++) box(x, 0.12 + i * 0.2, dz - 0.24, 5.2, 0.16, 0.06, i % 2 ? '#7d838b' : '#9aa1a9');
  box(x, 3.25, dz - 0.32, 5.6, 0.22, 0.22, '#2a2c30');
  for (const s of [-1, 1]) box(x + s * 2.75, 1.6, dz - 0.3, 0.2, 3.3, 0.2, '#ffb000');
  box(x, 0.16, dz - 1.4, 6.0, 0.02, 2.6, '#2b2d31');
  // turntable on the road: a dark disc with a bright rim and lane stripes either side
  const disc = new THREE.CylinderGeometry(3.05, 3.05, 0.035, 40, 1, false);
  add(disc.toNonIndexed().applyMatrix4(m.makeTranslation(SITE.x, 0.018, SITE.z)), '#2a2c32');
  const rim = new THREE.CylinderGeometry(3.2, 3.2, 0.03, 40, 1, true);
  add(rim.toNonIndexed().applyMatrix4(m.makeTranslation(SITE.x, 0.02, SITE.z)), '#ffb000');
  for (let i = 0; i < 6; i++) box(x - 4.4 - i * 0.9, 0.012, SITE.bayZ - 0.1, 0.45, 0.01, 0.16, '#ffb000');
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

function signTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#07080b'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#ffb000'; g.lineWidth = 6; g.strokeRect(8, 8, 496, 112);
  g.font = '800 58px Futura, "Arial Black", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#3fe0d0'; g.shadowBlur = 18; g.fillStyle = '#bff8f2';
  g.fillText('CUSTOMS', 256, 58);
  g.shadowBlur = 0; g.font = '700 20px Futura, Arial, sans-serif'; g.fillStyle = '#ffb000';
  g.fillText('BREAKWATER  ·  PAINT  ·  WHEELS  ·  AERO', 256, 103);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const $el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

export class GarageMenu {
  // hooks: { ground(x, z), balance(), syncWallet(), afterPurchase(record, vehicle), adoptCar(vehicle), leave(vehicle) }
  constructor(scene, lm, hooks) {
    this.hooks = hooks;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
    if (lm) lm.patch(mat, { mode: 'wall', push: 0.2, fall: 0.25 });
    this.shell = new THREE.Mesh(siteGeometry(), mat);
    this.shell.name = 'garage-site'; this.shell.receiveShadow = true; this.shell.castShadow = true;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.4), new THREE.MeshBasicMaterial({ map: signTexture(), color: new THREE.Color(2.2, 2.2, 2.2), fog: true }));
    sign.position.set(SITE.x, 4.25, SITE.doorZ - 0.36); sign.rotation.y = Math.PI;
    sign.name = 'garage-sign';
    scene.add(this.shell, sign);
    this.sign = sign;

    this.open = false;
    this.vehicle = null; this.record = null;
    this.rows = CATEGORIES.flatMap((c) => c.rows.map((r) => ({ ...r, cat: c })));
    this.row = 0; this.pick = {};    // per row: option index being previewed
    this.spin = 0; this.flash = null; this.lastBuy = null;
    this.buildDom();
    addEventListener('keydown', (e) => this.key(e), true);
  }

  buildDom() {
    const root = $el('div'); root.id = 'customs'; root.hidden = true;
    const head = $el('div', 'c-head');
    head.append($el('div', 'c-kicker', 'BREAKWATER'), $el('h2', null, 'CUSTOMS'));
    this.elCar = $el('div', 'c-car');
    this.elCash = $el('div', 'c-cash');
    head.append(this.elCar, this.elCash);
    this.elList = $el('div', 'c-list');
    this.elPerf = $el('div', 'c-perf');
    this.elMsg = $el('div', 'c-msg');
    const foot = $el('div', 'c-foot');
    foot.innerHTML = '<kbd>↑</kbd><kbd>↓</kbd> part · <kbd>←</kbd><kbd>→</kbd> option · <kbd>Enter</kbd> buy · <kbd>Esc</kbd> leave';
    root.append(head, this.elList, this.elPerf, this.elMsg, foot);
    this.rowEls = this.rows.map((r, i) => {
      if (r === this.rows.find((o) => o.cat === r.cat)) this.elList.append($el('div', 'c-cat', r.cat.label));
      const el = $el('div', 'c-row');
      const name = $el('span', 'c-name', r.label);
      const prev = $el('button', 'c-arrow', '◀'), next = $el('button', 'c-arrow', '▶');
      const val = $el('span', 'c-val'), price = $el('span', 'c-price');
      const sw = $el('span', 'c-swatch');
      el.append(name, prev, sw, val, next, price);
      for (const b of [prev, next]) { b.tabIndex = -1; b.addEventListener('mousedown', (e) => e.preventDefault()); }
      prev.addEventListener('click', (e) => { e.stopPropagation(); this.row = i; this.cycle(-1); });
      next.addEventListener('click', (e) => { e.stopPropagation(); this.row = i; this.cycle(1); });
      el.addEventListener('click', () => { if (this.row === i) this.buy(); else { this.row = i; this.render(); } });
      this.elList.append(el);
      return { el, val, price, sw };
    });
    this.root = root;
    const prompt = $el('div'); prompt.id = 'customs-prompt'; prompt.hidden = true;
    prompt.innerHTML = '<kbd>G</kbd><span>Breakwater Customs</span>';
    this.prompt = prompt;
    document.body.append(root, prompt);
  }

  // ---- site --------------------------------------------------------------------
  onBay(v) { return Math.hypot(v.x - SITE.x, v.z - SITE.z) < SITE.radius || Math.hypot(v.x - SITE.x, v.z - SITE.bayZ) < SITE.radius; }
  showPrompt(on) { if (this.prompt.hidden === on) this.prompt.hidden = !on; }

  // ---- open / close ---------------------------------------------------------------
  enter(v) {
    if (this.open || !v) return false;
    this.hooks.syncWallet();
    let rec = v.garageId ? Garage.get(v.garageId) : null;
    if (!rec || rec.typeId !== v.type.name) {
      rec = Garage.adopt(v.type.name, '#' + v.paint.getHexString());
      if (!rec) return false;
      v.garageId = rec.id;
    }
    Garage.setActive(rec.id);
    this.hooks.adoptCar(v, rec);
    this.vehicle = v; this.record = rec;
    this.open = true; this.spin = 0; this.flash = null;
    this.resetPicks();
    v.ctrl.throttle = 0; v.ctrl.brake = 0; v.ctrl.steer = 0; v.ctrl.handbrake = true;
    v.place(SITE.x, SITE.z, SITE.bayYaw);
    v.gY = this.hooks.ground(SITE.x, SITE.z) + 0.035; v.gPitch = v.gRoll = 0;   // on the turntable deck
    v.slip = v.slipF = 0;
    this.hooks.opened?.(v);
    this.root.hidden = false; this.showPrompt(false);
    document.body.classList.add('customs-open');
    if (document.pointerLockElement) document.exitPointerLock?.();
    this.render();
    return true;
  }

  leave() {
    if (!this.open) return false;
    const v = this.vehicle;
    applyRecord(v, this.record);          // drop any preview
    v.driver = 'player';
    v.place(SITE.x - 1.5, SITE.bayZ, SITE.bayYaw);
    v.ctrl.handbrake = false; v.slip = v.slipF = 0;
    this.open = false; this.root.hidden = true;
    document.body.classList.remove('customs-open');
    this.hooks.leave(v);
    this.vehicle = null;
    return true;
  }

  resetPicks() {
    for (let i = 0; i < this.rows.length; i++) this.pick[i] = this.installedIndex(i);
  }
  installed(i) { const k = this.rows[i].key; return k === 'colour' ? this.record.colour : this.record.custom[k]; }
  installedIndex(i) { const opts = rowOptions(this.rows[i].key); return Math.max(0, opts.findIndex((o) => o.id === this.installed(i))); }

  // what the car wears while browsing: installed parts plus the option under the cursor
  preview() {
    const r = this.rows[this.row], o = rowOptions(r.key)[this.pick[this.row]];
    const rec = { ...this.record, custom: { ...this.record.custom } };
    if (r.key === 'colour') rec.colour = o.id; else rec.custom[r.key] = o.id;
    applyRecord(this.vehicle, rec);
  }

  cycle(d) {
    const n = rowOptions(this.rows[this.row].key).length;
    this.pick[this.row] = (this.pick[this.row] + d + n) % n;
    this.flash = null;
    this.render();
  }

  move(d) {
    this.pick[this.row] = this.installedIndex(this.row);
    this.row = (this.row + d + this.rows.length) % this.rows.length;
    this.flash = null;
    this.render();
  }

  buy() {
    const r = this.rows[this.row], o = rowOptions(r.key)[this.pick[this.row]];
    if (o.id === this.installed(this.row)) { this.flash = { text: 'Already fitted', bad: false }; this.render(); return null; }
    const before = this.hooks.balance();
    const rec = Garage.customise(this.record.id, r.key, o.id);
    if (!rec) {
      this.flash = { text: `Not enough cash for ${o.label} (${money(o.price)})`, bad: true };
      this.render();
      return null;
    }
    this.record = rec;
    this.lastBuy = { key: r.key, value: o.id, price: o.price, before };
    this.hooks.afterPurchase(rec, this.vehicle);
    this.flash = { text: `${o.label} fitted${o.price ? ` · −${money(o.price)}` : ''}`, bad: false };
    this.render();
    return rec;
  }

  key(e) {
    if (!this.open) return;
    const c = e.code;
    const map = { ArrowUp: () => this.move(-1), KeyW: () => this.move(-1), ArrowDown: () => this.move(1), KeyS: () => this.move(1),
      ArrowLeft: () => this.cycle(-1), KeyA: () => this.cycle(-1), ArrowRight: () => this.cycle(1), KeyD: () => this.cycle(1),
      Enter: () => this.buy(), Space: () => this.buy(), Escape: () => this.leave(), Backspace: () => this.leave(), KeyG: () => this.leave() };
    if (!map[c]) return;
    e.preventDefault(); e.stopPropagation();
    if (!e.repeat || c.startsWith('Arrow')) map[c]();
  }

  // ---- per frame ----------------------------------------------------------------
  step(dt) {
    const v = this.vehicle;
    if (!v) return;
    this.spin += dt * SPIN;
    const yaw = SITE.bayYaw + this.spin;
    v.x = v.px = SITE.x; v.z = v.pz = SITE.z; v.yaw = v.pyaw = yaw;
    v.vx = v.vz = v.r = 0; v.speed = v.fwd = 0;
    v.lamps.head = 1; v.lamps.brake = 0; v.lamps.reverse = 0;
  }

  // fixed turntable camera looking across the disc at the roller door
  frame(camera) {
    const t = this.vehicle.type;
    const dist = 3.2 + t.length * 0.78;
    const a = -0.5;   // a little off the door axis
    camera.fov = 50; camera.updateProjectionMatrix();
    // aim right of the car so it sits in the free left part of the screen (the panel is on the right)
    const shift = 0.34 * dist * Math.tan(camera.fov * Math.PI / 360) * camera.aspect;
    camera.position.set(SITE.x + Math.sin(a) * dist, 1.15 + t.height * 0.55, SITE.z - Math.cos(a) * dist);
    camera.lookAt(SITE.x - Math.cos(a) * shift, t.height * 0.42, SITE.z - Math.sin(a) * shift);
    camera.updateMatrixWorld();
    return camera;
  }

  // the player's spotlight becomes the shop's key light while the menu is up
  light(spot) {
    spot.position.set(SITE.x - 2.5, 5.5, SITE.z - 4.5);
    spot.target.position.set(SITE.x, 0.3, SITE.z);
    spot.target.updateMatrixWorld();
    spot.color.setRGB(1, 0.95, 0.88);
    spot.intensity = 420;
  }

  visibleCars(list) {
    return list.filter((o) => o === this.vehicle || Math.hypot(o.x - SITE.x, o.z - SITE.z) > HIDE_R);
  }

  // ---- DOM ----------------------------------------------------------------------
  render() {
    const rec = this.record;
    this.elCar.textContent = `${this.vehicle.type.label}`;
    this.elCash.textContent = money(this.hooks.balance());
    this.rows.forEach((r, i) => {
      const opts = rowOptions(r.key), o = opts[this.pick[i]];
      const els = this.rowEls[i];
      const fitted = o.id === this.installed(i);
      els.el.classList.toggle('sel', i === this.row);
      els.val.textContent = o.label;
      els.price.textContent = fitted ? 'FITTED' : o.price ? money(o.price) : 'FREE';
      els.price.classList.toggle('fitted', fitted);
      els.price.classList.toggle('short', !fitted && o.price > this.hooks.balance());
      els.sw.style.visibility = r.key === 'colour' ? 'visible' : 'hidden';
      if (r.key === 'colour') els.sw.style.background = o.id;
    });
    const u = rec.upgrades, bars = (n) => '■'.repeat(n) + '□'.repeat(Garage.MAX_LEVEL - n);
    this.elPerf.innerHTML = `<div class="c-cat">Performance</div>` + Garage.UPGRADE_PARTS.map((p) =>
      `<div class="c-perf-row"><span>${p}</span><span class="c-bars">${bars(u[p])}</span><span>LV ${u[p]}/${Garage.MAX_LEVEL}</span></div>`).join('');
    this.elMsg.textContent = this.flash?.text ?? '';
    this.elMsg.classList.toggle('bad', !!this.flash?.bad);
    this.preview();
  }

  state() {
    return { open: this.open, row: this.row, key: this.rows[this.row].key, record: this.record, lastBuy: this.lastBuy, flash: this.flash?.text ?? null,
      rows: this.rows.map((r, i) => ({ key: r.key, option: rowOptions(r.key)[this.pick[i]].id, installed: this.record ? this.installed(i) : null })) };
  }

  // tool hook: pick a row by key and an option by id (no purchase)
  select(key, id) {
    const i = this.rows.findIndex((r) => r.key === key);
    if (i < 0) return false;
    const k = rowOptions(key).findIndex((o) => o.id === id);
    if (k < 0) return false;
    if (i !== this.row) this.pick[this.row] = this.installedIndex(this.row);
    this.row = i; this.pick[i] = k; this.flash = null;
    this.render();
    return true;
  }
}
