// World-space UI kit for the VR scene (canvas-texture panels).
// Two layers, two palettes:
// - the WORLD is the real Baku Metro: metro-blue boards, red "M" roundel, official line colours,
//   the kiosk's own green. Learners practise reading the real signs, so these stay as they are.
// - the GUIDE layer is UMATE: task card, hotspot rings, chips, feedback, summary, floor target.
//   Night-purple glass with ivory text; anything you can select glows mint (the brand's "go" signal).
// Type: Lexend for all text, Fraunces Soft for the one big heading (the arrival summary).
import * as THREE from 'three';
import { BRAND, FONT_UI, FONT_DISPLAY, loadBrandFonts } from './brand.js';

export const TOKENS = {
  // world (real Baku Metro)
  metroBlue: '#1f3c96',
  metroBlueDeep: '#172e74',
  signalRed: '#ee1d23',
  lineRed: '#ee1d23',
  lineGreen: '#00ab5b',
  linePurple: '#8e177c',
  kioskGo: '#16a34a',
  // guide layer (UMATE brand)
  go: BRAND.mint,
  stop: BRAND.amber,
  paper: BRAND.ivory,
  ink: BRAND.ink,
  glass: BRAND.glass,
  glassEdge: BRAND.glassEdge,
  muted: BRAND.ivorySoft,
  focus: BRAND.mint,
  focusGlow: BRAND.mintGlow,
};

export const FONT = FONT_UI;
export { FONT_DISPLAY };

export async function loadFonts() {
  try {
    await loadBrandFonts();
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

export function text(ctx, str, x, y, { size = 60, weight = 700, color = TOKENS.paper, align = 'left', baseline = 'alphabetic', maxWidth, font = FONT } = {}) {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (maxWidth) {
    let s = size;
    while (ctx.measureText(str).width > maxWidth && s > 12) {
      s -= 2;
      ctx.font = `${weight} ${s}px ${font}`;
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
      ctx.strokeStyle = s.tone === 'good' ? TOKENS.go : s.tone === 'warn' ? TOKENS.stop : TOKENS.glassEdge;
      ctx.lineWidth = s.tone ? 8 : 5;
      rr(ctx, 4, 4, w - 8, h - 8, 37);
      ctx.stroke();
      const total = s.total || 4;
      const pad = h * 0.24;
      const dotY = h * 0.25;
      for (let i = 0; i < total; i++) {
        ctx.fillStyle = i < s.step ? TOKENS.go : i === s.step ? TOKENS.paper : BRAND.ivoryFaint;
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

// Gaze button (used on the kiosk screen). The kiosk keeps its own colours; looking at a button
// gives it the guide layer's mint ring, like every other thing you can select.
export function makeButton(id, label, { width = 0.36, height = 0.13, primary = false, sub } = {}) {
  return makePanel(
    width,
    height,
    (ctx, w, h, s) => {
      rr(ctx, 0, 0, w, h, h * 0.22);
      ctx.fillStyle = s.hover ? (primary ? '#1fbf5f' : '#2b5fd9') : primary ? TOKENS.kioskGo : '#24479f';
      ctx.fill();
      if (s.hover) {
        ctx.strokeStyle = TOKENS.focus;
        ctx.lineWidth = 10;
        rr(ctx, 5, 5, w - 10, h - 10, h * 0.2);
        ctx.stroke();
      }
      text(ctx, label, w / 2, sub ? h * 0.5 : h * 0.62, { size: h * 0.36, align: 'center', maxWidth: w - 40 });
      if (sub) text(ctx, sub, w / 2, h * 0.82, { size: h * 0.2, weight: 400, align: 'center', color: TOKENS.muted });
    },
    { interactive: id, renderOrder: 22 },
  );
}

// Hotspot marker placed on a real object in the panorama (kiosk, turnstile...).
export function makeHotspot(id, label, { chipAbove = false, glyph = 'card' } = {}) {
  const g = new THREE.Group();
  const ring = makePanel(
    0.34,
    0.34,
    (ctx, w, h, s) => {
      const c = w / 2;
      const color = s.state === 'ok' ? TOKENS.go : s.state === 'bad' ? TOKENS.stop : s.off ? BRAND.ivoryFaint : TOKENS.paper;
      ctx.fillStyle = s.state ? color : s.hover ? TOKENS.focusGlow : 'rgba(35,13,55,0.55)';
      ctx.beginPath();
      ctx.arc(c, c, c * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = s.hover ? TOKENS.focus : color;
      ctx.lineWidth = s.hover ? c * 0.12 : c * 0.09;
      ctx.beginPath();
      ctx.arc(c, c, c * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      if (s.state === 'ok') icon.check(ctx, c, c, c * 0.8, TOKENS.ink);
      else if (s.state === 'bad') icon.cross(ctx, c, c, c * 0.8, TOKENS.ink);
      else if (!s.off) icon[glyph](ctx, c, c, c * 0.62, TOKENS.paper);
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
      ctx.fillStyle = s.hover ? TOKENS.focusGlow : 'rgba(35,13,55,0.35)';
      ctx.beginPath();
      ctx.arc(c, c, c * 0.92, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = s.hover ? TOKENS.focus : TOKENS.paper;
      ctx.lineWidth = c * 0.07;
      ctx.beginPath();
      ctx.arc(c, c, c * 0.86, 0, Math.PI * 2);
      ctx.stroke();
      icon.walk(ctx, c, c, c * 0.9, TOKENS.paper);
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
