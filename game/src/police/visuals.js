import * as THREE from '../../vendor/three.min.js';
import { buildCharacter, gaitParams, PALETTES } from '../player/character.js';

const box = new THREE.BoxGeometry();
const sphere = new THREE.SphereGeometry(1, 16, 10);
const surface = color => new THREE.MeshStandardMaterial({ color, roughness: 0.62 });
const glow = color => new THREE.MeshBasicMaterial({ color, toneMapped: false });
const red = glow(new THREE.Color(5, 0.025, 0.06));
const blue = glow(new THREE.Color(0.06, 0.32, 6));
const dark = surface(0x171c24);

function part(parent, geometry, material, x, y, z, width, height, depth) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(width, height, depth);
  parent.add(mesh);
  return mesh;
}

function pool(parent, width, length, color) {
  const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { tint: { value: new THREE.Color(color) }, power: { value: 0 } },
    vertexShader: 'varying vec2 p; void main(){p=uv*2.0-1.0; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec2 p; uniform vec3 tint; uniform float power; void main(){float f=max(0.0,1.0-dot(p,p)); gl_FragColor=vec4(tint,power*f*f);}' });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2), material);
  parent.add(mesh);
  return mesh;
}

export class Helicopter {
  constructor(scene, world) {
    this.world = world;
    this.body = new THREE.Group();
    this.body.name = 'police-helicopter';
    scene.add(this.body);
    const shell = surface(0x263850), glass = surface(0x0b1720), stripe = surface(0xc5dcec);
    part(this.body, sphere, shell, 0, 0, 0, 1.25, 1.15, 2.15);
    part(this.body, sphere, glass, 0, 0.3, 1.05, 1.13, 0.81, 1.34);
    part(this.body, box, stripe, 0, -0.24, -0.4, 2.25, 0.21, 2.9);
    part(this.body, box, shell, 0, 0.15, -3.5, 0.48, 0.52, 4.2).rotation.x = 0.08;
    part(this.body, box, shell, 0, 0.65, -5.4, 0.21, 1.54, 0.77).rotation.x = -0.25;
    for (const side of [-1, 1]) {
      part(this.body, box, dark, side * 1.05, -1.37, 0, 0.16, 0.16, 3.6);
      part(this.body, box, shell, side * 0.85, -1.03, 0.72, 0.13, 0.69, 0.15).rotation.z = side * 0.34;
      part(this.body, box, shell, side * 0.85, -1.03, -0.72, 0.13, 0.69, 0.15).rotation.z = side * 0.34;
    }
    part(this.body, box, dark, 0, 1.32, 0, 0.2, 0.6, 0.2);
    this.rotor = new THREE.Group(); this.rotor.position.y = 1.67; this.body.add(this.rotor);
    part(this.rotor, box, dark, 0, 0, 0, 9.7, 0.045, 0.22);
    part(this.rotor, box, dark, 0, 0, 0, 0.22, 0.045, 9.7);
    this.tail = new THREE.Group(); this.tail.position.set(0.2, 0.66, -5.47); this.body.add(this.tail);
    part(this.tail, box, dark, 0, 0, 0, 0.05, 1.38, 0.12);
    part(this.tail, box, dark, 0, 0, 0, 0.05, 0.12, 1.38);
    part(this.body, sphere, glow(new THREE.Color(4, 4, 3)), 0, -0.83, 1.0, 0.24, 0.24, 0.24);
    this.cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 24, 1, true), new THREE.MeshBasicMaterial({
      color: 0xb9daff, transparent: true, opacity: 0.095, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.spot = pool(scene, 16, 16, 0xc8e1ff);
    scene.add(this.cone);
    this.center = new THREE.Vector3();
    this.from = new THREE.Vector3(); this.direction = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.reset();
  }

  reset() {
    this.body.visible = this.cone.visible = this.spot.visible = false;
    this.angle = 0;
    this.spotted = false;
  }

  update(dt, active, player, report) {
    if (!active || !report) { if (this.body.visible) this.reset(); return false; }
    const position = this.body.position;
    if (!this.body.visible) {
      this.center.set(report.x, 0, report.z);
      position.set(report.x + 24, 78, report.z);
      this.body.visible = this.cone.visible = true;
    }
    const ease = 1 - Math.exp(-dt * 0.65);
    this.center.x += (report.x - this.center.x) * ease;
    this.center.z += (report.z - this.center.z) * ease;
    this.angle += dt * 0.34;
    const x = this.center.x + Math.cos(this.angle) * 24;
    const z = this.center.z + Math.sin(this.angle) * 24;
    // Stay above any roof directly below the aircraft when descending.
    const roof = this.world.colliders.query(x - 5, z - 5, x + 5, z + 5)
      .reduce((h, b) => Math.max(h, b.y1), 0);
    const height = Math.max(roof + 9, this.spotted ? 41 : 78);
    position.set(x, Math.max(roof + 5, position.y + (height - position.y) * ease), z);
    this.body.rotation.set(0, -this.angle, -0.12);
    this.rotor.rotation.y += dt * 32;
    this.tail.rotation.x += dt * 49;
    this.from.copy(position); this.from.y -= 1;
    this.direction.subVectors(player, this.from);
    const range = this.direction.length();
    this.direction.normalize();
    this.spotted = range < 100 && Math.hypot(player.x - this.center.x, player.z - this.center.z) < 25
      && this.world.colliders.raycast(this.from, this.direction, range) >= range - 0.04;
    const target = this.spotted ? player : this.center;
    const ground = this.world.groundHeight(target.x, target.z);
    this.direction.set(target.x - x, ground - this.from.y, target.z - z);
    const length = this.direction.length();
    this.direction.normalize();
    const beam = this.world.colliders.raycast(this.from, this.direction, length);
    this.cone.position.copy(this.from).addScaledVector(this.direction, beam / 2);
    this.cone.quaternion.setFromUnitVectors(this.up, this.direction.clone().negate());
    this.cone.scale.set(beam * 0.11, beam, beam * 0.11);
    this.spot.visible = beam >= length - 0.04;
    this.spot.position.set(target.x, ground + 0.022, target.z);
    this.spot.material.uniforms.power.value = 0.34;
    return this.spotted;
  }

  status() { return { active: this.body.visible, spotted: this.spotted, height: this.body.visible ? this.body.position.y : 0 }; }
}

export class PoliceVisuals {
  // The light bar itself is part of the cruiser model (lit by vehicle.lamps.siren
  // through the vehicle shader; its glow sprites come from the vehicle renderer).
  // Here: the tinted pool it throws on the road and the officer on foot, who uses
  // the same rig as the player (uniform palette, peaked cap) and plants his feet:
  // the gait phase advances with the measured ground speed.
  constructor(scene, lm = null) {
    this.slots = Array.from({ length: 3 }, () => {
      const rig = buildCharacter(lm, PALETTES.police);
      const officer = rig.root;
      officer.name = 'police-officer';
      scene.add(officer);
      const spill = pool(scene, 11, 13, 0xffffff);
      officer.visible = spill.visible = false;
      return { spill, officer, rig, last: null, phase: 0, speed: 0 };
    });
  }

  render(units, time, alpha) {
    this.slots.forEach((slot, i) => {
      const { spill, officer, rig } = slot;
      const u = units[i];
      const v = u?.car;
      spill.visible = !!(u?.siren && v.lamps.siren >= 1);
      officer.visible = !!u?.officer;
      if (spill.visible) {
        const x = THREE.MathUtils.lerp(v.px, v.x, alpha), z = THREE.MathUtils.lerp(v.pz, v.z, alpha);
        spill.position.set(x, v.gY + 0.018, z);
        spill.rotation.y = THREE.MathUtils.lerp(v.pyaw, v.yaw, alpha);
        // same phase and strobe as the model's bar (vehicleMaterial: red when the phase >= 0.5)
        const ph = v.lamps.siren % 1;
        const strobe = (ph * 4) % 1 >= 0.08;
        spill.material.uniforms.tint.value.copy(ph >= 0.5 ? red.color : blue.color);
        spill.material.uniforms.power.value = strobe ? 0.2 : 0.03;
      }
      if (officer.visible) {
        const p = u.officer;
        // ground speed from the officer's own motion; phase rate keeps the stance foot planted
        if (slot.last && time > slot.last.t) {
          const dt = time - slot.last.t;
          const sp = Math.hypot(p.x - slot.last.x, p.z - slot.last.z) / dt;
          slot.speed += (Math.min(6, sp) - slot.speed) * Math.min(1, dt * 10);
          slot.phase = (slot.phase + dt / gaitParams(slot.speed).T) % 1;
        }
        slot.last = { x: p.x, z: p.z, t: time };
        officer.position.set(p.x, p.y, p.z);
        officer.rotation.set(u.hit * 0.95, p.yaw, u.hit * 0.8);
        rig.pose(slot.phase, slot.speed, { lean: 0.04, t: time });
      } else slot.last = null;
    });
  }
}
