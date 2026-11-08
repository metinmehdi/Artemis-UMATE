// Gaze selection: whatever is in the centre of view gets a filling ring; after `dwell`
// seconds it is selected. A tap / box button / Bluetooth remote / key selects instantly.
import * as THREE from 'three';

const CENTER = new THREE.Vector2(0, 0);

export class Gaze {
  constructor(camera, { dwell = 1.5 } = {}) {
    this.camera = camera;
    this.dwell = dwell;
    this.ray = new THREE.Raycaster();
    this.ray.far = 30;
    this.targets = [];
    this.hover = null;
    this.t = 0;
    this.onSelect = () => {};
    this.onHoverChange = () => {};
    this.cursor = makeCursor();
    camera.add(this.cursor);
  }

  findInteractive(o) {
    while (o) {
      if (o.userData?.interactive) return o;
      o = o.parent;
    }
    return null;
  }

  isShown(o) {
    while (o) {
      if (!o.visible) return false;
      o = o.parent;
    }
    return true;
  }

  update(dt) {
    this.ray.setFromCamera(CENTER, this.camera);
    const hits = this.ray.intersectObjects(this.targets, true);
    let obj = null;
    for (const h of hits) {
      const it = this.findInteractive(h.object);
      if (it && this.isShown(it)) {
        obj = it;
        break;
      }
    }
    if (obj !== this.hover) {
      const prev = this.hover;
      this.hover = obj;
      this.t = 0;
      this.onHoverChange(obj, prev);
    }
    if (obj && obj.userData.dwell !== false) {
      this.t += dt;
      if (this.t >= this.dwell) this.fire(obj);
    }
    const p = obj && obj.userData.dwell !== false ? Math.max(0, this.t) / this.dwell : 0;
    this.cursor.userData.setState(!!obj, p);
  }

  fire(obj = this.hover) {
    if (!obj || obj.userData.dwell === false) return;
    this.t = -0.8; // short cooldown so one look = one selection
    this.onSelect(obj);
  }
}

function makeCursor() {
  const g = new THREE.Group();
  const mat = (color, opacity) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.008, 16), mat(0xffffff, 0.9));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.018, 0.024, 32), mat(0xffffff, 0.6));
  const fill = new THREE.Mesh(new THREE.RingGeometry(0.018, 0.024, 32, 1, 0, 0.0001), mat(0x7ee0c3, 1));
  for (const m of [dot, ring, fill]) m.renderOrder = 999;
  g.add(dot, ring, fill);
  g.position.z = -1; // 1 m in front of the eyes
  let lastP = -1;
  g.userData.setState = (hovering, p) => {
    ring.material.color.set(hovering ? 0x7ee0c3 : 0xffffff);
    const s = hovering ? 1.35 : 1;
    ring.scale.setScalar(s);
    fill.scale.setScalar(s);
    const q = Math.round(p * 40) / 40;
    if (q !== lastP) {
      lastP = q;
      fill.geometry.dispose();
      const len = Math.max(0.0001, q * Math.PI * 2); // grows clockwise from 12 o'clock
      fill.geometry = new THREE.RingGeometry(0.018, 0.024, 32, 1, Math.PI / 2 - len, len);
    }
  };
  return g;
}
