'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import * as THREE from 'three';
import { cx as cn } from '@/utils/cx';

export type AIBlobState = 'idle' | 'listening' | 'thinking' | 'speaking';
export type AIBlobBlend = 'auto' | 'glow' | 'ink';

export interface AIBlobHandle {
  tap: (angle?: number, strength?: number) => void;
}

export interface AIBlobProps {
  size?: number;
  animationSpeed?: number;
  glowIntensity?: number;
  noiseScale?: number;
  innerScale?: number;
  resolution?: number;
  colors?: string[];
  state?: AIBlobState;
  volume?: number;
  getVolume?: () => number;
  autoVolume?: boolean;
  reactivity?: number;
  rimWidth?: number;
  rimIntensity?: number;
  coreIntensity?: number;
  glints?: number;
  halo?: number;
  colorSpeed?: number;
  wobble?: number;
  hoverTilt?: number;
  interactive?: boolean;
  blend?: AIBlobBlend;
  intro?: boolean;
  paused?: boolean;
  className?: string;
  style?: CSSProperties;
}

interface Settings {
  size: number;
  animationSpeed: number;
  glowIntensity: number;
  noiseScale: number;
  innerScale: number;
  resolution: number;
  colors: string[];
  state: AIBlobState;
  volume: number | undefined;
  getVolume: (() => number) | undefined;
  autoVolume: boolean;
  reactivity: number;
  rimWidth: number;
  rimIntensity: number;
  coreIntensity: number;
  glints: number;
  halo: number;
  colorSpeed: number;
  wobble: number;
  hoverTilt: number;
  interactive: boolean;
  blend: AIBlobBlend;
  intro: boolean;
  paused: boolean;
  reduced: boolean;
}

interface Controller {
  sync: () => void;
  tap: (angle?: number, strength?: number) => void;
  destroy: () => void;
}

interface Mood {
  speed: number;
  color: number;
  react: number;
  listen: number;
  think: number;
}

const MOODS: Record<AIBlobState, Mood> = {
  idle: { speed: 1, color: 1, react: 0.4, listen: 0, think: 0 },
  listening: { speed: 1.2, color: 1.3, react: 0.8, listen: 1, think: 0 },
  thinking: { speed: 2.2, color: 4, react: 0.3, listen: 0.2, think: 1 },
  speaking: { speed: 1.5, color: 1.8, react: 1, listen: 0.3, think: 0 },
};
const DEFAULT_COLORS = ['#ff006e', '#8338ec', '#3a86ff', '#06ffa5'];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);
const smooth = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const scratchColor = new THREE.Color();

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

const parseColor = (value: string | undefined, fallback: string) => {
  try {
    scratchColor.setStyle((value ?? fallback).trim() || fallback, THREE.NoColorSpace);
  } catch {
    scratchColor.setStyle(fallback, THREE.NoColorSpace);
  }
  const r = toLinear(scratchColor.r);
  const g = toLinear(scratchColor.g);
  const b = toLinear(scratchColor.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const greenRed = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const blueYellow = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return new THREE.Vector3(lightness, Math.hypot(greenRed, blueYellow), Math.atan2(blueYellow, greenRed));
};

const subscribeToMotion = (notify: () => void) => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

const readMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const vertexShader = `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

const fragmentShader = `
precision highp float;

uniform float uTime;
uniform float uColorTime;
uniform vec2 uResolution;
uniform float uGlowIntensity;
uniform float uNoiseScale;
uniform float uInnerScale;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec3 uColor4;
uniform float uRimWidth;
uniform float uRimIntensity;
uniform float uCoreIntensity;
uniform float uGlints;
uniform float uHalo;
uniform float uWobble;
uniform float uLevel;
uniform float uReact;
uniform float uListen;
uniform float uThink;
uniform vec2 uLook;
uniform float uJiggle;
uniform float uTapAngle;
uniform float uTapAge;
uniform float uInk;
uniform float uFade;
uniform float uGrow;

#define PI_TWO 6.28318530718

float rng(vec2 n) {
  return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
}

float perlin(vec2 p) {
  vec2 ip = floor(p);
  vec2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  float res = mix(
    mix(rng(ip), rng(ip + vec2(1.0, 0.0)), u.x),
    mix(rng(ip + vec2(0.0, 1.0)), rng(ip + vec2(1.0, 1.0)), u.x),
    u.y
  );
  return res * res;
}

float fractal(vec2 p) {
  return (perlin(p) * 0.5 + perlin(p * 2.0) * 0.25) / 0.75;
}

float brightness(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

mat3 rotateX(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

mat3 rotateY(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

mat3 rotateZ(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
}

vec3 blendHue(vec3 a, vec3 b, float k) {
  float turn = b.z - a.z;
  turn -= PI_TWO * floor((turn + 3.14159265) / PI_TWO);
  float lightness = mix(a.x, b.x, k);
  float chroma = mix(a.y, b.y, k);
  float hue = a.z + turn * k;
  vec3 lms = mat3(1.0, 1.0, 1.0, 0.3963377774, -0.1055613458, -0.0894841775, 0.2158037573, -0.0638541728, -1.291485548) * vec3(lightness, chroma * cos(hue), chroma * sin(hue));
  lms = lms * lms * lms;
  vec3 linear = mat3(4.0767416621, -1.2684380046, -0.0041960863, -3.3077115913, 2.6097574011, -0.7034186147, 0.2309699292, -0.3413193965, 1.707614701) * lms;
  return pow(clamp(linear, 0.0, 1.0), vec3(1.0 / 2.2));
}

vec3 ramp(float t) {
  float g = fract(t) * 4.0;
  if (g < 1.0) return blendHue(uColor1, uColor2, smoothstep(0.0, 1.0, g));
  if (g < 2.0) return blendHue(uColor2, uColor3, smoothstep(0.0, 1.0, g - 1.0));
  if (g < 3.0) return blendHue(uColor3, uColor4, smoothstep(0.0, 1.0, g - 2.0));
  return blendHue(uColor4, uColor1, smoothstep(0.0, 1.0, g - 3.0));
}

void main() {
  float minRes = min(uResolution.x, uResolution.y);
  vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution.xy) / minRes * 1.5;
  float t = uTime;

  float bearing = atan(uv.y, uv.x);
  float squish = uJiggle * exp(-uTapAge * 3.0) * sin(uTapAge * 13.0) * 0.07 * cos(2.0 * (bearing - uTapAngle));
  float sway = uWobble * 0.035 * (sin(3.0 * bearing + t * 0.9) * sin(t * 0.6) + 0.6 * sin(2.0 * bearing - t * 0.7 + 1.3));
  uv /= max(uGrow * (1.0 + uLevel * uReact * 0.06 + squish + sway), 0.05);

  float l = dot(uv, uv);
  if (l > 2.5) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float sm = smoothstep(1.04, 0.96, l);
  float z = sqrt(max(0.0, 1.0 - min(l, 1.0)));
  vec3 noisePos = normalize(vec3(uv.x, uv.y, z));

  float angleX = sin(t * 0.23) * 1.5 + cos(t * 0.37) * 0.6 + uLook.y * 0.6;
  float angleY = sin(t * 0.19) * 1.3 + cos(t * 0.41) * 0.7 - uLook.x * 0.6;
  float angleZ = sin(t * 0.31) * 1.1 + cos(t * 0.29) * 0.5;
  noisePos = rotateX(angleX) * noisePos;
  noisePos = rotateY(angleY) * noisePos;
  noisePos = rotateZ(angleZ) * noisePos;

  float d = sm * l * l * l * 2.0;
  vec3 norm = normalize(vec3(uv.x, uv.y, 0.7 - d));

  float nx = fractal(noisePos.xy * 2.0 * uNoiseScale / 3.0 + t * 0.4 + 25.69);
  float ny = fractal(noisePos.xy * 2.0 * uNoiseScale / 3.0 + t * 0.4 + 86.31);
  float n = fractal(noisePos.xy * uNoiseScale + 2.0 * vec2(nx, ny));
  vec3 col = vec3(n * 0.5 + 0.25);
  vec3 gradientColor = ramp(atan(noisePos.y, noisePos.x) / PI_TWO + uColorTime * 0.1);

  col *= gradientColor;
  col *= 2.0 * uGlowIntensity * 1.25 * (1.0 + uListen * 0.35 + uLevel * uReact * 0.6);
  vec3 cd = abs(col);
  vec3 c = col * d * uRimIntensity;

  vec3 lightDir = normalize(vec3(uLook.x * 0.35, uLook.y * 0.35, -1.0));
  float lightDot = max(0.0, dot(norm, lightDir));
  float glint = lightDot * lightDot * lightDot * lightDot * lightDot * 3.0 * uGlints;
  c += (c * 0.5 + vec3(1.0) - brightness(c)) * glint;

  float inner = 1.0 - 0.02 * max(uRimWidth, 0.05);
  float outline = max((1.0 - smoothstep(1.0, inner, l) - pow(max(0.0, length(uv) - 1.0), 0.2)) * 2.0, 0.0);
  col = c + col * outline * outline * outline * outline * uRimIntensity;

  float f = fractal(noisePos.xy * 2.0 + t) + 0.1;
  vec2 innerUV = uv * (f + 0.1) * 0.5 / max(uInnerScale, 0.05);
  float innerL = dot(innerUV, innerUV);
  vec3 ins = normalize(cd + 0.0001) + 0.1;
  float ind = 0.2 + pow(smoothstep(0.0, 1.5, sqrt(innerL)) * 48.0, 0.25);
  ind *= ind * ind * ind;
  ind = 1.0 / ind;
  ins *= ind;
  float pulse = uCoreIntensity * (1.0 + uLevel * uReact * 0.9 + uThink * 0.3 * sin(t * 3.5) + uJiggle * exp(-uTapAge * 2.0) * 0.9);
  vec3 coreGlow = ins * ins * smoothstep(0.05, 1.0, ind);
  vec3 core = (1.0 - exp(-coreGlow * 3.0)) * sm * uGlowIntensity * 1.15 * pulse;
  vec3 shade = abs(norm) * (1.0 - d) * sm * 0.25;

  float edgeDist = length(uv);
  float edgeFalloff = smoothstep(1.0, 0.95, edgeDist);
  float spread = max(uHalo, 0.05);
  float halo = exp(-max(edgeDist - 1.0, 0.0) * (14.0 / spread)) * smoothstep(0.96, 1.0, edgeDist) * uGlowIntensity * min(spread, 1.5) * (1.0 + uLevel * uReact + uListen * 0.4);
  vec3 vivid = gradientColor / max(max(gradientColor.r, max(gradientColor.g, gradientColor.b)), 0.0001);

  if (uInk > 0.5) {
    float inside = smoothstep(1.012, 0.988, edgeDist);
    float line = clamp(outline * outline * outline * outline * uRimIntensity * 0.9, 0.0, 1.0);
    float band = clamp(pow(d * (n * 0.9 + 0.2) * 0.55, 1.7) * uRimIntensity * 1.3, 0.0, 1.0);
    float rimA = clamp(line + band, 0.0, 1.0) * inside;
    float coreA = clamp(pow(brightness(core), 2.2) * 1.8, 0.0, 0.85);
    float haloA = clamp(halo * 0.28, 0.0, 1.0) * (1.0 - inside * 0.6);
    vec3 coreInk = mix(vivid, vec3(1.0), 0.18) * 0.9;
    float weight = max(rimA + coreA + haloA, 0.0001);
    vec3 paint = (vivid * 0.82 * rimA + coreInk * coreA + vivid * haloA) / weight;
    float cover = 1.0 - (1.0 - rimA) * (1.0 - coreA) * (1.0 - haloA);
    gl_FragColor = vec4(paint, clamp(cover, 0.0, 1.0) * uFade);
    return;
  }

  col += core + shade;
  float alpha = clamp(sm * pow(brightness(col), 2.5) * 2.0, 0.0, 1.0) * edgeFalloff;
  col = pow(max(col, 0.0), vec3(0.95));
  float glowA = clamp(halo * 0.35, 0.0, 1.0) * (1.0 - alpha);
  float total = alpha + glowA;
  vec3 mixed = (col * alpha + vivid * 1.1 * glowA) / max(total, 0.0001);
  gl_FragColor = vec4(mixed, clamp(total, 0.0, 1.0) * uFade);
}
`;

function createBlob(
  root: HTMLDivElement,
  stage: HTMLDivElement,
  settingsRef: { current: Settings },
): Controller | null {
  const doc = root.ownerDocument;
  const view = doc.defaultView ?? window;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      premultipliedAlpha: false,
      stencil: false,
      depth: false,
    });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;background:transparent';
  stage.appendChild(canvas);

  const settings = () => settingsRef.current;
  const uniforms = {
    uTime: { value: 0 },
    uColorTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uGlowIntensity: { value: 0.8 },
    uNoiseScale: { value: 3 },
    uInnerScale: { value: 1 },
    uColor1: { value: new THREE.Vector3() },
    uColor2: { value: new THREE.Vector3() },
    uColor3: { value: new THREE.Vector3() },
    uColor4: { value: new THREE.Vector3() },
    uRimWidth: { value: 1 },
    uRimIntensity: { value: 1 },
    uCoreIntensity: { value: 1 },
    uGlints: { value: 1 },
    uHalo: { value: 1 },
    uWobble: { value: 0 },
    uLevel: { value: 0 },
    uReact: { value: 0.4 },
    uListen: { value: 0 },
    uThink: { value: 0 },
    uLook: { value: new THREE.Vector2() },
    uJiggle: { value: 0 },
    uTapAngle: { value: 0 },
    uTapAge: { value: 10 },
    uInk: { value: 0 },
    uFade: { value: 1 },
    uGrow: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: false,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let sized = false;
  let colorKey = '';
  let inkAt = -10;
  let clock = 0;
  let colorClock = 0;
  let level = 0;
  let lookX = 0;
  let lookY = 0;
  let lookTargetX = 0;
  let lookTargetY = 0;
  let jiggle = 0;
  let tapAngle = 0;
  let tapAge = 10;
  let introStart = -1;
  let grow = 1;
  let growVelocity = 0;
  let fade = 1;
  let raf = 0;
  let last = 0;
  let visible = false;
  let destroyed = false;
  let lost = false;
  let press: { id: number; x: number; y: number; time: number } | null = null;
  const mood: Mood = { ...MOODS.idle };

  const pageIsLight = () => {
    let node: HTMLElement | null = root.parentElement;
    while (node) {
      const match = view.getComputedStyle(node).backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (match) {
        const parts = match[1].split(',').map((part) => Number.parseFloat(part));
        if (parts.length < 4 || parts[3] > 0.05) return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2] > 140;
      }
      node = node.parentElement;
    }
    return !view.matchMedia('(prefers-color-scheme: dark)').matches;
  };

  const syncColors = () => {
    const s = settings();
    const list = s.colors.length ? s.colors : DEFAULT_COLORS;
    const key = list.join('|');
    if (key === colorKey) return;
    colorKey = key;
    const pick = (index: number) => parseColor(list[index] ?? list[index % list.length], DEFAULT_COLORS[index]);
    uniforms.uColor1.value.copy(pick(0));
    uniforms.uColor2.value.copy(pick(1));
    uniforms.uColor3.value.copy(pick(2));
    uniforms.uColor4.value.copy(pick(3));
  };

  const syncInk = () => {
    const s = settings();
    uniforms.uInk.value = s.blend === 'ink' ? 1 : s.blend === 'glow' ? 0 : pageIsLight() ? 1 : 0;
  };

  const readSize = () => {
    const s = settings();
    const nextWidth = Math.round(root.clientWidth);
    const nextHeight = Math.round(root.clientHeight);
    if (nextWidth < 2 || nextHeight < 2) {
      sized = false;
      return false;
    }
    const nextRatio = Math.min(view.devicePixelRatio || 1, 2) * clamp(finite(s.resolution, 1), 0.25, 2);
    if (sized && nextWidth === width && nextHeight === height && nextRatio === pixelRatio) return false;
    sized = true;
    width = nextWidth;
    height = nextHeight;
    pixelRatio = nextRatio;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    uniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio);
    return true;
  };

  const simulated = (t: number, state: AIBlobState) => {
    const syllable = Math.pow(0.5 + 0.5 * Math.sin(t * 9 + 2 * Math.sin(t * 2.3)), 3);
    const phrase = smooth(0.2, 0.65, 0.5 + 0.35 * Math.sin(t * 0.9) + 0.25 * Math.sin(t * 2.1 + 1));
    return syllable * phrase * (0.7 + 0.3 * Math.sin(t * 13.7)) * (state === 'speaking' ? 1 : 0.6);
  };

  const readLevel = (s: Settings, now: number) => {
    if (s.getVolume) {
      try {
        return clamp(finite(s.getVolume(), 0), 0, 1);
      } catch {
        return 0;
      }
    }
    if (s.volume !== undefined) return clamp(finite(s.volume, 0), 0, 1);
    if (s.autoVolume && (s.state === 'listening' || s.state === 'speaking')) return simulated(now / 1000, s.state);
    return 0;
  };

  const render = () => {
    if (!sized) return;
    const s = settings();
    if (performance.now() - inkAt > 1000) {
      inkAt = performance.now();
      syncInk();
    }
    syncColors();
    uniforms.uTime.value = clock;
    uniforms.uColorTime.value = colorClock;
    uniforms.uGlowIntensity.value = clamp(finite(s.glowIntensity, 0.8), 0, 3);
    uniforms.uNoiseScale.value = clamp(finite(s.noiseScale, 3), 0.1, 20);
    uniforms.uInnerScale.value = clamp(finite(s.innerScale, 1), 0.05, 5);
    uniforms.uRimWidth.value = clamp(finite(s.rimWidth, 1), 0.05, 6);
    uniforms.uRimIntensity.value = clamp(finite(s.rimIntensity, 1), 0, 3);
    uniforms.uCoreIntensity.value = clamp(finite(s.coreIntensity, 1), 0, 3);
    uniforms.uGlints.value = clamp(finite(s.glints, 1), 0, 3);
    uniforms.uHalo.value = clamp(finite(s.halo, 1), 0, 3);
    uniforms.uWobble.value = s.reduced ? 0 : clamp(finite(s.wobble, 0), 0, 3);
    uniforms.uLevel.value = level;
    uniforms.uReact.value = clamp(finite(s.reactivity, 1), 0, 3) * mood.react;
    uniforms.uListen.value = mood.listen;
    uniforms.uThink.value = mood.think;
    uniforms.uLook.value.set(lookX, lookY);
    uniforms.uJiggle.value = jiggle;
    uniforms.uTapAngle.value = tapAngle;
    uniforms.uTapAge.value = tapAge;
    uniforms.uFade.value = fade;
    uniforms.uGrow.value = grow;
    renderer.render(scene, camera);
  };

  const schedule = () => {
    if (destroyed || lost || !visible || raf) return;
    raf = requestAnimationFrame(frame);
  };

  const frame = (now: number) => {
    raf = 0;
    if (destroyed || lost) return;
    const s = settings();
    const dt = last && now - last < 100 ? Math.min(Math.max((now - last) / 1000, 0), 0.05) : 1 / 60;
    last = now;
    const moving = !s.reduced && !s.paused;
    const goal = MOODS[s.state] ?? MOODS.idle;
    const ease = s.reduced ? 1 : 1 - Math.exp(-dt / 0.35);
    mood.speed += (goal.speed - mood.speed) * ease;
    mood.color += (goal.color - mood.color) * ease;
    mood.react += (goal.react - mood.react) * ease;
    mood.listen += (goal.listen - mood.listen) * ease;
    mood.think += (goal.think - mood.think) * ease;
    if (moving) {
      const speed = clamp(finite(s.animationSpeed, 1), 0, 5);
      clock += dt * speed * mood.speed;
      colorClock += dt * speed * clamp(finite(s.colorSpeed, 1), 0, 5) * mood.color;
      tapAge += dt;
      if (tapAge > 6) jiggle = 0;
    }
    const target = moving ? readLevel(s, now) : 0;
    level += (target - level) * (1 - Math.exp(-dt / (target > level ? 0.05 : 0.22)));
    const follow = s.reduced ? 1 : 1 - Math.exp(-dt / 0.35);
    lookX += (lookTargetX - lookX) * follow;
    lookY += (lookTargetY - lookY) * follow;
    if (s.intro && !s.reduced) {
      if (introStart < 0) introStart = now;
      fade = clamp((now - introStart) / 450, 0, 1);
      growVelocity += (-70 * (grow - 1) - 9 * growVelocity) * dt;
      grow += growVelocity * dt;
    } else {
      fade = 1;
      grow = 1;
      growVelocity = 0;
    }
    render();
    const settling =
      Math.abs(lookTargetX - lookX) + Math.abs(lookTargetY - lookY) > 0.0005 ||
      level > 0.0005 ||
      Math.abs(grow - 1) + Math.abs(growVelocity) > 0.0005 ||
      fade < 1;
    if ((moving || settling) && !doc.hidden) raf = requestAnimationFrame(frame);
    else last = 0;
  };

  const tap = (angle: number, strength: number) => {
    jiggle = Math.min(jiggle * Math.exp(-tapAge * 3) + strength, 2.2);
    tapAge = 0;
    tapAngle = angle;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now() };
  };

  const onPointerUp = (event: PointerEvent) => {
    const current = press;
    press = null;
    if (!current || current.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 10) return;
    if (performance.now() - current.time > 600) return;
    const s = settings();
    if (!s.interactive || s.reduced || s.paused) return;
    const box = root.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    tap(Math.atan2(box.top + box.height / 2 - event.clientY, event.clientX - box.left - box.width / 2), 1);
    schedule();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    const s = settings();
    const box = root.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    const amount = clamp(finite(s.hoverTilt, 1), 0, 3);
    lookTargetX = clamp(((event.clientX - box.left) / box.width - 0.5) * 2, -1, 1) * amount;
    lookTargetY = clamp((0.5 - (event.clientY - box.top) / box.height) * 2, -1, 1) * amount;
    schedule();
  };

  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    lookTargetX = 0;
    lookTargetY = 0;
    schedule();
  };

  const onPointerCancel = () => {
    press = null;
  };

  const onVisibility = () => {
    last = 0;
    schedule();
  };

  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    cancelAnimationFrame(raf);
    raf = 0;
  };

  const onRestored = () => {
    lost = false;
    colorKey = '';
    schedule();
  };

  const resizeObserver = new ResizeObserver(() => {
    if (readSize()) {
      render();
      schedule();
    }
  });

  const intersection = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      last = 0;
      schedule();
    },
    { rootMargin: '120px' },
  );

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerleave', onPointerLeave);
  root.addEventListener('pointercancel', onPointerCancel);
  doc.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  resizeObserver.observe(root);
  intersection.observe(root);
  if (settings().intro && !settings().reduced) {
    grow = 0.7;
    fade = 0;
  }
  clock = settings().reduced ? 2 : 0;
  readSize();

  return {
    sync: () => {
      inkAt = -10;
      readSize();
      last = 0;
      if (!raf && visible) {
        render();
        schedule();
      }
    },
    tap: (angle, strength) => {
      if (settings().reduced) return;
      tap(
        angle === undefined ? Math.random() * Math.PI * 2 : (finite(angle, 0) * Math.PI) / 180,
        clamp(finite(strength ?? 1, 1), 0, 2),
      );
      schedule();
    },
    destroy: () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersection.disconnect();
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointerup', onPointerUp);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerleave', onPointerLeave);
      root.removeEventListener('pointercancel', onPointerCancel);
      doc.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

export const AIBlob = forwardRef<AIBlobHandle, AIBlobProps>(function AIBlob(
  {
    size = 400,
    animationSpeed = 1,
    glowIntensity = 0.8,
    noiseScale = 3,
    innerScale = 1,
    resolution = 1,
    colors = DEFAULT_COLORS,
    state = 'idle',
    volume,
    getVolume,
    autoVolume = true,
    reactivity = 1,
    rimWidth = 1,
    rimIntensity = 1,
    coreIntensity = 1,
    glints = 1,
    halo = 1,
    colorSpeed = 1,
    wobble = 0,
    hoverTilt = 1,
    interactive = true,
    blend = 'auto',
    intro = true,
    paused = false,
    className,
    style,
  },
  ref,
) {
  const [unavailable, setUnavailable] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<Controller | null>(null);
  const reduced = useSyncExternalStore(subscribeToMotion, readMotion, () => false);

  const settings: Settings = {
    size,
    animationSpeed,
    glowIntensity,
    noiseScale,
    innerScale,
    resolution,
    colors,
    state,
    volume,
    getVolume,
    autoVolume,
    reactivity,
    rimWidth,
    rimIntensity,
    coreIntensity,
    glints,
    halo,
    colorSpeed,
    wobble,
    hoverTilt,
    interactive,
    blend,
    intro,
    paused,
    reduced,
  };
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
    controllerRef.current?.sync();
  });

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return;
    const controller = createBlob(root, stage, settingsRef);
    controllerRef.current = controller;
    setUnavailable(!controller);
    return () => {
      controller?.destroy();
      controllerRef.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      tap: (angle?: number, strength?: number) => controllerRef.current?.tap(angle, strength),
    }),
    [],
  );

  return (
    <div
      ref={rootRef}
      className={cn('relative', className)}
      style={{ width: size, height: size, touchAction: 'manipulation', ...style }}
    >
      <div ref={stageRef} aria-hidden="true" className="pointer-events-none absolute inset-0 select-none" />
    </div>
  );
});

AIBlob.displayName = 'AIBlob';

export default AIBlob;
