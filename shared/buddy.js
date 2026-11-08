// AI buddy: an abstract, voice-reactive "aurora" orb (no face) — calm, modern, readable at a glance.
// States: idle (slow breathing), listening (bright rim + ring reacts to the learner's voice),
// speaking (pulses with the buddy's voice), offline (dim grey).
import * as THREE from 'three';

const vert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    vP = position;
    gl_Position = projectionMatrix * mv;
  }
`;

const frag = /* glsl */ `
  uniform float uTime;
  uniform float uLevel;
  uniform float uDim;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  void main() {
    float fres = pow(1.0 - clamp(dot(vN, vV), 0.0, 1.0), 2.2);
    vec3 p = normalize(vP);
    float t = uTime * 0.6;
    float w1 = sin(p.y * 5.0 + t * 2.0 + sin(p.x * 4.0 - t)) * 0.5 + 0.5;
    float w2 = sin(p.x * 6.0 - t * 1.4 + cos(p.z * 5.0 + t)) * 0.5 + 0.5;
    vec3 col = mix(uA, uB, w1);
    col = mix(col, uC, w2 * 0.45);
    col = col * (0.55 + 0.45 * (1.0 - fres)) + vec3(1.0) * fres * (0.55 + uLevel * 0.6);
    col *= 1.0 + uLevel * 0.5;
    col = mix(col, vec3(dot(col, vec3(0.33))), uDim);
    float a = clamp(0.82 + fres * 0.3, 0.0, 1.0);
    gl_FragColor = vec4(col * (1.0 - uDim * 0.45), a);
  }
`;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.35, 'rgba(126,224,195,0.35)');
  grd.addColorStop(1, 'rgba(122,79,176,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeBuddy() {
  const group = new THREE.Group();
  const uniforms = {
    uTime: { value: 0 },
    uLevel: { value: 0 },
    uDim: { value: 0 },
    uA: { value: new THREE.Color('#7ee0c3') }, // brand mint
    uB: { value: new THREE.Color('#7a4fb0') }, // lifted night purple
    uC: { value: new THREE.Color('#faf6e9') }, // ivory
  };
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 48, 32),
    new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true }),
  );
  orb.renderOrder = 25;
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }),
  );
  glow.scale.setScalar(0.42);
  glow.renderOrder = 24;
  // listening ring (reacts to the learner's voice)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.11, 0.004, 8, 96),
    new THREE.MeshBasicMaterial({ color: '#7ee0c3', transparent: true, opacity: 0, depthWrite: false }),
  );
  ring.renderOrder = 26;
  // generous invisible hit area so it is easy to look at
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
  group.add(glow, orb, ring, hit);
  group.userData = { interactive: true, id: 'buddy', dwell: false, mode: 'offline', level: 0, mic: 0, anchorYaw: null, placed: false };

  let smooth = 0;
  let smoothMic = 0;
  group.tick = (dt, t, camPos) => {
    const u = group.userData;
    const mode = u.mode;
    const target = mode === 'speaking' ? Math.max(u.level, 0.25 + 0.2 * Math.abs(Math.sin(t * 7))) : 0;
    smooth += (target - smooth) * Math.min(1, dt * 10);
    smoothMic += ((mode === 'listening' ? u.mic : 0) - smoothMic) * Math.min(1, dt * 12);
    uniforms.uTime.value = t;
    uniforms.uLevel.value = smooth;
    // offline = calmer and slightly muted, but still recognisably the buddy (never a grey blob)
    uniforms.uDim.value += ((mode === 'offline' ? 0.35 : 0) - uniforms.uDim.value) * Math.min(1, dt * 4);
    const breathe = 1 + Math.sin(t * 1.6) * 0.035;
    orb.scale.setScalar(breathe * (1 + smooth * 0.22));
    glow.material.opacity = 0.35 + smooth * 0.5 + (mode === 'listening' ? 0.2 : 0);
    glow.scale.setScalar(0.38 + smooth * 0.18);
    ring.material.opacity += ((mode === 'listening' ? 0.95 : 0) - ring.material.opacity) * Math.min(1, dt * 8);
    ring.scale.setScalar(1 + smoothMic * 0.35);
    if (camPos) ring.lookAt(camPos);
  };
  return group;
}
