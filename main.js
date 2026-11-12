import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';



// Escena base
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07090a);
scene.fog = new THREE.FogExp2(0x0d1114, 0.055);
scene.add(new THREE.HemisphereLight(0x3a4550, 0x08080a, 0.25));

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 200);
camera.position.set(0, 1.7, 0);
scene.add(camera);

const listener = new THREE.AudioListener();
camera.add(listener);
addEventListener('click', () => {
  if (listener.context.state === 'suspended') listener.context.resume();
});

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

// Cámara en primera persona (mouse look)
const controls = new PointerLockControls(camera, document.body);
const inicio = document.getElementById('inicio');
let juegoTerminado = false;
inicio.addEventListener('click', () => { if (!juegoTerminado) controls.lock(); });
controls.addEventListener('lock', () => (inicio.style.display = 'none'));
controls.addEventListener('unlock', () => (inicio.style.display = juegoTerminado ? 'none' : 'flex'));

// Sistema de armas
const WEAPONS = [
  { nombre: 'Pistola',  archivo: 'Models/pistola_9mm.glb',               largo: 0.35, pos: [0.22, -0.20, -0.45], rotY: -Math.PI / 2, retroceso: 0.05, cooldown: 0.25,
    cargador: 12, reservaInicial: 24, reservaMax: 60, recarga: 12, tiempoRecarga: 1.2 },
  { nombre: 'Escopeta', archivo: 'Models/escopeta_recortada.glb', largo: 0.60, pos: [0.25, -0.24, -0.60], rotY: Math.PI / 2,  retroceso: 0.12, cooldown: 0.70,
    cargador: 4,  reservaInicial: 8,  reservaMax: 24, recarga: 4,  tiempoRecarga: 2.0 },
];
// 'largo' = largo deseado del arma en metros (se auto-escala).
// 'rotY'  = si el arma sale mirando al revés o de lado, cambia este valor (0, Math.PI, Math.PI/2, -Math.PI/2).

const armas = [];      // { cfg, grupo, base: Vector3 }
let actual = 0;
let enfriamiento = 0;  // segundos restantes para poder volver a disparar

const loader = new GLTFLoader();

function crearArma(cfg) {
  const grupo = new THREE.Group();             // pivote: posición/retroceso
  grupo.position.set(...cfg.pos);
  grupo.visible = false;
  camera.add(grupo);

      const item = { cfg, grupo, base: grupo.position.clone(), orient: null, cargador: cfg.cargador, reserva: cfg.reservaInicial };
  armas.push(item);

  loader.load(
    cfg.archivo,
    (gltf) => {
      const modelo = gltf.scene;
      // Normalizar tamaño y centrar, sin importar de dónde bajaste el modelo
      const caja = new THREE.Box3().setFromObject(modelo);
      const tam = caja.getSize(new THREE.Vector3());
      modelo.scale.setScalar(cfg.largo / Math.max(tam.x, tam.y, tam.z));
      const caja2 = new THREE.Box3().setFromObject(modelo);
      modelo.position.sub(caja2.getCenter(new THREE.Vector3()));

      const orient = new THREE.Group();        // contenedor para rotar sin tocar el pivote
      orient.rotation.y = cfg.rotY;
      orient.add(modelo);
      grupo.add(orient);
    },
    undefined,
    () => {
      // Si no encuentra el .glb, pone una cajita para que igual puedas probar
      console.warn('No se pudo cargar', cfg.archivo, '→ usando placeholder');
      grupo.add(new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.1, cfg.largo),
        new THREE.MeshStandardMaterial({ color: cfg.nombre === 'Pistola' ? 0x888888 : 0x8b5a2b })
      ));
    }
  );
}
WEAPONS.forEach(crearArma);

const hud = document.getElementById('hud');
let recargando = false;
let recargaTimer = 0;

function actualizarHUD() {
  const a = armas[actual];
  const pct = (a.cargador / a.cfg.cargador) * 100;
  hud.className = a.cargador === 0 ? 'vacio'
                : a.cargador <= a.cfg.cargador * 0.25 ? 'bajo' : '';
  let msg = '';
  if (recargando) msg = 'RECARGANDO...';
  else if (a.cargador === 0 && a.reserva === 0) msg = 'SIN MUNICIÓN';
  else if (a.cargador === 0) msg = 'PRESIONA R';
  hud.innerHTML = `
    <div class="msg">${msg}</div>
    <div class="nombre">${a.cfg.nombre}</div>
    <div class="cuenta">
      <span class="actual">${a.cargador}</span><span class="max">/ ${a.reserva}</span>
    </div>
    <div class="barra"><i style="width:${pct}%"></i></div>`;
}

function recargar() {
  const a = armas[actual];
  sonar('recarga', 0.7);
  if (recargando) return;
  if (a.cargador >= a.cfg.cargador) return;                    // cargador lleno
  if (a.reserva <= 0) { mostrarAviso('Sin munición de reserva'); return; }
  recargando = true;
  recargaTimer = a.cfg.tiempoRecarga;
  actualizarHUD();
}

function terminarRecarga() {
  const a = armas[actual];
  const mover = Math.min(a.cfg.cargador - a.cargador, a.reserva);
  a.cargador += mover;      // pasa balas de la reserva al cargador...
  a.reserva  -= mover;      // ...y las descuenta de la reserva (no se crea nada)
  recargando = false;
  actualizarHUD();
}

function seleccionar(i) {
  if (i === actual && armas[i].grupo.visible) return;
  armas.forEach((a, k) => (a.grupo.visible = k === i));
  actual = i;

  // Animación de "sacar arma": empieza abajo e inclinada
  const g = armas[i].grupo;
  g.position.y = armas[i].base.y - 0.35;
  g.rotation.x = -0.6;

  // Evita disparar justo en el instante del cambio
  enfriamiento = 0.2;

    actualizarHUD();
}
seleccionar(0);

// Sistemas de munición
const cajas = [];
const aviso = document.getElementById('aviso');
let avisoTimer;

function mostrarAviso(texto) {
  aviso.textContent = texto;
  aviso.style.opacity = 1;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => (aviso.style.opacity = 0), 1500);
}

function crearCaja(indiceArma, x, z) {
  const color = indiceArma === 0 ? 0xffcc00 : 0xff5533;  // amarilla = pistola, roja = escopeta
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.3, 0.4),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 })
  );
  mesh.position.set(x, 0.5, z);
  scene.add(mesh);
  cajas.push({ mesh, arma: indiceArma, baseY: 0.5 });
}

function actualizarCajas(dt) {
  for (let i = cajas.length - 1; i >= 0; i--) {
    const c = cajas[i];
    c.mesh.rotation.y += 2 * dt;
    c.mesh.position.y = c.baseY + Math.sin(reloj.elapsedTime * 3 + i) * 0.08;

    const dx = camera.position.x - c.mesh.position.x;
    const dz = camera.position.z - c.mesh.position.z;
    if (dx * dx + dz * dz < 1.5 * 1.5) {            // a menos de 1.5 m
         const a = armas[c.arma];
      if (a.reserva >= a.cfg.reservaMax) continue;   // reserva llena: la caja se queda
      a.reserva = Math.min(a.cfg.reservaMax, a.reserva + a.cfg.recarga);
      scene.remove(c.mesh);
      cajas.splice(i, 1);
      actualizarHUD();
      mostrarAviso(`+${a.cfg.recarga} balas de ${a.cfg.nombre}`);
    }
  }
}

function disparar() {
  if (enfriamiento > 0 || recargando) return;
  const a = armas[actual];

  if (a.cargador <= 0) {            // cargador vacío: no dispara
    enfriamiento = 0.25;
    sonar('vacio', 0.6);
    actualizarHUD();
    return;
  }

  a.cargador--;
  enfriamiento = a.cfg.cooldown;
  a.grupo.position.z += a.cfg.retroceso;
  a.grupo.rotation.x += 0.12;
  actualizarHUD();
  console.log('Disparo con', a.cfg.nombre, '| cargador', a.cargador, '| reserva', a.reserva);
  sonar(a.cfg.nombre === 'Escopeta' ? 'escopeta' : 'pistola', 0.8, 0.95 + Math.random() * 0.1);
  
  const rayo = new THREE.Raycaster();
    rayo.setFromCamera(new THREE.Vector2(0, 0), camera);
    const vivos = zombis.filter((z) => !z.muerto);
    const hits = rayo.intersectObjects(vivos.map((z) => z.g), true);
    if (hits.length) {
    let o = hits[0].object;
    while (o && !o.userData.zombi) o = o.parent;
    if (o) dañarZombi(o.userData.zombi, a.cfg.nombre === 'Escopeta' ? 3 : 1);
  }
}

// Teclas 1 y 2
addEventListener('keydown', (e) => {
  if (!controls.isLocked) return;
  if (e.code === 'Digit1') seleccionar(0);
  if (e.code === 'Digit2') seleccionar(1);
  if (e.code === 'KeyR') recargar();  
  if (e.code === 'KeyF') linterna.visible = !linterna.visible;  
  if (e.code === 'KeyE') abrirPuerta();
});

// Un clic = un disparo. 'mousedown' se dispara UNA vez por pulsación,
// así que mantener presionado NO hace disparo automático.
addEventListener('mousedown', (e) => {
  if (e.button === 0 && controls.isLocked) disparar();
});

// Movimiento WASD temporal para poder llegar a las cajas
const teclas = {};
addEventListener('keydown', (e) => (teclas[e.code] = true));
addEventListener('keyup',   (e) => (teclas[e.code] = false));

// Loop
const reloj = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = reloj.getDelta();
  if (enfriamiento > 0) enfriamiento -= dt;

      if (controls.isLocked) {
    const v = 5 * dt;
    const antes = camera.position.clone();
    if (teclas.KeyW) controls.moveForward(v);
    if (teclas.KeyS) controls.moveForward(-v);
    if (teclas.KeyD) controls.moveRight(v);
    if (teclas.KeyA) controls.moveRight(-v);

    // Colisión por ejes separados: si chocas en un eje, resbalas por el otro
    const nx = camera.position.x, nz = camera.position.z;
    camera.position.x = chocaConMundo(nx, antes.z) ? antes.x : nx;
    camera.position.z = chocaConMundo(camera.position.x, nz) ? antes.z : nz;
  }
  revisarExtraccion();

  actualizarCajas(dt);

    if (recargando) {
    recargaTimer -= dt;
    if (recargaTimer <= 0) terminarRecarga();
  }
  const a = armas[actual];
  const objetivo = a.base.clone();
  let rotObj = 0;
  if (recargando) { objetivo.y -= 0.25; rotObj = -0.6; }   // animación de recarga
  a.grupo.position.lerp(objetivo, 1 - Math.exp(-15 * dt));
  a.grupo.rotation.x += (rotObj - a.grupo.rotation.x) * (1 - Math.exp(-15 * dt));
    actualizarAmbiente(dt, reloj.elapsedTime);
      actualizarSalaSegura(dt);
      actualizarZombis(dt);

  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});


// Construccion del mundo tridimensional
const colisionadores = [];                       // cajas sólidas (Box3)
let semilla = 7;
const rnd = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;  // aleatorio repetible

function bloque(x, z, w, d, h, color, solido = true, mapa = null) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, map: mapa })
  );
  m.position.set(x, h / 2, z);
  scene.add(m);
  if (solido) colisionadores.push(new THREE.Box3().setFromObject(m));
  return m;
}

function auto(x, z, rotY, color) {
  const g = new THREE.Group();
  const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 4.4),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  cuerpo.position.y = 0.6;
  const cabina = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x1b1f23 }));
  cabina.position.set(0, 1.3, -0.2);
  g.add(cuerpo, cabina);
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  scene.add(g);
  colisionadores.push(new THREE.Box3().setFromObject(g));
}

const cargadorProps = new GLTFLoader();
function prop(archivo, x, z, { rotY = 0, tam = 2, solido = true } = {}) {
  cargadorProps.load(archivo, (gltf) => {
    const m = gltf.scene;
    const s = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
    m.scale.setScalar(tam / Math.max(s.x, s.y, s.z));      // 'tam' = dimensión mayor, en metros
    const c = new THREE.Box3().setFromObject(m);
    m.position.set(-(c.min.x + c.max.x) / 2, -c.min.y, -(c.min.z + c.max.z) / 2);  // centrado y en el piso

    const g = new THREE.Group();
    g.add(m);
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    scene.add(g);
    if (solido) colisionadores.push(new THREE.Box3().setFromObject(g));
  }, undefined, () => console.warn('No cargó', archivo));
}

const barricada  = (x, z, w) => bloque(x, z, w, 0.8, 1.4, 0x6b4a2b);
const contenedor = (x, z, w, color) => bloque(x, z, w, 2.6, 2.6, color);

function letrero(texto, x, y, z, color = '#ffffff', ancho = 8) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(3, 3, 506, 122);
  g.fillStyle = color; g.font = 'bold 60px Arial';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(texto, 256, 68);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(ancho, ancho / 4),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true,
      side: THREE.DoubleSide, fog: false })   // fog:false = se ve de lejos
  );
  m.position.set(x, y, z);
  scene.add(m);
}

const lamparas = [];
function lampara(x, z, averiada = false) {
  const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5, 8),
    new THREE.MeshStandardMaterial({ color: 0x222222 }));
  poste.position.set(x, 2.5, z);
  const foco = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
  foco.position.set(x, 5.1, z);
  const luz = new THREE.PointLight(0xffb060, 25, 22, 2);
  luz.position.set(x, 5, z);
  scene.add(poste, foco, luz);
  lamparas.push({ luz, base: 25, averiada, t: rnd() * 10 });
}

// Texturas del suelo
const texLoader = new THREE.TextureLoader();
function textura(ruta, repX = 1, repY = 1, esColor = true) {
  const t = texLoader.load(ruta);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repX, repY);
  t.anisotropy = 8;
  if (esColor) t.colorSpace = THREE.SRGBColorSpace;   // solo la textura de color
  return t;
}
const texMuro = textura('Textures/Textura_LadrilloSucio.jpg', 2, 3);

//Suelo
//Suelo
const texAsfalto = textura('Textures/Textura_Asfalto.avif', 15, 68);
const suelo = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 270),
  new THREE.MeshStandardMaterial({
    map: texAsfalto,
    emissiveMap: texAsfalto,
    emissive: 0x555555,    // sube o baja para más o menos brillo
    roughness: 1
  })
);
suelo.rotation.x = -Math.PI / 2;
suelo.position.set(0, 0, -122);
scene.add(suelo);

// Línea central discontinua
for (let z = -2; z > -214; z -= 8) bloque(0, z, 0.2, 2, 0.02, 0x998800, false);

// Edificios a ambos lados (con patios laterales con munición)
const PATIOS_IZQ = [3, 8, 12];
const PATIOS_DER = [6, 10];
const COLORES = [0x4a4540, 0x3d4248, 0x504a44, 0x363b40];

for (let i = 0; i < 16; i++) {
  const zc = -1 - i * 14;
  [-1, 1].forEach((lado) => {
    const esPatio = (lado < 0 ? PATIOS_IZQ : PATIOS_DER).includes(i);
    if (esPatio) {
      bloque(lado * 25.5, zc, 1, 14, 7, 0x2a2d30);        // muro del fondo
      bloque(lado * 21.5, zc + 6.5, 9, 1, 7, 0x2a2d30);   // muro lateral
      bloque(lado * 21.5, zc - 6.5, 9, 1, 7, 0x2a2d30);   // muro lateral
      crearCaja(i % 2, lado * 21, zc);                     // munición escondida
      return;
    }
    const h = 8 + rnd() * 10;
        bloque(lado * 12, zc, 10, 14, h, 0xaaaaaa, true, texMuro);
    // Ventanas (franjas oscuras) en la fachada que da a la calle
    for (let y = 2.5; y < h - 1; y += 3) {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 11.5),
        new THREE.MeshStandardMaterial({ color: 0x0b0d10, emissive: 0x140f08 }));
      v.position.set(lado * 6.95, y, zc);
      scene.add(v);
    }
  });
}

// Cierre del inicio
bloque(0, 6.5, 36, 1, 9, 0x2a2d30);

// ZONA 1: inicio 
//sala segura
const MURO = 0x3a3d3f;
const ALTO = 3.2;

// Piso y techo
const pisoSala = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 11.4),
  new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1 }));
pisoSala.rotation.x = -Math.PI / 2;
pisoSala.position.set(0, 0.03, 0.5);
scene.add(pisoSala);

const techo = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 11.5),
  new THREE.MeshStandardMaterial({ color: 0x25282a, roughness: 1 }));
techo.position.set(0, ALTO + 0.15, 0.5);
scene.add(techo);

// Paredes (el fondo ya lo cierra el muro de z = 6.5)
bloque(-3.7, 0.5, 0.4, 11.5, ALTO, MURO);     // izquierda
bloque( 3.7, 0.5, 0.4, 11.5, ALTO, MURO);     // derecha
bloque(-2.55, -5, 2.7, 0.4, ALTO, MURO);      // frente, a la izquierda de la puerta
bloque( 2.55, -5, 2.7, 0.4, ALTO, MURO);      // frente, a la derecha de la puerta

const dintel = new THREE.Mesh(new THREE.BoxGeometry(2.4, ALTO - 2.6, 0.4),
  new THREE.MeshStandardMaterial({ color: MURO, roughness: 0.9 }));
dintel.position.set(0, 2.6 + (ALTO - 2.6) / 2, -5);
scene.add(dintel);

// Puerta de metal (la bisagra está a la izquierda)
const puerta = new THREE.Group();
puerta.position.set(-1.2, 0, -5);
const hoja = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 0.15),
  new THREE.MeshStandardMaterial({ color: 0x4d5a52, metalness: 0.3, roughness: 0.6 }));
hoja.position.set(1.2, 1.3, 0);
puerta.add(hoja);
scene.add(puerta);
const cajaPuerta = new THREE.Box3(new THREE.Vector3(-1.2, 0, -5.1), new THREE.Vector3(1.2, 2.6, -4.9));
colisionadores.push(cajaPuerta);

// Luz sobre la puerta: roja = cerrada, verde = abierta
const luzPuerta = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.1),
  new THREE.MeshBasicMaterial({ color: 0xff2222 }));
luzPuerta.position.set(0, 2.9, -4.75);
scene.add(luzPuerta);

// Carteles en la pared
function cartel(texto, x, y, z, color, ancho = 2) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,10,10,0.8)'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(3, 3, 506, 122);
  g.fillStyle = color; g.font = 'bold 50px Arial';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(texto, 256, 68);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(ancho, ancho / 4),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color: 0xbbbbbb }));
  m.position.set(x, y, z);
  scene.add(m);
}
cartel('SALA SEGURA',   -2.35, 1.9, -4.78, '#7CFC00');
cartel('NO ESTÁS SOLO',  2.35, 1.9, -4.78, '#d03030');

// Foco cálido (el único lugar "seguro" de todo el mapa)
const bombillo = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12),
  new THREE.MeshBasicMaterial({ color: 0xffe0a8 }));
bombillo.position.set(0, 3.0, 0);
const luzSala = new THREE.PointLight(0xffc880, 24, 14, 2);
luzSala.position.set(0, 2.9, 0);
scene.add(bombillo, luzSala);
lamparas.push({ luz: luzSala, base: 24, averiada: false, t: 1.5 });

// Suministros: mesa con botiquín, cajones y munición
bloque(-2.5, 4.6, 2, 1, 0.9, 0x5a3f28);
const botiquin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.35),
  new THREE.MeshStandardMaterial({ color: 0xe8e8e8 }));
botiquin.position.set(-2.5, 1.025, 4.6);
const rojo = new THREE.MeshBasicMaterial({ color: 0xcc1111 });
const cruzA = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.08), rojo);
const cruzB = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.3), rojo);
cruzA.position.set(-2.5, 1.16, 4.6);
cruzB.position.set(-2.5, 1.16, 4.6);
scene.add(botiquin, cruzA, cruzB);
bloque(2.6, 4.8, 1.2, 1.2, 1.2, 0x4a3b2a);
bloque(2.6, 3.5, 0.8, 0.8, 0.8, 0x4a3b2a);
crearCaja(0, -2.5, 2.2);   // munición de pistola
crearCaja(1,  2.5, 2.2);   // munición de escopeta

// Interacción con la puerta (tecla E)
let puertaAbierta = false;
const msgPuerta = document.createElement('div');
msgPuerta.style.cssText = 'position:fixed;bottom:22%;left:50%;transform:translateX(-50%);color:#fff;' +
  'font:20px monospace;text-shadow:0 0 6px #000,2px 2px 0 #000;pointer-events:none;display:none;';
msgPuerta.textContent = 'Presiona E para abrir la puerta';
document.body.appendChild(msgPuerta);

const cercaDePuerta = () => {
  const dx = camera.position.x, dz = camera.position.z + 5;
  return dx * dx + dz * dz < 6 * 6;
};

function abrirPuerta() {
  if (puertaAbierta || !cercaDePuerta()) return;
  puertaAbierta = true;
  colisionadores.splice(colisionadores.indexOf(cajaPuerta), 1);   // ya se puede pasar
  luzPuerta.material.color.set(0x35ff7a);
  msgPuerta.style.display = 'none';
}

function actualizarSalaSegura(dt) {
  const objetivo = puertaAbierta ? 1.7 : 0;     // la puerta gira hacia afuera
  puerta.rotation.y += (objetivo - puerta.rotation.y) * (1 - Math.exp(-3 * dt));
  msgPuerta.style.display = (!puertaAbierta && controls.isLocked && cercaDePuerta()) ? 'block' : 'none';
}

// ZONA 2: barricadas en zigzag 
barricada(-3, -35, 8);   // deja pasar por la derecha
barricada( 3, -48, 8);   // deja pasar por la izquierda
barricada(-3, -61, 8);

// ZONA 3: cementerio de autos
auto(-3,   -78,  0.3, 0x7a2a2a);
auto( 3.5, -84, -0.4, 0x2a4a7a);
auto(-1,   -92,  1.2, 0x555555);
auto( 4,  -100,  0.1, 0x6a6a2a);
auto(-4.5,-104, -0.2, 0x7a2a2a);

// ZONA 4: pasillo de contenedores (cuellos de botella de 2 m)
contenedor(-4, -120, 6, 0x2f5d4a);
contenedor( 4, -120, 6, 0x8a3b2a);   // hueco central: x -1 a 1
contenedor( 2, -136, 10, 0x35476b);  // hueco izquierdo: x -7 a -3
contenedor(-4, -148, 6, 0x2f5d4a);
contenedor( 4, -148, 6, 0x8a3b2a);

// ZONA FINAL: plaza de extracción 
const ZONA_EXTRACCION = new THREE.Vector3(0, 0, -234);
bloque(-18, -234, 1, 32, 8, 0x2a2d30);                 // muros de la plaza
bloque( 18, -234, 1, 32, 8, 0x2a2d30);
bloque(  0, -250.5, 37, 1, 8, 0x2a2d30);
auto(-9, -228, 0.8, 0x555555);
auto( 9, -240, -0.7, 0x2a4a7a);

const anillo = new THREE.Mesh(new THREE.RingGeometry(4.5, 5, 48),
  new THREE.MeshBasicMaterial({ color: 0x35ff7a, side: THREE.DoubleSide }));
anillo.rotation.x = -Math.PI / 2;
anillo.position.set(0, 0.03, -234);
scene.add(anillo);

const faro = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 40, 24, 1, true),
  new THREE.MeshBasicMaterial({ color: 0x35ff7a, transparent: true, opacity: 0.22,
    side: THREE.DoubleSide, fog: false }));
faro.position.set(0, 20, -234);
scene.add(faro);
const luzFaro = new THREE.PointLight(0x35ff7a, 60, 30, 2);
luzFaro.position.set(0, 4, -234);
scene.add(luzFaro);

// Iluminación de calle 
[[-6, -10], [6, -45], [-6, -80], [6, -115], [-6, -150], [6, -185]]
  .forEach(([x, z], i) => lampara(x, z, i % 2 === 1));

// Cajas de munición en la calle (además de las de los patios)
crearCaja(0,  0, -28);
crearCaja(1, -4, -112);

// Props con modelos descargados
prop('Models/barriles.glb',            5,   -12, { tam: 1.3 });   // se ve apenas sales de la sala
prop('Models/barriles.glb',            6,   -33, { tam: 1.3 });
prop('Models/barriles.glb',            6,   -63, { tam: 1.3 });
prop('Models/wrecked_fiat_125p.glb',  -3,   -78, { rotY:  0.3, tam: 4 });
prop('Models/wrecked_fiat_125p.glb',   3.5, -84, { rotY: -0.4, tam: 4 });
prop('Models/escombros.glb',           5.5, -70, { tam: 2, solido: false });
prop('Models/dead_tree.glb',         -23.5, -40, { tam: 7, solido: false });
prop('Models/dead_tree.glb',          23.5, -88, { tam: 7, solido: false });
prop('Models/lapida.glb',            -14,   -43, { tam: 1.3, solido: false });
prop('Models/lapida.glb',            -12,   -46, { tam: 1.3, rotY: 0.4, solido: false });
prop('Models/lapida.glb',             15,   -85, { tam: 1.3, solido: false });

// Puntos de encuentro: aquí aparecerán los zombis
const puntosEncuentro = [
  { x:  2, z:  -30 }, { x: -3, z:  -52 }, { x:  4, z:  -75 }, { x: -2, z:  -95 },
  { x:  0, z: -125 }, { x: -5, z: -140 }, { x:  3, z: -165 }, { x: -3, z: -185 },
  { x:  0, z: -200 }, { x: -8, z: -225 }, { x:  8, z: -238 },
];

// SONIDOS
const audioLoader = new THREE.AudioLoader();
const buffers = {};
const SONIDOS = {
  pistola:       'Sounds/pistola.mp3',
  escopeta:      'Sounds/escopeta.mp3',
  vacio:         'Sounds/click_vacio.mp3',
  recarga:       'Sounds/recarga.mp3',
  zombi_idle:    'Sounds/zombi_idle.mp3',
  zombi_alerta:  'Sounds/zombi_alerta.mp3',
  zombi_ataque:  'Sounds/zombi_ataque.mp3',
  zombi_muerte:  'Sounds/zombi_muerte.mp3',
};
Object.entries(SONIDOS).forEach(([k, ruta]) =>
  audioLoader.load(ruta, (b) => (buffers[k] = b), undefined, () => console.warn('No cargó', ruta)));

// Sonido normal (armas): se oye igual en todas partes
function sonar(nombre, vol = 1, pitch = 1) {
  if (!buffers[nombre]) return;
  const s = new THREE.Audio(listener);
  s.setBuffer(buffers[nombre]);
  s.setVolume(vol);
  s.setPlaybackRate(pitch);
  s.play();
}

// Sonido posicional (zombis): se oye más fuerte cerca y por el lado de donde viene
function sonarEn(obj, nombre, vol = 1, pitch = 1) {
  if (!buffers[nombre]) return;
  const s = new THREE.PositionalAudio(listener);
  s.setBuffer(buffers[nombre]);
  s.setRefDistance(3);
  s.setMaxDistance(40);
  s.setRolloffFactor(1.5);
  s.setVolume(vol);
  s.setPlaybackRate(pitch);
  obj.add(s);
  s.play();
  s.onEnded = () => { s.isPlaying = false; obj.remove(s); };
}

// ZOMBIS
const ARCHIVOS_ZOMBI = [
  { ruta: 'Models/zombie.glb',                       escala: 1 },
  { ruta: 'Models/zombie (1).glb',                   escala: 1 },
  { ruta: 'Models/zombie_monster_slasher_necromorph.glb', escala: 1 },
];
const zombis = [];
const DIST_ACTIVACION = 15;
const DIST_ATAQUE = 1.0;
const cargadorZombis = new GLTFLoader();

const cargarGLB = (ruta) => new Promise((ok) =>
  cargadorZombis.load(ruta, ok, undefined, () => { console.warn('No cargó', ruta); ok(null); }));

Promise.all(
  ARCHIVOS_ZOMBI.map((a) => cargarGLB(a.ruta).then((g) => g && Object.assign(g, { escala: a.escala })))
).then((lista) => {
  const modelos = lista.filter(Boolean);
  if (!modelos.length) return;
  let n = 0;
  puntosEncuentro.forEach((p) => {
    const cantidad = 2 + Math.floor(Math.random() * 3);      // 2 a 4 por punto
    for (let k = 0; k < cantidad; k++) {
      for (let intento = 0; intento < 10; intento++) {      // busca un hueco libre
        const x = p.x + (Math.random() - 0.5) * 6;
        const z = p.z + (Math.random() - 0.5) * 8;
        if (chocaConMundo(x, z)) continue;
        crearZombi(modelos[n++ % modelos.length], x, z);    // reparte los 3 modelos
        break;
      }
    }
  });
});

function crearZombi(gltf, x, z) {
  const m = SkeletonUtils.clone(gltf.scene);
  m.updateMatrixWorld(true);
  const s = new THREE.Box3().setFromObject(m, true).getSize(new THREE.Vector3());
  if (isFinite(s.y) && s.y > 0) m.scale.setScalar(1.8 / s.y);
  m.updateMatrixWorld(true);
  const c = new THREE.Box3().setFromObject(m, true);
  m.position.set(-(c.min.x + c.max.x) / 2, -c.min.y, -(c.min.z + c.max.z) / 2);

  m.traverse((o) => {
    if (o.isMesh) {
      o.frustumCulled = false;
      // material propio por zombi, para que el destello rojo no afecte a todos
      o.material = Array.isArray(o.material) ? o.material.map((q) => q.clone()) : o.material.clone();
    }
  });

  const pivote = new THREE.Group();     // sirve para inclinar / tumbar al zombi
  pivote.add(m);
  const g = new THREE.Group();
  g.add(pivote);
  g.position.set(x, 0, z);
  g.rotation.y = Math.random() * Math.PI * 2;
  scene.add(g);

  // Animaciones
  const acc = {};
  let mixer = null;
  const clips = gltf.animations;
  if (clips.length) {
    mixer = new THREE.AnimationMixer(m);
    console.log('Animaciones del zombi:', clips.map((a) => a.name));
    const accion = (re, repetir = true) => {
      const clip = clips.find((a) => re.test(a.name));
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      if (!repetir) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      return a;
    };
    acc.idle   = accion(/idle|stand|breath|reposo/i);
    acc.walk   = accion(/walk|shuffle|limp|camin/i);
    acc.run    = accion(/run|sprint|corr/i);
    acc.attack = accion(/attack|punch|bite|slash|swipe|claw|atac/i);
    acc.death  = accion(/death|die|dead|fall|muer/i, false);
    const base = acc.walk || acc.run ||
      mixer.clipAction(clips.find((a) => !/death|die|dead|fall|muer/i.test(a.name)) || clips[0]);
    acc.walk = base;
    acc.run  = acc.run  || base;
    acc.idle = acc.idle || base;
  }

  const zombi = {
    g, m, pivote, mixer, acc, actual: null,
    vida: 2, estado: 'espera', muerto: false,
    velBase: 1.1 + Math.random() * 0.7,      // cada zombi camina distinto
    corredor: Math.random() < 0.25,          // 1 de cada 4 corre al acercarse
    fase: Math.random() * 10,
    espera: 0, cd: 0, stun: 0, flash: 0, tMuerte: 0,
    rango: DIST_ACTIVACION * (0.8 + Math.random() * 0.4),   // cada uno nota a distinta distancia
    tGrunido: 2 + Math.random() * 6,
  };
  g.userData.zombi = zombi;
  zombis.push(zombi);

  jugar(zombi, 'idle', 0, acc.idle === acc.walk ? 0.15 : 1);
  if (zombi.actual) zombi.actual.time = Math.random() * zombi.actual.getClip().duration;
}

const GIRO_MODELO = 0;   // si los zombis caminan de espaldas, pon Math.PI

function jugar(z, nombre, fade = 0.25, ts = 1) {
  const a = z.acc[nombre];
  if (!a) return;
  if (z.actual !== a) {
    a.reset().fadeIn(fade).play();
    if (z.actual) z.actual.fadeOut(fade);
    z.actual = a;
  }
  a.timeScale = ts;
}

function girarHacia(g, objetivo, dt, vel = 6) {
  let d = objetivo - g.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  g.rotation.y += d * Math.min(1, vel * dt);
}

function moverZombi(z, vx, vz) {          // se mueve sin atravesar paredes
  const p = z.g.position;
  if (!chocaConMundo(p.x + vx, p.z)) p.x += vx;
  if (!chocaConMundo(p.x, p.z + vz)) p.z += vz;
}

function dañarZombi(z, dmg) {
  if (z.muerto) return;
  z.vida -= dmg;
  if (z.estado === 'espera') z.estado = 'persigue';
  if (z.vida <= 0) { matarZombi(z); return; }
  z.stun = 0.25;     // se tambalea hacia atrás
  z.flash = 0.12;    // destello rojo
  sonarEn(z.g, 'zombi_herido', 0.9, 0.9 + Math.random() * 0.2);
}

function matarZombi(z) {
  z.muerto = true;
  z.estado = 'muerto';
  sonarEn(z.g, 'zombi_muerte', 1);
  z.tMuerte = 0;
  if (z.acc.death) jugar(z, 'death', 0.1);
  else if (z.actual) { z.actual.fadeOut(0.2); z.actual = null; }   // sin clip: cae por código
}

function golpearJugador(z) {
  sonarEn(z.g, 'zombi_ataque', 1);
  gameOver();
}

function gameOver() {
  if (juegoTerminado || misionCumplida) return;
  juegoTerminado = true;
  controls.unlock();                      // suelta el mouse y detiene los controles

  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:24px;background:#300c;' +
    'color:#ff2a2a;font-family:monospace;text-align:center;';
  d.innerHTML =
    '<div style="font-size:80px;font-weight:bold;text-shadow:0 0 20px #f00">GAME OVER</div>' +
    '<div style="font-size:24px;color:#ddd">Un zombi te atrapó</div>' +
    '<button id="btnReiniciar" style="font:bold 24px monospace;padding:12px 32px;cursor:pointer;' +
    'background:#222;color:#fff;border:2px solid #ff2a2a">REINICIAR</button>';
  document.body.appendChild(d);
  document.getElementById('btnReiniciar').onclick = () => location.reload();   // mejora voluntaria
}

function actualizarZombis(dt) {
    if (juegoTerminado || !controls.isLocked) return;
  const t = reloj.elapsedTime;
  for (let i = zombis.length - 1; i >= 0; i--) {
    const z = zombis[i];
    if (z.mixer) z.mixer.update(dt);

    if (z.flash > 0) {
      z.flash -= dt;
      const k = z.flash > 0 ? 0.8 : 0;
      z.m.traverse((o) => {
        if (o.isMesh) [].concat(o.material).forEach((q) => q.emissive && q.emissive.setRGB(k, 0, 0));
      });
    }

    if (z.muerto) {
      z.tMuerte += dt;
      if (!z.acc.death) z.pivote.rotation.x += (-Math.PI / 2 - z.pivote.rotation.x) * Math.min(1, 8 * dt);
      if (z.tMuerte > 4) z.g.position.y -= 0.4 * dt;                 // se hunde en el suelo
      if (z.tMuerte > 9) { scene.remove(z.g); zombis.splice(i, 1); }
      continue;
    }

    const dx = camera.position.x - z.g.position.x;
    const dz = camera.position.z - z.g.position.z;
    const d = Math.hypot(dx, dz) || 0.001;
    z.tGrunido -= dt;
    if (z.tGrunido <= 0) {
    z.tGrunido = 4 + Math.random() * 6;
    if (d < 30) sonarEn(z.g, 'zombi_idle', 0.8, 0.85 + Math.random() * 0.3);
    }
    const mirar = Math.atan2(dx, dz) + GIRO_MODELO;

    if (z.stun > 0) {                       // retroceso al recibir un disparo
      z.stun -= dt;
      moverZombi(z, (-dx / d) * 2.5 * dt, (-dz / d) * 2.5 * dt);
      continue;
    }

    if (z.estado === 'espera') {
      jugar(z, 'idle', 0.3, z.acc.idle === z.acc.walk ? 0.15 : 1);
      if (d < z.rango) {
    z.estado = 'alerta';
    z.espera = 0.4 + Math.random() * 0.8;
    sonarEn(z.g, 'zombi_alerta', 1, 0.85 + Math.random() * 0.3);
    }

    } else if (z.estado === 'alerta') {     // te nota y reacciona un momento antes de ir
      girarHacia(z.g, mirar, dt, 4);
      z.espera -= dt;
      if (z.espera <= 0) z.estado = 'persigue';

    } else if (z.estado === 'persigue') {
      girarHacia(z.g, mirar, dt, 5);
      const rapido = z.corredor && d < 14;
      const lurch = rapido ? 1 : 0.65 + 0.35 * Math.sin(t * 3 + z.fase);   // avanza a tirones
      const vel = (rapido ? 3.4 : z.velBase) * lurch;
      jugar(z, rapido ? 'run' : 'walk', 0.3, rapido ? 1 : 0.7 + 0.5 * lurch);
      moverZombi(z, (dx / d) * vel * dt, (dz / d) * vel * dt);

      for (const o of zombis) {             // no se amontonan unos sobre otros
        if (o === z || o.muerto) continue;
        const ox = z.g.position.x - o.g.position.x, oz = z.g.position.z - o.g.position.z;
        const od = Math.hypot(ox, oz);
        if (od > 0 && od < 0.9) moverZombi(z, (ox / od) * 1.5 * dt, (oz / od) * 1.5 * dt);
      }

      // sin clips de animación: inclinación y balanceo por código
      const incl = z.mixer ? 0 : 0.15;
      z.pivote.rotation.x += (incl - z.pivote.rotation.x) * Math.min(1, 10 * dt);
      if (!z.mixer) z.pivote.rotation.z = Math.sin(t * 7 + z.fase) * 0.1;

      if (d < DIST_ATAQUE) { z.estado = 'ataca'; z.cd = 0.4; }

    } else if (z.estado === 'ataca') {
      girarHacia(z.g, mirar, dt, 8);
      jugar(z, 'attack', 0.15);
      if (!z.acc.attack) z.pivote.rotation.x = 0.25 + 0.25 * Math.sin(t * 10);   // embestida simple
      z.cd -= dt;
      if (z.cd <= 0) { z.cd = 1.2; golpearJugador(z); }
      if (d > DIST_ATAQUE + 0.7) z.estado = 'persigue';
    }
  }
}

// Colisiones del jugador contra el mundo
const RADIO = 0.4;
function chocaConMundo(x, z) {
  for (const b of colisionadores) {
    const cx = Math.max(b.min.x, Math.min(x, b.max.x));
    const cz = Math.max(b.min.z, Math.min(z, b.max.z));
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz < RADIO * RADIO) return true;
  }
  return false;
}

// Llegada a la extracción (provisional hasta tener enemigos)
let misionCumplida = false;
function revisarExtraccion() {
    if (juegoTerminado) return;
  if (misionCumplida) return;
  const dx = camera.position.x - ZONA_EXTRACCION.x;
  const dz = camera.position.z - ZONA_EXTRACCION.z;
  if (dx * dx + dz * dz < 25) {
    misionCumplida = true;
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:#000c;color:#35ff7a;font:bold 48px monospace;';
    d.textContent = 'MISIÓN CUMPLIDA';
    document.body.appendChild(d);
    controls.unlock();
  }
}

// Ambiente tétrico

// Linterna (tecla F)
const linterna = new THREE.SpotLight(0xfff2d0, 150, 35, Math.PI / 7, 0.5, 1.5);
linterna.position.set(0.15, -0.1, 0);
linterna.target.position.set(0, 0, -5);
camera.add(linterna, linterna.target);

// Ceniza flotando
const NC = 700;
const posC = new Float32Array(NC * 3);
for (let i = 0; i < NC; i++) {
  posC[i * 3]     = (Math.random() - 0.5) * 30;
  posC[i * 3 + 1] = Math.random() * 10;
  posC[i * 3 + 2] = (Math.random() - 0.5) * 30;
}
const geoC = new THREE.BufferGeometry();
geoC.setAttribute('position', new THREE.BufferAttribute(posC, 3));
const ceniza = new THREE.Points(geoC, new THREE.PointsMaterial({
  color: 0xbbbbbb, size: 0.07, transparent: true, opacity: 0.55, depthWrite: false }));
ceniza.frustumCulled = false;
scene.add(ceniza);

// Luz roja de emergencia pulsante
const luzRoja = new THREE.PointLight(0xff1111, 0, 25, 2);
luzRoja.position.set(0, 3.5, -130);
scene.add(luzRoja);

function actualizarAmbiente(dt, t) {
  // Farolas
  lamparas.forEach((l) => {
    if (l.averiada) {
      const f = Math.sin(t * 23 + l.t) * Math.sin(t * 7 + l.t * 2);
      l.luz.intensity = f > 0.2 ? l.base : l.base * 0.05;
    } else {
      l.luz.intensity = l.base * (0.9 + 0.1 * Math.sin(t * 3 + l.t));
    }
  });
  luzRoja.intensity = 40 * Math.max(0, Math.sin(t * 2.5));

  // Ceniza
  ceniza.position.set(camera.position.x, 0, camera.position.z);
  const p = geoC.attributes.position;
  for (let i = 0; i < NC; i++) {
    p.array[i * 3 + 1] -= dt * 0.4;
    p.array[i * 3]     += Math.sin(t + i) * dt * 0.15;
    if (p.array[i * 3 + 1] < 0) p.array[i * 3 + 1] = 10;
  }
  p.needsUpdate = true;
}

animate();