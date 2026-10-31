import * as THREE from 'three';
import { rng } from './noise.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

/** A cluster of painted leaves on a transparent card (alpha-tested foliage). */
export function leafClusterTexture() {
  const [c, g] = canvas(256, 256);
  const r = rng(11);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const d = 20 + r() * 80;
    const x = 128 + Math.cos(a) * d * 0.9;
    const y = 128 + Math.sin(a) * d * 0.9;
    const len = 46 + r() * 34;
    const wid = len * (0.36 + r() * 0.1);
    g.save();
    g.translate(x, y);
    g.rotate(a + Math.PI / 2 + (r() - 0.5) * 0.9);
    const light = 52 + r() * 22;
    const grad = g.createLinearGradient(0, -len / 2, 0, len / 2);
    grad.addColorStop(0, `hsl(${88 + r() * 16}, 52%, ${light}%)`);
    grad.addColorStop(1, `hsl(${100 + r() * 14}, 48%, ${light - 18}%)`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, -len / 2);
    g.bezierCurveTo(wid, -len / 4, wid * 0.8, len / 4, 0, len / 2);
    g.bezierCurveTo(-wid * 0.8, len / 4, -wid, -len / 4, 0, -len / 2);
    g.fill();
    g.strokeStyle = 'rgba(230,245,190,0.35)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -len / 2 + 4);
    g.lineTo(0, len / 2 - 4);
    g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Single leaf (falling leaves). */
export function singleLeafTexture() {
  const [c, g] = canvas(64, 64);
  g.translate(32, 32);
  g.rotate(0.6);
  g.fillStyle = '#a7b947';
  g.beginPath();
  g.moveTo(0, -28);
  g.bezierCurveTo(16, -12, 14, 14, 0, 28);
  g.bezierCurveTo(-14, 14, -16, -12, 0, -28);
  g.fill();
  g.strokeStyle = 'rgba(80,90,30,0.6)';
  g.beginPath();
  g.moveTo(0, -24);
  g.lineTo(0, 26);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft radial dot used for particles and glow sprites. */
export function softDotTexture() {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Dark radial blob for the contact shadow under Mori. */
export function blobShadowTexture() {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Vertical soft beam used for god rays. */
export function beamTexture() {
  const [c, g] = canvas(64, 256);
  const v = g.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, 'rgba(255,255,255,0)');
  v.addColorStop(0.2, 'rgba(255,255,255,0.9)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v;
  g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = 'destination-in';
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)');
  h.addColorStop(0.5, 'rgba(0,0,0,1)');
  h.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = h;
  g.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(c);
}
