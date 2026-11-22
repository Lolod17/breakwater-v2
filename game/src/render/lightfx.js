// "Light with body": everything that makes a light source read as a light,
// without real-time lights.
//  - Glow sprites: one instanced, additive, camera-facing billboard set for every
//    lamp head, neon sign, signal lens, beacon (blinking), floodlight and the
//    dynamic car / police lamps. Pulled toward the camera so wall-mounted halos
//    are not cut by their own wall; faded by distance haze. One draw call.
//  - Light shafts: faint additive cones under street lamps (and any other cone
//    registered), edge-faded so they read as lit air, not geometry. One call.
//  - Wet-road reflection sources: every frame the brightest sources near and in
//    front of the camera are packed into a uniform array that the ground, paving
//    and road-paint shaders turn into vertical reflection smears (lightmap.js).
import * as THREE from '../../vendor/three.min.js';
import { MOOD } from '../config.js';

export const MAX_REFLECT = 20;
const MAX_DYNAMIC = 512;

// uniforms shared by every wet surface
export const WET = {
  uWetPos: { value: Array.from({ length: MAX_REFLECT }, () => new THREE.Vector4()) },   // xyz, width scale
  uWetCol: { value: Array.from({ length: MAX_REFLECT }, () => new THREE.Vector3()) },
  uWetCount: { value: 0 },
  uWetAmt: { value: 1 },     // PASS 16: wetness multiplier (1 = the dusk look), from render/daylight.js
  uWetCover: { value: 0 },   // PASS 16: how much of the road holds water after rain (0 = the dusk look)
};

const SPRITE_VERT = /* glsl */`
  attribute vec3 iPos;
  attribute vec4 iCol;      // rgb (HDR), a = size (m)
  attribute vec4 iParam;    // x blink rate (Hz, 0 = steady), y phase, z pull (m toward camera), w stretch (x/y aspect)
  uniform float uTime;
  uniform float uGain;      // PASS 16: lamp / sign glow strength for the time of day
  uniform float uFogD;      // PASS 16: live fog density
  uniform float uPxMin;     // minimum size in pixels (far lights stay visible points)
  uniform vec2 uRes;
  varying vec2 vUv;
  varying vec3 vCol;
  void main() {
    vec3 toCam = cameraPosition - iPos;
    float dist = length(toCam);
    vec3 p = iPos + toCam / max(dist, 1e-3) * min(iParam.z, dist * 0.5);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    float size = iCol.a;
    // keep a minimum on-screen footprint so distant lamps stay as glints
    float pxPerM = uRes.y * projectionMatrix[1][1] * 0.5 / max(-mv.z, 0.1);
    float k = max(1.0, uPxMin / max(size * pxPerM, 1e-3));
    size *= k;
    float blink = 1.0;
    if (iParam.x > 0.0) {
      float ph = fract(uTime * iParam.x + iParam.y);
      blink = smoothstep(0.0, 0.05, ph) * (1.0 - smoothstep(0.18, 0.3, ph));
    }
    // smaller apparent size compensates brightness so tiny far sprites do not flare
    vCol = iCol.rgb * blink / (k * k * 0.6 + 0.4);
    // distance haze: same exp2 density as the scene, fades rather than tints
    vCol *= uGain;
    float fd = uFogD * dist;
    // lights carry through haze better than surfaces: never fade below a glint
    vCol *= max(exp(-fd * fd * 0.8), 0.26);
    mv.xy += position.xy * size * vec2(iParam.w, 1.0);
    vUv = position.xy * 2.0;
    gl_Position = projectionMatrix * mv;
  }`;
const SPRITE_FRAG = /* glsl */`
  varying vec2 vUv;
  varying vec3 vCol;
  void main() {
    float r2 = dot(vUv, vUv);
    if (r2 > 1.0) discard;
    // tight hot core + wide soft halo
    float core = exp(-r2 * 28.0);
    float halo = exp(-r2 * 4.5) * (1.0 - r2);
    gl_FragColor = vec4(vCol * (core * 1.4 + halo * 0.35), 1.0);
  }`;

const SHAFT_VERT = /* glsl */`
  uniform float uGain;
  uniform float uFogD;
  varying vec3 vCol;
  varying float vFade;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vV = normalize(cameraPosition - w.xyz);
    vCol = instanceColor * uGain;
    // position.z runs 0 (source) .. 1 (far end): bright near the lamp
    vFade = pow(1.0 - clamp(position.z, 0.0, 1.0), 1.6);
    float d = length(cameraPosition - w.xyz);
    float fd = uFogD * d;
    vFade *= exp(-fd * fd) * smoothstep(1.5, 5.0, d);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const SHAFT_FRAG = /* glsl */`
  varying vec3 vCol;
  varying float vFade;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    // silhouette edges fade out: the cone reads as a volume of lit haze
    float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.4);
    gl_FragColor = vec4(vCol * vFade * edge, 1.0);
  }`;

function shaftGeometry() {
  // open cone, apex at origin, opening along +z to radius 1 at z = 1
  const g = new THREE.ConeGeometry(1, 1, 10, 1, true);
  g.translate(0, -0.5, 0);
  g.rotateX(-Math.PI / 2);
  return g;
}

export class LightFX {
  // registry: { sprites: [{x,y,z,r,g,b,size,blink,phase,pull,stretch}], shafts: [{x,y,z,dx,dy,dz,len,radius,r,g,b}],
  //             sources: [{x,y,z,r,g,b,w}] } — filled while the world is built.
  constructor(scene, registry) {
    this.reg = registry;
    this.gain = { value: 1 };
    this.fogD = { value: MOOD.fogDensity };
    const nStatic = registry.sprites.length;
    this.nStatic = nStatic;
    const cap = nStatic + MAX_DYNAMIC;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.par = new Float32Array(cap * 4);
    registry.sprites.forEach((s, i) => this._write(i, s));
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('iCol', new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('iParam', new THREE.InstancedBufferAttribute(this.par, 4).setUsage(THREE.DynamicDrawUsage));
    geo.instanceCount = nStatic;
    this.spriteGeo = geo;
    this.spriteMat = new THREE.ShaderMaterial({
      vertexShader: SPRITE_VERT, fragmentShader: SPRITE_FRAG,
      uniforms: { uTime: { value: 0 }, uPxMin: { value: 3.0 }, uRes: { value: new THREE.Vector2(1280, 720) }, uGain: this.gain, uFogD: this.fogD },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    });
    this.sprites = new THREE.Mesh(geo, this.spriteMat);
    this.sprites.frustumCulled = false;
    this.sprites.renderOrder = 8;
    this.sprites.name = 'glow-sprites';
    scene.add(this.sprites);

    // light shafts
    const sh = registry.shafts;
    this.shafts = new THREE.InstancedMesh(shaftGeometry(), new THREE.ShaderMaterial({
      uniforms: { uGain: this.gain, uFogD: this.fogD },
      vertexShader: SHAFT_VERT, fragmentShader: SHAFT_FRAG, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }), Math.max(1, sh.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1), d = new THREE.Vector3();
    sh.forEach((s, i) => {
      q.setFromUnitVectors(Z, d.set(s.dx, s.dy, s.dz).normalize());
      m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.radius, s.radius, s.len));
      this.shafts.setMatrixAt(i, m);
      this.shafts.setColorAt(i, new THREE.Color(s.r, s.g, s.b));
    });
    this.shafts.count = sh.length;
    this.shafts.frustumCulled = false;
    this.shafts.renderOrder = 6;
    this.shafts.name = 'light-shafts';
    this.shafts.visible = sh.length > 0;
    scene.add(this.shafts);

    // reflection candidates: static sources bucketed on a 40 m grid
    this.cell = 40;
    this.grid = new Map();
    for (const s of registry.sources) {
      const k = `${Math.floor(s.x / this.cell)},${Math.floor(s.z / this.cell)}`;
      let b = this.grid.get(k);
      if (!b) this.grid.set(k, b = []);
      b.push(s);
    }
    this.dynamic = [];         // sprites written this frame after the static block
    this.dynSources = [];      // reflection sources added this frame (car lamps, police bars)
    this._cand = [];
  }

  _write(i, s) {
    this.pos[i * 3] = s.x; this.pos[i * 3 + 1] = s.y; this.pos[i * 3 + 2] = s.z;
    this.col[i * 4] = s.r; this.col[i * 4 + 1] = s.g; this.col[i * 4 + 2] = s.b; this.col[i * 4 + 3] = s.size;
    this.par[i * 4] = s.blink || 0; this.par[i * 4 + 1] = s.phase || 0; this.par[i * 4 + 2] = s.pull ?? Math.min(1.2, s.size * 0.6); this.par[i * 4 + 3] = s.stretch || 1;
  }

  // Overwrite a static sprite's colour (signals change state).
  setStaticColor(i, r, g, b) {
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b;
    this._staticDirty = true;
  }

  // PASS 16: time-of-day / weather (render/daylight.js). Defaults are the dusk look.
  setLook(gain, fogDensity, wet, wetCover) {
    this.gain.value = gain;
    this.fogD.value = fogDensity;
    WET.uWetAmt.value = wet;
    WET.uWetCover.value = wetCover;
  }

  // Per-frame dynamic content.
  begin() { this.nDyn = 0; this.dynSources.length = 0; }
  sprite(x, y, z, r, g, b, size, pull = 0.3, stretch = 1) {
    if (this.nDyn >= MAX_DYNAMIC) return;
    const i = this.nStatic + this.nDyn++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = size;
    this.par[i * 4] = 0; this.par[i * 4 + 1] = 0; this.par[i * 4 + 2] = pull; this.par[i * 4 + 3] = stretch;
  }
  source(x, y, z, r, g, b, w = 1) { this.dynSources.push({ x, y, z, r, g, b, w }); }

  end(camera, time, res) {
    const geo = this.spriteGeo;
    geo.instanceCount = this.nStatic + this.nDyn;
    for (const name of ['iPos', 'iCol', 'iParam']) {
      const a = geo.attributes[name];
      a.clearUpdateRanges();
      if (this._staticDirty) a.addUpdateRange(0, (this.nStatic + this.nDyn) * a.itemSize);
      else a.addUpdateRange(this.nStatic * a.itemSize, Math.max(1, this.nDyn) * a.itemSize);
      a.needsUpdate = true;
    }
    this._staticDirty = false;
    this.spriteMat.uniforms.uTime.value = time;
    if (res) this.spriteMat.uniforms.uRes.value.copy(res);
    this.pickReflections(camera);
  }

  // Choose the sources whose reflections matter most from this camera.
  pickReflections(camera) {
    const cx = camera.position.x, cz = camera.position.z;
    const fx = -camera.matrixWorld.elements[8], fz = -camera.matrixWorld.elements[10];
    const fl = Math.hypot(fx, fz) || 1;
    const R = 130, c = this.cell;
    const cand = this._cand;
    cand.length = 0;
    const score = (s) => {
      const dx = s.x - cx, dz = s.z - cz;
      const d = Math.hypot(dx, dz);
      if (d > R) return;
      const ahead = (dx * fx + dz * fz) / fl / Math.max(d, 1);
      if (ahead < -0.35 && d > 8) return;
      const lum = (s.r * 0.3 + s.g * 0.55 + s.b * 0.15) * (s.w || 1);
      s._score = lum / (8 + d) * (0.6 + 0.4 * Math.max(0, ahead));
      cand.push(s);
    };
    for (let gx = Math.floor((cx - R) / c); gx <= Math.floor((cx + R) / c); gx++) {
      for (let gz = Math.floor((cz - R) / c); gz <= Math.floor((cz + R) / c); gz++) {
        const b = this.grid.get(`${gx},${gz}`);
        if (b) for (const s of b) score(s);
      }
    }
    for (const s of this.dynSources) score(s);
    cand.sort((a, b) => b._score - a._score);
    const n = Math.min(MAX_REFLECT, cand.length);
    for (let i = 0; i < n; i++) {
      const s = cand[i];
      WET.uWetPos.value[i].set(s.x, s.y, s.z, s.w || 1);
      WET.uWetCol.value[i].set(s.r, s.g, s.b);
    }
    WET.uWetCount.value = n;
  }
}
