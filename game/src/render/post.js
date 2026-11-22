// HDR post pipeline: the scene renders into a multisampled half-float target,
// a soft-knee bright pass feeds a 5-level bloom pyramid, and the composite
// applies subtle neutral bloom plus thresholded halation (warm bleed only round
// the brightest sources), edge-only chromatic aberration, a filmic ACES curve,
// filmic S-curve and saturation, split-tone grade, lifted blacks and vignette before sRGB.
// PASS 17e: the graded LDR image then goes through a final pass: FXAA (edge search
// along the local luma gradient plus sub-pixel blend), a light contrast-adaptive
// sharpen on non-edge pixels clamped to the 3x3 neighbourhood (cannot ring) and the
// film grain, applied last so the AA does not smear it.
import * as THREE from '../../vendor/three.min.js';

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DOWN = /* glsl */`
  uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uPrefilter;
  varying vec2 vUv;
  // PASS 16: on the bright pass each tap is capped, so one texel of sun glint on a car's glass
  // (midday) cannot flood the whole pyramid; dusk lamps and neon sit well below the cap
  vec3 s(vec2 o) { vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb; return uPrefilter > 0.5 ? min(c, vec3(16.0)) : c; }
  void main() {
    // 13-tap downsample (box-weighted) to avoid fireflies
    vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
    vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
    vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
    vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
    vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
    if (uPrefilter > 0.5) {
      float br = max(col.r, max(col.g, col.b));
      float knee = uThreshold * 0.35;
      float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
      soft = soft * soft / (4.0 * knee + 1e-4);
      float w = max(soft, br - uThreshold) / max(br, 1e-4);
      col *= w;
      col = min(col, vec3(40.0));
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

const UP = /* glsl */`
  uniform sampler2D tSrc; uniform sampler2D tBase; uniform vec2 uTexel; uniform float uRadius;
  varying vec2 vUv;
  void main() {
    vec2 t = uTexel * uRadius;
    vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
    c += (texture2D(tSrc, vUv + vec2(t.x, 0)).rgb + texture2D(tSrc, vUv - vec2(t.x, 0)).rgb +
          texture2D(tSrc, vUv + vec2(0, t.y)).rgb + texture2D(tSrc, vUv - vec2(0, t.y)).rgb) * 2.0;
    c += texture2D(tSrc, vUv + t).rgb + texture2D(tSrc, vUv - t).rgb +
         texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb;
    gl_FragColor = vec4(c / 16.0 + texture2D(tBase, vUv).rgb, 1.0);
  }`;

const COMPOSITE = /* glsl */`
  uniform sampler2D tScene; uniform sampler2D tBloom;
  uniform float uExposure, uBloom, uTime, uVignette, uGrain, uHalo, uHaloT, uCA;
  uniform vec3 uLift;
  uniform vec2 uRes;
  varying vec2 vUv;
  vec3 aces(vec3 x) {
    const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
    const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
    x = inM * x;
    vec3 a = x * (x + 0.0245786) - 0.000090537;
    vec3 b = x * (0.983729 * x + 0.4329510) + 0.238081;
    return clamp(outM * (a / b), 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
  void main() {
    // mild lateral chromatic aberration, only toward the frame edges (r^2 falloff)
    vec2 cq = vUv - 0.5;
    float r2 = dot(cq, cq);
    vec2 ca = cq * r2 * uCA;
    vec3 scene;
    scene.r = texture2D(tScene, vUv - ca).r;
    scene.g = texture2D(tScene, vUv).g;
    scene.b = texture2D(tScene, vUv + ca).b;
    vec3 bloom = texture2D(tBloom, vUv).rgb;
    // bloom stays neutral and subtle; halation (the warm-red film bleed) only
    // appears where the bloom itself is above a brightness threshold
    float bl = max(bloom.r, max(bloom.g, bloom.b));
    vec3 halo = bloom * (smoothstep(uHaloT, uHaloT * 3.0, bl)) * vec3(1.0, 0.42, 0.22);
    vec3 col = scene + bloom * uBloom + halo * uHalo;
    col *= uExposure;
    col = aces(col);
    // filmic grade: gentle S-curve around mid grey, a touch more colour in the
    // mids (not the highlights, which ACES already desaturates toward white)
    float lg = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);
    col = max(mix(vec3(lg), col, 1.0 + 0.08 * (1.0 - smoothstep(0.6, 1.0, lg))), 0.0);
    // split tone: teal shadows, warm highlights
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, col * vec3(0.9, 0.98, 1.08) + vec3(0.0, 0.006, 0.018), (1.0 - smoothstep(0.0, 0.45, l)) * 0.6);
    col = mix(col, col * vec3(1.06, 1.0, 0.92), smoothstep(0.5, 1.0, l) * 0.5);
    // lifted, slightly cool blacks keep detail in the shadows (toe, not a wash)
    col = uLift + col * (1.0 - uLift);
    vec2 q = cq;
    q.x *= uRes.x / uRes.y;
    col *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(q));
    col = toSRGB(clamp(col, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }`;

const FINAL = /* glsl */`
  uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uTime, uGrain, uSharpen, uAA;
  uniform vec2 uRes;
  varying vec2 vUv;
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  vec3 tap(vec2 uv) { return texture2D(tSrc, uv).rgb; }
  float L(vec2 uv) { return luma(texture2D(tSrc, uv).rgb); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
  void main() {
    vec2 px = uTexel;
    vec3 cM = tap(vUv);
    vec3 cN = tap(vUv + vec2(0.0, px.y)), cS = tap(vUv - vec2(0.0, px.y));
    vec3 cE = tap(vUv + vec2(px.x, 0.0)), cW = tap(vUv - vec2(px.x, 0.0));
    float lM = luma(cM), lN = luma(cN), lS = luma(cS), lE = luma(cE), lW = luma(cW);
    float lMin = min(lM, min(min(lN, lS), min(lE, lW)));
    float lMax = max(lM, max(max(lN, lS), max(lE, lW)));
    float range = lMax - lMin;
    vec3 col = cM;
    bool edge = uAA > 0.5 && range >= max(0.0312, lMax * 0.125);
    if (edge) {
      float lNW = L(vUv + vec2(-px.x, px.y)), lNE = L(vUv + px), lSW = L(vUv - px), lSE = L(vUv + vec2(px.x, -px.y));
      // sub-pixel aliasing amount from the 3x3 low-pass
      float lAvg = (2.0 * (lN + lS + lE + lW) + lNW + lNE + lSW + lSE) / 12.0;
      float sub = clamp(abs(lAvg - lM) / range, 0.0, 1.0);
      sub = smoothstep(0.0, 1.0, sub); sub = sub * sub * 0.75;
      // edge orientation
      float eH = abs(lNW + lNE - 2.0 * lN) + 2.0 * abs(lW + lE - 2.0 * lM) + abs(lSW + lSE - 2.0 * lS);
      float eV = abs(lNW + lSW - 2.0 * lW) + 2.0 * abs(lN + lS - 2.0 * lM) + abs(lNE + lSE - 2.0 * lE);
      bool horz = eH >= eV;
      float l1 = horz ? lS : lW, l2 = horz ? lN : lE;
      float g1 = abs(l1 - lM), g2 = abs(l2 - lM);
      float stepLen = horz ? px.y : px.x;
      float lLocal, grad;
      if (g1 >= g2) { stepLen = -stepLen; lLocal = 0.5 * (l1 + lM); grad = g1; }
      else { lLocal = 0.5 * (l2 + lM); grad = g2; }
      vec2 uv = vUv;
      if (horz) uv.y += stepLen * 0.5; else uv.x += stepLen * 0.5;
      vec2 off = horz ? vec2(px.x, 0.0) : vec2(0.0, px.y);
      float gScaled = grad * 0.25;
      vec2 uv1 = uv - off, uv2 = uv + off;
      float e1 = L(uv1) - lLocal, e2 = L(uv2) - lLocal;
      bool d1 = abs(e1) >= gScaled, d2 = abs(e2) >= gScaled;
      for (int i = 0; i < 10; i++) {
        if (d1 && d2) break;
        float q = i < 3 ? 1.0 : i < 6 ? 1.5 : i < 8 ? 2.0 : 4.0;
        if (!d1) { uv1 -= off * q; e1 = L(uv1) - lLocal; d1 = abs(e1) >= gScaled; }
        if (!d2) { uv2 += off * q; e2 = L(uv2) - lLocal; d2 = abs(e2) >= gScaled; }
      }
      float dist1 = horz ? vUv.x - uv1.x : vUv.y - uv1.y;
      float dist2 = horz ? uv2.x - vUv.x : uv2.y - vUv.y;
      bool nearer1 = dist1 < dist2;
      float dMin = min(dist1, dist2), span = dist1 + dist2;
      bool centreSmaller = lM < lLocal;
      bool goodSpan = ((nearer1 ? e1 : e2) < 0.0) != centreSmaller;
      float pixOff = goodSpan ? -dMin / span + 0.5 : 0.0;
      pixOff = max(pixOff, sub);
      vec2 fuv = vUv;
      if (horz) fuv.y += pixOff * stepLen; else fuv.x += pixOff * stepLen;
      col = tap(fuv);
    } else if (uSharpen > 0.0) {
      // contrast-adaptive sharpen (cross taps), weaker where local contrast is already high,
      // and clamped to the neighbourhood range so it never overshoots into halos
      vec3 mn = min(cM, min(min(cN, cS), min(cE, cW)));
      vec3 mx = max(cM, max(max(cN, cS), max(cE, cW)));
      vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
      vec3 w = -amp * uSharpen * 0.2;
      vec3 sharp = (cM + (cN + cS + cE + cW) * w) / (1.0 + 4.0 * w);
      col = clamp(sharp, mn, mx);
    }
    col += (hash(vUv * uRes) - 0.5) * uGrain;
    gl_FragColor = vec4(col, 1.0);
  }`;

// PASS 15b photo mode: depth of field from the scene depth (a 40-tap golden-angle
// disc whose radius is the circle of confusion; nearer sharp samples do not bleed
// into a blurred background) and four looks applied after the filmic grade.
const PHOTO = /* glsl */`
  uniform sampler2D tColor; uniform sampler2D tDepth;
  uniform vec2 uTexel, uFocusUV; uniform float uNear, uFar, uFocus, uAuto, uStrength, uFilter, uTime, uAspect;
  varying vec2 vUv;
  float lin(float z) { float n = z * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - n * (uFar - uNear)); }
  float focusD;
  float coc(float d) { return clamp(abs(d - focusD) / max(d, 0.1) * uStrength * 1.6, 0.0, 1.0); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
  void main() {
    // auto focus: the nearest surface in a small cross round the subject's screen position
    focusD = uFocus;
    if (uAuto > 0.5) {
      vec2 o = uTexel * 6.0;
      focusD = min(min(lin(texture2D(tDepth, uFocusUV).r), lin(texture2D(tDepth, uFocusUV + vec2(o.x, 0.0)).r)),
                   min(min(lin(texture2D(tDepth, uFocusUV - vec2(o.x, 0.0)).r), lin(texture2D(tDepth, uFocusUV + vec2(0.0, o.y)).r)), lin(texture2D(tDepth, uFocusUV - vec2(0.0, o.y)).r)));
    }
    float d0 = lin(texture2D(tDepth, vUv).r);
    float maxR = 14.0 * uStrength;
    float c0 = coc(d0) * maxR;
    vec3 col = texture2D(tColor, vUv).rgb;
    if (c0 > 0.5) {
      vec3 acc = col; float wsum = 1.0;
      float spin = hash(gl_FragCoord.xy * 0.37) * 6.2831853 * smoothstep(4.0, 10.0, c0);   // per-pixel rotation hides the tap pattern of wide blurs
      for (int i = 0; i < 40; i++) {
        float fi = float(i);
        float r = sqrt((fi + 0.5) / 40.0) * c0;
        float a = fi * 2.39996323 + spin;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uTexel;
        float di = lin(texture2D(tDepth, uv).r);
        float ci = coc(di) * maxR;
        if (di > d0) ci = min(ci, c0);            // background never smears over a nearer subject
        float w = clamp(ci - r + 1.0, 0.0, 1.0);
        acc += texture2D(tColor, uv).rgb * w; wsum += w;
      }
      col = acc / wsum;
    }
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec2 q = vUv - 0.5; q.x *= uAspect;
    float vig = smoothstep(0.3, 1.0, length(q));
    float g = hash(vUv * 977.0) - 0.5;
    if (uFilter > 2.5) {             // neon: saturated, violet shadows, cyan-magenta highlights
      col = max(mix(vec3(l), col, 1.55), 0.0);
      col = mix(col, col * vec3(0.75, 0.55, 1.25) + vec3(0.05, 0.0, 0.09), 1.0 - smoothstep(0.0, 0.5, l));
      col = mix(col, col * vec3(0.9, 1.08, 1.15), smoothstep(0.45, 1.0, l));
      col = (col - 0.5) * 1.12 + 0.5;
      col *= 1.0 - vig * 0.35;
    } else if (uFilter > 1.5) {      // warm film: amber cast, faded lifted blacks, soft highlights, coarse grain
      col = mix(vec3(l), col, 0.82) * vec3(1.09, 1.0, 0.82);
      col = vec3(0.055, 0.035, 0.02) + col * 0.93;
      col = col / (1.0 + max(col - 0.85, 0.0));
      col += g * 0.045;
      col *= 1.0 - vig * 0.45;
    } else if (uFilter > 0.5) {      // noir: black and white, hard contrast, heavy vignette
      float n = smoothstep(0.04, 0.92, l);
      n = n * n * (3.0 - 2.0 * n);
      col = vec3(n) + g * 0.05;
      col *= 1.0 - vig * 0.7;
    }
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`;

export class PostPipeline {
  constructor(renderer, { levels = 5, samples = 0 } = {}) {
    this.renderer = renderer;
    this.levels = levels;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    this.down = [];
    this.up = [];
    for (let i = 0; i < levels; i++) {
      this.down.push(new THREE.WebGLRenderTarget(1, 1, opts));
      if (i < levels - 1) this.up.push(new THREE.WebGLRenderTarget(1, 1, opts));
    }
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(tri, null);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.downMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: DOWN, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.7 }, uPrefilter: { value: 0 } } });
    this.upMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: UP, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1.0 } } });
    this.compMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false,
      uniforms: { tScene: { value: null }, tBloom: { value: null }, uExposure: { value: 1 }, uBloom: { value: 0.26 },
        uHalo: { value: 0.55 }, uHaloT: { value: 0.35 }, uCA: { value: 0.012 }, uLift: { value: new THREE.Vector3(0.0036, 0.0042, 0.0068) },
        uTime: { value: 0 }, uVignette: { value: 0.42 }, uGrain: { value: 0 }, uRes: { value: new THREE.Vector2() } } });
    // PASS 17e: graded LDR image -> FXAA + sharpen + grain
    this.ldrRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.finalMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FINAL, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uTime: { value: 0 }, uGrain: { value: 0.022 },
        uSharpen: { value: 0.5 }, uAA: { value: 1 }, uRes: { value: new THREE.Vector2() } } });
  }

  setSize(w, h) {
    this.sceneRT.setSize(w, h);
    let cw = Math.max(1, w >> 1), ch = Math.max(1, h >> 1);
    for (let i = 0; i < this.levels; i++) {
      this.down[i].setSize(cw, ch);
      if (i < this.levels - 1) this.up[i].setSize(cw, ch);
      cw = Math.max(1, cw >> 1); ch = Math.max(1, ch >> 1);
    }
    this.compMat.uniforms.uRes.value.set(w, h);
    this.ldrRT.setSize(w, h);
    this.finalMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.finalMat.uniforms.uRes.value.set(w, h);
    this.size = [w, h];
    if (this.photoRT) { this.photoRT.scene.setSize(w, h); this.photoRT.ldr.setSize(w, h); this.photoRT.aa.setSize(w, h); }
  }
  // Photo mode targets, made on first use: a scene target that keeps its depth as a texture, and an LDR composite.
  _photoTargets() {
    if (this.photoRT) return this.photoRT;
    const [w, h] = this.size ?? [1, 1];
    const scene = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true });
    scene.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    const ldr = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    const aa = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.photoMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: PHOTO, depthTest: false, depthWrite: false,
      uniforms: { tColor: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 6000 },
        uFocus: { value: 10 }, uAuto: { value: 0 }, uFocusUV: { value: new THREE.Vector2(0.5, 0.5) }, uStrength: { value: 0 }, uFilter: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 } } });
    return (this.photoRT = { scene, ldr, aa });
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  // photo: { focus, strength, filter } (photo mode) adds the depth-of-field / look pass.
  render(scene, camera, { exposure = 1, time = 0, photo = null } = {}) {
    const r = this.renderer;
    const pt = photo ? this._photoTargets() : null;
    const sceneRT = pt ? pt.scene : this.sceneRT;
    r.setRenderTarget(sceneRT);
    r.render(scene, camera);
    // bloom pyramid
    let src = sceneRT.texture, sw = sceneRT.width, sh = sceneRT.height;
    for (let i = 0; i < this.levels; i++) {
      const u = this.downMat.uniforms;
      u.tSrc.value = src; u.uTexel.value.set(1 / sw, 1 / sh); u.uPrefilter.value = i === 0 ? 1 : 0;
      this.pass(this.downMat, this.down[i]);
      src = this.down[i].texture; sw = this.down[i].width; sh = this.down[i].height;
    }
    let low = this.down[this.levels - 1];
    for (let i = this.levels - 2; i >= 0; i--) {
      const u = this.upMat.uniforms;
      u.tSrc.value = low.texture; u.tBase.value = this.down[i].texture;
      u.uTexel.value.set(1 / low.width, 1 / low.height);
      this.pass(this.upMat, this.up[i]);
      low = this.up[i];
    }
    const c = this.compMat.uniforms;
    c.tScene.value = sceneRT.texture; c.tBloom.value = low.texture;
    c.uExposure.value = exposure; c.uTime.value = time % 100;
    const f = this.finalMat.uniforms;
    f.uTime.value = time % 100;
    if (!pt) {
      this.pass(this.compMat, this.ldrRT);
      f.tSrc.value = this.ldrRT.texture;
      this.pass(this.finalMat, null);
      return;
    }
    this.pass(this.compMat, pt.ldr);
    f.tSrc.value = pt.ldr.texture;
    this.pass(this.finalMat, pt.aa);
    const u = this.photoMat.uniforms;
    u.tColor.value = pt.aa.texture; u.tDepth.value = pt.scene.depthTexture;
    u.uTexel.value.set(1 / pt.ldr.width, 1 / pt.ldr.height); u.uAspect.value = pt.ldr.width / pt.ldr.height;
    u.uNear.value = camera.near; u.uFar.value = camera.far;
    u.uFocus.value = photo.focus; u.uAuto.value = photo.focusUV ? 1 : 0;
    if (photo.focusUV) u.uFocusUV.value.set(photo.focusUV[0], photo.focusUV[1]);
    u.uStrength.value = photo.strength; u.uFilter.value = photo.filter; u.uTime.value = time % 100;
    this.pass(this.photoMat, null);
  }
}
