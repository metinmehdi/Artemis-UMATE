// Photoreal world: one 360° panorama per node (generated from real Baku Metro reference photos),
// with interactive overlays placed on real objects in the photo. The camera never translates:
// "walking" = cross-fading to the next node's panorama (comfortable, no vection).
// Shared by the phone (stereo) and the panel (mono spectator). Pure view: applyState(state).
import * as THREE from 'three';
import { makeBuddy } from './buddy.js';
import { makeDirectionSign, makeTaskCard, makeButton, makeHotspot, makeFloorTarget, makePanel, TOKENS, text, rr, icon, roundel } from './ui3d.js';

export const EYE = 1.6;
const PANO_R = 12;
const UP = new THREE.Vector3(0, 1, 0);

// Hotspot positions are image coordinates (u: 0..1 left→right, v: 0..1 top→bottom) measured on the
// panorama files, plus a distance in metres, so they sit on the real object in the photo.
export const NODES = {
  hall: {
    pano: '/assets/pano/koroglu-gates.png',
    forwardU: 0.5, // the turnstile row
    kiosk: { u: 0.2, v: 0.53, d: 3.0 }, // grey BakıKART kiosk (left wall)
    kioskPanel: { u: 0.235, v: 0.47, d: 1.5 },
    gate: { u: 0.54, v: 0.575, d: 2.6 }, // turnstile with the green arrow, nearest the centre
    toPlatform: { u: 0.54, ground: 4.6 }, // floor beyond the turnstiles
  },
  platform: {
    pano: '/assets/pano/koroglu-platform.png',
    forwardU: 0.5, // looking along the island platform; tracks at u≈0.25 (left) and u≈0.75 (right)
    // hanging signs perpendicular to the platform (like the real ones), one over each track side
    signLeft: { x: -1.45, y: 2.55, z: -3.9 },
    signRight: { x: 1.45, y: 2.55, z: -3.9 },
    nameBoards: [
      { u: 0.25, v: 0.45, d: 5.2 },
      { u: 0.75, v: 0.45, d: 5.2 },
    ],
  },
  train: {
    pano: '/assets/pano/train-interior.png',
    forwardU: 0.172, // facing the exit doors (left doors in the panorama); aisle at u=0.5
    display: { u: 0.172, v: 0.32, d: 1.4 }, // route display above the doors
    doors: { u: 0.172, v: 0.5, d: 1.5 }, // eye level on the door windows, clear of the task card
    feedback: { u: 0.172, v: 0.4, d: 1.3 },
    summary: { u: 0.172, v: 0.47, d: 1.25 },
  },
};

// Direction (unit vector from the eye) for an image coordinate on our panorama sphere.
// Sphere = SphereGeometry scaled (-1,1,1) and rotated -90° so the image centre faces -Z.
const ROT_Y = -Math.PI / 2;
export function dirFromUV(u, v) {
  const phi = u * Math.PI * 2;
  const theta = v * Math.PI;
  const d = new THREE.Vector3(Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
  return d.applyAxisAngle(UP, ROT_Y).normalize();
}
const eye = () => new THREE.Vector3(0, EYE, 0);
function pointAt(u, v, dist) {
  return eye().add(dirFromUV(u, v).multiplyScalar(dist));
}
function floorPoint(u, ground) {
  const d = dirFromUV(u, 0.5);
  d.y = 0;
  d.normalize();
  return new THREE.Vector3(d.x * ground, 0.02, d.z * ground);
}
export function yawOfU(u) {
  const d = dirFromUV(u, 0.5);
  return Math.atan2(-d.x, -d.z);
}
function faceCamera(obj) {
  obj.lookAt(eye().setY(obj.position.y));
}

function makePanoSphere(url, onReady) {
  const geo = new THREE.SphereGeometry(PANO_R, 64, 40);
  geo.scale(-1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.y = ROT_Y;
  mesh.position.y = EYE;
  mesh.renderOrder = -10;
  new THREE.TextureLoader().load(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    mat.map = t;
    mat.needsUpdate = true;
    onReady?.();
  });
  return mesh;
}

// ---------- kiosk screen (BakıKART top-up flow) ----------
function makeKiosk() {
  const g = new THREE.Group();
  const W = 0.9;
  const H = 0.66;
  const screen = makePanel(
    W,
    H,
    (ctx, w, h, s) => {
      rr(ctx, 0, 0, w, h, 36);
      ctx.fillStyle = '#0d1626';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 6;
      rr(ctx, 3, 3, w - 6, h - 6, 34);
      ctx.stroke();
      // header bar
      ctx.fillStyle = TOKENS.metroBlue;
      ctx.beginPath();
      ctx.roundRect(0, 0, w, 120, [36, 36, 0, 0]);
      ctx.fill();
      text(ctx, 'BakıKART', 44, 82, { size: 58 });
      text(ctx, 'AZ  ·  RU  ·  EN', w - 44, 78, { size: 30, weight: 400, align: 'right', color: TOKENS.muted });
      const st = s.kiosk || 'idle';
      if (st === 'idle') {
        icon.card(ctx, w / 2, 250, 150);
        text(ctx, 'Top up your card', w / 2, 400, { size: 60, align: 'center' });
        text(ctx, 'Kartınızı oxuyucuya yaxınlaşdırın', w / 2, 452, { size: 32, weight: 400, align: 'center', color: TOKENS.muted });
      } else if (st === 'amount') {
        text(ctx, 'Balance', w / 2, 190, { size: 36, weight: 400, align: 'center', color: TOKENS.muted });
        text(ctx, `${s.balance.toFixed(2)} AZN`, w / 2, 262, { size: 72, align: 'center' });
        text(ctx, 'Choose an amount', w / 2, 326, { size: 36, weight: 400, align: 'center', color: TOKENS.muted });
      } else if (st === 'paying') {
        text(ctx, `Insert ${s.amount} AZN`, w / 2, 270, { size: 64, align: 'center' });
        text(ctx, 'Pul əskinasını daxil edin', w / 2, 324, { size: 32, weight: 400, align: 'center', color: TOKENS.muted });
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        rr(ctx, w * 0.2, 380, w * 0.6, 18, 9);
        ctx.fill();
        ctx.fillStyle = TOKENS.go;
        rr(ctx, w * 0.2, 380, w * 0.6 * (s.progress || 0), 18, 9);
        ctx.fill();
      } else if (st === 'done') {
        ctx.fillStyle = TOKENS.go;
        ctx.beginPath();
        ctx.arc(w / 2, 240, 74, 0, Math.PI * 2);
        ctx.fill();
        icon.check(ctx, w / 2, 240, 110);
        text(ctx, `Balance ${s.balance.toFixed(2)} AZN`, w / 2, 390, { size: 60, align: 'center' });
        text(ctx, 'Take your card', w / 2, 446, { size: 34, weight: 400, align: 'center', color: TOKENS.muted });
      }
    },
    { renderOrder: 18 },
  );
  g.add(screen);
  const place = makeButton('kiosk:card', 'Hold card to reader', { width: 0.62, height: 0.12, primary: true });
  place.position.set(0, -0.2, 0.005);
  const amounts = [1, 2, 5].map((a, i) => {
    const b = makeButton(`kiosk:amount:${a}`, `${a} AZN`, { width: 0.24, height: 0.12 });
    b.position.set((i - 1) * 0.27, -0.2, 0.005);
    return b;
  });
  g.add(place, ...amounts);
  g.userData = { screen, place, amounts };
  return g;
}

// ---------- short feedback banner (green = good, amber = gentle warning) ----------
function makeFeedbackPanel() {
  return makePanel(
    1.3,
    0.24,
    (ctx, w, h, s) => {
      if (!s.text) return;
      rr(ctx, 0, 0, w, h, 28);
      ctx.fillStyle = s.ok ? 'rgba(22,163,74,0.95)' : 'rgba(180,83,9,0.95)';
      ctx.fill();
      (s.ok ? icon.check : icon.cross)(ctx, 80, h / 2, 80);
      text(ctx, s.text, 150, h / 2 + 22, { size: 58, maxWidth: w - 180 });
    },
    { renderOrder: 28, depthTest: false },
  );
}

// ---------- in-car route display (like the LCD strip above the doors of an 81-765 car) ----------
// Shows the next / current station in Azerbaijani (as on the real display) with English below,
// and the learner's trip as a red line with stops: passed (grey), here (white), destination (ring).
function makeRouteDisplay(trip) {
  const st = (i) => trip.station(trip.line.stations[i]);
  const lo = Math.min(trip.fromIdx, trip.toIdx);
  const hi = Math.max(trip.fromIdx, trip.toIdx);
  // the trip plus one station beyond the destination, in travel order
  const span = [];
  for (let i = trip.fromIdx; trip.dir > 0 ? i <= Math.min(hi + 1, trip.line.stations.length - 1) : i >= Math.max(lo - 1, 0); i += trip.dir) span.push(i);
  return makePanel(
    1.3,
    0.42,
    (ctx, w, h, s) => {
      rr(ctx, 0, 0, w, h, 26);
      ctx.fillStyle = '#0a0f18';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 4;
      rr(ctx, 2, 2, w - 4, h - 4, 24);
      ctx.stroke();
      const idx = s.idx ?? trip.fromIdx;
      const delayed = s.phase === 'delay';
      const atStation = s.phase === 'doors';
      const showIdx = atStation ? idx : s.nextIdx ?? idx;
      // header
      if (delayed) {
        ctx.fillStyle = '#b45309';
        rr(ctx, 24, 22, w - 48, 120, 18);
        ctx.fill();
        text(ctx, 'Qatar gecikir', 50, 82, { size: 46 });
        text(ctx, 'Train delayed. Please wait', 50, 124, { size: 32, weight: 400, color: TOKENS.muted });
      } else {
        text(ctx, atStation ? 'Stansiya' : 'Növbəti stansiya', 40, 62, { size: 30, weight: 400, color: TOKENS.muted });
        text(ctx, atStation ? 'This station' : 'Next station', 40, 98, { size: 26, weight: 400, color: TOKENS.muted });
        const name = st(showIdx);
        text(ctx, name.name_az, w - 40, 98, { size: 76, align: 'right', maxWidth: w - 420 });
        text(ctx, name.name_en, w - 40, 136, { size: 28, weight: 400, align: 'right', color: TOKENS.muted });
      }
      // trip strip
      const y = 236;
      const x0 = 90;
      const x1 = w - 90;
      const step = span.length > 1 ? (x1 - x0) / (span.length - 1) : 0;
      ctx.strokeStyle = trip.line.colour || TOKENS.lineRed;
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      span.forEach((i, k) => {
        const x = x0 + k * step;
        const passed = (i - idx) * trip.dir < 0;
        const here = i === idx;
        const dest = i === trip.toIdx;
        ctx.beginPath();
        ctx.arc(x, y, here ? 26 : 18, 0, Math.PI * 2);
        ctx.fillStyle = passed ? '#5b6472' : here ? '#ffffff' : '#0a0f18';
        ctx.fill();
        ctx.lineWidth = 8;
        ctx.strokeStyle = passed ? '#5b6472' : trip.line.colour || TOKENS.lineRed;
        ctx.stroke();
        if (dest) {
          ctx.lineWidth = 6;
          ctx.strokeStyle = TOKENS.go;
          ctx.beginPath();
          ctx.arc(x, y, 40, 0, Math.PI * 2);
          ctx.stroke();
        }
        text(ctx, st(i).name_az, x, y + 78, { size: 28, weight: here || dest ? 700 : 400, align: 'center', color: passed ? '#8a93a3' : TOKENS.paper, maxWidth: step * 0.95 || 300 });
        if (dest) text(ctx, 'Your stop', x, y + 114, { size: 24, align: 'center', color: '#4ade80' });
      });
    },
    { renderOrder: 16 },
  );
}

// ---------- arrival summary (shown in the car after getting off at the destination) ----------
function makeSummary(trip) {
  return makePanel(
    1.2,
    0.62,
    (ctx, w, h, s) => {
      if (!s.steps) return;
      rr(ctx, 0, 0, w, h, 34);
      ctx.fillStyle = 'rgba(10,15,24,0.94)';
      ctx.fill();
      ctx.fillStyle = TOKENS.go;
      ctx.beginPath();
      ctx.arc(110, 120, 62, 0, Math.PI * 2);
      ctx.fill();
      icon.check(ctx, 110, 120, 90);
      text(ctx, `You arrived at ${trip.to.name_az}!`, 200, 112, { size: 58, maxWidth: w - 230 });
      text(ctx, `${trip.from.name_az} → ${trip.to.name_az} · ${trip.stops} stops`, 200, 160, { size: 32, weight: 400, color: TOKENS.muted });
      const rows = [
        ['Steps done', `${s.steps} of 4`],
        ['Hints used', String(s.hints)],
        ['Asked the buddy', s.askedHelp ? 'Yes, well done' : 'No'],
        ['Mistakes (it is okay!)', String(s.errors)],
      ];
      rows.forEach(([k, v], i) => {
        const y = 260 + i * 68;
        text(ctx, k, 70, y, { size: 36, weight: 400, color: TOKENS.muted });
        text(ctx, v, w - 70, y, { size: 38, align: 'right' });
      });
    },
    { renderOrder: 26, depthTest: false },
  );
}

// ---------- build ----------
// `trip` comes from the scenario engine (createTrip): signs and station names are built from the
// OpenStreetMap network data, not typed by hand.
export function buildWorld({ trip }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b0f16');
  const interactives = [];
  const nodes = {};

  // HALL (entrance, top-up kiosk, turnstiles)
  {
    const cfg = NODES.hall;
    const group = new THREE.Group();
    const sphere = makePanoSphere(cfg.pano);
    const kioskSpot = makeHotspot('kiosk', 'Top-up machine');
    kioskSpot.position.copy(pointAt(cfg.kiosk.u, cfg.kiosk.v, cfg.kiosk.d));
    faceCamera(kioskSpot);
    const kiosk = makeKiosk();
    kiosk.position.copy(pointAt(cfg.kioskPanel.u, cfg.kioskPanel.v, cfg.kioskPanel.d));
    faceCamera(kiosk);
    kiosk.visible = false;
    const gateSpot = makeHotspot('gate', 'Turnstile', { chipAbove: true });
    gateSpot.position.copy(pointAt(cfg.gate.u, cfg.gate.v, cfg.gate.d));
    faceCamera(gateSpot);
    const toPlatform = makeFloorTarget('go:platform');
    toPlatform.position.copy(floorPoint(cfg.toPlatform.u, cfg.toPlatform.ground));
    toPlatform.visible = false;
    const overlay = new THREE.Group();
    overlay.add(kioskSpot, kiosk, gateSpot, toPlatform);
    group.add(sphere, overlay);
    interactives.push(kioskSpot, gateSpot, toPlatform, kiosk.userData.place, ...kiosk.userData.amounts);
    nodes.hall = { group, sphere, overlay, kioskSpot, kiosk, gateSpot, toPlatform, forwardYaw: yawOfU(cfg.forwardU) };
  }

  // PLATFORM (Koroğlu, Red line, direction choice)
  {
    const cfg = NODES.platform;
    const group = new THREE.Group();
    const sphere = makePanoSphere(cfg.pano);
    const signFor = (side) =>
      makeDirectionSign({
        id: 'sign:' + side,
        towards: trip.signs[side].towards.name_az,
        towardsEn: trip.signs[side].towards.name_en,
        stations: trip.signs[side].next.slice(0, 4).map((s) => s.name_az),
        arrow: side,
      });
    const signLeft = signFor('left');
    const signRight = signFor('right');
    for (const [sign, c] of [[signLeft, cfg.signLeft], [signRight, cfg.signRight]]) {
      sign.position.set(c.x, c.y, c.z); // faces +Z (towards the learner), perpendicular to the platform
      // thin mounting rods to the ceiling
      for (const dx of [-0.75, 0.75]) {
        const rod = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.012, 1.2, 6),
          new THREE.MeshBasicMaterial({ color: '#8a9099' }),
        );
        rod.position.set(dx, 0.31 + 0.6, -0.01);
        sign.add(rod);
      }
    }
    // station name boards on both track walls (like the real stations)
    const nameBoards = cfg.nameBoards.map((c) => {
      const b = makePanel(2.8, 0.5, (ctx, w, h) => {
        rr(ctx, 0, 0, w, h, 20);
        ctx.fillStyle = TOKENS.metroBlue;
        ctx.fill();
        roundel(ctx, 90, h / 2, 62);
        text(ctx, trip.from.name_az, 190, h / 2 + 46, { size: 132 });
        text(ctx, trip.from.name_en, w - 60, h / 2 + 20, { size: 54, weight: 400, align: 'right', color: TOKENS.muted });
      });
      b.position.copy(pointAt(c.u, c.v, c.d));
      faceCamera(b);
      return b;
    });
    const feedback = makeFeedbackPanel();
    feedback.position.set(0, 1.85, -3.2);
    faceCamera(feedback);
    const overlay = new THREE.Group();
    overlay.add(signLeft, signRight, ...nameBoards, feedback);
    group.add(sphere, overlay);
    interactives.push(signLeft, signRight);
    nodes.platform = { group, sphere, overlay, signLeft, signRight, feedback, forwardYaw: yawOfU(cfg.forwardU) };
  }

  // TRAIN (Baku Metro 81-765 car, Red line)
  {
    const cfg = NODES.train;
    const group = new THREE.Group();
    const sphere = makePanoSphere(cfg.pano);
    const display = makeRouteDisplay(trip);
    display.position.copy(pointAt(cfg.display.u, cfg.display.v, cfg.display.d));
    faceCamera(display);
    const doors = makeHotspot('exit', 'Doors closed', { glyph: 'walk' });
    doors.position.copy(pointAt(cfg.doors.u, cfg.doors.v, cfg.doors.d));
    faceCamera(doors);
    const feedback = makeFeedbackPanel();
    feedback.position.copy(pointAt(cfg.feedback.u, cfg.feedback.v, cfg.feedback.d));
    faceCamera(feedback);
    const summary = makeSummary(trip);
    summary.position.copy(pointAt(cfg.summary.u, cfg.summary.v, cfg.summary.d));
    faceCamera(summary);
    summary.visible = false;
    const overlay = new THREE.Group();
    overlay.add(display, doors, feedback, summary);
    group.add(sphere, overlay);
    interactives.push(doors);
    nodes.train = { group, sphere, overlay, display, doors, feedback, summary, forwardYaw: yawOfU(cfg.forwardU) };
  }

  for (const n of Object.values(nodes)) {
    n.group.visible = false;
    scene.add(n.group);
  }

  // head-anchored elements
  const buddy = makeBuddy();
  scene.add(buddy);
  interactives.push(buddy);
  const taskCard = makeTaskCard();
  scene.add(taskCard);

  // ---------- state -> visuals ----------
  let current = null;
  let fadeFrom = null;
  let fadeT = 1;
  let hoverId = null;
  let last = {};

  function setHover(id) {
    hoverId = id;
    render(last);
  }

  function render(s) {
    const hall = nodes.hall;
    const plat = nodes.platform;
    // hint level 2+ makes the target glow as if the learner were looking at it
    const hinted = (id) => hoverId === id || ((s.hint?.level || 0) >= 2 && s.hint?.target === id);
    hall.kioskSpot.userData.ring.redraw({ hover: hinted('kiosk'), state: s.kiosk === 'done' ? 'ok' : null });
    hall.kioskSpot.userData.chip.redraw({ label: s.kiosk === 'done' ? 'Card topped up' : 'Top-up machine' });
    hall.kioskSpot.visible = !s.kioskOpen;
    hall.kiosk.visible = !!s.kioskOpen;
    hall.kiosk.userData.screen.redraw({ kiosk: s.kiosk, balance: s.balance || 0, amount: s.amount, progress: s.progress });
    hall.kiosk.userData.place.visible = s.kiosk === 'idle';
    hall.kiosk.userData.place.redraw({ hover: hoverId === 'kiosk:card' });
    hall.kiosk.userData.amounts.forEach((b) => {
      b.visible = s.kiosk === 'amount';
      b.redraw({ hover: hoverId === b.userData.id });
    });
    const bad = s.gate === 'bad' || s.gate === 'unread';
    hall.gateSpot.userData.ring.redraw({ hover: hinted('gate'), state: s.gate === 'ok' ? 'ok' : bad ? 'bad' : null });
    hall.gateSpot.userData.chip.redraw({
      label: s.gate === 'ok' ? 'Go through' : s.gate === 'bad' ? 'Not enough balance' : s.gate === 'unread' ? 'Card not read. Try again' : 'Tap your card here',
    });
    hall.toPlatform.visible = (s.targets || []).includes('platform');
    hall.toPlatform.userData.disc.redraw({ hover: hinted('go:platform') });
    plat.signLeft.redraw({ highlight: hinted('sign:left') || s.sign === 'left' });
    plat.signRight.redraw({ highlight: hinted('sign:right') || s.sign === 'right' });
    plat.feedback.redraw(s.feedback || {});
    const train = nodes.train;
    const ride = s.ride || {};
    train.display.redraw(ride);
    train.doors.visible = !s.summary;
    train.doors.userData.ring.redraw({ hover: ride.doorsOpen && hinted('exit'), off: !ride.doorsOpen });
    train.doors.userData.dwell = !!ride.doorsOpen; // closed doors cannot be selected
    train.doors.userData.chip.redraw({ label: ride.doorsOpen ? (ride.atDest ? 'Get off here' : 'Doors open') : 'Doors closed' });
    train.feedback.redraw(s.trainFeedback || {});
    train.feedback.visible = !s.summary;
    train.summary.visible = !!s.summary;
    if (s.summary) train.summary.redraw(s.summary);
    taskCard.redraw(s.task || {});
    buddy.userData.mode = s.buddyMode || buddy.userData.mode;
  }

  function applyState(s) {
    last = s;
    if (s.node && s.node !== current) {
      fadeFrom = current;
      current = s.node;
      fadeT = 0;
      nodes[current].group.visible = true;
    }
    render(s);
  }

  // ---------- per-frame ----------
  const tmpE = new THREE.Euler();
  const tmpV = new THREE.Vector3();
  const anchors = { buddy: null, card: null };
  function follow(obj, key, camPos, camQuat, offset, threshold, dt) {
    tmpE.setFromQuaternion(camQuat, 'YXZ');
    const yaw = tmpE.y;
    if (anchors[key] === null || Math.abs(angleDiff(yaw, anchors[key])) > threshold) anchors[key] = yaw;
    tmpV.copy(offset).applyAxisAngle(UP, anchors[key]).add(camPos);
    if (!obj.userData.placed) {
      obj.position.copy(tmpV);
      obj.userData.placed = true;
    } else obj.position.lerp(tmpV, Math.min(1, dt * 3));
  }

  function update(dt, t, camPos, camQuat) {
    if (fadeT < 1) {
      fadeT = Math.min(1, fadeT + dt / 0.6);
      const e = fadeT * fadeT * (3 - 2 * fadeT);
      nodes[current].sphere.material.opacity = e;
      if (fadeFrom) {
        nodes[fadeFrom].sphere.material.opacity = 1 - e;
        if (fadeT >= 1) nodes[fadeFrom].group.visible = false;
      }
    } else if (current) nodes[current].sphere.material.opacity = 1;
    // hide the old node's overlays immediately, show the new node's once mostly faded in
    for (const [id, n] of Object.entries(nodes)) n.overlay.visible = id === current && fadeT >= 0.6;
    if (camPos && camQuat) {
      follow(buddy, 'buddy', camPos, camQuat, new THREE.Vector3(-0.5, -0.16, -0.85), 1.0, dt);
      buddy.tick(dt, t, camPos);
      follow(taskCard, 'card', camPos, camQuat, new THREE.Vector3(0, -0.6, -1.35), 0.5, dt);
      taskCard.lookAt(camPos);
    }
    for (const n of Object.values(nodes)) {
      if (n.toPlatform?.visible) {
        const s = 1 + Math.sin(t * 3) * 0.05;
        n.toPlatform.scale.set(s, 1, s);
      }
    }
  }

  return {
    scene,
    nodes,
    interactives,
    buddy,
    taskCard,
    applyState,
    setHover,
    update,
    forwardYaw: (id) => nodes[id].forwardYaw,
  };
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
