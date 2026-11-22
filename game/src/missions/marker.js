// World-space mission markers: one light beam with a ground ring for the current
// waypoint (yellow objective, coral mission contact), and the package prop for
// THE PICKUP. Built once at boot and only moved/toggled, so mission changes and
// save reloads never add scene objects.
import * as THREE from '../../vendor/three.min.js';

function fadeGeometry(geo, axis, from, to) {
  const p = geo.attributes.position, col = [];
  for (let i = 0; i < p.count; i++) {
    const v = axis === 'y' ? p.getY(i) : Math.hypot(p.getX(i), p.getZ(i));
    const k = Math.max(0, Math.min(1, (v - from) / (to - from)));
    const a = Math.pow(1 - k, 1.4);
    col.push(a, a, a);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

const COLORS = { objective: new THREE.Color('#ffd23f'), contact: new THREE.Color('#ff6f61'), target: new THREE.Color('#ff3b3b') };

export class MissionMarker {
  constructor(scene) {
    const mat = (o) => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false, ...o });
    // unit beam (radius 1, height 1) scaled to the waypoint radius; fades upward
    this.beamMat = mat({});
    this.beam = new THREE.Mesh(fadeGeometry(new THREE.CylinderGeometry(1, 1, 1, 28, 6, true).translate(0, 0.5, 0), 'y', 0, 1), this.beamMat);
    this.ringMat = mat({});
    this.ring = new THREE.Mesh(fadeGeometry(new THREE.RingGeometry(0.82, 1, 40, 1).rotateX(-Math.PI / 2), 'r', 0.82, 1.4), this.ringMat);
    this.beam.name = 'mission-beam'; this.ring.name = 'mission-ring';
    this.beam.frustumCulled = this.ring.frustumCulled = false;
    this.beam.renderOrder = this.ring.renderOrder = 3;
    this.group = new THREE.Group();
    this.group.name = 'mission-marker';
    this.group.add(this.beam, this.ring);
    this.group.visible = false;
    // the package: a taped parcel on the market kerb
    const box = new THREE.BoxGeometry(0.62, 0.42, 0.48).translate(0, 0.21, 0);
    this.package = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: '#9a7046', roughness: 0.85 }));
    this.package.name = 'mission-package';
    this.package.castShadow = true;
    this.package.visible = false;
    scene.add(this.group, this.package);
  }

  // wp: { x, z, r, y, kind } or null; time: sim seconds (pulse)
  set(wp, time = 0) {
    this.group.visible = !!wp;
    if (!wp) return;
    const c = COLORS[wp.kind] ?? COLORS.objective;
    const pulse = 0.75 + 0.25 * Math.sin(time * 3.2);
    const r = wp.r ?? 4;
    this.group.position.set(wp.x, (wp.y ?? 0) + 0.04, wp.z);
    this.beam.scale.set(r * 0.32, wp.kind === 'target' ? 9 : 34, r * 0.32);
    this.ring.scale.set(r, 1, r);
    this.beamMat.color.copy(c).multiplyScalar(0.55 * pulse);
    this.ringMat.color.copy(c).multiplyScalar(1.3 * pulse);
  }

  showPackage(at, time = 0) {
    this.package.visible = !!at;
    if (!at) return;
    this.package.position.set(at.x, (at.y ?? 0) + 0.02 + Math.abs(Math.sin(time * 2)) * 0.06, at.z);
    this.package.rotation.y = time * 0.8;
  }

  reset() { this.set(null); this.showPackage(null); }
}
