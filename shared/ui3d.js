// World-space UI kit for the VR scene (canvas-texture panels).
// Design tokens follow real Baku Metro wayfinding: metro-blue boards, red "M" roundel,
// official line colours. Type: Atkinson Hyperlegible Next (built for low-vision legibility).
import * as THREE from 'three';

export const TOKENS = {
  metroBlue: '#1f3c96',
  metroBlueDeep: '#172e74',
  signalRed: '#ee1d23',
  lineRed: '#ee1d23',
  lineGreen: '#00ab5b',
  linePurple: '#8e177c',
  go: '#16a34a',
  stop: '#dc2626',
  paper: '#f7f8fa',
  ink: '#0f141c',
  glass: 'rgba(15,20,28,0.86)',
  glassEdge: 'rgba(255,255,255,0.18)',
  muted: 'rgba(247,248,250,0.72)',
  focus: '#6fe3ff',
};

export const FONT = '"Atkinson Next", "Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export async function loadFonts() {
  if (!document.fonts) return;
  try {
    await Promise.all([document.fonts.load(`700 64px ${FONT}`, 'Əə Ğğ İı Şş Çç Öö Üü'), document.fonts.load(`400 64px ${FONT}`, 'Aa')]);
  } catch {}
}

const PX_PER_M = 900; // canvas resolution per metre of panel width

// A flat panel whose look is drawn by `draw(ctx, w, h, state)` onto a canvas texture.
export function makePanel(width, height, draw, { interactive = null, renderOrder = 10, depthTest = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * PX_PER_M);
  canvas.height = Math.round(height * PX_PER_M);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  mesh.renderOrder = renderOrder;
  let lastKey = null;
  mesh.redraw = (state = {}, force = false) => {
    const key = JSON.stringify(state);
    if (!force && key === lastKey) return;
    lastKey = key;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    draw(ctx, canvas.width, canvas.height, state);
    tex.needsUpdate = true;
  };
  mesh.redraw({}, true);
  if (interactive) {
    mesh.userData.interactive = true;
    mesh.userData.id = interactive;
    mesh.userData.dwell = true;
  }
  return mesh;
}

// ---------- drawing helpers ----------
export function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function text(ctx, str, x, y, { size = 60, weight = 700, color = TOKENS.paper, align = 'left', baseline = 'alphabetic', maxWidth } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (maxWidth) {
    let s = size;
    while (ctx.measureText(str).width > maxWidth && s > 12) {
      s -= 2;
      ctx.font = `${weight} ${s}px ${FONT}`;
    }
  }
  ctx.fillText(str, x, y);
}

// Baku-Metro style roundel: red "M" in a white circle.
export function roundel(ctx, cx, cy, r) {
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = TOKENS.signalRed;
  ctx.lineWidth = r * 0.2;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  const w = r * 0.62;
  const h = r * 0.58;
  ctx.beginPath();
  ctx.moveTo(cx - w, cy + h);
  ctx.lineTo(cx - w * 0.78, cy - h);
  ctx.lineTo(cx, cy + h * 0.35);
  ctx.lineTo(cx + w * 0.78, cy - h);
  ctx.lineTo(cx + w, cy + h);
  ctx.stroke();
}

export function lineBullet(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

// Simple vector icons (no emoji).
export const icon = {
  arrow(ctx, cx, cy, s, dir = 'right', color = TOKENS.paper) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate({ right: 0, left: Math.PI, up: -Math.PI / 2, down: Math.PI / 2 }[dir]);
    ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.16;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, 0);
    ctx.lineTo(s * 0.45, 0);
    ctx.moveTo(s * 0.1, -s * 0.38);
    ctx.lineTo(s * 0.48, 0);
    ctx.lineTo(s * 0.1, s * 0.38);
    ctx.stroke();
    ctx.restore();
  },
  check(ctx, cx, cy, s, color = '#fff') {
    ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.16;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.38, cy + s * 0.02);
    ctx.lineTo(cx - s * 0.1, cy + s * 0.3);
    ctx.lineTo(cx + s * 0.42, cy - s * 0.3);
    ctx.stroke();
  },
  cross(ctx, cx, cy, s, color = '#fff') {
    ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.32, cy - s * 0.32);
    ctx.lineTo(cx + s * 0.32, cy + s * 0.32);
    ctx.moveTo(cx + s * 0.32, cy - s * 0.32);
    ctx.lineTo(cx - s * 0.32, cy + s * 0.32);
    ctx.stroke();
  },
  card(ctx, cx, cy, s, color = '#fff') {
    ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.09;
    rr(ctx, cx - s * 0.5, cy - s * 0.32, s, s * 0.64, s * 0.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.5, cy - s * 0.1);
    ctx.lineTo(cx + s * 0.5, cy - s * 0.1);
    ctx.stroke();
    // contactless waves
    ctx.lineWidth = s * 0.06;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.arc(cx + s * 0.2, cy + s * 0.14, s * (0.08 + i * 0.08), -Math.PI / 4, Math.PI / 4);
      ctx.stroke();
    }
  },
  walk(ctx, cx, cy, s, color = '#fff') {
    ctx.fillStyle = color;
    for (const [dx, dy, rot] of [[-0.16, 0.12, -0.15], [0.16, -0.12, 0.15]]) {
      ctx.save();
      ctx.translate(cx + dx * s, cy + dy * s);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.12, s * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },
};

// ---------- components ----------

// Hanging Baku-Metro direction sign. `stations` = next stops in that direction (Azerbaijani names).
export function makeDirectionSign({ towards, towardsEn, stations, arrow = 'left', line = TOKENS.lineRed, id }) {
  const W = 2.1;
  const H = 0.62;
  return makePanel(
    W,
    H,
    (ctx, w, h, s) => {
      const hi = s.highlight;
      rr(ctx, 0, 0, w, h, 26);
      ctx.fillStyle = TOKENS.metroBlue;
      ctx.fill();
      ctx.lineWidth = hi ? 14 : 6;
      ctx.strokeStyle = hi ? TOKENS.focus : 'rgba(255,255,255,0.25)';
      rr(ctx, 3, 3, w - 6, h - 6, 24);
      ctx.stroke();
      const pad = 44;
      const arrowLeft = arrow === 'left';
      const ax = arrowLeft ? pad + 70 : w - pad - 70;
      icon.arrow(ctx, ax, h * 0.34, 120, arrow);
      roundel(ctx, arrowLeft ? w - pad - 52 : pad + 52, h * 0.34, 52);
      const tx = arrowLeft ? pad + 170 : pad + 140;
      lineBullet(ctx, tx + 20, h * 0.34, 18, line);
      text(ctx, towards, tx + 56, h * 0.34 + 26, { size: 82, maxWidth: w - tx - 260 });
      text(ctx, `Towards ${towardsEn}`, tx + 56, h * 0.34 + 80, { size: 40, weight: 400, color: TOKENS.muted });
      // next stops strip
      ctx.fillStyle = TOKENS.metroBlueDeep;
      ctx.fillRect(18, h * 0.7, w - 36, h * 0.26);
      text(ctx, stations.join('  ·  '), w / 2, h * 0.7 + h * 0.18, { size: 52, weight: 700, align: 'center', maxWidth: w - 80 });
    },
    { interactive: id },
  );
}

// Instruction card that floats low in the view: step dots + one instruction.
export function makeTaskCard() {
  return makePanel(
    0.84,
    0.22,
    (ctx, w, h, s) => {
      if (!s.title) return;
      rr(ctx, 0, 0, w, h, 40);
      ctx.fillStyle = TOKENS.glass;
      ctx.fill();
      ctx.strokeStyle = s.tone === 'good' ? TOKENS.go : s.tone === 'warn' ? '#f59e0b' : TOKENS.glassEdge;
      ctx.lineWidth = 5;
      rr(ctx, 2.5, 2.5, w - 5, h - 5, 38);
      ctx.stroke();
      const total = s.total || 4;
      const pad = h * 0.24;
      const dotY = h * 0.25;
      for (let i = 0; i < total; i++) {
        ctx.fillStyle = i < s.step ? TOKENS.go : i === s.step ? TOKENS.paper : 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.arc(pad + i * h * 0.15, dotY, h * 0.045, 0, Math.PI * 2);
        ctx.fill();
      }
      text(ctx, s.kicker || `Step ${Math.min(s.step + 1, total)} of ${total}`, pad + total * h * 0.15 + h * 0.02, dotY + h * 0.055, {
        size: h * 0.15,
        weight: 400,
        color: TOKENS.muted,
      });
      text(ctx, s.title, pad, h * (s.sub ? 0.63 : 0.72), { size: h * 0.27, maxWidth: w - pad * 2 });
      if (s.sub) text(ctx, s.sub, pad, h * 0.86, { size: h * 0.15, weight: 400, color: TOKENS.muted, maxWidth: w - pad * 2 });
    },
    { renderOrder: 30, depthTest: false },
  );
}

// Gaze button (used on the kiosk screen).
export function makeButton(id, label, { width = 0.36, height = 0.13, primary = false, sub } = {}) {
  return makePanel(
    width,
    height,
    (ctx, w, h, s) => {
      rr(ctx, 0, 0, w, h, h * 0.22);
      ctx.fillStyle = s.hover ? (primary ? '#1fbf5f' : '#2b5fd9') : primary ? TOKENS.go : '#24479f';
      ctx.fill();
      if (s.hover) {
        ctx.strokeStyle = TOKENS.focus;
        ctx.lineWidth = 8;
        rr(ctx, 4, 4, w - 8, h - 8, h * 0.2);
        ctx.stroke();
      }
      text(ctx, label, w / 2, sub ? h * 0.5 : h * 0.62, { size: h * 0.36, align: 'center', maxWidth: w - 40 });
      if (sub) text(ctx, sub, w / 2, h * 0.82, { size: h * 0.2, weight: 400, align: 'center', color: TOKENS.muted });
    },
    { interactive: id, renderOrder: 22 },
  );
}

// Hotspot marker placed on a real object in the panorama (kiosk, turnstile...).
export function makeHotspot(id, label, { chipAbove = false } = {}) {
  const g = new THREE.Group();
  const ring = makePanel(
    0.34,
    0.34,
    (ctx, w, h, s) => {
      const c = w / 2;
      const color = s.state === 'ok' ? TOKENS.go : s.state === 'bad' ? TOKENS.stop : TOKENS.paper;
      ctx.fillStyle = s.state ? color : s.hover ? 'rgba(111,227,255,0.35)' : 'rgba(15,20,28,0.45)';
      ctx.beginPath();
      ctx.arc(c, c, c * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = s.hover ? TOKENS.focus : color;
      ctx.lineWidth = c * 0.09;
      ctx.beginPath();
      ctx.arc(c, c, c * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      if (s.state === 'ok') icon.check(ctx, c, c, c * 0.8);
      else if (s.state === 'bad') icon.cross(ctx, c, c, c * 0.8);
      else icon.card(ctx, c, c, c * 0.62, TOKENS.paper);
    },
    { interactive: id, renderOrder: 20, depthTest: false },
  );
  const chip = makePanel(
    0.62,
    0.12,
    (ctx, w, h, s) => {
      rr(ctx, 0, 0, w, h, h / 2);
      ctx.fillStyle = TOKENS.glass;
      ctx.fill();
      text(ctx, s.label ?? label, w / 2, h * 0.66, { size: h * 0.5, align: 'center', maxWidth: w - 40 });
    },
    { renderOrder: 21, depthTest: false },
  );
  chip.position.y = chipAbove ? 0.27 : -0.27;
  g.add(ring, chip);
  g.userData.ring = ring;
  g.userData.chip = chip;
  g.userData.interactive = true;
  g.userData.id = id;
  g.userData.dwell = true;
  return g;
}

// "Walk here" target on the floor.
export function makeFloorTarget(id) {
  const g = new THREE.Group();
  const disc = makePanel(
    0.9,
    0.9,
    (ctx, w, h, s) => {
      const c = w / 2;
      ctx.fillStyle = s.hover ? 'rgba(111,227,255,0.28)' : 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.arc(c, c, c * 0.92, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = s.hover ? TOKENS.focus : '#ffffff';
      ctx.lineWidth = c * 0.07;
      ctx.beginPath();
      ctx.arc(c, c, c * 0.86, 0, Math.PI * 2);
      ctx.stroke();
      icon.walk(ctx, c, c, c * 0.9);
    },
    { interactive: id, renderOrder: 15, depthTest: false },
  );
  disc.rotation.x = -Math.PI / 2;
  g.add(disc);
  g.userData.disc = disc;
  g.userData.interactive = true;
  g.userData.id = id;
  g.userData.dwell = true;
  return g;
}
