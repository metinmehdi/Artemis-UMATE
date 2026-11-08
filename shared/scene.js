// Shared 3D station scene (low-poly, procedural; no external assets).
// Used by the phone (stereo VR) AND the panel (mono spectator view), so both always show the
// same thing. The scene is a pure "view": call applyState(state) to reflect app state.
import * as THREE from 'three';

const COLORS = {
  bg: 0x1b1e26,
  floor1: '#8d8a84',
  floor2: '#7b7872',
  wall: 0xd8c9a8,
  wallBand: 0x2f6f8f,
  ceiling: 0xe9e4da,
  light: 0xfff6dd,
  pit: 0x2a2a2a,
  rail: 0x9a9a9a,
  yellow: 0xf2c230,
  column: 0xcfc2a3,
  terminal: 0x1f5fa8,
  gate: 0x8c949c,
  green: 0x3ddc84,
  buddy: 0x7fdcff,
};

// ---------- helpers ----------
export function makeLabel(text, opts = {}) {
  const {
    width = 1,
    height = 0.3,
    fg = '#ffffff',
    bg = 'rgba(10,14,22,0.82)',
    radius = 24,
    weight = 700,
    maxFont = 120,
  } = opts;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.max(64, Math.round((1024 * height) / width));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  let last = null;
  mesh.setText = (t, o = {}) => {
    const key = JSON.stringify([t, o]);
    if (key === last) return;
    last = key;
    const c = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = o.bg ?? bg;
    c.beginPath();
    c.roundRect(0, 0, W, H, radius);
    c.fill();
    const lines = String(t).split('\n');
    let size = Math.min(maxFont, Math.floor((H / lines.length) * 0.62));
    c.font = `${weight} ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    const widest = Math.max(...lines.map((l) => c.measureText(l).width));
    if (widest > W * 0.9) {
      size = Math.floor((size * W * 0.9) / widest);
      c.font = `${weight} ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    }
    c.fillStyle = o.fg ?? fg;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const lh = size * 1.18;
    const top = H / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => c.fillText(l, W / 2, top + i * lh));
    tex.needsUpdate = true;
  };
  mesh.setText(text);
  return mesh;
}

function box(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color, ...opts }),
  );
  return m;
}

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = COLORS.floor1;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = COLORS.floor2;
  g.fillRect(0, 0, 64, 64);
  g.fillRect(64, 64, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function plane(w, d, color, map) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshLambertMaterial(map ? { color: 0xffffff, map } : { color }),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

// Mark an object as selectable by gaze. onSelect receives the object.
export function makeInteractive(obj, id, { dwell = true } = {}) {
  obj.userData.interactive = true;
  obj.userData.id = id;
  obj.userData.dwell = dwell;
  return obj;
}

// ---------- footprint marker ("walk here") ----------
function makeFootprint(id) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.55, 40),
    new THREE.MeshBasicMaterial({ color: COLORS.green, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 40),
    new THREE.MeshBasicMaterial({ color: COLORS.green, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
  );
  disc.rotation.x = -Math.PI / 2;
  // two simple "feet"
  const footMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  for (const x of [-0.11, 0.11]) {
    const f = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), footMat);
    f.scale.set(0.7, 1.4, 1);
    f.rotation.x = -Math.PI / 2;
    f.position.set(x, 0.002, x < 0 ? 0.03 : -0.03);
    g.add(f);
  }
  g.add(ring, disc);
  g.position.y = 0.02;
  g.userData.ring = ring;
  makeInteractive(g, `go:${id}`);
  return g;
}

// ---------- AI buddy (small glowing robot orb) ----------
function makeBuddy() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 24, 16),
    new THREE.MeshBasicMaterial({ color: COLORS.buddy }),
  );
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 24, 16),
    new THREE.MeshBasicMaterial({ color: COLORS.buddy, transparent: true, opacity: 0.18, depthWrite: false }),
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.2, 0.012, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
  );
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0b2233 });
  const eyes = new THREE.Group();
  for (const x of [-0.035, 0.035]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), eyeMat);
    e.scale.set(1, 1.5, 0.5);
    e.position.set(x, 0.015, 0.1);
    eyes.add(e);
  }
  // invisible bigger hit sphere so it is easy to look at
  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 12, 8),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  g.add(core, halo, ring, eyes, hit);
  g.userData.parts = { core, halo, ring };
  makeInteractive(g, 'buddy', { dwell: false });
  g.userData.anchorYaw = null;
  g.userData.mode = 'idle'; // idle | listening | speaking | offline
  return g;
}

// ---------- the station ----------
export function buildStation() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.bg);
  scene.fog = new THREE.Fog(COLORS.bg, 18, 42);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x555048, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(3, 8, 5);
  scene.add(sun);

  // Architecture lives in its own group so the "AI panorama" visual style can hide it.
  const arch = new THREE.Group();
  scene.add(arch);

  const ftex = floorTexture();
  ftex.repeat.set(14, 11);
  const concourse = plane(14, 11, null, ftex);
  concourse.position.set(0, 0, 6.5);
  arch.add(concourse);

  const ptex = ftex.clone();
  ptex.needsUpdate = true;
  ptex.repeat.set(6, 19);
  const platform = plane(6, 19, null, ptex);
  platform.position.set(0, 0, -8.5);
  arch.add(platform);

  // track pits + rails
  for (const side of [-1, 1]) {
    const pit = plane(4, 19, COLORS.pit);
    pit.position.set(side * 5, -1.1, -8.5);
    arch.add(pit);
    const edge = new THREE.Mesh(
      new THREE.PlaneGeometry(19, 1.1),
      new THREE.MeshLambertMaterial({ color: 0x55524c, side: THREE.DoubleSide }),
    );
    edge.rotation.y = Math.PI / 2;
    edge.position.set(side * 3, -0.55, -8.5);
    arch.add(edge);
    const line = plane(0.15, 19, COLORS.yellow);
    line.position.set(side * 2.6, 0.005, -8.5);
    arch.add(line);
    for (const dx of [-0.7, 0.7]) {
      const rail = box(0.08, 0.12, 19, COLORS.rail);
      rail.position.set(side * 5 + dx, -1.04, -8.5);
      arch.add(rail);
    }
  }

  // walls, ceiling, light strips
  const wallMat = new THREE.MeshLambertMaterial({ color: COLORS.wall, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(31, 5.6), wallMat);
    wall.rotation.y = Math.PI / 2;
    wall.position.set(side * 7, 1.7, -2.5);
    arch.add(wall);
    const band = box(0.05, 0.5, 31, COLORS.wallBand);
    band.position.set(side * 6.97, 1.6, -2.5);
    arch.add(band);
  }
  const back = new THREE.Mesh(new THREE.PlaneGeometry(14, 5.6), wallMat);
  back.position.set(0, 1.7, -18);
  arch.add(back);
  const front = back.clone();
  front.position.z = 12;
  arch.add(front);
  const ceiling = plane(14, 30, COLORS.ceiling);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, 4.5, -3);
  arch.add(ceiling);
  for (const x of [-4.5, 0, 4.5]) {
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.05, 28),
      new THREE.MeshBasicMaterial({ color: COLORS.light }),
    );
    strip.position.set(x, 4.45, -3);
    arch.add(strip);
  }

  // columns on the island platform
  for (let z = -3; z >= -16; z -= 4.5) {
    for (const x of [-1.6, 1.6]) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.32, 4.5, 8),
        new THREE.MeshLambertMaterial({ color: COLORS.column }),
      );
      col.position.set(x, 2.25, z);
      arch.add(col);
    }
  }

  // ---- visual style A/B: 'lowpoly' (3D architecture) or 'ai' (AI-generated 360° panorama) ----
  let style = 'lowpoly';
  let panoTex = null;
  const defaultBg = scene.background;
  function setStyle(next) {
    if (next === style) return;
    style = next;
    if (style === 'ai') {
      arch.visible = false;
      scene.fog = null;
      // Rotate so the panorama centre (the corridor) faces forward (-Z). Verified by screenshot.
      scene.backgroundRotation.set(0, Math.PI / 2, 0);
      if (!panoTex) {
        panoTex = new THREE.TextureLoader().load('/assets/pano/metro-ai.png', (t) => {
          t.mapping = THREE.EquirectangularReflectionMapping;
          t.colorSpace = THREE.SRGBColorSpace;
          if (style === 'ai') scene.background = t;
        });
      } else scene.background = panoTex;
    } else {
      arch.visible = true;
      scene.background = defaultBg;
      scene.fog = new THREE.Fog(COLORS.bg, 18, 42);
    }
  }

  const interactives = [];

  // ---- trip board at entrance ----
  const tripBoard = makeLabel('Your trip\nKoroglu  →  28 May', { width: 2.4, height: 0.9 });
  tripBoard.position.set(0, 2.2, 7.6);
  scene.add(tripBoard);

  // ---- top-up terminal (BakuKart) ----
  const terminal = new THREE.Group();
  const body = box(0.8, 1.7, 0.45, COLORS.terminal);
  body.position.y = 0.85;
  const screen = makeLabel('BakuKart\nBalance: 0.00 AZN', { width: 0.62, height: 0.46, bg: '#0d1b2a', maxFont: 90 });
  screen.position.set(0, 1.35, 0.231);
  const topup = makeLabel('Top up\n1 AZN', { width: 0.5, height: 0.28, bg: '#1f9d55', maxFont: 90 });
  topup.position.set(0, 0.95, 0.232);
  makeInteractive(topup, 'topup');
  const header = makeLabel('TOP UP', { width: 0.8, height: 0.2, bg: '#12396b' });
  header.position.set(0, 1.82, 0.231);
  terminal.add(body, screen, topup, header);
  terminal.position.set(-2.5, 0, 7.2);
  scene.add(terminal);
  interactives.push(topup);

  // ---- turnstiles ----
  const gates = new THREE.Group();
  const glass = new THREE.MeshLambertMaterial({ color: 0x9fd3e6, transparent: true, opacity: 0.35 });
  for (const [x0, x1] of [[-7, -1.9], [1.9, 7]]) {
    const pane = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 1.1, 0.05), glass);
    pane.position.set((x0 + x1) / 2, 0.55, 3);
    gates.add(pane);
  }
  const arms = [];
  let reader = null;
  for (const x of [-1.25, 0, 1.25]) {
    const ped = box(0.22, 1.0, 1.0, COLORS.gate);
    ped.position.set(x - 0.62, 0.5, 3);
    gates.add(ped);
    const arm = box(1.0, 0.06, 0.06, 0xd0d4d8);
    arm.geometry.translate(0.5, 0, 0); // hinge at left end
    arm.position.set(x - 0.5, 0.85, 3);
    gates.add(arm);
    arms.push(arm);
  }
  const lastPed = box(0.22, 1.0, 1.0, COLORS.gate);
  lastPed.position.set(1.25 + 0.62, 0.5, 3);
  gates.add(lastPed);
  // card reader on the middle gate
  reader = makeLabel('Tap card', { width: 0.34, height: 0.22, bg: '#203040', maxFont: 70 });
  reader.rotation.x = -Math.PI / 5;
  reader.position.set(-0.62, 1.03, 3.25);
  makeInteractive(reader, 'reader');
  gates.add(reader);
  interactives.push(reader);
  scene.add(gates);

  // ---- direction signs on the platform ----
  const signLeft = makeLabel('←  Icherisheher', { width: 2.2, height: 0.45, bg: '#b3261e' });
  signLeft.position.set(-1.6, 3.0, -6.4);
  makeInteractive(signLeft, 'sign:left');
  const signRight = makeLabel('Hazi Aslanov  →', { width: 2.2, height: 0.45, bg: '#b3261e' });
  signRight.position.set(1.6, 3.0, -6.4);
  makeInteractive(signRight, 'sign:right');
  scene.add(signLeft, signRight);
  interactives.push(signLeft, signRight);

  const feedback = makeLabel('', { width: 2.6, height: 0.5, bg: 'rgba(0,0,0,0)' });
  feedback.position.set(0, 2.2, -6.3);
  feedback.visible = false;
  scene.add(feedback);

  // ---- navigation nodes ----
  const nodes = {
    entrance: { id: 'entrance', pos: new THREE.Vector3(0, 0, 10.5), yaw: 0 },
    terminal: { id: 'terminal', pos: new THREE.Vector3(-2.5, 0, 8.4), yaw: 0 },
    gate: { id: 'gate', pos: new THREE.Vector3(-0.4, 0, 4.9), yaw: 0 },
    platform: { id: 'platform', pos: new THREE.Vector3(0, 0, -2.5), yaw: 0 },
  };
  const footprints = {};
  for (const id of ['terminal', 'gate', 'platform']) {
    const fp = makeFootprint(id);
    fp.position.x = nodes[id].pos.x;
    fp.position.z = nodes[id].pos.z;
    fp.visible = false;
    scene.add(fp);
    footprints[id] = fp;
    interactives.push(fp);
  }

  // ---- buddy ----
  const buddy = makeBuddy();
  scene.add(buddy);
  interactives.push(buddy);

  // ---------- state -> visuals ----------
  let gateOpenT = 0;
  let gateOpen = false;
  function applyState(s) {
    screen.setText(`BakuKart\nBalance: ${s.balance.toFixed(2)} AZN`);
    if (s.readerText) reader.setText(s.readerText, { bg: s.readerBg || '#203040' });
    gateOpen = !!s.gateOpen;
    for (const [id, fp] of Object.entries(footprints)) fp.visible = (s.footprints || []).includes(id);
    if (s.feedback) {
      feedback.visible = true;
      feedback.setText(s.feedback.text, { bg: s.feedback.ok ? '#1f9d55' : '#c26a12' });
    } else feedback.visible = false;
    buddy.userData.mode = s.buddyMode || buddy.userData.mode;
    if (s.style) setStyle(s.style);
  }

  // ---------- per-frame animation ----------
  const tmpV = new THREE.Vector3();
  const tmpE = new THREE.Euler();
  function update(dt, t, camPos, camQuat) {
    for (const fp of Object.values(footprints)) {
      if (!fp.visible) continue;
      const s = 1 + Math.sin(t * 4) * 0.08;
      fp.userData.ring.scale.set(s, s, s);
    }
    gateOpenT = THREE.MathUtils.clamp(gateOpenT + (gateOpen ? dt : -dt) * 2.5, 0, 1);
    arms[1].rotation.y = -gateOpenT * (Math.PI / 2);

    // buddy: lazy-follow at the left-front of the head so it can be looked at
    if (camPos && camQuat) {
      tmpE.setFromQuaternion(camQuat, 'YXZ');
      const headYaw = tmpE.y;
      const a = buddy.userData;
      if (a.anchorYaw === null || Math.abs(angleDiff(headYaw, a.anchorYaw)) > 1.05) a.anchorYaw = headYaw;
      tmpV.set(-0.75, -0.22, -1.0).applyAxisAngle(UP, a.anchorYaw).add(camPos);
      if (!a.placed) {
        buddy.position.copy(tmpV);
        a.placed = true;
      } else buddy.position.lerp(tmpV, Math.min(1, dt * 2.5));
      buddy.position.y += Math.sin(t * 2) * 0.004;
      buddy.lookAt(camPos);
      const p = buddy.userData.parts;
      const mode = a.mode;
      const pulse = mode === 'speaking' ? 1 + Math.abs(Math.sin(t * 9)) * 0.18 : 1 + Math.sin(t * 2) * 0.04;
      p.core.scale.setScalar(pulse);
      p.halo.material.opacity = mode === 'speaking' ? 0.35 : 0.18;
      p.ring.material.color.set(mode === 'listening' ? COLORS.green : mode === 'offline' ? 0x777777 : 0xffffff);
      p.ring.material.opacity = mode === 'listening' ? 0.95 : 0.35;
      p.core.material.color.set(mode === 'offline' ? 0x667788 : COLORS.buddy);
    }
  }

  return { scene, nodes, interactives, footprints, buddy, applyState, update };
}

const UP = new THREE.Vector3(0, 1, 0);
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
