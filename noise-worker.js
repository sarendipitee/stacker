// Periodic Perlin-Worley volume, ported from src/ui/CloudBackground.cpp.
// Generating it in a worker keeps shader setup off the interaction thread.
const SIZE = 64;
const wrap = (value, period) => (value % period + period) % period;
const mix = (a, b, t) => a + (b - a) * t;
function hash(x, y, z) {
  let value = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2246822519)) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}
function perlin(px, py, pz, period) {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const fx = px - ix, fy = py - iy, fz = pz - iz;
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const gradient = (x, y, z) => {
    const h = hash(wrap(ix + x, period), wrap(iy + y, period), wrap(iz + z, period)) & 15;
    const dx = fx - x, dy = fy - y, dz = fz - z;
    const u = h < 8 ? dx : dy;
    const v = h < 4 ? dy : h === 12 || h === 14 ? dx : dz;
    return (h & 1 ? -u : u) + (h & 2 ? -v : v);
  };
  return 0.5 + 0.5 * mix(
    mix(mix(gradient(0, 0, 0), gradient(1, 0, 0), fade(fx)), mix(gradient(0, 1, 0), gradient(1, 1, 0), fade(fx)), fade(fy)),
    mix(mix(gradient(0, 0, 1), gradient(1, 0, 1), fade(fx)), mix(gradient(0, 1, 1), gradient(1, 1, 1), fade(fx)), fade(fy)), fade(fz));
}
function worley(px, py, pz, period) {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  let distance = 3;
  for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const value = hash(wrap(ix + x, period), wrap(iy + y, period), wrap(iz + z, period));
    const dx = ix + x + (value & 1023) / 1024 - px;
    const dy = iy + y + ((value >>> 10) & 1023) / 1024 - py;
    const dz = iz + z + ((value >>> 20) & 1023) / 1024 - pz;
    distance = Math.min(distance, dx * dx + dy * dy + dz * dz);
  }
  return 1 - Math.min(1, Math.sqrt(distance));
}
self.onmessage = () => {
  const data = new Uint8Array(SIZE ** 3 * 4);
  for (let z = 0; z < SIZE; z++) for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const px = (x + 0.5) / SIZE, py = (y + 0.5) / SIZE, pz = (z + 0.5) / SIZE;
    const cells = worley(px * 4, py * 4, pz * 4, 4);
    const base = perlin(px * 4, py * 4, pz * 4, 4) * 0.7 + perlin(px * 8, py * 8, pz * 8, 8) * 0.3;
    const erosion = worley(px * 8, py * 8, pz * 8, 8) * 0.7 + worley(px * 16, py * 16, pz * 16, 16) * 0.3;
    const index = ((z * SIZE + y) * SIZE + x) * 4;
    data[index] = Math.round(Math.min(1, Math.max(0, base * 0.75 + cells * 0.25)) * 255);
    data[index + 1] = Math.round(cells * 255);
    data[index + 2] = Math.round(erosion * 255);
    data[index + 3] = 255;
  }
  self.postMessage(data.buffer, [data.buffer]);
};
