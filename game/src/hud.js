// On-screen overlay: loading bar, start card, district banner, clock, and an
// optional performance readout (F3 or ?debug=1).
import * as THREE from '../vendor/three.min.js';

const $ = (id) => document.getElementById(id);
const _dir = new THREE.Vector3();

export class Hud {
  constructor() {
    this.el = { loading: $('loading'), bar: $('load-bar'), step: $('load-step'), start: $('start'), hud: $('hud'),
      district: $('district'), clock: $('clock'), perf: $('perf'), keys: $('keys'),
      prompt: $('prompt'), promptText: $('prompt-text'), msg: $('msg'), speedo: $('speedo'), carName: $('car-name'),
      spd: $('spd'), gear: $('gear'), rpm: $('rpm-bar'), wanted: $('wanted'), police: $('police-status'),
      health: $('health'), money: $('money'), ammo: $('ammo'), reticle: $('reticle'), incident: $('incident'),
      incidentTitle: $('incident-title'), incidentDetail: $('incident-detail'),
      mission: $('mission'), missionTitle: $('mission-title'), missionObjective: $('mission-objective'), missionExtra: $('mission-extra'),
      missionMeterLabel: $('mission-meter-label'), missionMeter: $('mission-meter'), missionTimer: $('mission-timer'), storyLine: $('story-line'),
      briefing: $('briefing'), briefingN: $('briefing-n'), briefingTitle: $('briefing-title'), briefingLines: $('briefing-lines'), briefingReward: $('briefing-reward'),
      result: $('result'), resultTitle: $('result-title'), resultDetail: $('result-detail'), resultHint: $('result-hint'),
      choice: $('choice'), choicePrompt: $('choice-prompt'), choicePress: $('choice-press'), choiceDeal: $('choice-deal'),
      continueBtn: $('continue'), saveInfo: $('save-info'), continueDetail: $('continue-detail'), day: $('day'),
      healthBar: $('health-bar'), healthFill: $('health-fill'), ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'),
      radio: $('radio'), radioName: $('radio-name'), radioFreq: $('radio-freq'), radioTrack: $('radio-track'), titleClock: $('title-clock'),
      radioPanel: $('radio-panel'), weather: $('weather'), lowhp: $('lowhp-vignette'), sidePrompt: $('side-prompt'), sidePromptText: $('side-prompt-text') };
    this.stars = [...this.el.wanted.children];
    // PASS 14b: weapon wheel (plain DOM, built here) and the crouch tag beside the police status
    const wheel = this.el.weaponWheel = document.createElement('div');
    wheel.id = 'weapon-wheel'; wheel.hidden = true; wheel.setAttribute('aria-label', 'Weapon wheel');
    wheel.innerHTML = '<div class="ww-hub"><b></b><span><kbd>Tab</kbd> release to equip</span></div>';
    this.el.hud.appendChild(wheel);
    const stance = this.el.stance = document.createElement('div');
    stance.id = 'stance'; stance.hidden = true; stance.textContent = 'CROUCHED';
    this.el.police.after(stance);
    this.el.ammoName = this.el.ammo.querySelector('.w');
    this._wheel = '';
    this._armedUntil = 0;
    this._ms = {};
    this._mode = '';
    this.debug = new URLSearchParams(location.search).has('debug');
    this.el.perf.hidden = !this.debug;
    addEventListener('keydown', (e) => { if (e.code === 'F3') { this.debug = !this.debug; this.el.perf.hidden = !this.debug; e.preventDefault(); } });
    this._last = 0;
  }
  progress(f, label) {
    this.el.bar.style.width = `${Math.round(f * 100)}%`;
    if (label) this.el.step.textContent = label;
  }
  ready(autostart) {
    this.el.loading.classList.add('done');
    if (autostart) this.el.loading.hidden = true;
    this.el.hud.hidden = false;
    if (!autostart) this.el.start.hidden = false;
  }
  hideStart() { this.el.start.hidden = true; }
  // Start card: show Continue only for a valid save; explain a rejected one.
  saveState(save) {
    this.el.continueBtn.hidden = !save.data;
    if (save.data) this.el.continueDetail.textContent = `DAY ${save.data.clock?.day ?? 1} — $${save.data.money}`;
    const info = save.data ? `Saved: mission ${Math.min(save.data.mission + 1, 5)} of 5 · $${save.data.money}${save.data.ending ? ' · story complete' : ''}`
      : save.error ? 'Save data was damaged and has been ignored. Starting fresh.'
      : 'No saved story yet — Continue appears after your first autosave.';
    this.el.saveInfo.hidden = !info;
    this.el.saveInfo.textContent = info;
  }

  // Mission overlay from Missions.hud(): objective panel, story line, briefing, result and choice cards.
  mission(m) {
    const e = this.el, c = this._ms;
    const set = (key, el, value, prop = 'textContent') => { if (c[key] !== value) { c[key] = value; el[prop] = value; } };
    const show = (key, el, on) => { if (c['h' + key] !== on) { c['h' + key] = on; el.hidden = !on; } };
    show('mission', e.mission, !!m.title && m.phase !== 'briefing');
    set('title', e.missionTitle, m.title);
    if (c.objective !== m.objective && m.objective) {          // PASS 15b: the new objective fades in
      e.missionObjective.classList.remove('obj-swap'); void e.missionObjective.offsetWidth; e.missionObjective.classList.add('obj-swap');
    }
    set('objective', e.missionObjective, m.objective);
    const extra = !!(m.meter || m.timer !== null);
    show('extra', e.missionExtra, extra);
    if (extra) {
      set('meterLabel', e.missionMeterLabel, m.meter?.label ?? '');
      show('meterBar', e.missionMeter.parentElement, !!m.meter);
      set('meter', e.missionMeter.style, m.meter ? `${Math.round(m.meter.value * 100)}%` : '0%', 'width');
      set('timer', e.missionTimer, m.timer === null ? '' : `${Math.floor(m.timer / 60)}:${String(Math.floor(m.timer % 60)).padStart(2, '0')}`);
    }
    show('line', e.storyLine, !!m.line);
    set('line', e.storyLine, m.line);
    show('briefing', e.briefing, !!m.briefing);
    if (m.briefing) {
      set('bn', e.briefingN, `MISSION ${m.briefing.n} OF 5`);
      set('bt', e.briefingTitle, m.briefing.title);
      set('bl', e.briefingLines, m.briefing.lines.map((l) => `<p>${l}</p>`).join(''), 'innerHTML');
      set('br', e.briefingReward, `Reward ${m.briefing.reward}`);
    }
    show('result', e.result, !!m.result);
    if (m.result) {
      e.result.classList.toggle('fail', !m.result.ok);
      set('rt', e.resultTitle, m.result.title);
      set('rd', e.resultDetail, m.result.detail);
      set('rh', e.resultHint, m.result.ok ? '' : 'Press E to retry');
    }
    show('choice', e.choice, !!m.choice);
    if (m.choice) {
      set('cp', e.choicePrompt, m.choice.prompt);
      set('c1', e.choicePress.lastElementChild, `${m.choice.options[0].label} ($${m.choice.options[0].reward})`);
      set('c2', e.choiceDeal.lastElementChild, `${m.choice.options[1].label} ($${m.choice.options[1].reward})`);
    }
  }

  // Driving overlay: enter prompt, messages, speedometer with gear and rev bar.
  // Updated every frame (cheap DOM writes only when values change).
  vehicle(drv) {
    const e = this.el;
    const mode = drv.driving ? 'car' : 'foot';
    if (mode !== this._mode) {
      this._mode = mode;
      e.speedo.hidden = mode !== 'car';
      e.radio.hidden = mode !== 'car';
      // one unbreakable key + action pair per span, so the bar wraps between pairs, never inside one
      const hints = mode === 'car'
        ? [['W', 'throttle'], ['S', 'brake'], ['A D', 'steer'], ['Space', 'handbrake'], ['R', 'radio'], ['P', 'photo'], ['F', 'get out']]
        : [['WASD', 'move'], ['Shift', 'sprint'], ['C', 'crouch'], ['F', 'enter car'], ['RMB', 'aim'], ['LMB', 'fire'], ['R', 'reload'], ['Tab', 'weapons'], ['O', 'outfit'], ['P', 'photo']];
      e.keys.innerHTML = hints.map(([k, a]) => `<span><b>${k}</b> ${a}</span>`).join('');
      // key hints show for a few seconds after each mode change, then fade
      e.keys.classList.remove('faded');
      clearTimeout(this._keysT);
      if (!document.body.classList.contains('ui-still')) this._keysT = setTimeout(() => e.keys.classList.add('faded'), 7000);
    }
    const c = drv.state === 'foot' ? drv.candidate : null;
    const ptxt = c ? `${c.driver && c.driver !== 'player' ? 'Take' : 'Enter'} ${c.type.label}` : '';
    if (ptxt !== this._ptxt) { this._ptxt = ptxt; e.prompt.hidden = !ptxt; e.promptText.textContent = ptxt; }
    const msg = drv.messageT > 0 ? drv.message : '';
    if (msg !== this._msg) { this._msg = msg; e.msg.hidden = !msg; e.msg.textContent = msg; }
    if (mode === 'car' && drv.vehicle) {
      const v = drv.vehicle;
      const kmh = String(Math.round(Math.abs(v.fwd) * 3.6));
      const gear = v.gear < 0 ? 'R' : v.speed < 0.3 && v.ctrl.throttle === 0 ? 'N' : String(v.gear);
      if (kmh !== this._kmh) { this._kmh = kmh; e.spd.textContent = kmh; }
      if (gear !== this._gear) { this._gear = gear; e.gear.textContent = gear; }
      if (v.type.label !== this._car) { this._car = v.type.label; e.carName.textContent = v.type.label; }
      const r = Math.round(Math.min(1, (v.rpm - v.type.idle * 0.6) / (v.type.redline - v.type.idle * 0.6)) * 100);
      if (r !== this._rpm) { this._rpm = r; e.rpm.style.width = `${r}%`; }
    }
  }

  // Status group (stars, health, money) and the ammo readout. "Armed" = the
  // pistol is out: aiming, reloading, or within 6 s of the last shot.
  playerStatus(wanted, police, life, combat, foot) {
    const e = this.el, now = performance.now();
    if (wanted.level !== this._stars) {
      this._stars = wanted.level;
      this.stars.forEach((s, i) => s.classList.toggle('on', i < this._stars));
      e.wanted.setAttribute('aria-label', `Wanted level ${this._stars} of 5`);
    }
    const alert = wanted.level ? (police.seen ? 'SPOTTED' : 'SEARCHING') : '';
    e.police.hidden = !alert;
    e.reticle.hidden = !combat.aiming || !foot;
    if (combat.aiming || combat.reload || combat.shots > (this._shots ?? combat.shots)) this._armedUntil = now + 6000;
    this._shots = combat.shots;
    const armed = foot && now < this._armedUntil;
    if (armed !== this._armed) { this._armed = armed; e.ammo.hidden = !armed; }
    e.incident.hidden = !life.incident;
    const hp = Math.max(0, Math.ceil(life.hp));
    if (hp !== this._hp) {
      this._hp = hp; e.healthFill.style.width = `${hp}%`; e.healthBar.classList.toggle('low', hp <= 30);
      // PASS 15b: a steady red edge below half health, beating below 30
      const k = life.incident ? 0 : Math.max(0, Math.min(1, (55 - hp) / 45));
      e.lowhp.style.opacity = k.toFixed(2);
      e.lowhp.classList.toggle('beat', k > 0 && hp <= 30);
    }
    e.ammo.classList.toggle('reloading', !!combat.reload);
    const cs = combat.weapon;      // PASS 14b: the readout follows the equipped weapon
    const melee = cs.kind !== 'firearm';
    const values = { police: alert, health: String(hp), money: `$${Math.round(life.money).toLocaleString('en-US')}`,
      ammoName: cs.name.toUpperCase(), ammoMag: melee ? '-' : combat.reload ? '..' : String(combat.ammo), ammoReserve: melee ? '' : `/ ${combat.reserve}`,
      incidentTitle: life.incident?.title ?? '', incidentDetail: life.incident?.message ?? '' };
    for (const [key, value] of Object.entries(values)) {
      if (e[key].textContent !== value) e[key].textContent = value;
    }
  }
  // PASS 14b: the weapon wheel from WeaponWheel.state(); sectors are laid out
  // clockwise from the top, the highlighted one lit. Rebuilt only on change.
  weaponWheel(w, crouched) {
    const e = this.el;
    if (crouched !== this._crouched) { this._crouched = crouched; e.stance.hidden = !crouched; }
    const key = w.open ? `${w.options.join(',')}|${w.hover}|${w.equipped}` : '';
    if (key === this._wheel) return;
    this._wheel = key;
    e.weaponWheel.hidden = !w.open;
    e.reticle.classList.toggle('wheel', w.open);
    if (!w.open) return;
    const hub = e.weaponWheel.firstElementChild;
    e.weaponWheel.replaceChildren(hub);
    const n = w.options.length;
    w.options.forEach((id, i) => {
      const a = (i / n) * Math.PI * 2;
      const slot = document.createElement('div');
      slot.className = 'ww-slot' + (i === w.hover ? ' on' : '') + (id === w.equipped ? ' eq' : '');
      slot.style.left = `calc(50% + ${(Math.sin(a) * 112).toFixed(1)}px)`;
      slot.style.top = `calc(50% - ${(Math.cos(a) * 112).toFixed(1)}px)`;
      slot.innerHTML = `<kbd>${i + 1}</kbd><b></b>`;
      slot.querySelector('b').textContent = id.toUpperCase();
      e.weaponWheel.appendChild(slot);
    });
    hub.querySelector('b').textContent = (w.highlighted ?? '').toUpperCase();
  }
  // Radio readout (shown while driving): station, frequency, "Title — Artist".
  // PASS 16: side-job spot prompt ("Start TAXI RANK"); null hides it
  sidePrompt(text) {
    const t = text ?? '';
    if (t === this._sideTxt) return;
    this._sideTxt = t;
    this.el.sidePrompt.hidden = !t;
    this.el.sidePromptText.textContent = t;
  }

  radio(np) {
    const e = this.el;
    const key = `${np.station}|${np.trackId}|${np.playing}`;
    if (key === this._radio) return;
    const fresh = this._radio && this._radio.split('|')[0] !== np.station;
    this._radio = key;
    e.radioName.textContent = np.station;
    e.radioFreq.textContent = np.freq ? `${np.freq} FM` : '';
    e.radioTrack.textContent = np.off ? 'Press R to tune in' : `${np.title} — ${np.artist}`;
    e.radio.dataset.track = np.trackId ?? '';
    if (fresh) { e.radio.classList.remove('fresh'); void e.radio.offsetWidth; e.radio.classList.add('fresh'); }
  }
  // PASS 15b: the station panel. Every station (and OFF) in dial order, the tuned
  // one lit; it opens when the player changes station in a car and closes 2.6 s later.
  radioPanel(stations, index, tunedAt, inCar, now = performance.now()) {
    const e = this.el, p = e.radioPanel;
    if (!p) return;
    if (!this._rpBuilt) {
      this._rpBuilt = true;
      const rows = stations.map((s) => `<li><span class="rp-freq">${s.freq}</span><span class="rp-name">${s.name}</span><span class="rp-genre">${s.genre}</span></li>`);
      rows.push('<li><span class="rp-freq">--</span><span class="rp-name">RADIO OFF</span><span class="rp-genre"></span></li>');
      p.querySelector('ol').innerHTML = rows.join('');
      this._rpRows = [...p.querySelectorAll('li')];
    }
    const open = inCar && now - tunedAt < 2600;
    if (open !== this._rpOpen) { this._rpOpen = open; p.hidden = !open; }
    if (index !== this._rpIndex) { this._rpIndex = index; this._rpRows.forEach((li, i) => li.classList.toggle('on', i === index)); }
  }
  // District from the real position (the label was a constant before).
  districtAt(x, z) {
    const L = this.layout;
    if (!L) return 'Downtown';
    const p = L.pier, b = this.bounds;
    if (x >= p.x0 && x <= p.x1 && z >= p.z0 - 0.5 && z <= p.z1) return 'Harbour Jetty';
    if (z > this.waterfrontZ && z <= b.z1 + 2) return 'Waterfront';
    if (x >= -200 && x <= -40 && z >= -200 && z <= -120) return 'Old Market';
    if (x >= -40 && x <= 200 && z >= -126 && z <= -114) return 'Customs Row';
    if (x >= 114 && x <= b.x1 && z >= 34 && z <= 200) return 'Industrial';
    if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return 'Downtown';
    return 'Outer Ring';
  }

  // Minimap: the city is drawn once into an offscreen canvas (water, quay,
  // pavements, building lots, roads, the jetty); each frame that image is
  // drawn rotated so the camera's view points up, with live blips on top.
  initMap(layout, city) {
    this.layout = layout;
    this.bounds = city.bounds;
    this.waterfrontZ = city.streets[city.streets.length - 1] + city.roadHalf;
    const canvas = $('minimap');
    if (!canvas) return;
    this.map = { canvas, ctx: canvas.getContext('2d'), last: -1e9 };
    const k = this.mapScale = 1.5, x0 = this.mapX0 = -340, z0 = this.mapZ0 = -340, size = 680;
    const img = document.createElement('canvas');
    img.width = img.height = size * k;
    const g = img.getContext('2d');
    const rect = (r, color) => { g.fillStyle = color; g.fillRect((r.x0 - x0) * k, (r.z0 - z0) * k, (r.x1 - r.x0) * k, (r.z1 - r.z0) * k); };
    // PASS 7 high-contrast palette: bright roads on near-black blocks, saturated water
    g.fillStyle = '#0a4f78'; g.fillRect(0, 0, img.width, img.height);                               // harbour water
    rect({ x0: -700, x1: 700, z0: -700, z1: city.quayZ }, '#c9ced6');                                // roads / land
    for (const b of layout.outerBlocks) { rect(b.slab, '#4a505c'); rect(b.lot, '#1b1f27'); }
    rect(layout.promenade, '#8e96a3');
    for (const b of layout.blocks) { rect(b.slab, '#4f5663'); rect(b.lot, '#14171d'); }
    rect(layout.pier, '#c08a4e');
    this.mapImage = img;
  }

  // PASS 7: 100 px map (canvas 200 px for a 2x backing store), rotated with the
  // player's heading (up = where the player or their car faces). The view widens
  // with speed. Mission pins are bold diamonds with a pulsing ring, clamped to the rim.
  minimap(now, focus, camera, police, wanted, force = false, marks = []) {
    const m = this.map;
    if (!m || (!force && now - m.last < 33)) return;
    m.last = now;
    const { ctx, canvas } = m;
    const W = canvas.width, R = W / 2;
    const target = 120 + Math.min(70, (focus.speed ?? 0) * 2.5);          // metres centre -> rim
    m.view = force || !m.view ? target : m.view + (target - m.view) * 0.08;
    const px = R / m.view;                                                // backing px per metre
    const h = focus.yaw, ch = Math.cos(h), sh = Math.sin(h);
    const toScreen = (x, z) => { const dx = x - focus.x, dz = z - focus.z; return [R + (-ch * dx + sh * dz) * px, R + (-sh * dx - ch * dz) * px]; };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R, 0, Math.PI * 2); ctx.clip();
    const k = px / this.mapScale;
    const [ox, oy] = toScreen(this.mapX0, this.mapZ0);
    ctx.setTransform(-ch * k, -sh * k, sh * k, -ch * k, ox, oy);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mapImage, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // last known position while the police search
    const search = wanted.level && !police.seen ? police.lastSeen ?? wanted.report : null;
    if (search) {
      const [sx, sy] = toScreen(search.x, search.z);
      ctx.fillStyle = 'rgba(255, 70, 60, 0.28)'; ctx.strokeStyle = 'rgba(255, 110, 90, 0.9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(sx, sy, 38 * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    const flash = Math.floor(now / 250) % 2;
    const MARK = { objective: '#ffd23f', contact: '#ff4f40', target: '#ff2d2d', ally: '#3dff8f', hostile: '#ff8a2a', side: '#3fe0d0' };
    const pins = [];
    for (const mk of marks) {
      const [mx, my] = toScreen(mk.x, mk.z);
      if (mk.kind === 'zone') {
        ctx.fillStyle = mk.hot ? 'rgba(255, 70, 70, 0.3)' : 'rgba(70, 140, 255, 0.3)'; ctx.strokeStyle = mk.hot ? '#ff6b6b' : '#7fb0ff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(mx, my, mk.r * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        continue;
      }
      if (mk.pin) { pins.push([mk, mx, my]); continue; }
      ctx.fillStyle = MARK[mk.kind] ?? '#fff'; ctx.strokeStyle = '#05080c'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(mx, my, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    for (const u of police.units) {
      const [ux, uy] = toScreen(u.car.x, u.car.z);
      ctx.fillStyle = u.siren ? (flash ? '#ff3b3b' : '#3b7bff') : '#9db7ff'; ctx.strokeStyle = '#05080c'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(ux, uy, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // mission pins: bold diamond, dark outline, pulsing ring; clamped to the rim when far
    const pulse = (now % 1200) / 1200;
    for (const [mk, mx, my] of pins) {
      let sx = mx, sy = my;
      const off = Math.hypot(mx - R, my - R), edge = R - 17;
      const clamped = off > edge;
      if (clamped) { sx = R + (mx - R) / off * edge; sy = R + (my - R) / off * edge; }
      const col = MARK[mk.kind] ?? '#ffd23f';
      if (!clamped) { ctx.strokeStyle = col; ctx.globalAlpha = 1 - pulse; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sx, sy, 12 + pulse * 16, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.fillStyle = col; ctx.strokeStyle = '#05080c'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy - 14); ctx.lineTo(sx + 12, sy); ctx.lineTo(sx, sy + 14); ctx.lineTo(sx - 12, sy); ctx.closePath(); ctx.stroke(); ctx.fill();
      ctx.fillStyle = '#05080c'; ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    // the player, drawn last: a bold white arrow, always pointing up (the map turns under it)
    ctx.save();
    ctx.translate(R, R);
    ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 6;
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#05080c'; ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(0, -19); ctx.lineTo(13, 13); ctx.lineTo(0, 6); ctx.lineTo(-13, 13); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
    ctx.restore();
    // north marker on the rim
    const [nx, ny] = toScreen(focus.x, focus.z - 1e4);
    const nl = Math.hypot(nx - R, ny - R) || 1;
    const qx = R + (nx - R) / nl * (R - 17), qy = R + (ny - R) / nl * (R - 17);
    ctx.fillStyle = '#05080c'; ctx.beginPath(); ctx.arc(qx, qy, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = '800 20px "Avenir Next", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', qx, qy + 1);
  }

  // clock: { day, minutes } from env/time.js (the saved clock)
  update(now, clock, player, perf) {
    if (now - this._last < 250) return;
    this._last = now;
    const pos = player.pos ?? player;
    const district = this.districtAt(pos.x, pos.z);
    if (district !== this.el.district.textContent) this.el.district.textContent = district;
    const hhmm = `${String(Math.floor(clock.minutes / 60) % 24).padStart(2, '0')}:${String(Math.floor(clock.minutes % 60)).padStart(2, '0')}`;
    if (this.el.clock.textContent !== hhmm) this.el.clock.textContent = hhmm;
    const day = `DAY ${clock.day}`;
    const wx = (clock.weather ?? 'clear').toUpperCase();                 // PASS 16: weather beside the clock
    if (this.el.weather && this.el.weather.textContent !== wx) this.el.weather.textContent = wx;
    if (this.el.day.textContent !== day) this.el.day.textContent = day;
    const tc = `${day} · ${hhmm}`;
    if (this.el.titleClock.textContent !== tc) this.el.titleClock.textContent = tc;
    if (this.debug && perf) {
      this.el.perf.textContent = `${perf.fps.toFixed(0)} fps · ${perf.calls} calls · ${(perf.triangles / 1000).toFixed(0)}k tris · ${player.speed.toFixed(1)} m/s · ${perf.cars ?? 0} cars drawn`;
    }
  }
}
