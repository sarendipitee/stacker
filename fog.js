const canvas = document.querySelector('#fog-canvas');
const toggle = document.querySelector('#atmosphere-toggle');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });

const vertexSource = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const preamble = `#version 300 es
precision highp float;
precision highp sampler3D;
#define float3 vec3
#define CLOUD_VOLUME sampler3D
#define fmod mod
vec3 cloudNoise(sampler3D volume, vec3 p) { return texture(volume, p).rgb; }
in vec2 uv;
out vec4 colour;
`;

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}
function program(fragment) {
  const result = gl.createProgram();
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const pixel = compile(gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(result, vertex);
  gl.attachShader(result, pixel);
  gl.linkProgram(result);
  gl.deleteShader(vertex);
  gl.deleteShader(pixel);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result));
  return result;
}
function generateNoise() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./noise-worker.js', import.meta.url));
    worker.onmessage = event => { worker.terminate(); resolve(new Uint8Array(event.data)); };
    worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
    worker.postMessage(null);
  });
}

async function start() {
  if (!gl) { fallback(new Error('WebGL 2 is unavailable')); return; }
  const [model, noise] = await Promise.all([
    fetch(new URL('./shaders/cloud-model.glsl', import.meta.url)).then(response => {
      if (!response.ok) throw new Error(`Cloud model: ${response.status}`);
      return response.text();
    }),
    generateNoise(),
  ]);
  let rayProgram, composeProgram, volume, fields = [], lower = 0, upper = 1;
  let fieldWidth = 0, fieldHeight = 0, cachedStep = -1;
  let elapsed = 72, lastTime = 0, lastPaint = 0, request = 0;
  let paused = reducedMotion.matches;
  let lost = false;
  let entrance = null;
  const entranceDuration = 2.8;
  const entranceFieldRate = 12;
  function entranceScene(age) {
    const progress = Math.min(age / entranceDuration, 1);
    const remaining = 1 - progress;
    return {
      time: entrance.base + age,
      distance: remaining ** 3,
      sweep: 0.28 * remaining ** 4,
    };
  }
  const location = (target, name) => gl.getUniformLocation(target, name);

  function initialize() {
    rayProgram = program(preamble + model + `
uniform sampler3D volume;
uniform float seconds;
uniform float cameraDistance;
uniform vec2 cloudOffset;
void main() {
  CloudSample cloud = cloudRay(volume, uv.x, 1.0 - uv.y, seconds, cameraDistance, cloudOffset);
  // Scale radiance to retain precision in portable RGBA8 field textures.
  colour = vec4(cloud.light * 4.0, cloud.transmission);
}`);
    composeProgram = program(preamble + model + `
uniform sampler2D lowerField;
uniform sampler2D upperField;
uniform float blend;
uniform float seconds;
uniform vec2 viewport;
void main() {
  vec4 field = mix(texture(lowerField, uv), texture(upperField, uv), blend);
  vec2 point = vec2(uv.x, 1.0 - uv.y) * viewport;
  float gridSeed = floor(seconds / 30.0);
  float gridBlend = smoothstep(0.0, 1.0, fract(seconds / 30.0));
  vec3 rgb = cloudDecorate(field.rgb * 0.9, field.a, point.x, point.y,
    viewport.x, viewport.y, point.x, 0.0, gridSeed, gridBlend);
  colour = vec4(rgb, 1.0);
}`);
    volume = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, volume);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 64, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, noise);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, axis, gl.REPEAT);
    fields = [];
    fieldWidth = fieldHeight = 0;
    cachedStep = -1;
    lost = false;
    resize();
    toggle.hidden = false;
    canvas.dataset.renderer = 'webgl2';
    updateControl();
    schedule();
    document.dispatchEvent(new Event('stacker:atmosphere-ready'));
  }
  function makeField() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, fieldWidth, fieldHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Cloud framebuffer is incomplete');
    return { texture, framebuffer };
  }
  function resize() {
    if (lost || canvas.hidden || !rayProgram || !composeProgram) return;
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    const scale = Math.min(devicePixelRatio, 1.5, 1920 / width, 1200 / height);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const nextWidth = Math.max(1, Math.ceil(width / 4)), nextHeight = Math.max(1, Math.ceil(height / 4));
    if (nextWidth !== fieldWidth || nextHeight !== fieldHeight) {
      fields.forEach(field => { gl.deleteFramebuffer(field.framebuffer); gl.deleteTexture(field.texture); });
      fieldWidth = nextWidth;
      fieldHeight = nextHeight;
      fields = [makeField(), makeField()];
      cachedStep = -1;
    }
    paint();
  }
  function integrate(index, time, distance = 0, sweep = 0) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fields[index].framebuffer);
    gl.viewport(0, 0, fieldWidth, fieldHeight);
    gl.useProgram(rayProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, volume);
    gl.uniform1i(location(rayProgram, 'volume'), 0);
    gl.uniform1f(location(rayProgram, 'seconds'), time % 480);
    gl.uniform1f(location(rayProgram, 'cameraDistance'), distance);
    gl.uniform2f(location(rayProgram, 'cloudOffset'), sweep, -sweep * 0.16);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function paint() {
    if (lost || !fields.length) return;
    // Sample the fast spatial sweep more often without accelerating cloud evolution.
    const position = entrance ? entrance.age * entranceFieldRate : elapsed * 4;
    const step = Math.floor(position);
    function sample(index, tick) {
      if (entrance) {
        const scene = entranceScene(tick / entranceFieldRate);
        integrate(index, scene.time, scene.distance, scene.sweep);
      } else integrate(index, tick / 4);
    }
    if (cachedStep !== step) {
      if (cachedStep >= 0 && step === cachedStep + 1) {
        [lower, upper] = [upper, lower];
        sample(upper, step + 1);
      } else {
        lower = 0; upper = 1;
        sample(lower, step);
        sample(upper, step + 1);
      }
      cachedStep = step;
      canvas.dataset.fieldStep = String(step);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(composeProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fields[lower].texture);
    gl.uniform1i(location(composeProgram, 'lowerField'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fields[upper].texture);
    gl.uniform1i(location(composeProgram, 'upperField'), 1);
    gl.uniform1f(location(composeProgram, 'blend'), position - step);
    gl.uniform1f(location(composeProgram, 'seconds'), elapsed);
    gl.uniform2f(location(composeProgram, 'viewport'), canvas.clientWidth, canvas.clientHeight);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function frame(now) {
    request = 0;
    if (paused || document.hidden || lost) return;
    const delta = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0;
    if (entrance) {
      entrance.age += delta;
      elapsed = entranceScene(entrance.age).time;
      if (entrance.age >= entranceDuration) { entrance = null; cachedStep = -1; }
    } else elapsed += delta;
    lastTime = now;
    if (now - lastPaint >= 1000 / 30) { paint(); lastPaint = now; }
    schedule();
  }
  function schedule() {
    if (!request && !paused && !document.hidden && !lost) request = requestAnimationFrame(frame);
  }
  function stop() { cancelAnimationFrame(request); request = 0; lastTime = 0; }
  function finishEntrance() {
    if (!entrance) return;
    entrance = null;
    cachedStep = -1;
    paint();
  }
  function updateControl() {
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.setAttribute('aria-label', paused ? 'Resume background animation' : 'Pause background animation');
    toggle.querySelector('span').textContent = paused ? '▷' : 'Ⅱ';
    toggle.querySelector('.motion-label').textContent = paused ? 'ATMOSPHERE PAUSED' : 'LIVE ATMOSPHERE';
    canvas.dataset.motion = paused ? 'paused' : 'playing';
  }
  document.addEventListener('stacker:hero-start', () => {
    if (paused || lost) return;
    entrance = { base: elapsed, age: 0 };
    cachedStep = -1;
    paint();
  });
  document.addEventListener('stacker:hero-complete', finishEntrance);
  toggle.addEventListener('click', () => { finishEntrance(); paused = !paused; updateControl(); stop(); schedule(); });
  reducedMotion.addEventListener('change', () => { finishEntrance(); paused = reducedMotion.matches; updateControl(); stop(); schedule(); });
  document.addEventListener('visibilitychange', () => { stop(); schedule(); });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); lost = true; stop(); canvas.dataset.renderer = 'context-lost'; toggle.hidden = true;
  });
  canvas.addEventListener('webglcontextrestored', () => { try { initialize(); } catch (error) { fallback(error); } });
  initialize();
  new ResizeObserver(resize).observe(canvas);
}

function fallback(error) {
  console.warn('Stacker atmosphere unavailable:', error.message);
  canvas.dataset.renderer = 'fallback';
  canvas.hidden = true;
  toggle.hidden = true;
  document.dispatchEvent(new Event('stacker:atmosphere-ready'));
}
start().catch(fallback);
