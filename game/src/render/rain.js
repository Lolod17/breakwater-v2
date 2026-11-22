// PASS 16 — rain streaks. One LineSegments draw: a fixed set of drops in a box
// that follows the camera, wrapped in world space (so the rain does not slide
// with the view), falling and slanting in the vertex shader. Hidden (no draw
// call) when the rain weight is near zero.
import * as THREE from '../../vendor/three.min.js';

const COUNT = 2600;
const BOX = 46;       // horizontal size of the box around the camera (m)
const HEIGHT = 26;    // vertical size (m)

export class Rain {
  constructor(scene) {
    const seed = new Float32Array(COUNT * 2 * 4);
    let s = 0x9e3779b9;
    const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
    for (let i = 0; i < COUNT; i++) {
      const x = rnd(), y = rnd(), z = rnd(), sp = 0.8 + rnd() * 0.4;
      for (let e = 0; e < 2; e++) seed.set([x, y, z, e ? -sp : sp], (i * 2 + e) * 4);   // sign of w marks the tail vertex
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(COUNT * 2 * 3), 3));
    geo.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 4));
    this.uniforms = {
      uTime: { value: 0 }, uAmt: { value: 0 }, uCam: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2(1.6, 0.7) }, uColor: { value: new THREE.Color(0.55, 0.6, 0.7) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: /* glsl */`
        attribute vec4 seed;
        uniform float uTime, uAmt;
        uniform vec3 uCam;
        uniform vec2 uWind;
        varying float vA;
        void main() {
          float speed = 13.0 * abs(seed.w);
          vec3 p;
          p.x = uCam.x + mod(seed.x * ${BOX.toFixed(1)} - uCam.x, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
          p.z = uCam.z + mod(seed.z * ${BOX.toFixed(1)} - uCam.z, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
          float fall = mod(seed.y * ${HEIGHT.toFixed(1)} - uTime * speed, ${HEIGHT.toFixed(1)});
          p.y = uCam.y - ${(HEIGHT * 0.35).toFixed(1)} + fall;
          p.xz += uWind * (fall / speed);
          // the tail vertex trails up-wind: a streak about one frame-blur long
          if (seed.w < 0.0) { p.y += 0.75; p.xz -= uWind * 0.055; }
          vec3 d = p - uCam;
          float r = length(d.xz);
          // thin out with distance and toward the box edge; only as many drops as the rain is heavy
          vA = (1.0 - smoothstep(${(BOX * 0.3).toFixed(1)}, ${(BOX * 0.5).toFixed(1)}, r)) * step(fract(seed.x * 91.7 + seed.z * 37.3), uAmt);
          vA *= smoothstep(0.4, 2.0, length(d));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        uniform float uAmt;
        varying float vA;
        void main() {
          if (vA <= 0.0) discard;
          gl_FragColor = vec4(uColor * vA * (0.22 + 0.18 * uAmt), 1.0);
        }`,
    });
    this.mesh = new THREE.LineSegments(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.name = 'rain';
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  // amount 0..1 (the weather's rain weight); lit: scene brightness (night rain is dimmer)
  update(camera, time, amount, lit = 1) {
    const a = Math.max(0, Math.min(1, amount));
    this.mesh.visible = a > 0.02;
    this.uniforms.uAmt.value = a;
    this.uniforms.uTime.value = time % 1000;
    this.uniforms.uCam.value.copy(camera.position);
    this.uniforms.uColor.value.setRGB(0.55 * lit, 0.6 * lit, 0.7 * lit);
  }
}
