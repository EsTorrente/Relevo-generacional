/* =========================================================================
   RELEVO GENERACIONAL — Fórum UPB 2026
   Generative motion-graphics presentation engine (Three.js r128 + GSAP)
   ========================================================================= */

const PALETTE = {
  cyan:   '#17d4ff',
  pink:   '#ff80ac',
  red:    '#ff2b39',
  orange: '#ff8636',
  forest: '#063d04',
  cream:  '#fffbf2',
  ink:    '#0f0b01'
};

const TWO_PI = Math.PI * 2;
function rand(a, b){ return a + Math.random() * (b - a); }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
function easeOutCubic(p){ return 1 - Math.pow(1 - p, 3); }

let currentLang = 'es';

/* -------------------------------------------------------------------------
   Renderer / Scene / Camera
   ------------------------------------------------------------------------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 300);

const bgColor = new THREE.Color(PALETTE.cream);
const bgGoal = new THREE.Color(PALETTE.cream);
scene.background = bgColor;
function setBgGoal(colorLike){ bgGoal.set(colorLike); }

scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2a2a, 0.9));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(8, 12, 10);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xfff2e0, 0.35);
rimLight.position.set(-10, -4, -8);
scene.add(rimLight);

const world = new THREE.Group();
scene.add(world);

/* -------------------------------------------------------------------------
   Shared geometry / material cache
   ------------------------------------------------------------------------- */
const geoSphere   = new THREE.SphereGeometry(1, 28, 22);
const geoCube     = new THREE.BoxGeometry(1.55, 1.55, 1.55);
const geoOcta     = new THREE.OctahedronGeometry(1.35, 0);
const geoTetra    = new THREE.TetrahedronGeometry(1.5, 0);
const geoCylinder = new THREE.CylinderGeometry(0.9, 0.9, 2.15, 22);
const geoCone     = new THREE.ConeGeometry(1.15, 1.9, 4);

function geometryFor(shape){
  switch(shape){
    case 'cube': return geoCube;
    case 'octa': return geoOcta;
    case 'tetra': return geoTetra;
    case 'cylinder': return geoCylinder;
    case 'cone': return geoCone;
    default: return geoSphere;
  }
}

const _matCache = {};
function mat(colorHex){
  if(!_matCache[colorHex]){
    _matCache[colorHex] = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.5, metalness: 0.06 });
  }
  return _matCache[colorHex];
}

function makeCross(colorHex){
  const g = new THREE.Group();
  const m = mat(colorHex);
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.42, 0.42), m));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.9, 0.42), m));
  return g;
}

function makeMesh(shape, colorHex){
  if(shape === 'cross') return makeCross(colorHex);
  return new THREE.Mesh(geometryFor(shape), mat(colorHex));
}

function swapGeometry(mesh, shape){
  mesh.geometry = geometryFor(shape);
}

function cloneMaterialOf(obj){
  if(obj.material){
    obj.material = obj.material.clone();
    clonedMaterials.push(obj.material);
  } else {
    obj.traverse(c => { if(c.material){ c.material = c.material.clone(); clonedMaterials.push(c.material); } });
  }
}

function setColorOf(obj, color){
  if(obj.material) obj.material.color.set(color);
  else obj.traverse(c => { if(c.material) c.material.color.set(color); });
}

/* -------------------------------------------------------------------------
   Reusable temp objects
   ------------------------------------------------------------------------- */
const _tmpColor = new THREE.Color();
const _tmpVecA = new THREE.Vector3();

/* -------------------------------------------------------------------------
   Glow sprites
   ------------------------------------------------------------------------- */
const _glowTexCache = {};
function glowTexture(colorHex){
  if(_glowTexCache[colorHex]) return _glowTexCache[colorHex];
  const size = 128;
  const cnv = document.createElement('canvas');
  cnv.width = cnv.height = size;
  const ctx = cnv.getContext('2d');
  const hex = '#' + new THREE.Color(colorHex).getHexString();
  const grd = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grd.addColorStop(0, hex + 'ff');
  grd.addColorStop(0.35, hex + '99');
  grd.addColorStop(1, hex + '00');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cnv);
  _glowTexCache[colorHex] = tex;
  return tex;
}
function makeGlow(colorHex, scale){
  const m = new THREE.SpriteMaterial({ map: glowTexture(colorHex), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const spr = new THREE.Sprite(m);
  spr.scale.set(scale, scale, 1);
  return spr;
}

/* -------------------------------------------------------------------------
   TrailSystem
   ------------------------------------------------------------------------- */
class TrailSystem {
  constructor(count, baseColorHex, pointSize){
    this.count = count;
    this.head = 0;
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.alphas = new Float32Array(count);
    const c = new THREE.Color(baseColorHex);
    for(let i = 0; i < count; i++){
      this.colors[i*3] = c.r; this.colors[i*3+1] = c.g; this.colors[i*3+2] = c.b;
      this.positions[i*3+2] = -9999;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: pointSize || 30.0 } },
      vertexShader: `
        attribute float aAlpha;
        attribute vec3 color;
        varying float vAlpha;
        varying vec3 vColor;
        uniform float uSize;
        void main(){
          vAlpha = aAlpha;
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * (1.0 / max(0.001, -mv.z)) * (0.3 + aAlpha * 0.9);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying vec3 vColor;
        void main(){
          float d = length(gl_PointCoord - vec2(0.5));
          if(d > 0.5) discard;
          float edge = smoothstep(0.5, 0.05, d);
          gl_FragColor = vec4(vColor, vAlpha * edge * 0.9);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }
  spawn(pos, colorHex){
    const i = this.head;
    this.positions[i*3] = pos.x; this.positions[i*3+1] = pos.y; this.positions[i*3+2] = pos.z;
    if(colorHex){
      _tmpColor.set(colorHex);
      this.colors[i*3] = _tmpColor.r; this.colors[i*3+1] = _tmpColor.g; this.colors[i*3+2] = _tmpColor.b;
      this.geometry.attributes.color.needsUpdate = true;
    }
    this.alphas[i] = 1.0;
    this.head = (this.head + 1) % this.count;
    this.geometry.attributes.position.needsUpdate = true;
  }
  decay(rate){
    for(let i = 0; i < this.count; i++){ this.alphas[i] = Math.max(0, this.alphas[i] - rate); }
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }
  dispose(){ this.geometry.dispose(); this.material.dispose(); }
}

/* -------------------------------------------------------------------------
   ConnectionNet
   ------------------------------------------------------------------------- */
class ConnectionNet {
  constructor(maxConnections, colorHex, opts){
    opts = opts || {};
    this.maxConnections = maxConnections;
    const positions = new Float32Array(maxConnections * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.LineBasicMaterial({
      color: colorHex, transparent: true,
      opacity: opts.opacity !== undefined ? opts.opacity : 0.32,
      blending: opts.blending !== undefined ? opts.blending : THREE.AdditiveBlending
    });
    this.geometry = geo;
    this.material = m;
    this.mesh = new THREE.LineSegments(geo, m);
    this.mesh.frustumCulled = false;
  }
  update(objects, maxDist){
    const pos = this.geometry.attributes.position.array;
    let count = 0;
    const cap = this.maxConnections;
    for(let i = 0; i < objects.length && count < cap; i++){
      for(let j = i + 1; j < objects.length && count < cap; j++){
        const a = objects[i].position, b = objects[j].position;
        if(a.distanceTo(b) < maxDist){
          const idx = count * 6;
          pos[idx]=a.x; pos[idx+1]=a.y; pos[idx+2]=a.z;
          pos[idx+3]=b.x; pos[idx+4]=b.y; pos[idx+5]=b.z;
          count++;
        }
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.setDrawRange(0, count * 2);
  }
  dispose(){ this.geometry.dispose(); this.material.dispose(); }
}

/* -------------------------------------------------------------------------
   Starfield
   ------------------------------------------------------------------------- */
class Starfield {
  constructor(count){
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    for(let i = 0; i < count; i++){
      positions[i*3]   = rand(-26, 26);
      positions[i*3+1] = rand(-14, 14);
      positions[i*3+2] = rand(-34, 8);
      phases[i] = rand(0, TWO_PI);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        attribute float aPhase;
        uniform float uTime;
        varying float vTwinkle;
        void main(){
          vTwinkle = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 2.0 + aPhase));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 2.4 * (46.0 / max(0.001, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying float vTwinkle;
        void main(){
          float d = length(gl_PointCoord - vec2(0.5));
          if(d > 0.5) discard;
          gl_FragColor = vec4(vec3(0.999, 0.984, 0.949), vTwinkle * smoothstep(0.5, 0.0, d));
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.geometry = geo; this.material = m;
    this.mesh = new THREE.Points(geo, m);
    this.mesh.frustumCulled = false;
  }
  update(t){ this.material.uniforms.uTime.value = t; }
  dispose(){ this.geometry.dispose(); this.material.dispose(); }
}

/* -------------------------------------------------------------------------
   FaintParticles
   ------------------------------------------------------------------------- */
class FaintParticles {
  constructor(count = 60){
    this.particles = [];
    for(let i = 0; i < count; i++){
      const shape = pick(['sphere', 'octa', 'tetra']);
      const color = pick([PALETTE.cyan, PALETTE.pink, PALETTE.orange, PALETTE.cream]);
      const mesh = makeMesh(shape, color);
      cloneMaterialOf(mesh);
      mesh.material.transparent = true;
      mesh.material.opacity = rand(0.12, 0.28);
      
      const scale = rand(0.12, 0.28);
      mesh.scale.setScalar(scale);

      mesh.position.set(rand(-22, 22), rand(-12, 25), rand(-18, 5));
      world.add(mesh);

      this.particles.push({
        mesh,
        vx: rand(-0.8, 0.8),
        vy: rand(-0.6, 1.2),
        vz: rand(-0.8, 0.8),
        rotX: rand(-1, 1),
        rotY: rand(-1, 1)
      });
    }
  }
  update(dt){
    this.particles.forEach(p => {
      p.mesh.position.x += p.vx * dt * 2;
      p.mesh.position.y += p.vy * dt * 2;
      p.mesh.position.z += p.vz * dt * 2;

      p.mesh.rotation.x += p.rotX * dt;
      p.mesh.rotation.y += p.rotY * dt;

      if(p.mesh.position.x > 25) p.mesh.position.x = -25;
      if(p.mesh.position.x < -25) p.mesh.position.x = 25;
      if(p.mesh.position.y > 30) p.mesh.position.y = -10;
      if(p.mesh.position.y < -10) p.mesh.position.y = 30;
      if(p.mesh.position.z > 10) p.mesh.position.z = -20;
      if(p.mesh.position.z < -20) p.mesh.position.z = 10;
    });
  }
  dispose(){
    this.particles.forEach(p => world.remove(p.mesh));
    this.particles = [];
  }
}

/* -------------------------------------------------------------------------
   Disposal & Flashes
   ------------------------------------------------------------------------- */
let disposables = [];
let clonedMaterials = [];

function clearWorld(){
  while(world.children.length){ world.remove(world.children[world.children.length - 1]); }
  disposables.forEach(d => d.dispose && d.dispose());
  disposables = [];
  clonedMaterials.forEach(m => m.dispose());
  clonedMaterials = [];
}

const flashEl = document.getElementById('flash');
function triggerFlash(){
  if(flashEl) {
    gsap.killTweensOf(flashEl);
    gsap.set(flashEl, { opacity: 0.9 });
    gsap.to(flashEl, { opacity: 0, duration: 1.1, ease: 'power2.out' });
  }
}

function flashConnection(a, b, colorHex, opts){
  const radius = (opts && opts.radius) || 0.075;
  const hold = (opts && opts.hold) || 0.16;
  const fade = (opts && opts.fade) || 0.55;
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(0.001, dir.length());
  const geo = new THREE.CylinderGeometry(radius, radius, len, 8, 1, true);
  const m = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  world.add(mesh);
  gsap.to(m, { opacity: 0, duration: fade, delay: hold, onComplete: () => { world.remove(mesh); geo.dispose(); m.dispose(); } });
}

/* -------------------------------------------------------------------------
   Camera rig
   ------------------------------------------------------------------------- */
const camCur  = { pos: new THREE.Vector3(0, 0, 20), look: new THREE.Vector3(0, 0, 0) };
const camGoal = { pos: new THREE.Vector3(0, 0, 20), look: new THREE.Vector3(0, 0, 0) };
let camSmooth = 0.02;

function setCamGoal(px, py, pz, lx, ly, lz){
  camGoal.pos.set(px, py, pz);
  camGoal.look.set(lx, ly, lz);
}
let camIdleX = 0, camIdleY = 0;   // read by the photo parallax
function updateCamera(dt, tAbs){
  const k = 1 - Math.pow(camSmooth, dt);
  camCur.pos.lerp(camGoal.pos, k);
  camCur.look.lerp(camGoal.look, k);
  
  const idleX = Math.sin(tAbs * 0.25) * 0.45;
  const idleY = Math.cos(tAbs * 0.18) * 0.35;
  const idleZ = Math.sin(tAbs * 0.12) * 0.25;
  
  camIdleX = idleX; camIdleY = idleY;
  camera.position.set(camCur.pos.x + idleX, camCur.pos.y + idleY, camCur.pos.z + idleZ);
  
  const lookIdleX = Math.cos(tAbs * 0.15) * 0.15;
  const lookIdleY = Math.sin(tAbs * 0.1) * 0.15;
  camera.lookAt(camCur.look.x + lookIdleX, camCur.look.y + lookIdleY, camCur.look.z);
}

/* =========================================================================
   CHAPTER 1 — Título
   ========================================================================= */
function makeChapter1(){
  let runners = [], ambient = [];
  const CYCLE = 6.4, ROLL_END = 0.4, POP_END = 0.48, EXIT_END = 0.92;
  const START_X = -15, TRIGGER_X = 0, EXIT_X_CUBE = 21;

  function enter(){
    camSmooth = 0.05;
    runners = [
      { phase: 0,          color: PALETTE.red  },
      { phase: CYCLE*0.5,  color: PALETTE.cyan }
    ].map(r => {
      const mesh = makeMesh('sphere', r.color);
      cloneMaterialOf(mesh);
      mesh.material.transparent = true;
      mesh.position.set(START_X, 0, 0);
      world.add(mesh);
      return { ...r, mesh, isCube: false };
    });

    ambient = [];
    for(let i = 0; i < 22; i++){
      const shape = Math.random() < 0.5 ? 'sphere' : 'cube';
      const mesh = makeMesh(shape, PALETTE.pink);
      cloneMaterialOf(mesh);
      mesh.material.transparent = true;
      mesh.material.opacity = 0.05 + Math.random() * 0.08;
      const s = 0.25 + Math.random() * 0.4;
      mesh.scale.setScalar(s);
      mesh.position.set(rand(-22, 22), rand(-10, 10), rand(-16, -5));
      world.add(mesh);
      ambient.push(mesh);
    }
    setCamGoal(0, 1.2, 13, 0, 0.4, 0);
  }
  function exit(){ runners = []; ambient = []; }

  function update(dt, t){
    ambient.forEach(a => { a.rotation.y += dt * 0.18; a.rotation.x += dt * 0.09; });

    let followX = null;
    runners.forEach(r => {
      const local = ((t + r.phase) % CYCLE) / CYCLE;
      if(local < ROLL_END){
        if(r.isCube){
          r.isCube = false;
          swapGeometry(r.mesh, 'sphere');
          r.mesh.scale.setScalar(1);
        }
        r.mesh.material.opacity = 1;
        const p = local / ROLL_END;
        const x = THREE.MathUtils.lerp(START_X, TRIGGER_X, easeOutCubic(p));
        r.mesh.position.x = x;
        r.mesh.position.y = Math.max(0, Math.sin(p * Math.PI)) * 0.15;
        r.mesh.rotation.z -= dt * 4.4;
        followX = x;
      } else if(local < POP_END){
        if(!r.isCube){
          r.isCube = true;
          swapGeometry(r.mesh, 'cube');
          r.mesh.rotation.set(0, 0, 0);
          gsap.fromTo(r.mesh.scale, { x: 1.35, y: 0.65, z: 1.35 }, { x: 1, y: 1, z: 1, duration: 0.55, ease: 'elastic.out(1,0.55)' });
        }
        r.mesh.position.set(TRIGGER_X, 0, 0);
      } else if(local < EXIT_END){
        const p2 = (local - POP_END) / (EXIT_END - POP_END);
        r.mesh.position.x = THREE.MathUtils.lerp(TRIGGER_X, EXIT_X_CUBE, easeOutCubic(p2));
        r.mesh.rotation.y += dt * 2.2;
        if(p2 > 0.7) r.mesh.material.opacity = THREE.MathUtils.lerp(1, 0, (p2 - 0.7) / 0.3);
      } else {
        r.mesh.position.x = EXIT_X_CUBE + 2;
        r.mesh.material.opacity = 0;
      }
    });

    if(followX === null) followX = 0;
    setCamGoal(followX * 0.45, 1.2, 12.5, followX * 0.45, 0.35, 0);
  }
  return { enter, update, exit };
}

/* =========================================================================
   CHAPTER 2 — Línea de graduación
   ========================================================================= */
function makeChapter2(){
  let arc, spheres = [], bgParticles;
  const N = 9, SPACING = 3.1, SPEED = 3.2;
  const RANGE = N * SPACING;

  function enter(){
    camSmooth = 0.02;
    setCamGoal(0, 1, 16.5, 0, 0.4, 0);

    arc = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.4, 20, 64, Math.PI), mat(PALETTE.ink));
    arc.position.set(0, -3.2, -3.5);
    world.add(arc);

    spheres = [];
    for(let i = 0; i < N; i++){
      const mesh = makeMesh('sphere', PALETTE.cyan);
      cloneMaterialOf(mesh);
      mesh.scale.setScalar(0.78);
      world.add(mesh);
      spheres.push({ mesh, offset: i * SPACING, switched: false });
    }
    bgParticles = new FaintParticles(60);
  }
  function exit(){ spheres = []; bgParticles = null; }

  function update(dt, t){
    if(bgParticles) bgParticles.update(dt);
    spheres.forEach(s => {
      const x = ((t * SPEED + s.offset) % RANGE) - RANGE / 2;
      s.mesh.position.x = x;
      const behind = Math.max(0, 1 - Math.abs(x) / 2.3);
      s.mesh.position.z = -behind * 6.6;
      const bounce = Math.abs(Math.sin(t * 6 + s.offset * 1.3));
      s.mesh.position.y = -0.15 + bounce * 0.42;
      s.mesh.scale.set(0.78 * (1 + (1 - bounce) * 0.06), 0.78 * (1 - (1 - bounce) * 0.14), 0.78 * (1 + (1 - bounce) * 0.06));
      s.mesh.rotation.x += dt * 2.4;
      if(x > 0.15 && !s.switched){
        s.switched = true;
        const target = new THREE.Color(PALETTE.red);
        gsap.to(s.mesh.material.color, { r: target.r, g: target.g, b: target.b, duration: 0.55 });
      }
      if(x < -RANGE / 2 + 0.35 && s.switched){
        s.switched = false;
        s.mesh.material.color.set(PALETTE.cyan);
      }
    });
  }
  return { enter, update, exit };
}

/* =========================================================================
   CHAPTER 3 — Transición
   ========================================================================= */
function makeChapter3(){
  let floaters = [], net, stars;
  const HOLD = 1.0, FLY_DUR = 3.0;
  const SHAPES = ['sphere', 'cube', 'octa', 'tetra', 'cone', 'cross'];
  let logosInverted = false; // State to track logic color flip for this slide

  function enter(){
    logosInverted = false;
    camSmooth = 0.03;
    setCamGoal(0, 1, 16.5, 0, 0.4, 0);

    const arch = new THREE.Mesh(new THREE.TorusGeometry(6.2, 0.4, 20, 64, Math.PI), mat(PALETTE.ink));
    arch.position.set(0, -3.2, -3.5);
    world.add(arch);

    stars = new Starfield(220);
    world.add(stars.mesh); disposables.push(stars);

    gsap.to(arch.position, { z: -7, y: 0.3, duration: FLY_DUR, delay: HOLD, ease: 'power2.inOut' });
    gsap.to(arch.scale,    { x: 1.6, y: 1.6, z: 1.6, duration: FLY_DUR, delay: HOLD, ease: 'power2.inOut' });
    gsap.to(camGoal.pos,   { z: -14, duration: FLY_DUR, delay: HOLD, ease: 'power2.inOut' });
    gsap.to(camGoal.look,  { z: -18, duration: FLY_DUR, delay: HOLD, ease: 'power2.inOut' });

    floaters = [];
    for(let i = 0; i < 26; i++){
      const shape = pick(SHAPES);
      const color = pick([PALETTE.cyan, PALETTE.pink, PALETTE.red, PALETTE.orange]);
      const mesh = makeMesh(shape, color);
      cloneMaterialOf(mesh);
      const angle = rand(0, TWO_PI);
      const radius = rand(9, 15);
      mesh.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.6, rand(2, 14));
      mesh.scale.setScalar(0.001);
      world.add(mesh);
      floaters.push({
        mesh, base: new THREE.Color(color), targetScale: rand(0.35, 0.85),
        angle, radius, spawnAt: HOLD + rand(0, 1.3), spawned: false,
        orbitR: rand(2, 9), orbitSpeed: rand(0.12, 0.38), orbitPhase: rand(0, TWO_PI), driftPhase: rand(0, TWO_PI)
      });
    }

    net = new ConnectionNet(60, PALETTE.cyan);
    world.add(net.mesh); disposables.push(net);
  }
  function exit(){ floaters = []; }

  function update(dt, t){
    if (stars) stars.update(t);
    
    if(t > HOLD){
      const p = Math.min(1, (t - HOLD) / FLY_DUR);
      bgGoal.copy(new THREE.Color(PALETTE.cream).lerp(new THREE.Color(PALETTE.ink), p));
    }
    
    // Invert the logos dynamically slightly after the movement starts
    // so it happens while sliding through the dark arc.
    if(t > HOLD + 1.2 && !logosInverted) {
      logosInverted = true;
      document.body.style.setProperty('--logo-invert', 1);
    }

    const settled = t >= HOLD + FLY_DUR;
    floaters.forEach(f => {
      if(t < f.spawnAt) return;
      if(!f.spawned){
        f.spawned = true;
        gsap.to(f.mesh.scale, { x: f.targetScale, y: f.targetScale, z: f.targetScale, duration: 0.55, ease: 'back.out(1.7)' });
      }
      const localT = t - f.spawnAt;
      if(!settled){
        const shrink = 1 - Math.min(1, localT / 1.6) * 0.82;
        f.mesh.position.x = Math.cos(f.angle) * f.radius * shrink;
        f.mesh.position.y = Math.sin(f.angle) * f.radius * 0.6 * shrink;
        f.mesh.position.z -= dt * 7.2;
        f.mesh.rotation.x += dt * 0.6;
        f.mesh.rotation.y += dt * 0.7;
      } else {
        const a = f.orbitPhase + t * f.orbitSpeed;
        f.mesh.position.x = Math.cos(a) * f.orbitR;
        f.mesh.position.y = Math.sin(a * 1.3) * f.orbitR * 0.6 + Math.sin(t * 0.4 + f.driftPhase) * 1.1;
        f.mesh.position.z = -16 + Math.sin(a * 0.7) * f.orbitR * 0.7;
        f.mesh.rotation.x += dt * 0.5;
        f.mesh.rotation.y += dt * 0.4;
        const hsl = { h: 0, s: 0, l: 0 };
        f.base.getHSL(hsl);
        const col = new THREE.Color().setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + Math.sin(t * 1.3 + f.driftPhase) * 0.08, 0.15, 0.85));
        setColorOf(f.mesh, col);
      }
    });
    if(settled && net){
      net.update(floaters.filter(f => f.spawned).map(f => f.mesh), 6.2);
      setCamGoal(Math.sin(t * 0.1) * 2, Math.sin(t * 0.15) * 1, -14 + Math.sin(t * 0.12) * 3, 0, 0, -18);
    }
  }
  return { enter, update, exit };
}

/* =========================================================================
   CHAPTER 4 — Academia + Industria + Ciudad (Glowing Heroes + Stardust)
   ========================================================================= */
function makeChapter4(){
  let heroes = [], minions = [];
  const RISE_SPAN = 44;

  function enter(){
    camSmooth = 0.02;
    const defs = [
      { shape: 'octa',     color: PALETTE.cyan, phase: 0 },
      { shape: 'tetra',    color: PALETTE.red,  phase: TWO_PI / 3 },
      { shape: 'cylinder', color: PALETTE.pink, phase: (TWO_PI * 2) / 3 }
    ];
    heroes = defs.map(d => {
      const mesh = makeMesh(d.shape, d.color);
      cloneMaterialOf(mesh);
      mesh.scale.setScalar(1.25);
      world.add(mesh);

      const glow = makeGlow(d.color, 4.5);
      world.add(glow);

      const trail = new TrailSystem(220, d.color, 260);
      world.add(trail.points); disposables.push(trail);
      return { ...d, mesh, glow, trail, radius: 3.5, speed: 0.5 };
    });

    minions = [];
    for(let i = 0; i < 50; i++){
      const color = pick([PALETTE.orange, PALETTE.cyan, PALETTE.cream, PALETTE.pink]);
      const mesh = new THREE.Mesh(geoSphere, mat(color));
      cloneMaterialOf(mesh);
      
      const size = rand(0.015, 0.035);
      mesh.scale.setScalar(size);
      
      if(mesh.material){
        mesh.material.transparent = true;
        mesh.material.opacity = rand(0.15, 0.35);
      }
      
      const orbitR = rand(3.5, 9.5);
      const orbitAngle = rand(0, TWO_PI);
      mesh.position.set(Math.cos(orbitAngle) * orbitR, rand(-20, -2), Math.sin(orbitAngle) * orbitR);
      world.add(mesh);
      minions.push({
        mesh,
        orbitR,
        angle: orbitAngle,
        rotSpeed: rand(0.6, 1.8) * (Math.random() < 0.5 ? 1 : -1),
        yWobble: rand(0, TWO_PI)
      });
    }
  }
  function exit(){ heroes = []; minions = []; }

  function update(dt, t){
    let cx = 0, cy = 0, cz = 0;
    heroes.forEach(h => {
      const y = (t * 1.9) % RISE_SPAN - RISE_SPAN * 0.35;
      const a = h.phase + t * h.speed * TWO_PI * 0.42;
      const r = h.radius + Math.sin(t * 1.1 + h.phase) * 1.15;
      h.mesh.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      h.mesh.rotation.y += dt * 1.2;
      h.mesh.rotation.x += dt * 0.5;

      if(h.glow){
        h.glow.position.copy(h.mesh.position);
        const pulse = 4.2 + Math.sin(t * 4.0 + h.phase) * 1.4;
        h.glow.scale.set(pulse, pulse, 1);
      }

      if(h.trail) {
        h.trail.spawn(h.mesh.position);
        h.trail.spawn(h.mesh.position);
        h.trail.decay(dt * 0.45);
      }
      cx += h.mesh.position.x; cy += h.mesh.position.y; cz += h.mesh.position.z;
    });
    if(heroes.length > 0) {
      cx /= heroes.length; cy /= heroes.length; cz /= heroes.length;
    }

    minions.forEach(m => {
      m.angle += dt * m.rotSpeed;
      
      const targetX = cx + Math.cos(m.angle) * m.orbitR;
      const targetZ = cz + Math.sin(m.angle) * m.orbitR;
      const targetY = cy + Math.sin(t * 2.5 + m.yWobble) * 2.2;
      
      let pushVec = new THREE.Vector3();
      heroes.forEach(h => {
        const dVec = new THREE.Vector3().subVectors(m.mesh.position, h.mesh.position);
        const dist = dVec.length();
        if(dist < 3.8 && dist > 0.001){
          const force = (3.8 - dist) / 3.8;
          pushVec.add(dVec.normalize().multiplyScalar(force * 6.0));
        }
      });

      _tmpVecA.set(targetX, targetY, targetZ).add(pushVec).sub(m.mesh.position);
      m.mesh.position.addScaledVector(_tmpVecA, dt * 2.8);
    });

    setCamGoal(cx + 7.5, cy + 2, cz + 11, cx, cy, cz);
  }
  return { enter, update, exit };
}

/* =========================================================================
   CHAPTER 5 — Red / mandala
   ========================================================================= */
function makeChapter5(){
  let parts = [], net, bgParticles;
  const N = 34;

  function enter(){
    camSmooth = 0.025;
    parts = [];
    for(let i = 0; i < N; i++){
      const shape = i % 2 === 0 ? 'sphere' : 'cube';
      const color = pick([PALETTE.cyan, PALETTE.pink, PALETTE.red, PALETTE.orange]);
      const mesh = makeMesh(shape, color);
      mesh.scale.setScalar(0.38 + Math.random() * 0.28);
      world.add(mesh);
      parts.push({ mesh, angle: (i / N) * TWO_PI, radiusBase: 4 + (i % 5), phase: rand(0, TWO_PI) });
    }
    net = new ConnectionNet(70, PALETTE.pink);
    world.add(net.mesh); disposables.push(net);
    bgParticles = new FaintParticles(60);
    setCamGoal(0, 0, 19, 0, 0, 0);
  }
  function exit(){ parts = []; bgParticles = null; }

  function update(dt, t){
    if(bgParticles) bgParticles.update(dt);
    bgGoal.copy(new THREE.Color(PALETTE.ink).lerp(new THREE.Color(PALETTE.forest), 0.35 + Math.sin(t * 0.18) * 0.25));
    parts.forEach(p => {
      const ang = p.angle + t * 0.13;
      const r = p.radiusBase + Math.sin(t * 0.6 + p.phase) * 1.4;
      p.mesh.position.x = Math.cos(ang) * r;
      p.mesh.position.y = Math.sin(ang) * r * 0.55;
      p.mesh.position.z = Math.sin(t * 0.3 + p.phase) * 2.2 - 2;
      p.mesh.rotation.z += dt * 0.6;
      p.mesh.rotation.x += dt * 0.2;
    });
    if(net) net.update(parts.map(p => p.mesh), 3.3);
    const dolly = 12.5 + Math.sin(t * 0.22) * 4.5;
    setCamGoal(Math.sin(t * 0.1) * 1.5, Math.cos(t * 0.08) * 1, dolly, 0, 0, -2);
  }
  return { enter, update, exit };
}

/* =========================================================================
   CHAPTER 6 — Comunidad
   ========================================================================= */
function makeChapter6(){
  let streaks = [], stars;
  const N = 20;

  function enter(){
    camSmooth = 0.06;
    triggerFlash();
    stars = new Starfield(260);
    world.add(stars.mesh); disposables.push(stars);
    streaks = [];
    for(let i = 0; i < N; i++){
      const shape = pick(['sphere', 'cube', 'octa', 'cylinder']);
      const color = pick([PALETTE.cyan, PALETTE.pink, PALETTE.red, PALETTE.orange]);
      const mesh = makeMesh(shape, color);
      mesh.scale.setScalar(0.32 + Math.random() * 0.32);
      world.add(mesh);
      const trail = new TrailSystem(100, color, 46);
      world.add(trail.points); disposables.push(trail);
      streaks.push({ mesh, trail, y: rand(-8, 8), z: rand(-6, 4), speed: rand(2.5, 7.5), offset: rand(0, 40) });
    }
    setCamGoal(0, 0, 15.5, 0, 0, 0);
  }
  function exit(){ streaks = []; stars = null; }

  function update(dt, t){
    bgGoal.copy(new THREE.Color(PALETTE.ink).lerp(new THREE.Color(PALETTE.pink), 0.1 + Math.sin(t * 0.25) * 0.06));
    if(stars) stars.update(t);
    streaks.forEach(s => {
      const x = ((t * s.speed + s.offset) % 40) - 20;
      s.mesh.position.set(x, s.y, s.z);
      s.mesh.rotation.x += dt * 1.2;
      s.mesh.rotation.y += dt * 1.6;
      if(s.trail) {
        s.trail.spawn(s.mesh.position);
        s.trail.decay(dt * 0.55);
      }
    });
  }
  return { enter, update, exit };
}

/* =========================================================================
   CHAPTER 7 — Confianza
   ========================================================================= */
function makeChapter7(){
  let runner, trail, obstacles = [], net, x = 0, connectionsMade = 0, bgParticles;
  const BASE_SPEED = 1.6, SPEED_PER_CONNECTION = 0.9, RANGE = 140, THRESH = 7.5;

  function enter(){
    camSmooth = 0.035;
    x = -RANGE / 2; connectionsMade = 0;
    runner = makeMesh('sphere', PALETTE.red);
    world.add(runner);
    trail = new TrailSystem(170, PALETTE.red);
    world.add(trail.points); disposables.push(trail);

    obstacles = [];
    for(let i = 0; i < 32; i++){
      const shape = pick(['cube', 'octa', 'tetra', 'cylinder']);
      const color = pick([PALETTE.cyan, PALETTE.orange, PALETTE.pink]);
      const mesh = makeMesh(shape, color);
      mesh.scale.setScalar(0.52);
      const ox = -RANGE / 2 + (i + 0.6) * (RANGE / 32);
      mesh.position.set(ox, rand(-1.5, 1.5), rand(-2, 2));
      world.add(mesh);
      obstacles.push({ mesh, hit: false });
    }
    net = new ConnectionNet(30, PALETTE.ink, { blending: THREE.NormalBlending, opacity: 0.95 });
    world.add(net.mesh); disposables.push(net);
    bgParticles = new FaintParticles(60);
  }
  function exit(){ obstacles = []; bgParticles = null; runner = null; trail = null; net = null; }

  function update(dt, t){
    if(!runner) return;
    if(bgParticles) bgParticles.update(dt);
    const speed = BASE_SPEED + connectionsMade * SPEED_PER_CONNECTION;
    x += dt * speed;
    if(x > RANGE / 2){ x = -RANGE / 2; connectionsMade = 0; obstacles.forEach(o => o.hit = false); }
    runner.position.x = x;
    runner.position.y = Math.sin(t * 2.2) * 0.22;
    runner.rotation.z -= dt * speed * 0.9;

    const trailRate = Math.max(1, Math.floor(speed / 1.4));
    if(trail) {
      for(let i = 0; i < trailRate; i++) trail.spawn(runner.position);
      trail.decay(dt * 0.55);
    }

    const near = [];
    obstacles.forEach(o => {
      if(Math.abs(runner.position.x - o.mesh.position.x) < THRESH){
        near.push(o.mesh);
        if(!o.hit){ o.hit = true; connectionsMade++; }
      }
    });
    if(net) net.update([runner, ...near], THRESH + 0.6);

    setCamGoal(x + 3.6, 1.3, 12.5, x, 0.35, 0);
  }
  return { enter, update, exit };
}

/* =========================================================================
   CHAPTER 8 — Experiencia y nuevas rutas
   ========================================================================= */
function makeChapter8(){
  let core, glow = null, branches = [], morphed = false, bgParticles;
  const RISE_SPAN = 40;

  function enter(){
    camSmooth = 0.006; 
    core = makeMesh('cube', PALETTE.orange);
    core.position.set(-14, 0, 0);
    world.add(core);

    gsap.to(core.position, { x: 0, y: 0, z: 0, duration: 1.4, ease: 'power2.out' });
    gsap.fromTo(core.scale, { x: 1.4, y: 0.6, z: 1.4 }, { x: 1, y: 1, z: 1, duration: 1.4, ease: 'elastic.out(1,0.6)' });

    glow = makeGlow(PALETTE.orange, 5);
    glow.position.set(0, 0, 0);
    world.add(glow);

    morphed = false;
    branches = [];

    const colors = [PALETTE.cyan, PALETTE.pink, PALETTE.red, PALETTE.orange];
    for(let i = 0; i < 4; i++){
      const color = colors[i];
      const mesh = makeMesh('sphere', color);
      mesh.scale.setScalar(0); 
      world.add(mesh);

      const trail = new TrailSystem(140, color, 85);
      world.add(trail.points); disposables.push(trail);
      
      branches.push({
        mesh, trail, dirAngle: (i / 4) * TWO_PI + 0.4,
        radius: 1.6 + i * 0.4, wobble: rand(0, TWO_PI), released: false
      });
    }

    bgParticles = new FaintParticles(60);

    gsap.delayedCall(1.8, () => {
      morphed = true;
      branches.forEach((b, idx) => {
        if(b && b.mesh) {
          gsap.to(b.mesh.scale, {
            x: 0.52, y: 0.52, z: 0.52,
            duration: 1.2,
            delay: idx * 0.2,
            ease: 'back.out(1.8)',
            onStart: () => { b.released = true; }
          });
        }
      });
    });

    setCamGoal(0, 1, 13.5, 0, 1, 0);
  }

  function exit(){ branches = []; bgParticles = null; core = null; glow = null; }

  function update(dt, t){
    if(core) core.rotation.y += dt * 0.3;
    if(glow && core){
      glow.position.copy(core.position);
      const pulse = 4.6 + Math.sin(t * 2) * 0.5;
      glow.scale.set(pulse, pulse, 1);
    }

    if(bgParticles) bgParticles.update(dt);

    if(morphed){
      let cx = 0, cy = 0, cz = 0;
      let activeCount = 0;
      const age = t - 1.8;

      branches.forEach(b => {
        if(!b.released) return;
        activeCount++;
        const y = (age * 2.2) % RISE_SPAN;
        const waveX = Math.sin(t * 2.2 + b.wobble) * 1.8;
        const waveZ = Math.cos(t * 1.8 + b.wobble) * 1.5;

        b.mesh.position.x = Math.cos(b.dirAngle) * b.radius + waveX;
        b.mesh.position.z = Math.sin(b.dirAngle) * b.radius + waveZ;
        b.mesh.position.y = y;

        b.mesh.rotation.x += dt * 2;
        b.mesh.rotation.y += dt * 1.5;
        if(b.trail) {
          b.trail.spawn(b.mesh.position);
          b.trail.decay(dt * 0.65);
        }

        cx += b.mesh.position.x; cy += y; cz += b.mesh.position.z;
      });

      if(activeCount > 0){
        cx /= activeCount; cy /= activeCount; cz /= activeCount;
        setCamGoal(cx + 3.2, cy + 3.2, cz + 12.5, cx, cy + 1.8, cz);
      }
    }
  }
  return { enter, update, exit };
}

/* =========================================================================
   CHAPTER 9 — Torre infinita
   ========================================================================= */
function makeChapter9(){
  let pieces = [], spawnAcc = 0, topY = 0, count = 0, bgParticles;
  const CAP = 46, GAP = 1.5, DROP_DUR = 0.55, SPAWN_RATE = 0.4;

  function enter(){
    camSmooth = 0.03;
    pieces = []; spawnAcc = 0; topY = -3; count = 0;
    bgParticles = new FaintParticles(60);
    setCamGoal(6, 2, 19, 0, 2, 0);
  }
  function exit(){ pieces = []; bgParticles = null; }

  function spawnPiece(){
    const shape = count % 2 === 0 ? 'cube' : 'sphere';
    const color = shape === 'cube' ? PALETTE.cyan : PALETTE.red;
    const mesh = makeMesh(shape, color);
    const targetY = topY + GAP;
    mesh.position.set(rand(-0.35, 0.35), targetY + 8, rand(-0.35, 0.35));
    world.add(mesh);
    gsap.to(mesh.position, { y: targetY, duration: DROP_DUR, ease: 'bounce.out' });
    gsap.to(mesh.rotation, { y: rand(-0.3, 0.3), duration: DROP_DUR, ease: 'power2.out' });
    pieces.push({ mesh });
    topY = targetY;
    count++;
    if(pieces.length > CAP){ const old = pieces.shift(); world.remove(old.mesh); }
  }

  function update(dt, t){
    if(bgParticles) bgParticles.update(dt);
    spawnAcc += dt;
    if(spawnAcc > SPAWN_RATE){ spawnAcc = 0; spawnPiece(); }
    pieces.forEach(p => { p.mesh.rotation.y += dt * 0.05; });
    setCamGoal(6, topY + 2.5, 19, 0, topY - 2, 0);
  }
  return { enter, update, exit };
}

/* =========================================================================
   CHAPTER 10 — Escalera
   ========================================================================= */
function makeChapter10(){
  let steps = [], rollers = [], spawnAcc = 0, stepIndex = 0, bgParticles;
  const CAP = 40, STEP_DX = 2.0, STEP_DY = 1.05, SPAWN_RATE = 0.45;
  const OFFSET_X = 6.0;

  function enter(){
    camSmooth = 0.03;
    steps = []; rollers = []; spawnAcc = 0; stepIndex = 0;
    bgParticles = new FaintParticles(60);

    for(let s = 0; s < 3; s++){
      const mesh = makeMesh('sphere', PALETTE.red);
      cloneMaterialOf(mesh);
      mesh.material.transparent = true;
      mesh.material.opacity = 0;
      mesh.scale.setScalar(0.001);
      mesh.position.set(OFFSET_X, 0, 0);
      world.add(mesh);

      gsap.to(mesh.scale, { x: 1, y: 1, z: 1, duration: 0.8, delay: 0.4 + s * 0.4, ease: 'back.out(1.8)' });
      gsap.to(mesh.material, { opacity: 1, duration: 0.6, delay: 0.4 + s * 0.4 });

      rollers.push({ mesh, progress: -s * 3.4, speed: 3.0 + s * 0.15, lastBumpIdx: -1 });
    }
    setCamGoal(OFFSET_X + 6, 4, 21, OFFSET_X, 2, 0);
  }
  function exit(){ steps = []; rollers = []; bgParticles = null; }

  function spawnStep(){
    const mesh = makeMesh('cube', PALETTE.cyan);
    cloneMaterialOf(mesh);
    mesh.material.transparent = true;
    mesh.material.opacity = 0;
    mesh.scale.setScalar(0.001);

    const x = OFFSET_X + stepIndex * STEP_DX;
    const y = stepIndex * STEP_DY;
    mesh.position.set(x, y, 0);
    world.add(mesh);

    gsap.to(mesh.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'back.out(1.7)' });
    gsap.to(mesh.material, { opacity: 1, duration: 0.4 });

    steps.push({ mesh, x, y });
    stepIndex++;
    if(steps.length > CAP){ const old = steps.shift(); world.remove(old.mesh); }
  }

  function update(dt, t){
    if(bgParticles) bgParticles.update(dt);
    spawnAcc += dt;
    if(steps.length < 6 || spawnAcc > SPAWN_RATE){ spawnAcc = 0; spawnStep(); }

    const lastStep = steps[steps.length - 1];

    rollers.forEach(r => {
      r.progress += dt * r.speed;
      const maxIdx = steps.length - 1;
      if(maxIdx < 1) return;
      if(r.progress < 0){
        r.mesh.position.set(OFFSET_X - 3 + r.progress * 0.4, 1.2, 0);
        return;
      }
      const idx = Math.min(Math.floor(r.progress), maxIdx - 1);
      const nextIdx = Math.min(idx + 1, maxIdx);
      const a = steps[idx], b = steps[nextIdx];
      const localT = THREE.MathUtils.clamp(r.progress - idx, 0, 1);
      const hop = Math.sin(localT * Math.PI) * 0.5;
      r.mesh.position.set(
        THREE.MathUtils.lerp(a.x, b.x, localT),
        THREE.MathUtils.lerp(a.y, b.y, localT) + 1.15 + hop,
        0
      );
      r.mesh.rotation.z -= dt * 5;
      const hopNorm = Math.sin(localT * Math.PI);
      r.mesh.scale.set(1.12 - hopNorm * 0.22, 0.85 + hopNorm * 0.3, 1.12 - hopNorm * 0.22);
      if(idx !== r.lastBumpIdx && localT < 0.4){
        r.lastBumpIdx = idx;
        gsap.to(a.mesh.position, { y: a.y + 0.32, duration: 0.16, yoyo: true, repeat: 1, ease: 'power1.inOut' });
        flashConnection(r.mesh.position, a.mesh.position, PALETTE.pink);
      }
      if(r.progress > maxIdx - 0.3){ r.progress = -rand(1.5, 3.5); r.lastBumpIdx = -1; }
    });

    if(lastStep) setCamGoal(lastStep.x - 2, lastStep.y + 3, 20, lastStep.x - 8, lastStep.y - 1, 0);
  }
  return { enter, update, exit };
}

/* =========================================================================
   CHAPTER 11 — El presente
   ========================================================================= */
function makeChapter11(){
  let cells = [];
  const ROWS = 9, COLS = 17, SPACING_X = 1.85, SPACING_Y = 1.5;
  const GRID_W = COLS * SPACING_X;
  const SCROLL_SPEED = 1.6;

  function enter(){
    camSmooth = 0.06;
    cells = [];
    for(let r = 0; r < ROWS; r++){
      for(let c = 0; c < COLS; c++){
        const m = new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 1 });
        clonedMaterials.push(m);
        const mesh = new THREE.Mesh(geoSphere, m);
        mesh.scale.setScalar(0.42);
        const baseX = (c - COLS / 2) * SPACING_X;
        const baseY = (r - ROWS / 2) * SPACING_Y;
        mesh.position.set(baseX, baseY, 0);
        world.add(mesh);
        cells.push({
          mesh, baseX, baseY,
          distNorm: Math.min(1, Math.sqrt((baseX / (GRID_W * 0.5)) ** 2 + (baseY / (ROWS * SPACING_Y * 0.5)) ** 2)),
          phase: rand(0, TWO_PI), blinkPhase: rand(0, TWO_PI), color: pick([PALETTE.cyan, PALETTE.pink, PALETTE.orange])
        });
      }
    }
    setCamGoal(0, 0, 13, 0, 0, 0);
  }
  function exit(){ cells = []; }

  function update(dt, t){
    const scrollAmt = t * SCROLL_SPEED;
    cells.forEach(c => {
      let x = (c.baseX - scrollAmt) % GRID_W;
      if(x < -GRID_W / 2) x += GRID_W;
      if(x > GRID_W / 2) x -= GRID_W;
      c.mesh.position.x = x;
      const pulse = 0.34 + Math.sin(t * 2.4 + c.phase) * 0.18;
      c.mesh.scale.setScalar(Math.max(0.14, pulse));
      const vis = (Math.sin(t * 1.3 + c.blinkPhase) + 1) / 2;
      const centerFade = THREE.MathUtils.clamp(0.12 + c.distNorm * 0.95, 0.12, 1);
      c.mesh.material.opacity = (0.15 + vis * 0.85) * centerFade;
      c.mesh.material.color.set(c.color);
    });
    setCamGoal(Math.sin(t * 0.05) * 1, 0, 13, 0, 0, 0);
  }
  return { enter, update, exit };
}

/* =========================================================================
   CHAPTER 12 — El futuro se construye
   ========================================================================= */
function makeChapter12(){
  let rings = [], net;
  const RING_DEFS = [
    { count: 10, radius: 3.2, speed:  0.18, color: PALETTE.cyan,   shape: 'sphere' },
    { count: 14, radius: 5.4, speed: -0.13, color: PALETTE.pink,   shape: 'cube'   },
    { count: 18, radius: 7.8, speed:  0.09, color: PALETTE.red,    shape: 'sphere' },
    { count: 10, radius: 9.8, speed: -0.22, color: PALETTE.orange, shape: 'cube'   }
  ];

  function enter(){
    camSmooth = 0.02;
    rings = RING_DEFS.map((def, ri) => {
      const items = [];
      const hslTarget = { h: 0, s: 0, l: 0 };
      new THREE.Color(def.color).getHSL(hslTarget);
      for(let i = 0; i < def.count; i++){
        const mesh = makeMesh(def.shape, def.color);
        cloneMaterialOf(mesh);
        mesh.scale.setScalar(0.32 + (ri % 2) * 0.1);
        world.add(mesh);
        items.push({ mesh, angle: (i / def.count) * TWO_PI });
      }
      return { ...def, items, radiusNow: def.radius, reorgAt: rand(3, 6), baseHue: hslTarget.h, baseScale: 0.32 + (ri % 2) * 0.1 };
    });
    net = new ConnectionNet(90, PALETTE.pink);
    world.add(net.mesh); disposables.push(net);
    setCamGoal(0, 0, 22, 0, 0, 0);
  }
  function exit(){ rings = []; }

  function update(dt, t){
    bgGoal.copy(new THREE.Color(PALETTE.ink).lerp(new THREE.Color(PALETTE.orange), 0.08 + Math.sin(t * 0.12) * 0.05));
    const all = [];
    rings.forEach(ring => {
      if(t > ring.reorgAt){
        ring.reorgAt = t + rand(4, 7);
        gsap.to(ring, { radiusNow: ring.radius + rand(-1.6, 1.6), duration: 1.8, ease: 'sine.inOut' });
      }
      const col = new THREE.Color().setHSL(ring.baseHue, 0.75, 0.55 + Math.sin(t * 2) * 0.1);
      ring.items.forEach((it, idx) => {
        const a = it.angle + t * ring.speed;
        const epicycleA = t * ring.speed * 3.2 + idx * 1.7;
        const wobbleR = ring.radiusNow + Math.sin(t * 0.8 + idx) * 0.4;
        it.mesh.position.x = Math.cos(a) * wobbleR + Math.cos(epicycleA) * 0.4;
        it.mesh.position.y = Math.sin(a) * wobbleR * 0.72 + Math.sin(epicycleA) * 0.4;
        it.mesh.position.z = Math.sin(t * 0.3 + a) * 1.2 - 3;
        const pulse = 1 + Math.sin(t * 2 + idx) * 0.22;
        it.mesh.scale.setScalar(ring.baseScale * pulse);
        it.mesh.rotation.z += dt * 0.6;
        it.mesh.rotation.x += dt * 0.35;
        it.mesh.material.color.copy(col);
        all.push(it.mesh);
      });
    });
    if(net) net.update(all, 2.6);
    setCamGoal(Math.sin(t * 0.07) * 2, Math.cos(t * 0.05) * 1.4, 20 + Math.sin(t * 0.1) * 3, 0, 0, -3);
  }
  return { enter, update, exit };
}

/* =========================================================================
   CHAPTER 13 — Cierre
   ========================================================================= */
function makeChapter13(){
  let sphere, cube, bgParticles;
  function enter(){
    camSmooth = 0.06;
    sphere = makeMesh('sphere', PALETTE.red);
    cube = makeMesh('cube', PALETTE.cyan);
    sphere.position.set(-2.3, 0, 0);
    cube.position.set(2.1, 0, 0);
    world.add(sphere, cube);
    bgParticles = new FaintParticles(60);
    setCamGoal(0, 1, 14.5, 0, 0.6, 0);
  }
  function exit(){ sphere = null; cube = null; bgParticles = null; }
  function update(dt, t){
    if(bgParticles) bgParticles.update(dt);
    if(!sphere || !cube) return;
    sphere.position.y = Math.abs(Math.sin(t * 4.2)) * 1.9;
    sphere.rotation.z -= dt * 6;
    const cubeJump = Math.abs(Math.sin(t * 1.9));
    cube.position.y = cubeJump * 1.1;
    cube.scale.set(1 + (1 - cubeJump) * 0.12, 1 - (1 - cubeJump) * 0.18, 1 + (1 - cubeJump) * 0.12);
    cube.rotation.y += dt * 0.4;
  }
  return { enter, update, exit };
}

/* =========================================================================
   Slide metadata (Bilingual)
   ========================================================================= */
const SLIDE_META = [
  { 
    headline: {
      es: 'RELEVO GENERACIONAL<br><span class="em">La ventaja que nadie está aprovechando.</span>',
      pt: 'RENOVAÇÃO GERACIONAL<br><span class="em">A vantagem que ninguém está aproveitando.</span>'
    },
    sub: { es: '', pt: '' }, align: 'top', theme: 'light', accent: PALETTE.red 
  },
  { 
    headline: {
      es: '¿Un gran auditorio<br>solo para hacer grados?',
      pt: 'Um grande auditório<br>apenas para formaturas?'
    },
    sub: { es: '', pt: '' }, align: 'top', theme: 'light', accent: PALETTE.orange,
    photo: { pose: 'pose-right-portrait', file: 'assets/upb-graduacion-2026.webp', label: { es: 'Graduación — foto de referencia', pt: 'Formatura — foto de referência' } } 
  },
  { 
    headline: {
      es: 'Los eventos no llegaron a la Universidad.<br><span class="em">La Universidad decidió encontrarse con el mundo.</span>',
      pt: 'Os eventos não chegaram à Universidade.<br><span class="em">A Universidade decidiu se encontrar com o mundo.</span>'
    },
    sub: { es: '', pt: '' }, align: 'center', theme: 'dark', accent: PALETTE.cyan 
  },
  { 
    headline: {
      es: 'Academia + Industria + Ciudad',
      pt: 'Academia + Indústria + Cidade'
    },
    sub: { es: '', pt: '' }, align: 'top', theme: 'dark', accent: PALETTE.cyan,
    photo: { pose: 'pose-bleed-right', file: 'assets/upb-ciudad-2026.webp', label: { es: 'Academia · Industria · Ciudad', pt: 'Academia · Indústria · Cidade' } } 
  },
  { 
    headline: {
      es: 'Los eventos nunca fueron el objetivo.<br><span class="em">El impacto sí.</span>',
      pt: 'Os eventos nunca foram o objetivo.<br><span class="em">O impacto sim.</span>'
    },
    sub: { es: '', pt: '' }, align: 'top', theme: 'dark', accent: PALETTE.pink,
    photo: { pose: 'pose-left-low', file: 'assets/upb-impacto-2026.webp', label: { es: 'Impacto — foto de referencia', pt: 'Impacto — foto de referência' } } 
  },
  { 
    headline: {
      es: 'Un evento trae personas.<br>Una <span class="em">comunidad</span> trae <span class="em">transformación</span>.',
      pt: 'Um evento atrai pessoas.<br>Uma <span class="em">comunidade</span> traz <span class="em">transformação</span>.'
    },
    sub: { es: '', pt: '' }, align: 'center', theme: 'dark', accent: PALETTE.pink 
  },
  { 
    headline: {
      es: 'El talento crece a la velocidad<br>de la <span class="em">confianza</span>.',
      pt: 'O talento cresce na velocidade<br>da <span class="em">confiança</span>.'
    },
    sub: { es: '', pt: '' }, align: 'top', theme: 'light', accent: PALETTE.red 
  },
  { 
    headline: {
      es: 'La <span class="em">experiencia</span> construye el <span class="em">camino</span>.<br>Las nuevas generaciones descubren <span class="em">nuevas rutas</span>.',
      pt: 'A <span class="em">experiência</span> constrói o <span class="em">caminho</span>.<br>As novas gerações descobrem <span class="em">novas rotas</span>.'
    },
    sub: { es: '', pt: '' }, align: 'top', theme: 'dark', accent: PALETTE.orange,
    photo: { pose: 'pose-ambient', file: 'assets/upb-experiencia-2026.webp', label: { es: 'Experiencia — foto de referencia', pt: 'Experiência — foto de referência' } } 
  },
  { 
    headline: {
      es: 'Una visión.<br><span class="em">Dos generaciones.</span>',
      pt: 'Uma visão.<br><span class="em">Duas gerações.</span>'
    },
    sub: { es: '', pt: '' }, align: 'top', theme: 'light', accent: PALETTE.cyan 
  },
  { 
    headline: {
      es: 'El <span class="em">crecimiento</span> no ocurre cuando<br>una generación reemplaza a otra.<br>Ocurre cuando <span class="em">trabajan juntas</span>.',
      pt: 'O <span class="em">crescimento</span> não acontece quando<br>uma geração substitui outra.<br>Acontece quando <span class="em">trabalham juntas</span>.'
    },
    sub: { es: '', pt: '' }, align: 'top', theme: 'light', accent: PALETTE.red 
  },
  { 
    headline: {
      es: 'Los jóvenes no son el futuro.<br>Son el <span class="em">presente</span> que muchas<br>organizaciones aún no ven.',
      pt: 'Os jovens não são o futuro.<br>São o <span class="em">presente</span> que muitas<br>organizações ainda não veem.'
    },
    sub: { es: '', pt: '' }, align: 'center', theme: 'dark', accent: PALETTE.cyan 
  },
  { 
    headline: {
      es: 'El <span class="em">futuro</span> no se hereda.<br><span class="em">Se construye.</span>',
      pt: 'O <span class="em">futuro</span> não se herda.<br><span class="em">Se constrói.</span>'
    },
    sub: { es: '', pt: '' }, align: 'top', theme: 'dark', accent: PALETTE.pink,
    photo: { pose: 'pose-band', file: 'assets/upb-futuro-2026.webp', label: { es: 'El futuro — foto de referencia', pt: 'O futuro — foto de referência' } } 
  },
  { 
    headline: {
      es: 'Gracias.',
      pt: 'Obrigado.'
    },
    sub: { es: '', pt: '' }, align: 'top-center', theme: 'dark', accent: PALETTE.red, qr: true,
    photo: { pose: 'pose-float-right', file: 'assets/upb-cierre-2026.webp', label: { es: 'Fórum UPB 2026', pt: 'Fórum UPB 2026' } } 
  }
];

const UI_TEXTS = {
  es: {
    qr1: 'Recuerdos del evento',
    qr2: 'Fórum UPB · Instagram',
    hint: '← → · espacio · clic para navegar · H oculta la interfaz'
  },
  pt: {
    qr1: 'Lembranças do evento',
    qr2: 'Fórum UPB · Instagram',
    hint: '← → · espaço · clique para navegar · H oculta a interface'
  }
};

const chapterFactories = [
  makeChapter1, makeChapter2, makeChapter3, makeChapter4, makeChapter5, makeChapter6,
  makeChapter7, makeChapter8, makeChapter9, makeChapter10, makeChapter11, makeChapter12, makeChapter13
];
const chapters = chapterFactories.map(f => f());

/* -------------------------------------------------------------------------
   DOM refs + navigation
   ------------------------------------------------------------------------- */
const stageEl = document.getElementById('stage');
const headlineEl = document.getElementById('headline');
const subtextEl = document.getElementById('subtext');
const textLayerEl = document.getElementById('text-layer');
const photoFrameEl = document.getElementById('photo-frame');
const photoImgEl = document.getElementById('photo-img');
const photoIdleEl = document.getElementById('photo-idle');
const photoAnimEl = document.getElementById('photo-anim');
const photoCaptionEl = document.getElementById('photo-caption');
const qrRowEl = document.getElementById('qr-row');
const chapterIndexEl = document.getElementById('chapter-index');
const progressFillEl = document.getElementById('progress-fill');
const langBtn = document.getElementById('lang-toggle');
const qrLabel1 = document.getElementById('qr-label-1');
const qrLabel2 = document.getElementById('qr-label-2');
const navHint = document.getElementById('nav-hint');

let current = -1;
let clockStart = 0;
const clock = new THREE.Clock();

function updateText(){
  if(current < 0) return;
  const meta = SLIDE_META[current];
  
  if(headlineEl) headlineEl.innerHTML = meta.headline[currentLang];
  if(subtextEl) subtextEl.innerHTML = meta.sub[currentLang] || '';
  
  if(meta.photo && photoCaptionEl){
    photoCaptionEl.textContent = meta.photo.label[currentLang];
  }
  
  if(qrLabel1) qrLabel1.textContent = UI_TEXTS[currentLang].qr1;
  if(qrLabel2) qrLabel2.textContent = UI_TEXTS[currentLang].qr2;
  if(navHint) navHint.textContent = UI_TEXTS[currentLang].hint;
}

if(langBtn) {
  langBtn.addEventListener('click', () => {
    currentLang = currentLang === 'es' ? 'pt' : 'es';
    updateText();
  });
}


/* -------------------------------------------------------------------------
   Photo choreography
   Each photo gets a pose (see style.css) and an entrance built for that pose,
   so the imagery never lands the same way twice.
   ------------------------------------------------------------------------- */
const PHOTO_POSES = [
  'pose-right-portrait', 'pose-bleed-right', 'pose-left-low',
  'pose-float-right', 'pose-band', 'pose-ambient'
];

function photoEnterConfig(pose){
  switch(pose){
    case 'pose-bleed-right':   // slides in from off-stage right, wipes open sideways
      return { from:{ xPercent:16, yPercent:0, scale:0.95, rotation:2.5, filter:'blur(18px)' },
               clip:['inset(0% 0% 0% 100%)', 'inset(0% 0% 0% 0%)'], dur:1.5, exit:{ xPercent:8, scale:1.02 } };
    case 'pose-left-low':      // rises from below, counter-tilted
      return { from:{ xPercent:-12, yPercent:16, scale:0.86, rotation:-5, filter:'blur(14px)' },
               clip:['inset(100% 0% 0% 0%)', 'inset(0% 0% 0% 0%)'], dur:1.25, exit:{ xPercent:-8, yPercent:10 } };
    case 'pose-float-right':   // irises open from the centre
      return { from:{ xPercent:4, yPercent:-12, scale:0.8, rotation:3, filter:'blur(16px)' },
               clip:['inset(18% 18% 18% 18%)', 'inset(0% 0% 0% 0%)'], dur:1.4, exit:{ yPercent:-12, scale:1.06 } };
    case 'pose-band':          // cinematic strip unfurling from the centre outward
      return { from:{ xPercent:0, yPercent:28, scale:1.03, rotation:0, filter:'blur(12px)' },
               clip:['inset(0% 42% 0% 42%)', 'inset(0% 0% 0% 0%)'], dur:1.7, exit:{ yPercent:18, scale:1.0 } };
    case 'pose-ambient':       // breathes in as environment, never as an object
      return { from:{ xPercent:0, yPercent:0, scale:1.07, rotation:0, filter:'blur(30px)' },
               clip:['inset(0% 0% 0% 0%)', 'inset(0% 0% 0% 0%)'], dur:2.1, exit:{ scale:1.04 } };
    default:                   // right-portrait: lifts and unrolls upward
      return { from:{ xPercent:6, yPercent:18, scale:0.87, rotation:4, filter:'blur(14px)' },
               clip:['inset(0% 0% 100% 0%)', 'inset(0% 0% 0% 0%)'], dur:1.3, exit:{ yPercent:-8, scale:1.05 } };
  }
}

let photoCurrentFile = null;
let photoCurrentPose = null;
let photoTl = null;

function updatePhoto(meta){
  if(!photoFrameEl || !photoAnimEl) return;
  const next = meta.photo || null;
  const nextFile = next ? next.file : null;
  if(nextFile === photoCurrentFile) return;

  const leaving = photoCurrentPose ? photoEnterConfig(photoCurrentPose) : null;
  const hadPhoto = !!photoCurrentFile;
  photoCurrentFile = nextFile;
  photoCurrentPose = next ? (next.pose || 'pose-right-portrait') : null;

  if(photoTl) photoTl.kill();
  photoTl = gsap.timeline();

  if(hadPhoto){
    photoTl.to(photoAnimEl, Object.assign(
      { opacity:0, filter:'blur(14px)', duration:0.55, ease:'power2.in' },
      (leaving && leaving.exit) || {}
    ));
  }

  if(!next){
    photoTl.add(() => {
      photoFrameEl.classList.remove('visible');
      gsap.set(photoAnimEl, { clearProps:'all' });
    });
    return;
  }

  const pose = photoCurrentPose;
  const cfg = photoEnterConfig(pose);

  photoTl.add(() => {
    PHOTO_POSES.forEach(p => photoFrameEl.classList.remove(p));
    photoFrameEl.classList.add(pose);
    if(photoImgEl) photoImgEl.style.backgroundImage = `url('${next.file}')`;
    photoFrameEl.classList.add('visible');
  });

  photoTl.fromTo(photoAnimEl,
    Object.assign({ opacity:0 }, cfg.from),
    { opacity:1, xPercent:0, yPercent:0, scale:1, rotation:0, filter:'blur(0px)',
      duration:cfg.dur, ease:'expo.out' });

  if(photoImgEl){
    photoTl.fromTo(photoImgEl,
      { clipPath:cfg.clip[0], webkitClipPath:cfg.clip[0] },
      { clipPath:cfg.clip[1], webkitClipPath:cfg.clip[1], duration:cfg.dur * 0.85, ease:'power3.out' },
      '<');
  }
}

/* Photo drifts with the same idle motion as the 3D camera, plus pointer parallax,
   so it reads as an object inside the scene rather than a card pasted on top. */
const pointer = { x:0, y:0, tx:0, ty:0 };
window.addEventListener('pointermove', (e) => {
  pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2;
  pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2;
});

function updatePhotoMotion(tAbs, dt){
  if(!photoIdleEl) return;
  const k = Math.min(1, dt * 3);
  pointer.x += (pointer.tx - pointer.x) * k;
  pointer.y += (pointer.ty - pointer.y) * k;
  const floatY = Math.sin(tAbs * 0.62) * 9 + Math.sin(tAbs * 0.27 + 1.3) * 5;
  const parX = (-camIdleX * 26) + (pointer.x * -20);
  const parY = (-camIdleY * 26) + (pointer.y * -13);
  photoIdleEl.style.setProperty('--float-y', floatY.toFixed(2) + 'px');
  photoIdleEl.style.setProperty('--par-x', parX.toFixed(2) + 'px');
  photoIdleEl.style.setProperty('--par-y', parY.toFixed(2) + 'px');
}

function goTo(i){
  if(i < 0 || i >= chapters.length || i === current) return;
  const prev = current;
  if(prev >= 0) chapters[prev].exit();
  clearWorld();
  current = i;

  const meta = SLIDE_META[i];
  document.body.classList.remove('theme-light', 'theme-dark');
  document.body.classList.add('theme-' + meta.theme);
  if(stageEl) stageEl.style.setProperty('--accent', meta.accent);
  
  updateText();
  
  // Handled targeted white logos based on slide numbers (1-based index)
  const whiteSlides = [3, 4, 5, 6, 8, 11, 12, 13];
  const slideNum = i + 1;
  if (i === 2) {
    // Chapter 3 handles its own transition, start it at 0 (black)
    document.body.style.setProperty('--logo-invert', 0);
  } else {
    document.body.style.setProperty('--logo-invert', whiteSlides.includes(slideNum) ? 1 : 0);
  }

  if(textLayerEl) textLayerEl.dataset.align = meta.align;
  if(chapterIndexEl) chapterIndexEl.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(chapters.length).padStart(2, '0');
  if(progressFillEl) progressFillEl.style.width = ((i + 1) / chapters.length * 100) + '%';

  updatePhoto(meta);
  if(qrRowEl) qrRowEl.classList.toggle('visible', !!meta.qr);

  setBgGoal(meta.theme === 'dark' ? PALETTE.ink : PALETTE.cream);
  clockStart = clock.getElapsedTime();
  chapters[i].enter();
}

window.addEventListener('keydown', (e) => {
  if(e.key === 'ArrowRight' || e.key === ' '){ e.preventDefault(); goTo(current + 1); }
  else if(e.key === 'ArrowLeft'){ e.preventDefault(); goTo(current - 1); }
  else if(e.key === 'h' || e.key === 'H'){
    e.preventDefault();
    document.body.classList.toggle('ui-hidden');
  }
  else if(e.key === 'f' || e.key === 'F'){
    if(!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }
});

document.getElementById('tap-left')?.addEventListener('click', () => goTo(current - 1));
document.getElementById('tap-right')?.addEventListener('click', () => goTo(current + 1));

/* -------------------------------------------------------------------------
   Stage fit
   ------------------------------------------------------------------------- */
function fitStage(){
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  const ox = (window.innerWidth - 1920 * scale) / 2;
  const oy = (window.innerHeight - 1080 * scale) / 2;
  if(stageEl) stageEl.style.transform = `translate(${ox}px, ${oy}px) scale(${scale})`;
}
window.addEventListener('resize', () => {
  fitStage();
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
fitStage();

/* -------------------------------------------------------------------------
   Main loop
   ------------------------------------------------------------------------- */
function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.getElapsedTime() - clockStart;
  if(chapters[current] && typeof chapters[current].update === 'function') {
    chapters[current].update(dt, t);
  }
  updateCamera(dt, clock.getElapsedTime());
  updatePhotoMotion(clock.getElapsedTime(), dt);
  bgColor.lerp(bgGoal, 1 - Math.pow(0.01, dt));
  renderer.render(scene, camera);
}

goTo(0);
animate();