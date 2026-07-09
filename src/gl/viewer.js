// Three.js setup, render loop, pan/zoom. One OrthographicCamera, one full-quad
// Mesh with ShaderMaterial (see gl/shader.js). All coordinates below are in
// source-image pixel space at zoom=1 (plan section 5, rule 1).
import * as THREE from 'three';
import { VERTEX_SHADER, buildFragmentShader } from './shader.js';
import { blurBitmap } from '../cpu/prepare.js';
import { MATRICES, matrixIndexById } from '../matrices.js';
import { generateNoiseGrid, NOISE_SIZE } from '../noise.js';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 32;
const NEAREST_ZOOM_THRESHOLD = 4;

const EFFECT_TYPE_ID = { none: 0, ordered: 1, halftone: 2, linescreen: 3 };
const HALFTONE_SHAPE_ID = { round: 0, square: 1, diamond: 2 };

function buildMatrixAtlas() {
  let totalCells = 0;
  const meta = [];
  for (const m of MATRICES) {
    meta.push(new THREE.Vector2(totalCells, m.n));
    totalCells += m.n * m.n;
  }
  const data = new Uint8Array(totalCells);
  let ptr = 0;
  for (const m of MATRICES) {
    for (let i = 0; i < m.values.length; i++) data[ptr++] = Math.round(m.values[i] * 255);
  }
  const texture = new THREE.DataTexture(data, totalCells, 1, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, meta, width: totalCells };
}

/** Packs an effect + params into the GPU's uEffectType/uParamsA/uParamsB uniform shape. Shared by the live preview and the parity harness. */
export function packEffectUniforms(effect, params) {
  const type = EFFECT_TYPE_ID[effect] ?? 0;
  const paramsA = new THREE.Vector4(0, 0, 0, 0);
  const paramsB = new THREE.Vector4(0, 0, 0, 0);
  if (effect === 'ordered') {
    paramsA.set(matrixIndexById(params.matrix), params.cell, params.jitter, 0);
  } else if (effect === 'halftone') {
    paramsA.set(params.pitch, params.angle, params.dotGain, HALFTONE_SHAPE_ID[params.shape] ?? 0);
    paramsB.set(params.maxOverlap ? 1 : 0, 0, 0, 0);
  } else if (effect === 'linescreen') {
    paramsA.set(params.pitch, params.angle, params.weight, params.smoothing);
    paramsB.set(params.phase, 0, 0, 0);
  }
  return { type, paramsA, paramsB };
}

export function createViewer(canvasEl, viewportEl) {
  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: false });
  renderer.setPixelRatio(window.devicePixelRatio || 1);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;

  const placeholderTex = new THREE.DataTexture(new Uint8Array([26, 26, 28, 255]), 1, 1);
  placeholderTex.needsUpdate = true;

  const matrixAtlas = buildMatrixAtlas();
  let noiseTexture = null;
  let lastNoiseSeed = null;

  function ensureNoiseTexture(seed) {
    if (noiseTexture && seed === lastNoiseSeed) return noiseTexture;
    lastNoiseSeed = seed;
    const grid = generateNoiseGrid(seed);
    if (noiseTexture) noiseTexture.dispose();
    noiseTexture = new THREE.DataTexture(grid, NOISE_SIZE, NOISE_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
    noiseTexture.magFilter = THREE.NearestFilter;
    noiseTexture.minFilter = THREE.NearestFilter;
    noiseTexture.generateMipmaps = false;
    noiseTexture.needsUpdate = true;
    material.uniforms.uNoiseTex.value = noiseTexture;
    return noiseTexture;
  }

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uActiveImage: { value: placeholderTex },
      uImageSize: { value: new THREE.Vector2(1, 1) },
      uPre: { value: new THREE.Vector3(0, 0, 1) },
      uInvert: { value: 0 },
      uMatrixTex: { value: matrixAtlas.texture },
      uMatrixMeta: { value: matrixAtlas.meta },
      uMatrixAtlasWidth: { value: matrixAtlas.width },
      uNoiseTex: { value: placeholderTex },
      uEffectType: { value: 0 },
      uParamsA: { value: new THREE.Vector4(0, 0, 0, 0) },
      uParamsB: { value: new THREE.Vector4(0, 0, 0, 0) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: buildFragmentShader(),
  });

  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false;
  scene.add(mesh);

  ensureNoiseTexture(1);

  let imageWidth = 0;
  let imageHeight = 0;
  let sourceBitmap = null;
  let sourceTexture = null;
  let blurTexture = null;
  let lastBlurRadius = 0;

  let zoom = 1;
  let panX = 0;
  let panY = 0;

  let onViewChange = null;

  function applyTextureFilter(tex) {
    const nearest = zoom >= NEAREST_ZOOM_THRESHOLD;
    tex.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
    tex.minFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
    tex.needsUpdate = true;
  }

  function resizeRendererAndCamera() {
    const w = viewportEl.clientWidth || 1;
    const h = viewportEl.clientHeight || 1;
    renderer.setSize(w, h, true);
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    updateCameraTransform();
  }

  function updateCameraTransform() {
    camera.zoom = zoom;
    camera.position.x = panX;
    camera.position.y = panY;
    camera.updateProjectionMatrix();
  }

  function render() {
    renderer.render(scene, camera);
    if (onViewChange) onViewChange({ zoom, panX, panY });
  }

  function setImage(bitmap) {
    sourceBitmap = bitmap;
    imageWidth = bitmap.width;
    imageHeight = bitmap.height;

    if (sourceTexture) sourceTexture.dispose();
    sourceTexture = new THREE.Texture(bitmap);
    sourceTexture.flipY = true;
    sourceTexture.generateMipmaps = false;
    sourceTexture.wrapS = THREE.ClampToEdgeWrapping;
    sourceTexture.wrapT = THREE.ClampToEdgeWrapping;
    sourceTexture.needsUpdate = true;

    if (blurTexture) {
      blurTexture.dispose();
      blurTexture = null;
    }
    lastBlurRadius = 0;

    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(imageWidth, imageHeight);
    mesh.visible = true;

    material.uniforms.uActiveImage.value = sourceTexture;
    material.uniforms.uImageSize.value.set(imageWidth, imageHeight);
    applyTextureFilter(sourceTexture);

    fit();
  }

  function setPre(pre) {
    material.uniforms.uPre.value.set(pre.brightness, pre.contrast, pre.gamma);
    material.uniforms.uInvert.value = pre.invert ? 1 : 0;
    setBlur(pre.blur || 0);
    render();
  }

  function setBlur(radius) {
    if (!sourceBitmap) return;
    if (radius === lastBlurRadius) return;
    lastBlurRadius = radius;

    if (radius <= 0) {
      material.uniforms.uActiveImage.value = sourceTexture;
      return;
    }

    const blurredCanvas = blurBitmap(sourceBitmap, radius, imageWidth, imageHeight);
    if (blurTexture) blurTexture.dispose();
    blurTexture = new THREE.CanvasTexture(blurredCanvas);
    blurTexture.flipY = true;
    blurTexture.generateMipmaps = false;
    blurTexture.wrapS = THREE.ClampToEdgeWrapping;
    blurTexture.wrapT = THREE.ClampToEdgeWrapping;
    applyTextureFilter(blurTexture);
    material.uniforms.uActiveImage.value = blurTexture;
  }

  /** Sets the single active effect unit (Phase 3: no zones/layers composition yet). */
  function setEffect(effect, params) {
    if (effect === 'ordered') ensureNoiseTexture(params.seed || 1);
    const packed = packEffectUniforms(effect, params);
    material.uniforms.uEffectType.value = packed.type;
    material.uniforms.uParamsA.value.copy(packed.paramsA);
    material.uniforms.uParamsB.value.copy(packed.paramsB);
    render();
  }

  function screenToWorld(clientX, clientY) {
    const rect = canvasEl.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const v = new THREE.Vector3(ndcX, ndcY, 0);
    v.unproject(camera);
    return v;
  }

  function zoomAt(clientX, clientY, factor) {
    const before = screenToWorld(clientX, clientY);
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    updateCameraTransform();
    const after = screenToWorld(clientX, clientY);
    panX -= after.x - before.x;
    panY -= after.y - before.y;
    updateCameraTransform();
    if (sourceTexture) applyTextureFilter(sourceTexture);
    if (blurTexture) applyTextureFilter(blurTexture);
    render();
  }

  function pan(dxScreen, dyScreen) {
    panX -= dxScreen / zoom;
    panY += dyScreen / zoom;
    updateCameraTransform();
    render();
  }

  function fit() {
    if (!imageWidth || !imageHeight) {
      zoom = 1;
      panX = 0;
      panY = 0;
      updateCameraTransform();
      render();
      return;
    }
    const w = viewportEl.clientWidth || 1;
    const h = viewportEl.clientHeight || 1;
    const margin = 0.92;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(w / imageWidth, h / imageHeight) * margin));
    panX = 0;
    panY = 0;
    updateCameraTransform();
    if (sourceTexture) applyTextureFilter(sourceTexture);
    render();
  }

  /** Image-space pixel coords (top-left origin) under the given client (mouse) position, or null if outside. */
  function pixelUnderCursor(clientX, clientY) {
    if (!imageWidth || !imageHeight) return null;
    const world = screenToWorld(clientX, clientY);
    const px = world.x + imageWidth / 2;
    const py = imageHeight / 2 - world.y;
    if (px < 0 || py < 0 || px >= imageWidth || py >= imageHeight) return null;
    return { x: Math.floor(px), y: Math.floor(py) };
  }

  /**
   * Renders the current material at exact 1:1 image resolution into an
   * offscreen render target (fixed camera, independent of live pan/zoom) and
   * reads back RGBA pixels — top-left origin, row 0 first. Used by the parity
   * harness (section 5 rule 5) to diff against the CPU raster pipeline.
   */
  function renderToPixels() {
    if (!imageWidth || !imageHeight) return null;

    const rt = new THREE.WebGLRenderTarget(imageWidth, imageHeight, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });

    const parityCamera = new THREE.OrthographicCamera(
      -imageWidth / 2,
      imageWidth / 2,
      imageHeight / 2,
      -imageHeight / 2,
      0.1,
      10
    );
    parityCamera.position.z = 1;
    parityCamera.updateProjectionMatrix();

    const prevNearest = { mag: sourceTexture?.magFilter, min: sourceTexture?.minFilter };
    if (sourceTexture) {
      sourceTexture.magFilter = THREE.NearestFilter;
      sourceTexture.minFilter = THREE.NearestFilter;
      sourceTexture.needsUpdate = true;
    }
    if (blurTexture) {
      blurTexture.magFilter = THREE.NearestFilter;
      blurTexture.minFilter = THREE.NearestFilter;
      blurTexture.needsUpdate = true;
    }

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(scene, parityCamera);

    const pixels = new Uint8Array(imageWidth * imageHeight * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, imageWidth, imageHeight, pixels);

    renderer.setRenderTarget(prevTarget);
    rt.dispose();

    if (sourceTexture && prevNearest.mag !== undefined) {
      sourceTexture.magFilter = prevNearest.mag;
      sourceTexture.minFilter = prevNearest.min;
      sourceTexture.needsUpdate = true;
    }

    // Empirically (verified against cpu/prepare.js output at many sample points):
    // readRenderTargetPixels already comes back in the same top-left-origin row
    // order the CPU pipeline uses for this camera/target setup — no row flip
    // needed. An earlier version of this function flipped rows on the (incorrect)
    // assumption of bottom-up GL readback order, which silently misaligned every
    // row and was the single largest source of parity mismatch during Phase 3.
    return pixels;
  }

  // ---- input wiring ----

  let spaceHeld = false;
  let panning = false;
  let lastX = 0;
  let lastY = 0;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') spaceHeld = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') spaceHeld = false;
  });

  canvasEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(e.clientX, e.clientY, factor);
  }, { passive: false });

  canvasEl.addEventListener('pointerdown', (e) => {
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      panning = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvasEl.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });
  canvasEl.addEventListener('pointermove', (e) => {
    if (panning) {
      pan(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });
  canvasEl.addEventListener('pointerup', (e) => {
    if (panning) {
      panning = false;
      canvasEl.releasePointerCapture(e.pointerId);
    }
  });

  new ResizeObserver(() => {
    resizeRendererAndCamera();
    render();
  }).observe(viewportEl);

  resizeRendererAndCamera();

  return {
    setImage,
    setPre,
    setEffect,
    fit,
    zoomAt,
    pixelUnderCursor,
    renderToPixels,
    render,
    getZoom: () => zoom,
    getImageSize: () => ({ width: imageWidth, height: imageHeight }),
    onViewChange: (fn) => {
      onViewChange = fn;
    },
  };
}
