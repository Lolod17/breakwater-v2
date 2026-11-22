// Tyre smoke and skid marks, both driven from the fixed step (so they are
// deterministic) and both single draw calls: camera-facing smoke puffs as an
// instanced quad with a soft shader, and skid strips as an instanced decal
// ring buffer that fades out as it is overwritten.
import * as THREE from '../../vendor/three.min.js';

const MAX_SMOKE = 220;
const MAX_SKID = 900;
const EFFECT_RANGE = 90;                         // metres from the focus point
const EFFECT_RANGE_SQ = EFFECT_RANGE * EFFECT_RANGE;

function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

export class VehicleEffects {
  constructor(scene, ground) {
    this.ground = ground;
    // ---- smoke
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    this.sPos = new Float32Array(MAX_SMOKE * 4);
    this.sA = new Float32Array(MAX_SMOKE);
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.sPos, 4));
    geo.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(this.sA, 1));
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTint: { value: new THREE.Color(0.62, 0.6, 0.66) } },
      vertexShader: `
        attribute vec4 iPos; attribute float iAlpha;
        varying vec2 vUv; varying float vA; varying float vSeed;
        void main() {
          vUv = uv; vA = iAlpha; vSeed = fract(iPos.x * 1.37 + iPos.z * 0.71);
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 wp = iPos.xyz + (right * position.x + up * position.y) * iPos.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uTint;
        varying vec2 vUv; varying float vA; varying float vSeed;
        void main() {
          vec2 p = vUv - 0.5;
          float r = length(p);
          float lobes = 0.06 * sin(atan(p.y, p.x) * 5.0 + vSeed * 6.28);
          float a = smoothstep(0.5, 0.1, r + lobes) * vA;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uTint * (0.85 + 0.3 * (0.5 - p.y)), a);
        }`,
      transparent: true, depthWrite: false,
    });
    this.smoke = new THREE.Mesh(geo, mat);
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 6;
    this.parts = [];
    for (let i = 0; i < MAX_SMOKE; i++) this.parts.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 1, life: 1, size: 1, a0: 0 });
    this.next = 0;
    this.spawnN = 0;

    // ---- skids
    const skidMat = new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.55, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.skids = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), skidMat, MAX_SKID);
    this.skids.count = 0; this.skids.frustumCulled = false; this.skids.renderOrder = 3;
    this.skidN = 0;
    this.trails = new Map();       // vehicle id * 8 + wheel -> last point
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    scene.add(this.smoke, this.skids);
  }

  reset() {
    for (const p of this.parts) p.age = p.life = 1;
    this.skidN = 0; this.skids.count = 0; this.trails.clear();
  }

  _puff(x, y, z, vx, vz, amount) {
    const p = this.parts[this.next];
    this.next = (this.next + 1) % MAX_SMOKE;
    const h = this.spawnN++;
    p.x = x + (hash(h) - 0.5) * 0.3; p.y = y; p.z = z + (hash(h + 7) - 0.5) * 0.3;
    p.vx = vx * 0.25 + (hash(h + 3) - 0.5) * 1.2; p.vz = vz * 0.25 + (hash(h + 5) - 0.5) * 1.2; p.vy = 0.5 + hash(h + 9) * 0.6;
    p.age = 0; p.life = 1.6 + hash(h + 11) * 1.4; p.size = 0.7 + amount * 0.6; p.a0 = 0.22 + 0.33 * amount;
  }

  _skid(key, x, z, w, y) {
    const last = this.trails.get(key);
    if (!last) { this.trails.set(key, { x, z }); return; }
    const dx = x - last.x, dz = z - last.z, d = Math.hypot(dx, dz);
    if (d < 0.35) return;
    if (d > 3) { last.x = x; last.z = z; return; }
    this._q.setFromAxisAngle(this._up, Math.atan2(dx, dz));
    this._m.compose(this._p.set((x + last.x) / 2, y + 0.018, (z + last.z) / 2), this._q, this._s.set(w, 1, d + 0.05));
    this.skids.setMatrixAt(this.skidN % MAX_SKID, this._m);
    this.skidN++;
    this.skids.count = Math.min(MAX_SKID, this.skidN);
    this.skids.instanceMatrix.needsUpdate = true;
    last.x = x; last.z = z;
  }

  // Fixed step: emit from sliding / spinning tyres near the focus point, age the smoke.
  step(dt, vehicles, focus) {
    for (const v of vehicles) {
      if (v.sleeping) continue;
      const near = (v.x - focus.x) ** 2 + (v.z - focus.z) ** 2 < EFFECT_RANGE_SQ;
      const wl = v.wheels();
      const s = Math.sin(v.yaw), co = Math.cos(v.yaw);
      for (let k = 0; k < wl.length; k++) {
        const [lx, lz, front] = wl[k];
        const amt = front ? v.slipF * 0.7 : v.slip;
        const key = v.id * 8 + k;
        if (!near || amt < 0.28) { this.trails.delete(key); continue; }
        const wx = v.x + co * lx + s * lz, wz = v.z - s * lx + co * lz;
        const gy = Math.max(0, v.wheelH[k]);
        this._skid(key, wx, wz, v.type.tyreW * 0.9, gy);
        if (hash(this.spawnN * 0.37 + key) < amt * 0.9) this._puff(wx, gy + 0.25, wz, v.vx, v.vz, amt);
      }
    }
    for (const p of this.parts) {
      if (p.age >= p.life) continue;
      p.age += dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = Math.exp(-dt * 1.4);
      p.vx *= k; p.vz *= k; p.vy *= Math.exp(-dt * 0.6);
      p.size += dt * 1.6;
    }
  }

  // Frame: pack live puffs.
  render() {
    let n = 0;
    for (const p of this.parts) {
      if (p.age >= p.life) continue;
      const u = p.age / p.life;
      this.sPos[n * 4] = p.x; this.sPos[n * 4 + 1] = p.y; this.sPos[n * 4 + 2] = p.z; this.sPos[n * 4 + 3] = p.size;
      this.sA[n] = p.a0 * Math.min(1, u * 8) * Math.pow(1 - u, 1.4);
      n++;
    }
    const g = this.smoke.geometry;
    g.instanceCount = n;
    g.attributes.iPos.needsUpdate = true;
    g.attributes.iAlpha.needsUpdate = true;
    this.smoke.visible = n > 0;
  }
}
