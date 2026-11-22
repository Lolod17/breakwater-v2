import * as THREE from '../../vendor/three.min.js';
import * as Weapons from './weapons.js';

// PASS 14b: damage, fire interval, range, magazine and reload come from the
// equipped weapon's data (weapons.js). Firearms keep a magazine each and draw
// from a shared reserve per ammo type; melee weapons need no ammo.
const PICKUP_AMMO = '9mm';

export class Combat {
  constructor(scene, world, player, crowd, police, onShot) {
    Object.assign(this, { world, player, crowd, police, onShot });
    const metal = new THREE.MeshStandardMaterial({ color: 0x27313e, roughness: 0.35, metalness: 0.55 });
    const pistol = this.pistol = new THREE.Group();
    for (const [w, h, d, y, z] of [[0.09, 0.09, 0.29, 0, 0.055], [0.078, 0.16, 0.084, -0.079, -0.044]]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), metal);
      mesh.position.set(0, y, z);
      pistol.add(mesh);
    }
    const flash = this.flash = new THREE.Mesh(new THREE.IcosahedronGeometry(0.105, 0),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 3.6, 0.5), toneMapped: false }));
    flash.position.z = 0.29;
    flash.scale.set(0.83, 0.83, 1.6);
    pistol.add(flash);
    scene.add(pistol);
    this.pickups = [[32.2, 172], [127.5, -65], [-112.5, -160], [150, 218], [-60, 285]].map(([x, z]) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.18, 0.32),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.35, 0.25) }));
      const y = world.groundHeight(x, z) + 0.42;
      mesh.position.set(x, y, z);
      scene.add(mesh);
      return { mesh, y, cooldown: 0 };
    });
    this.origin = new THREE.Vector3(); this.direction = new THREE.Vector3(); this.muzzle = new THREE.Vector3();
    this.point = new THREE.Vector3();
    this.reset();
  }

  get weapon() { return Weapons.equipped(); }
  get ammo() { const w = this.weapon; return w.magazine ? this.mags[w.id] ?? 0 : 0; }
  set ammo(n) { const w = this.weapon; if (w.magazine) this.mags[w.id] = n; }
  get reserve() { const w = this.weapon; return w.ammo ? this.pools[w.ammo] ?? 0 : 0; }
  set reserve(n) { const w = this.weapon; if (w.ammo) this.pools[w.ammo] = n; }

  reset() {
    this.mags = {}; this.pools = {};
    for (const w of Object.values(Weapons.WEAPONS)) if (w.magazine) {
      this.mags[w.id] = w.magazine;
      this.pools[w.ammo] = Math.max(this.pools[w.ammo] ?? 0, w.reserve ?? 0);
    }
    this.reloadFor = null;
    this.locked = false;       // PASS 14b: the weapon wheel is open (no aiming or firing)
    this.reload = this.cooldown = this.recoil = this.flashTime = 0;
    this.aiming = false;
    this.lastShot = null;
    this.shots = this.hits = this.damageApplied = 0;
    this.pistol.visible = false;
    for (const p of this.pickups) { p.cooldown = 0; p.mesh.visible = true; }
  }

  update(dt, time, input, foot, camera) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.recoil *= Math.exp(-dt * 11);
    this.flashTime = Math.max(0, this.flashTime - dt);
    this.aiming = foot && !this.locked && (input.buttons.has(2) || input.down('KeyQ'));
    if (this.reload && this.reloadFor !== this.weapon.id) this.reload = 0;   // switched weapons mid-reload
    for (const p of this.pickups) {
      p.cooldown = Math.max(0, p.cooldown - dt);
      if (!p.cooldown && foot && this.pools[PICKUP_AMMO] <= 78 && this.player.pos.distanceToSquared(p.mesh.position) < 1.7) {
        this.pools[PICKUP_AMMO] += 12; p.cooldown = 45;
      }
      p.mesh.visible = !p.cooldown;
      p.mesh.rotation.y = time * 1.55;
      p.mesh.position.y = p.y + 0.09 * Math.sin(time * 3);
    }
    if (!foot) { this.reload = 0; return; }
    if (this.reload > 0) {
      this.reload -= dt;
      if (this.reload <= 1e-8) {
        const rounds = Math.min(this.reserve, this.weapon.magazine - this.ammo);
        this.ammo += rounds; this.reserve -= rounds; this.reload = 0;
      }
    }
    if (!this.locked && input.tap('KeyR')) this.startReload();
    if (this.aiming && (input.buttons.has(0) || input.down('KeyX'))) this.fire(camera.position, camera.getWorldDirection(this.direction));
  }

  startReload() {
    const w = this.weapon;
    if (w.magazine && !this.reload && this.ammo < w.magazine && this.reserve) { this.reload = w.reload; this.reloadFor = w.id; }
  }

  muzzleAt(out, position, yaw) {
    return out.set(position.x + Math.cos(yaw) * 0.27 + Math.sin(yaw) * 0.51,
      position.y + 1.42, position.z - Math.sin(yaw) * 0.27 + Math.cos(yaw) * 0.51);
  }

  trace(origin, direction, limit) {
    let distance = this.world.colliders.raycast(origin, direction, limit);
    let hit = null;
    const ball = (target, kind, x, y, z, radius) => {
      const dx = x - origin.x, dy = y - origin.y, dz = z - origin.z;
      const projection = dx * direction.x + dy * direction.y + dz * direction.z;
      const side = dx * dx + dy * dy + dz * dz - projection * projection;
      if (projection <= 0 || side > radius * radius) return;
      const entry = Math.max(0, projection - Math.sqrt(radius * radius - side));
      if (entry < distance) { distance = entry; hit = { target, kind }; }
    };
    for (const p of this.crowd.peds) if (p.hp) {
      for (const fraction of [0.42, 0.60, 0.77, 0.90]) ball(p, 'pedestrian', p.x, p.y + p.height * fraction, p.z, 0.26);
    }
    for (const u of this.police.units) if (u.hp) {
      if (u.officer) {
        const p = u.officer;
        for (const y of [0.65, 1, 1.35]) ball(u, 'officer', p.x, p.y + y, p.z, 0.27);
      }
      const v = u.car;
      for (const z of v.type.circles) ball(u, 'cruiser', v.x + Math.sin(v.yaw) * z, v.gY + 0.78, v.z + Math.cos(v.yaw) * z, 0.88);
    }
    return { distance, hit };
  }

  fire(origin, direction) {
    if (this.cooldown || this.reload) return false;
    const weapon = this.weapon, firearm = weapon.kind === 'firearm';
    if (firearm && !this.ammo) { this.startReload(); return false; }
    if (firearm) this.ammo--;
    this.shots++;
    this.cooldown = weapon.interval;
    if (firearm) { this.flashTime = 0.056; this.recoil = Math.min(0.085, this.recoil + 0.049); }
    this.onShot(weapon);
    this.origin.copy(origin);
    this.direction.copy(direction).normalize();
    // The view ray starts at the camera, behind the shooter. Begin it level with
    // the shooter's chest so nothing between the camera and the player (a
    // pedestrian standing behind them) can be hit.
    const p = this.player.pos;
    const along = (p.x - this.origin.x) * this.direction.x + (p.y + 1.42 - this.origin.y) * this.direction.y + (p.z - this.origin.z) * this.direction.z;
    if (along > 0) this.origin.addScaledVector(this.direction, along);
    const first = this.trace(this.origin, this.direction, weapon.range);
    this.point.copy(this.origin).addScaledVector(this.direction, first.distance + 0.12);
    const yaw = Math.atan2(this.direction.x, this.direction.z);
    this.muzzleAt(this.muzzle, this.player.pos, yaw);
    // A third-person camera can see around a corner. The muzzle must also have a clear shot.
    const fromBody = this.origin.set(this.player.pos.x, this.player.pos.y + 1.42, this.player.pos.z);
    this.direction.subVectors(this.muzzle, fromBody);
    const muzzleGap = this.direction.length();
    this.direction.normalize();
    if (this.world.colliders.raycast(fromBody, this.direction, muzzleGap) < muzzleGap - 0.01) this.muzzle.copy(fromBody);
    this.direction.subVectors(this.point, this.muzzle);
    const travel = this.direction.length();
    this.direction.normalize();
    const { hit } = this.trace(this.muzzle, this.direction, travel);
    const damage = hit ? (hit.kind === 'pedestrian' ? this.crowd.damage(hit.target, weapon.damage) : this.police.damage(hit.target, weapon.damage)) : 0;
    if (damage) { this.hits++; this.damageApplied += damage; }
    this.lastShot = { weapon: weapon.id, kind: hit?.kind ?? null, id: hit ? hit.target.id ?? hit.target.car.id : null, damage };
    if (damage) this.onHit?.(weapon, hit, damage);
    return true;
  }

  render(camera, foot) {
    this.pistol.visible = foot && this.aiming && this.weapon.kind === 'firearm';
    this.flash.visible = this.flashTime > 0;
    if (!foot || !this.aiming) return;
    camera.getWorldDirection(this.direction);
    const yaw = Math.atan2(this.direction.x, this.direction.z);
    this.muzzleAt(this.pistol.position, this.player.object.position, yaw);
    this.pistol.position.addScaledVector(this.direction, -0.15 - this.recoil * 1.25);
    this.pistol.rotation.set(-Math.asin(this.direction.y) - this.recoil, yaw, this.reload ? -0.35 : 0, 'YXZ');
    this.player.object.rotation.y = yaw;
    for (const arm of this.player.char.parts.arms) {
      arm.shoulder.rotation.set(-1.25 + this.pistol.rotation.x, 0, arm.side * 0.07);
      arm.elbow.rotation.x = -0.44 - this.recoil * 2;
    }
  }

  status() { return { weapon: this.weapon.id, weaponName: this.weapon.name, melee: this.weapon.kind === 'melee', ammo: this.ammo, reserve: this.reserve, reload: this.reload, aiming: this.aiming,
    recoil: +this.recoil.toFixed(4), flash: this.flashTime > 0, pickups: this.pickups.filter(p => !p.cooldown).length,
    shots: this.shots, hits: this.hits, damage: this.damageApplied, lastShot: this.lastShot }; }
}
