// Phone gyroscope -> camera orientation (3DoF). Works on Android Chrome and iOS Safari.
// iOS needs DeviceOrientationEvent.requestPermission() from a user tap, over HTTPS.
import * as THREE from 'three';

const zee = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90deg around X
const deg = THREE.MathUtils.degToRad;

export class Gyro {
  constructor() {
    this.last = null;
    this.onEvent = (e) => {
      if (e.alpha !== null || e.beta !== null) this.last = e;
    };
  }

  // Must be called synchronously inside a user gesture handler (iOS).
  request() {
    const D = window.DeviceOrientationEvent;
    const listen = () => window.addEventListener('deviceorientation', this.onEvent);
    if (D && typeof D.requestPermission === 'function') {
      return D.requestPermission().then((r) => {
        if (r !== 'granted') throw new Error('Motion permission denied');
        listen();
      });
    }
    listen();
    return Promise.resolve();
  }

  get available() {
    return !!this.last;
  }

  screenAngle() {
    const a = screen.orientation?.angle ?? window.orientation ?? 0;
    return deg(a);
  }

  // Writes the device orientation into target.quaternion (local to its parent rig).
  apply(target) {
    const e = this.last;
    if (!e) return false;
    euler.set(deg(e.beta || 0), deg(e.alpha || 0), -deg(e.gamma || 0), 'YXZ');
    target.quaternion.setFromEuler(euler);
    target.quaternion.multiply(q1);
    target.quaternion.multiply(q0.setFromAxisAngle(zee, -this.screenAngle()));
    return true;
  }
}

// Mouse/touch-drag look for laptops and testing without a gyroscope.
export class DragLook {
  constructor(el) {
    this.lon = 0;
    this.lat = 0;
    this.dragging = false;
    this.moved = 0;
    el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.moved = 0;
      this.px = e.clientX;
      this.py = e.clientY;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.px;
      const dy = e.clientY - this.py;
      this.moved += Math.abs(dx) + Math.abs(dy);
      this.px = e.clientX;
      this.py = e.clientY;
      this.lon += dx * 0.004;
      this.lat = THREE.MathUtils.clamp(this.lat + dy * 0.004, -1.4, 1.4);
    });
    window.addEventListener('pointerup', () => (this.dragging = false));
  }

  apply(target) {
    target.quaternion.setFromEuler(new THREE.Euler(this.lat, this.lon, 0, 'YXZ'));
  }
}
