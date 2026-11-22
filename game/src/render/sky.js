// Dusk sky dome: indigo zenith, mauve haze at the horizon, a coral glow around
// the low sun, a sun disc, and streaks of sunset-lit stratus.
import * as THREE from '../../vendor/three.min.js';
import { MOOD } from '../config.js';

export function createSky({ clouds = true, sunDisc = true } = {}) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uSunDir: { value: MOOD.sunDir },
      uZenith: { value: MOOD.skyZenith },
      uMid: { value: MOOD.skyMid },
      uHorizon: { value: MOOD.skyHorizon },
      uGlow: { value: MOOD.skyGlow },
      uSun: { value: MOOD.sunColor },
      uFog: { value: MOOD.fogColor },
      uTime: { value: 0 },
    },
    defines: { CLOUDS: clouds ? 1 : 0, SUN_DISC: sunDisc ? 1 : 0 },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;   // z = w: depth 1.0, so the dome always sits on the far plane
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir, uZenith, uMid, uHorizon, uGlow, uSun, uFog;
      uniform float uTime;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float s = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
        return s;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float az = max(dot(normalize(d.xz + 1e-5), normalize(uSunDir.xz)), 0.0);
        float hp = max(h, 0.0);
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, hp));
        col = mix(col, uZenith, smoothstep(0.18, 0.85, hp));
        // sunset glow hugging the horizon, strongest toward the sun
        col += uGlow * pow(az, 3.0) * exp(-hp * 7.0) * 1.15;
        col += uGlow * 0.18 * exp(-hp * 18.0);
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSun * pow(sd, 12.0) * 0.6;
        #if SUN_DISC
          col += uSun * smoothstep(0.9993, 0.9997, sd) * 30.0;
          col += uSun * pow(sd, 400.0) * 3.0;
        #endif
        #if CLOUDS
          if (h > 0.0) {
            vec2 cp = d.xz / (h + 0.06) * vec2(0.55, 1.6) + vec2(uTime * 0.004, 0.0);
            float c = fbm(cp * 1.4);
            c = smoothstep(0.52, 0.8, c) * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.35, 0.7, h));
            vec3 lit = mix(vec3(0.16, 0.12, 0.2), uGlow * 1.4 + uSun * 0.3, pow(az, 2.0) * 0.9 + 0.1);
            col = mix(col, lit, c * 0.85);
          }
        #endif
        // below the horizon fade into the fog colour
        col = mix(col, uFog, smoothstep(0.02, -0.06, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// Prefiltered environment for reflections on glass and wet ground: the sky
// plus a band of warm city glow near the horizon.
export function createEnvironment(renderer) {
  const scene = new THREE.Scene();
  const sky = createSky({ clouds: true, sunDisc: false });
  sky.scale.setScalar(0.02);
  scene.add(sky);
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.1, 0.45), side: THREE.BackSide });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(60, 60, 4, 32, 1, true), glowMat);
  band.position.y = -1;
  scene.add(band);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(70, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.03, 0.025, 0.03) }));
  ground.position.y = -3;
  scene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  return rt.texture;
}
