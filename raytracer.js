import * as THREE from 'three';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(canvas.parentElement.clientWidth, canvas.parentElement.clientHeight);
renderer.setPixelRatio(1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 1.5, 4);
camera.lookAt(0, 0.5, 0);

const uniforms = {
  u_time: { value: 0 },
  u_resolution: { value: new THREE.Vector2(canvas.width, canvas.height) },
  u_cameraPos: { value: camera.position.clone() },
  u_cameraFwd: { value: new THREE.Vector3() },
  u_cameraRight: { value: new THREE.Vector3() },
  u_cameraUp: { value: new THREE.Vector3() },
  u_lightPos: { value: new THREE.Vector3(3, 4, 2) },
  u_lightColor: { value: new THREE.Vector3(1, 1, 1) },
  u_lightIntensity: { value: 1.0 },
  u_lightType: { value: 0 },
  u_shadowSamples: { value: 16 },
  u_maxBounces: { value: 4 },
  u_spp: { value: 1 },
  u_toneMap: { value: 0 },
  u_exposure: { value: 1.0 },
  u_bgColor: { value: new THREE.Vector3(0.1, 0.1, 0.18) },
  u_frameCount: { value: 0 },
  u_accumulate: { value: 1 },
  u_objCount: { value: 0 },
  u_objType: { value: new Int32Array(16) },
  u_objPos: { value: Array.from({length: 16}, () => new THREE.Vector3()) },
  u_objScale: { value: new Float32Array(16) },
  u_objRot: { value: new Float32Array(16) },
  u_objMatType: { value: new Int32Array(16) },
  u_objColor: { value: Array.from({length: 16}, () => new THREE.Vector3()) },
  u_objRoughness: { value: new Float32Array(16) },
  u_objMetallic: { value: new Float32Array(16) },
  u_objIOR: { value: new Float32Array(16) },
  u_objTransmission: { value: new Float32Array(16) },
  u_objEmission: { value: new Float32Array(16) },
};

for (let i = 0; i < 16; i++) {
  uniforms.u_objPos.value[i] = new THREE.Vector3(0, 0, 0);
  uniforms.u_objColor.value[i] = new THREE.Vector3(0.8, 0.2, 0.2);
}

const vertexShader = `
out vec2 v_uv;
void main() {
  v_uv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fragmentShader = `
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec3 u_cameraPos;
uniform vec3 u_cameraFwd;
uniform vec3 u_cameraRight;
uniform vec3 u_cameraUp;
uniform vec3 u_lightPos;
uniform vec3 u_lightColor;
uniform float u_lightIntensity;
uniform int u_lightType;
uniform int u_shadowSamples;
uniform int u_maxBounces;
uniform int u_spp;
uniform int u_toneMap;
uniform float u_exposure;
uniform vec3 u_bgColor;
uniform int u_frameCount;
uniform int u_accumulate;

const int MAX_OBJ = 16;
uniform int u_objCount;
uniform int u_objType[MAX_OBJ];
uniform vec3 u_objPos[MAX_OBJ];
uniform float u_objScale[MAX_OBJ];
uniform float u_objRot[MAX_OBJ];
uniform int u_objMatType[MAX_OBJ];
uniform vec3 u_objColor[MAX_OBJ];
uniform float u_objRoughness[MAX_OBJ];
uniform float u_objMetallic[MAX_OBJ];
uniform float u_objIOR[MAX_OBJ];
uniform float u_objTransmission[MAX_OBJ];
uniform float u_objEmission[MAX_OBJ];

in vec2 v_uv;

float hash(uint n) {
  n = (n << 13u) ^ n;
  n = n * (n * n * 15731u + 789221u) + 1376312589u;
  return float(n & 0x7fffffffu) / float(0x7fffffff);
}

vec3 hash3(uint seed) {
  return vec3(hash(seed), hash(seed + 1u), hash(seed + 2u));
}

vec2 hash2(uint seed) {
  return vec2(hash(seed), hash(seed + 1u));
}

vec3 randomDirection(uint seed) {
  float z = 1.0 - 2.0 * hash(seed);
  float r = sqrt(max(0.0, 1.0 - z * z));
  float phi = 6.2831853 * hash(seed + 100u);
  return vec3(r * cos(phi), r * sin(phi), z);
}

vec3 randomOnHemisphere(vec3 n, uint seed) {
  vec3 dir = randomDirection(seed);
  return dir * sign(dot(dir, n));
}

float sdSphere(vec3 p, float r) { return length(p) - r; }

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdCylinder(vec3 p, float r, float h) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

mat2 rot2(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

float sceneSDF(vec3 p, out int hitObj) {
  hitObj = -1;
  float mind = 1e10;
  for (int i = 0; i < MAX_OBJ; i++) {
    if (i >= u_objCount) break;
    vec3 op = p - u_objPos[i];
    float rot = u_objRot[i];
    op.xz = rot2(rot) * op.xz;
    float sc = u_objScale[i];
    float d;
    int tp = u_objType[i];
    if (tp == 0) {
      d = sdSphere(op, sc * 0.5) / sc;
    } else if (tp == 1) {
      d = sdBox(op, vec3(sc * 0.5)) / sc;
    } else if (tp == 2) {
      d = sdCylinder(op, sc * 0.3, sc * 0.5) / sc;
    } else {
      d = sdTorus(op, vec2(sc * 0.35, sc * 0.12)) / sc;
    }
    if (d < mind) { mind = d; hitObj = i; }
  }
  float floorD = p.y + 0.5;
  if (floorD < mind) { mind = floorD; hitObj = -2; }
  return mind;
}

float sceneSDF(vec3 p) { int tmp; return sceneSDF(p, tmp); }

vec3 calcNormal(vec3 p) {
  float e = 0.001;
  return normalize(vec3(
    sceneSDF(p + vec3(e,0,0)) - sceneSDF(p - vec3(e,0,0)),
    sceneSDF(p + vec3(0,e,0)) - sceneSDF(p - vec3(0,e,0)),
    sceneSDF(p + vec3(0,0,e)) - sceneSDF(p - vec3(0,0,e))
  ));
}

float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
  float res = 1.0;
  float t = mint;
  for (int i = 0; i < 32; i++) {
    float d = sceneSDF(ro + rd * t);
    if (d < 0.0005) return 0.05;
    res = min(res, k * d / t);
    t += clamp(d, 0.02, 0.1);
    if (t > maxt) break;
  }
  return clamp(res, 0.0, 1.0);
}

float fresnel(float cosTheta, float ior) {
  float r0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
  return r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);
}

struct Material {
  vec3 albedo;
  float roughness;
  float metallic;
  float ior;
  float transmission;
  float emission;
};

Material getMaterial(int objId) {
  Material m;
  if (objId == -2) {
    float checker = mod(floor(floor(0) + floor(0)), 2.0);
    m.albedo = mix(vec3(0.7), vec3(0.3), checker);
    m.roughness = 0.9;
    m.metallic = 0.0;
    m.ior = 1.0;
    m.transmission = 0.0;
    m.emission = 0.0;
  } else if (objId >= 0 && objId < u_objCount) {
    m.albedo = u_objColor[objId];
    m.roughness = u_objRoughness[objId];
    m.metallic = u_objMetallic[objId];
    m.ior = u_objIOR[objId];
    m.transmission = u_objTransmission[objId];
    m.emission = u_objEmission[objId];
  } else {
    m.albedo = vec3(0.5);
    m.roughness = 0.5;
    m.metallic = 0.0;
    m.ior = 1.0;
    m.transmission = 0.0;
    m.emission = 0.0;
  }
  return m;
}

vec3 shade(vec3 ro, vec3 rd, vec3 N, vec3 pos, Material mat, int hitObj, uint seed) {
  vec3 V = -rd;

  vec3 L;
  float lightDist;
  if (u_lightType == 0) {
    L = normalize(u_lightPos - pos);
    lightDist = length(u_lightPos - pos);
  } else {
    L = normalize(u_lightPos);
    lightDist = 100.0;
  }

  float shadow = 1.0;
  if (u_lightType == 0) {
    shadow = softShadow(pos + N * 0.002, L, 0.05, lightDist, 16.0);
  }

  vec3 H = normalize(V + L);
  float NdotL = max(dot(N, L), 0.0);
  float NdotV = max(dot(N, V), 0.0);
  float NdotH = max(dot(N, H), 0.0);
  float VdotH = max(dot(V, H), 0.0);

  vec3 F0 = mix(vec3(0.04), mat.albedo, mat.metallic);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdotH, 5.0);

  float D = pow(NdotH, 2.0 / (mat.roughness * mat.roughness + 0.001) - 2.0) / (3.14159 * (mat.roughness * mat.roughness + 0.001));
  float k = (mat.roughness + 1.0) * (mat.roughness + 1.0) / 8.0;
  float G1 = NdotV / (NdotV * (1.0 - k) + k);
  float G2 = NdotL / (NdotL * (1.0 - k) + k);
  float G = G1 * G2;

  vec3 diffuse = (1.0 - F) * (1.0 - mat.metallic) * mat.albedo / 3.14159;
  vec3 specular = F * D * G / max(4.0 * NdotV * NdotL, 0.001);

  vec3 Li = u_lightColor * u_lightIntensity * shadow / (lightDist * lightDist * 0.1 + 1.0);

  vec3 col = (diffuse + specular) * Li * NdotL;

  col += mat.albedo * 0.03;
  col += mat.albedo * mat.emission;

  return col;
}

vec3 tracePath(vec3 ro, vec3 rd, uint seed) {
  vec3 throughput = vec3(1.0);
  vec3 emission = vec3(0.0);

  for (int bounce = 0; bounce < 16; bounce++) {
    if (bounce >= u_maxBounces) break;

    int hitObj;
    float t = 0.01;
    bool hit = false;
    for (int i = 0; i < 128; i++) {
      vec3 p = ro + rd * t;
      float d = sceneSDF(p, hitObj);
      if (d < 0.0005) { hit = true; break; }
      t += d;
      if (t > 20.0) break;
    }

    if (!hit) {
      float sky = smoothstep(-0.1, 0.5, rd.y);
      emission += throughput * mix(vec3(0.15, 0.15, 0.25), vec3(0.3, 0.5, 0.8), sky);
      break;
    }

    vec3 pos = ro + rd * t;
    vec3 N = calcNormal(pos);
    Material mat = getMaterial(hitObj);

    emission += throughput * mat.albedo * mat.emission;

    vec3 direct = shade(pos, rd, N, pos, mat, hitObj, seed + uint(bounce) * 1000u);
    emission += throughput * direct;

    float cosTheta = max(dot(-rd, N), 0.0);
    float kr = fresnel(cosTheta, mat.ior);

    seed = seed * 1664525u + 1013904223u;

    if (mat.transmission > 0.5 && hash(seed) < mat.transmission) {
      float eta = 1.0 / mat.ior;
      if (cosTheta < 0.0) {
        eta = mat.ior;
        N = -N;
        cosTheta = -cosTheta;
      }
      if (hash(seed + 1u) < kr) {
        rd = reflect(rd, N);
      } else {
        rd = refract(rd, N, eta);
        if (length(rd) < 0.001) rd = reflect(rd, N);
      }
      ro = pos + rd * 0.002;
    } else if (mat.metallic > 0.5) {
      vec3 refl = reflect(rd, N);
      vec3 diffuseDir = randomOnHemisphere(N, seed + 2u);
      rd = normalize(mix(refl, diffuseDir, mat.roughness * mat.roughness));
      ro = pos + N * 0.002;
    } else {
      vec3 diffuseDir = randomOnHemisphere(N, seed + 3u);
      rd = diffuseDir;
      ro = pos + N * 0.002;
    }

    throughput *= 0.95;
  }

  return emission;
}

vec3 acesToneMap(vec3 x) {
  float a = 2.51; float b = 0.03; float c = 2.43; float d = 0.59; float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 reinhardToneMap(vec3 x) {
  return x / (x + vec3(1.0));
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);

  vec3 ro = u_cameraPos;
  vec3 rd = normalize(u_cameraFwd + uv.x * u_cameraRight + uv.y * u_cameraUp);

  vec3 col = vec3(0.0);
  uint baseSeed = uint(gl_FragCoord.x) * 1973u + uint(gl_FragCoord.y) * 9277u + uint(u_time * 1000.0) * 26699u;

  for (int s = 0; s < 16; s++) {
    if (s >= u_spp) break;
    uint seed = baseSeed + uint(s) * 3713u;
    vec2 jitter = hash2(seed) - 0.5;
    vec3 rj = normalize(rd + (u_cameraRight * jitter.x + u_cameraUp * jitter.y) * 0.003);
    col += tracePath(ro, rj, seed);
  }
  col /= float(u_spp);

  if (u_toneMap == 0) col = acesToneMap(col * u_exposure);
  else if (u_toneMap == 1) col = reinhardToneMap(col * u_exposure);
  else col = col * u_exposure;

  col = pow(col, vec3(0.4545));

  gl_FragColor = vec4(col, 1.0);
}
`;

const mat = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader,
  uniforms
});
const geo = new THREE.PlaneGeometry(2, 2);
const mesh = new THREE.Mesh(geo, mat);
const sc = new THREE.Scene();
sc.add(mesh);
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

let camTheta = 0.5, camPhi = 0.8, camDist = 4.5;
let camTarget = new THREE.Vector3(0, 0.5, 0);
let isDragging = false, isRightDrag = false;
let lastMouse = { x: 0, y: 0 };

canvas.addEventListener('mousedown', e => {
  isDragging = true;
  isRightDrag = e.button === 2;
  lastMouse = { x: e.clientX, y: e.clientY };
});
window.addEventListener('mouseup', () => isDragging = false);
canvas.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('mousemove', e => {
  if (!isDragging) return;
  const dx = e.clientX - lastMouse.x;
  const dy = e.clientY - lastMouse.y;
  lastMouse = { x: e.clientX, y: e.clientY };
  if (isRightDrag) {
    const right = new THREE.Vector3().crossVectors(camera.getWorldDirection(new THREE.Vector3()), camera.up).normalize();
    const up = camera.up.clone().normalize();
    camTarget.add(right.multiplyScalar(-dx * 0.005));
    camTarget.add(up.multiplyScalar(dy * 0.005));
  } else {
    camTheta -= dx * 0.005;
    camPhi = Math.max(0.1, Math.min(Math.PI - 0.1, camPhi - dy * 0.005));
  }
  resetAccumulation();
});
canvas.addEventListener('wheel', e => {
  camDist *= 1 + e.deltaY * 0.001;
  camDist = Math.max(1.5, Math.min(15, camDist));
  resetAccumulation();
});

function updateCamera() {
  camera.position.set(
    camTarget.x + camDist * Math.sin(camPhi) * Math.cos(camTheta),
    camTarget.y + camDist * Math.cos(camPhi),
    camTarget.z + camDist * Math.sin(camPhi) * Math.sin(camTheta)
  );
  camera.lookAt(camTarget);

  const fwd = new THREE.Vector3().subVectors(camTarget, camera.position).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();

  uniforms.u_cameraPos.value.copy(camera.position);
  uniforms.u_cameraFwd.value.copy(fwd);
  uniforms.u_cameraRight.value.copy(right);
  uniforms.u_cameraUp.value.copy(up);
}

let objects = [
  { type: 'sphere', pos: [0, 0.5, 0], scale: 1, rot: 0,
    matType: 'diffuse', color: '#cc3333', roughness: 0.5, metallic: 0, ior: 1.5, transmission: 0, emission: 0 },
  { type: 'sphere', pos: [-1.2, 0.3, 0.5], scale: 0.6, rot: 0,
    matType: 'glass', color: '#aaddff', roughness: 0.1, metallic: 0, ior: 1.5, transmission: 1, emission: 0 },
  { type: 'box', pos: [1.2, 0.4, -0.3], scale: 0.8, rot: 0.4,
    matType: 'specular', color: '#44aa88', roughness: 0.2, metallic: 0.9, ior: 1.5, transmission: 0, emission: 0 },
];
let selectedObj = 0;

const typeMap = { sphere: 0, box: 1, cylinder: 2, torus: 3 };
const matTypeMap = { diffuse: 0, specular: 1, glass: 2, emissive: 3 };

function syncUniforms() {
  uniforms.u_objCount.value = objects.length;
  for (let i = 0; i < objects.length && i < 16; i++) {
    const o = objects[i];
    uniforms.u_objType.value[i] = typeMap[o.type] || 0;
    uniforms.u_objPos.value[i].set(o.pos[0], o.pos[1], o.pos[2]);
    uniforms.u_objScale.value[i] = o.scale;
    uniforms.u_objRot.value[i] = o.rot;
    uniforms.u_objMatType.value[i] = matTypeMap[o.matType] || 0;
    const c = hexToRgb(o.color);
    uniforms.u_objColor.value[i].set(c[0], c[1], c[2]);
    uniforms.u_objRoughness.value[i] = o.roughness;
    uniforms.u_objMetallic.value[i] = o.metallic;
    uniforms.u_objIOR.value[i] = o.ior;
    uniforms.u_objTransmission.value[i] = o.transmission;
    uniforms.u_objEmission.value[i] = o.emission;
  }
  resetAccumulation();
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

function renderObjectList() {
  const el = document.getElementById('object-list');
  el.innerHTML = objects.map((o, i) => `
    <div class="object-item ${i === selectedObj ? 'selected' : ''}" onclick="selectObj(${i})">
      <span class="name">${o.type} #${i}</span>
      <span class="delete" onclick="event.stopPropagation(); deleteObj(${i})">x</span>
    </div>
  `).join('');
}

function selectObj(i) {
  selectedObj = i;
  renderObjectList();
  const o = objects[i];
  document.getElementById('object-props').style.display = 'block';
  document.getElementById('obj-px').value = o.pos[0];
  document.getElementById('obj-py').value = o.pos[1];
  document.getElementById('obj-pz').value = o.pos[2];
  document.getElementById('obj-scale').value = o.scale;
  document.getElementById('obj-rot').value = o.rot;
  document.getElementById('mat-type').value = o.matType;
  document.getElementById('mat-color').value = o.color;
  document.getElementById('mat-roughness').value = o.roughness;
  document.getElementById('mat-metallic').value = o.metallic;
  document.getElementById('mat-ior').value = o.ior;
  document.getElementById('mat-transmission').value = o.transmission;
  document.getElementById('mat-emission').value = o.emission;
  updateLabels();
}

function updateLabels() {
  document.querySelectorAll('#tab-material input[type="range"], #tab-light input[type="range"], #tab-render input[type="range"]').forEach(el => {
    const valEl = document.getElementById(el.id + '-v');
    if (valEl) valEl.textContent = parseFloat(el.value).toFixed(el.step.includes('.') ? el.step.split('.')[1].length : 0);
  });
}

window.addObject = (type) => {
  objects.push({
    type, pos: [0, 0.5, 0], scale: 0.8, rot: 0,
    matType: 'diffuse', color: '#cc3333', roughness: 0.5, metallic: 0, ior: 1.5, transmission: 0, emission: 0
  });
  selectedObj = objects.length - 1;
  renderObjectList();
  selectObj(selectedObj);
  syncUniforms();
};

window.deleteObj = (i) => {
  objects.splice(i, 1);
  if (selectedObj >= objects.length) selectedObj = Math.max(0, objects.length - 1);
  renderObjectList();
  if (objects.length > 0) selectObj(selectedObj);
  else document.getElementById('object-props').style.display = 'none';
  syncUniforms();
};

window.selectObj = selectObj;

window.resetAccumulation = () => { uniforms.u_frameCount.value = 0; };
window.resetCamera = () => {
  camTheta = 0.5; camPhi = 0.8; camDist = 4.5;
  camTarget.set(0, 0.5, 0);
  resetAccumulation();
};

['obj-px', 'obj-py', 'obj-pz'].forEach((id, i) => {
  document.getElementById(id).addEventListener('input', e => {
    objects[selectedObj].pos[i] = parseFloat(e.target.value);
    syncUniforms();
  });
});
document.getElementById('obj-scale').addEventListener('input', e => {
  objects[selectedObj].scale = parseFloat(e.target.value);
  syncUniforms();
});
document.getElementById('obj-rot').addEventListener('input', e => {
  objects[selectedObj].rot = parseFloat(e.target.value);
  syncUniforms();
});

document.getElementById('mat-type').addEventListener('change', e => {
  objects[selectedObj].matType = e.target.value;
  syncUniforms();
});
document.getElementById('mat-color').addEventListener('input', e => {
  objects[selectedObj].color = e.target.value;
  syncUniforms();
});
document.getElementById('mat-roughness').addEventListener('input', e => {
  objects[selectedObj].roughness = parseFloat(e.target.value);
  syncUniforms();
});
document.getElementById('mat-metallic').addEventListener('input', e => {
  objects[selectedObj].metallic = parseFloat(e.target.value);
  syncUniforms();
});
document.getElementById('mat-ior').addEventListener('input', e => {
  objects[selectedObj].ior = parseFloat(e.target.value);
  syncUniforms();
});
document.getElementById('mat-transmission').addEventListener('input', e => {
  objects[selectedObj].transmission = parseFloat(e.target.value);
  syncUniforms();
});
document.getElementById('mat-emission').addEventListener('input', e => {
  objects[selectedObj].emission = parseFloat(e.target.value);
  syncUniforms();
});

document.getElementById('light-type').addEventListener('change', e => {
  uniforms.u_lightType.value = { point: 0, directional: 1, area: 2 }[e.target.value];
  resetAccumulation();
});
['light-px', 'light-py', 'light-pz'].forEach((id, i) => {
  document.getElementById(id).addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    if (i === 0) uniforms.u_lightPos.value.x = v;
    else if (i === 1) uniforms.u_lightPos.value.y = v;
    else uniforms.u_lightPos.value.z = v;
    resetAccumulation();
  });
});
document.getElementById('light-color').addEventListener('input', e => {
  const c = hexToRgb(e.target.value);
  uniforms.u_lightColor.value.set(c[0], c[1], c[2]);
  resetAccumulation();
});
document.getElementById('light-intensity').addEventListener('input', e => {
  uniforms.u_lightIntensity.value = parseFloat(e.target.value);
  resetAccumulation();
});
document.getElementById('light-shadow-samples').addEventListener('input', e => {
  uniforms.u_shadowSamples.value = parseInt(e.target.value);
  resetAccumulation();
});

document.getElementById('rt-bounces').addEventListener('input', e => {
  uniforms.u_maxBounces.value = parseInt(e.target.value);
  resetAccumulation();
});
document.getElementById('rt-spp').addEventListener('input', e => {
  uniforms.u_spp.value = parseInt(e.target.value);
  resetAccumulation();
});
document.getElementById('rt-tonemap').addEventListener('change', e => {
  uniforms.u_toneMap.value = { aces: 0, reinhard: 1, linear: 2 }[e.target.value];
  resetAccumulation();
});
document.getElementById('rt-exposure').addEventListener('input', e => {
  uniforms.u_exposure.value = parseFloat(e.target.value);
  resetAccumulation();
});
document.getElementById('rt-bg').addEventListener('input', e => {
  const c = hexToRgb(e.target.value);
  uniforms.u_bgColor.value.set(c[0], c[1], c[2]);
  resetAccumulation();
});
document.getElementById('rt-accumulate').addEventListener('change', e => {
  uniforms.u_accumulate.value = e.target.checked ? 1 : 0;
  resetAccumulation();
});

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(tc => tc.style.display = 'none');
    document.getElementById('tab-' + tab.dataset.tab).style.display = 'block';
  });
});

renderObjectList();
selectObj(0);
syncUniforms();

let lastTime = performance.now();
let frameCount = 0;
let fps = 0;

function animate(time) {
  const dt = (time - lastTime) * 0.001;
  lastTime = time;
  frameCount++;
  if (frameCount % 30 === 0) {
    fps = Math.round(1 / dt);
    document.getElementById('fps').textContent = fps + ' FPS | Frame: ' + uniforms.u_frameCount.value;
  }

  uniforms.u_time.value = time * 0.001;

  const w = canvas.parentElement.clientWidth;
  const h = canvas.parentElement.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    renderer.setSize(w, h);
    uniforms.u_resolution.value.set(w, h);
  }

  updateCamera();

  if (uniforms.u_accumulate.value === 1) {
    uniforms.u_frameCount.value++;
  }

  renderer.render(sc, cam);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
