import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { textureUrl } from './ids';

// Raffle cage for shows level on the qualifying line. A spherical brass wire
// cage on a stand, in a velvet studio. Each tied show gets the same number of
// ivory balls (its cover printed on one side, its title on the other). The
// balls pour in, the cage is cranked, then it slows so its door ends up at
// the bottom, the door slides open, a ball of the drawn show drops out onto
// a curved brass rail and rolls down, and it's lifted up into its spot. The
// drawn show's other balls vanish; then the next spot.

type B = {
  mesh: THREE.Mesh;
  p: THREE.Vector3;
  v: THREE.Vector3;
  q: THREE.Quaternion;
  r: number;
  show: number;
  state: 'wait' | 'mix' | 'drop' | 'rail' | 'end' | 'gone' | 'pop';
  delay: number;
  s?: number;
  sp?: number;
  t0?: number;
  onArrive?: (() => void) | null;
};

export default function DrawScreen({ t }: { t: PublicTournament }) {
  const cut = t.cut!;
  const picked = cut.picked ?? [];
  const host = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [landed, setLanded] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    setLanded(0);
    setDone(false);
    let alive = true;
    const T = THREE;
    const V = (x: number, y: number, z: number) => new T.Vector3(x, y, z);

    const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    el.appendChild(renderer.domElement);

    // ---------------------------------------------------------------- studio
    const BG = 0x0d0820;
    const scene = new T.Scene();
    {
      const c = document.createElement('canvas');
      c.width = c.height = 1024;
      const g = c.getContext('2d')!;
      const rg = g.createRadialGradient(512, 420, 30, 512, 470, 720);
      rg.addColorStop(0, '#46308c');
      rg.addColorStop(0.35, '#251a5c');
      rg.addColorStop(0.7, '#140e34');
      rg.addColorStop(1, '#07051a');
      g.fillStyle = rg;
      g.fillRect(0, 0, 1024, 1024);
      const v = g.createRadialGradient(512, 480, 200, 512, 480, 760);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(3,2,12,.75)');
      g.fillStyle = v;
      g.fillRect(0, 0, 1024, 1024);
      const tex = new T.CanvasTexture(c);
      tex.colorSpace = T.SRGBColorSpace;
      scene.background = tex;
    }
    scene.fog = new T.Fog(BG, 22, 46);
    const camera = new T.PerspectiveCamera(30, 16 / 9, 0.1, 120);
    scene.add(camera);

    // reflections: a dark violet room, a warm softbox above, cool strips at the sides
    const pmrem = new T.PMREMGenerator(renderer);
    {
      const env = new T.Scene();
      env.add(new T.Mesh(new T.SphereGeometry(40, 32, 16), new T.MeshBasicMaterial({ color: 0x140c30, side: T.BackSide })));
      const panel = (w: number, h: number, col: number, k: number, pos: [number, number, number]) => {
        const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(col).multiplyScalar(k), side: T.DoubleSide }));
        m.position.set(...pos);
        m.lookAt(0, 3, 0);
        env.add(m);
      };
      panel(20, 8, 0xfff0d8, 5, [3, 24, 8]);
      panel(4, 22, 0xb39dff, 2.6, [-20, 8, 4]);
      panel(4, 22, 0xd0bcff, 1.8, [20, 8, 2]);
      panel(36, 5, 0xffd38a, 0.8, [0, -4, 18]);
      scene.environment = pmrem.fromScene(env, 0.03).texture;
    }
    const key = new T.SpotLight(0xfff0dc, 650, 0, 0.4, 0.85, 2);
    key.position.set(4.5, 13, 7.5);
    key.target.position.set(0, 2.2, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 6;
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.02;
    key.shadow.camera.near = 5;
    key.shadow.camera.far = 26;
    scene.add(key, key.target);
    scene.add(new T.HemisphereLight(0x6a4ab0, 0x0a0806, 0.28));
    const rim = new T.DirectionalLight(0x9f7fff, 1.6);
    rim.position.set(-6, 7, -8);
    scene.add(rim);
    const rim2 = new T.DirectionalLight(0xff8fb0, 1.0);
    rim2.position.set(7, 4, -6);
    scene.add(rim2);

    // room: deep violet walls and floor, a velvet curtain behind the cage
    const RX = 13;
    const RZB = -9.6;
    const RZF = 17;
    const RH = 12;
    const wallMat = new T.MeshPhysicalMaterial({ color: 0x150d34, roughness: 0.92, envMapIntensity: 0.15, sheen: 1, sheenColor: new T.Color(0x2a1a58) });
    const floor = new T.Mesh(new T.PlaneGeometry(RX * 2, RZF - RZB), new T.MeshStandardMaterial({ color: 0x0d0820, roughness: 0.94, envMapIntensity: 0.15 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = (RZF + RZB) / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const wall = (w: number, h: number, pos: [number, number, number], rotY: number) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), wallMat);
      m.position.set(...pos);
      m.rotation.y = rotY;
      m.receiveShadow = true;
      scene.add(m);
    };
    wall(RX * 2, RH, [0, RH / 2, RZB - 0.4], 0);
    wall(RZF - RZB, RH, [-RX, RH / 2, (RZF + RZB) / 2], Math.PI / 2);
    wall(RZF - RZB, RH, [RX, RH / 2, (RZF + RZB) / 2], -Math.PI / 2);
    wall(RX * 2, RH, [0, RH / 2, RZF], Math.PI);
    const brass = new T.MeshPhysicalMaterial({ color: 0xc08a2a, metalness: 1, roughness: 0.28, clearcoat: 0.3, clearcoatRoughness: 0.25 });
    const brassPol = new T.MeshPhysicalMaterial({ color: 0xd9a640, metalness: 1, roughness: 0.16 });
    {
      const W = RX * 2 - 0.4;
      const H = RH - 0.9;
      const geo = new T.PlaneGeometry(W, H, 420, 48);
      const ps = geo.attributes.position;
      for (let i = 0; i < ps.count; i++) {
        const x = ps.getX(i);
        const y = ps.getY(i);
        const u = (x + W / 2) / W;
        const down = 1 - (y + H / 2) / H;
        const a = 0.24 * (0.7 + 0.3 * Math.sin(u * 23.1) * Math.sin(u * 7.7)) * (0.85 + 0.35 * down);
        ps.setZ(i, Math.sin(u * 46 * Math.PI + Math.sin(y * 0.35 + u * 9) * 0.5) * a);
      }
      geo.computeVertexNormals();
      const velvet = new T.MeshPhysicalMaterial({ color: 0x2a165e, roughness: 0.8, envMapIntensity: 0.25, sheen: 1, sheenColor: new T.Color(0x7a5cd0) });
      const cur = new T.Mesh(geo, velvet);
      cur.position.set(0, H / 2 + 0.02, RZB + 0.2);
      cur.receiveShadow = true;
      scene.add(cur);
      const rod = new T.Mesh(new T.CylinderGeometry(0.055, 0.055, W + 0.6, 16), brassPol);
      rod.rotation.z = Math.PI / 2;
      rod.position.set(0, H + 0.25, RZB + 0.45);
      scene.add(rod);
      for (const [x, col, I] of [
        [-7.5, 0x8a6aff, 55],
        [0, 0xffd29a, 70],
        [7.5, 0xff6aa8, 45],
      ] as const) {
        const sp = new T.SpotLight(col, I, 0, 0.75, 1, 2);
        sp.position.set(x, 0.25, RZB + 2.2);
        sp.target.position.set(x, 6.5, RZB + 0.1);
        scene.add(sp, sp.target);
      }
    }

    // ---------------------------------------------------------------- the cage
    const R = 1.6;
    const wireR = 0.015;
    const Rin = R - wireR - 0.012;
    const BASE = 0.03;
    const CY = BASE + 2.75;
    const C = V(0, CY, 0);
    const cageRot = new T.Group();
    cageRot.position.copy(C);
    scene.add(cageRot);
    const slider = new T.Group();
    const PORT = 0.24;
    {
      const rings = 13;
      for (let k = 1; k < rings; k++) {
        const x = -R + (2 * R * k) / rings;
        const r = Math.sqrt(R * R - x * x);
        const m = new T.Mesh(new T.TorusGeometry(r, wireR, 8, 120), brass);
        m.rotation.y = Math.PI / 2;
        m.position.x = x;
        m.castShadow = true;
        cageRot.add(m);
      }
      for (let j = 0; j < 6; j++) {
        const m = new T.Mesh(new T.TorusGeometry(R, wireR * 1.1, 8, 180), brass);
        m.rotation.x = (j * Math.PI) / 6;
        m.castShadow = true;
        cageRot.add(m);
      }
      for (const sx of [-1, 1]) {
        const hub = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 0.07, 32), brassPol);
        hub.rotation.z = Math.PI / 2;
        hub.position.x = sx * R;
        cageRot.add(hub);
      }
      // the exit port at the cage's bottom: a brass neck with a rolled lip, closed by a sliding disc
      const yb = -Math.sqrt(R * R - PORT * PORT);
      const neck = new T.Mesh(
        new T.CylinderGeometry(PORT, PORT, 0.09, 48, 1, true),
        new T.MeshPhysicalMaterial({ color: 0xd9a640, metalness: 1, roughness: 0.16, side: T.DoubleSide })
      );
      neck.position.y = yb - 0.035;
      neck.castShadow = true;
      cageRot.add(neck);
      const lip = new T.Mesh(new T.TorusGeometry(PORT, 0.022, 12, 64), brassPol);
      lip.rotation.x = Math.PI / 2;
      lip.position.y = yb - 0.08;
      cageRot.add(lip);
      const disc = new T.Mesh(new T.CylinderGeometry(PORT + 0.03, PORT + 0.03, 0.012, 48), brass);
      disc.castShadow = true;
      slider.add(disc);
      slider.position.y = yb - 0.1;
      cageRot.add(slider);
    }
    // stand, axle, crank
    const crankArm = new T.Group();
    {
      const stand = new T.Group();
      scene.add(stand);
      const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material = brass) => {
        const dir = new T.Vector3().subVectors(b, a);
        const len = dir.length();
        const m = new T.Mesh(new T.CylinderGeometry(r, r, len, 12), mat);
        m.position.copy(a).addScaledVector(dir, 0.5);
        m.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
        m.castShadow = true;
        m.receiveShadow = true;
        stand.add(m);
      };
      for (const sx of [-1, 1]) {
        const x = sx * (R + 0.22);
        const top = V(x, CY, 0);
        rod(V(x, BASE, -1.22), top, 0.034);
        rod(V(x, BASE, 1.22), top, 0.034);
        rod(V(x, BASE + 0.85, -0.8), V(x, BASE + 0.85, 0.8), 0.024);
        for (const fz of [-1.22, 1.22]) {
          const foot = new T.Mesh(new T.CylinderGeometry(0.06, 0.07, 0.03, 20), brassPol);
          foot.position.set(x, 0.015, fz);
          foot.castShadow = true;
          stand.add(foot);
        }
        const brg = new T.Mesh(new T.CylinderGeometry(0.085, 0.085, 0.11, 24), brassPol);
        brg.rotation.z = Math.PI / 2;
        brg.position.copy(top);
        stand.add(brg);
      }
      rod(V(-(R + 0.5), CY, 0), V(R + 0.38, CY, 0), 0.038, brassPol);
      crankArm.position.set(-(R + 0.46), CY, 0);
      scene.add(crankArm);
      const arm = new T.Mesh(new T.BoxGeometry(0.055, 0.64, 0.045), brassPol);
      arm.position.y = -0.29;
      arm.castShadow = true;
      crankArm.add(arm);
      const knob = new T.Mesh(
        new T.CylinderGeometry(0.06, 0.065, 0.42, 20),
        new T.MeshPhysicalMaterial({ color: 0x4a2814, roughness: 0.3, clearcoat: 1 })
      );
      knob.rotation.z = Math.PI / 2;
      knob.position.set(-0.24, -0.58, 0);
      knob.castShadow = true;
      crankArm.add(knob);
    }

    // balls: the same number per tied show, so the draw looks as fair as it is
    const shows = cut.candidates;
    const per = Math.max(1, Math.min(8, Math.floor(30 / Math.max(1, shows.length))));
    const rb = Math.max(0.14, Math.min(0.22, 0.19 * Math.cbrt(45 / Math.max(1, shows.length * per))));

    // the exit rail: falls like a/(z + a) – steep under the port, almost flat at the end
    class HyperRail extends T.Curve<THREE.Vector3> {
      yA: number;
      yEnd: number;
      zEnd: number;
      a: number;
      constructor(yA: number, yEnd: number, zEnd: number, a: number) {
        super();
        this.yA = yA;
        this.yEnd = yEnd;
        this.zEnd = zEnd;
        this.a = a;
      }
      getPoint(u: number, out = new T.Vector3()) {
        const z = u * this.zEnd;
        const f0 = this.a / (this.zEnd + this.a);
        const f = (this.a / (z + this.a) - f0) / (1 - f0);
        return out.set(0, this.yEnd + (this.yA - this.yEnd) * f, z);
      }
    }
    const railYA = CY - Math.sqrt(R * R - PORT * PORT) - 0.16;
    const railR = 0.02;
    const gap = rb * 0.72;
    const hOff = Math.sqrt((rb + railR) ** 2 - gap ** 2);
    const railCurve = new HyperRail(railYA, BASE + 0.08 + hOff + railR, 2.6, 0.2);
    railCurve.arcLengthDivisions = 600;
    const railLen = railCurve.getLength();
    {
      for (const off of [-gap, gap]) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 80; i++) {
          const u = i / 80;
          const p = railCurve.getPointAt(u);
          const tg = railCurve.getTangentAt(u);
          const lat = new T.Vector3(1, 0, 0);
          const dn = new T.Vector3().crossVectors(lat, tg).normalize();
          pts.push(p.clone().addScaledVector(lat, off).addScaledVector(dn, hOff));
        }
        pts.push(pts[pts.length - 1].clone().add(V(0, 0, 0.12)));
        const m = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 140, railR, 10, false), brassPol);
        m.castShadow = true;
        scene.add(m);
      }
      const end = railCurve.getPointAt(1);
      const stop = new T.Mesh(new T.TorusGeometry(gap + 0.02, 0.02, 8, 32, Math.PI), brassPol);
      stop.position.set(0, end.y - hOff + 0.04, end.z + 0.14);
      scene.add(stop);
      for (const u of [0.45, 0.72, 0.95]) {
        const p = railCurve.getPointAt(u);
        const top = p.y - hOff - 0.02;
        for (const off of [-gap, gap]) {
          const post = new T.Mesh(new T.CylinderGeometry(0.012, 0.016, top - BASE, 8), brass);
          post.position.set(off, (top + BASE) / 2, p.z);
          post.castShadow = true;
          scene.add(post);
        }
      }
    }

    // ball prints: ivory with a coloured band, the cover on one side, the title on the other
    const ballGeo = new T.SphereGeometry(1, 40, 28);
    const BANDS = ['#7c5cff', '#ff4d6d', '#c9971b', '#1f9fa8', '#3b82f6', '#e879f9'];
    const fam = getComputedStyle(document.body).fontFamily;
    const mats = new Map<number, THREE.MeshPhysicalMaterial>();
    shows.forEach((e, i) => {
      const W = 512;
      const H = 256;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d')!;
      const band = BANDS[i % BANDS.length];
      const paint = (img: HTMLImageElement | null) => {
        const base = g.createLinearGradient(0, 0, 0, H);
        base.addColorStop(0, '#FFFDF7');
        base.addColorStop(0.55, '#F7F1E4');
        base.addColorStop(1, '#E7DCC6');
        g.fillStyle = base;
        g.fillRect(0, 0, W, H);
        g.fillStyle = band;
        g.globalAlpha = 0.9;
        g.fillRect(0, H / 2 - 3, W, 6);
        g.globalAlpha = 1;
        for (const [cx, kind] of [
          [W * 0.25, 'cover'],
          [W * 0.75, 'title'],
        ] as const) {
          g.beginPath();
          g.arc(cx, H / 2, 66, 0, Math.PI * 2);
          g.fillStyle = '#FFFEFA';
          g.fill();
          if (kind === 'cover' && img) {
            g.save();
            g.beginPath();
            g.arc(cx, H / 2, 63, 0, Math.PI * 2);
            g.clip();
            const s = Math.max(126 / img.width, 126 / img.height);
            g.drawImage(img, cx - (img.width * s) / 2, H / 2 - (img.height * s) / 2, img.width * s, img.height * s);
            g.restore();
          } else {
            const txt = e.title;
            g.fillStyle = '#140e34';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            let fs = 30;
            g.font = `800 ${fs}px ${fam}`;
            const words = txt.split(' ');
            while (g.measureText(txt).width > 112 && fs > 15) g.font = `800 ${--fs}px ${fam}`;
            if (g.measureText(txt).width > 112 && words.length > 1) {
              const half = Math.ceil(words.length / 2);
              const lines = [words.slice(0, half).join(' '), words.slice(half).join(' ')];
              fs = 24;
              g.font = `800 ${fs}px ${fam}`;
              while (Math.max(...lines.map((l) => g.measureText(l).width)) > 108 && fs > 11) g.font = `800 ${--fs}px ${fam}`;
              g.fillText(lines[0], cx, H / 2 + 3 - fs * 0.62);
              g.fillText(lines[1], cx, H / 2 + 3 + fs * 0.62);
            } else g.fillText(txt, cx, H / 2 + 3);
          }
          g.lineWidth = 6;
          g.strokeStyle = band;
          g.beginPath();
          g.arc(cx, H / 2, 66, 0, Math.PI * 2);
          g.stroke();
        }
      };
      paint(null);
      const map = new T.CanvasTexture(c);
      map.colorSpace = T.SRGBColorSpace;
      map.anisotropy = 8;
      mats.set(e.id, new T.MeshPhysicalMaterial({ map, roughness: 0.34, clearcoat: 0.5, clearcoatRoughness: 0.2 }));
      if (e.cover) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (!alive) return;
          paint(img);
          map.needsUpdate = true;
        };
        img.src = textureUrl(e.cover);
      }
    });

    const balls: B[] = [];
    for (const e of shows) {
      for (let k = 0; k < per; k++) {
        const mesh = new T.Mesh(ballGeo, mats.get(e.id)!);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.scale.setScalar(rb);
        mesh.visible = false;
        scene.add(mesh);
        balls.push({
          mesh,
          p: V(0, 0, 0),
          v: V(0, 0, 0),
          q: new T.Quaternion().setFromEuler(new T.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)),
          r: rb,
          show: e.id,
          state: 'wait',
          delay: 0,
        });
      }
    }
    // a shuffled pour
    for (let i = balls.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [balls[i], balls[j]] = [balls[j], balls[i]];
    }
    balls.forEach((b, j) => (b.delay = 250 + j * 55));

    // ---------------------------------------------------------------- physics
    let time = 0;
    let theta = Math.PI; // door on top while pouring
    let omega = 0;
    let mode: 'hold' | 'crank' | 'idle' | 'stop' | 'held' = 'hold';
    let stopAnim: { t0: number; th0: number; delta: number; D: number; m0: number; res: () => void } | null = null;
    let door = 0;
    let doorT = 1; // open for the pour
    let closeAt = 0;
    const pourT0 = 0.35;
    const tmp = V(0, 0, 0);
    const tmp2 = V(0, 0, 0);
    const up = V(0, 1, 0);
    const qd = new T.Quaternion();

    const physics = (dt: number) => {
      const g = 9.8;
      const inCage = balls.filter((b) => b.state === 'mix');
      for (const b of inCage) {
        b.v.y -= g * dt;
        b.v.multiplyScalar(1 - 0.12 * dt);
        b.p.addScaledVector(b.v, dt);
        tmp.subVectors(b.p, C);
        const d = tmp.length();
        const lim = Rin - b.r;
        if (d > lim) {
          tmp.multiplyScalar(1 / d);
          b.p.copy(C).addScaledVector(tmp, lim);
          const vn = b.v.dot(tmp);
          if (vn > 0) b.v.addScaledVector(tmp, -1.55 * vn);
          // the turning wires drag the ball along
          tmp2.set(0, -omega * tmp.z * Rin, omega * tmp.y * Rin);
          const vt = b.v.clone().addScaledVector(tmp, -b.v.dot(tmp));
          b.v.addScaledVector(tmp2.sub(vt), 0.16);
        }
      }
      for (const b of balls) {
        if (b.state !== 'drop') continue;
        // out through the port: pulled onto the centre line as it falls
        b.v.y -= g * dt;
        b.v.x += -b.p.x * 14 * dt;
        b.v.z += -b.p.z * 14 * dt;
        b.v.x *= 1 - 5 * dt;
        b.v.z *= 1 - 5 * dt;
        b.p.addScaledVector(b.v, dt);
        if (b.p.y <= railYA) {
          b.state = 'rail';
          b.s = 0;
          b.sp = Math.max(0.6, -b.v.y * 0.5);
          closeAt = time + 0.4;
        }
      }
      for (let i = 0; i < inCage.length; i++) {
        for (let j = i + 1; j < inCage.length; j++) {
          const a = inCage[i];
          const c = inCage[j];
          tmp.subVectors(c.p, a.p);
          const md = a.r + c.r;
          const d2 = tmp.lengthSq();
          if (d2 >= md * md || d2 < 1e-9) continue;
          const d = Math.sqrt(d2);
          tmp.multiplyScalar(1 / d);
          const over = md - d;
          a.p.addScaledVector(tmp, -over / 2);
          c.p.addScaledVector(tmp, over / 2);
          const rv = tmp2.subVectors(c.v, a.v).dot(tmp);
          if (rv < 0) {
            const imp = (-1.5 * rv) / 2;
            a.v.addScaledVector(tmp, -imp);
            c.v.addScaledVector(tmp, imp);
          }
        }
      }
    };
    const roll = (b: B, dt: number) => {
      const sp = b.v.length();
      if (sp < 1e-3) return;
      tmp.crossVectors(up, b.v);
      const l = tmp.length();
      if (l < 1e-4) return;
      qd.setFromAxisAngle(tmp.multiplyScalar(1 / l), (sp * dt) / b.r);
      b.q.premultiply(qd);
    };

    /** Slow the cage so it stops at `phase` (0 = door at the bottom). */
    const turnTo = (phase: number) =>
      new Promise<void>((res) => {
        const w = Math.max(0.6, omega);
        const TAU = Math.PI * 2;
        let target = phase + TAU * Math.ceil((theta - phase) / TAU);
        while (target - theta < w * 0.55) target += TAU;
        const delta = target - theta;
        const D = Math.min(3.2, Math.max(1.1, (2 * delta) / w));
        stopAnim = { t0: time, th0: theta, delta, D, m0: Math.min(w * D, 2.4 * delta), res };
        mode = 'stop';
      });

    // ---------------------------------------------------------------- the winners on show
    const holder = new T.Group();
    camera.add(holder);
    const glow = new T.PointLight(0xfff0d8, 6, 0, 2);
    glow.position.set(0.6, 0.8, -1.4);
    camera.add(glow);
    type Shown = { m: THREE.Mesh; from: THREE.Vector3; q0: THREE.Quaternion; s0: number; t0: number; slot: number };
    const shown: Shown[] = [];
    const Z = 2.8;
    const slotTarget = (slot: number, out: THREE.Vector3) => {
      const ring = slotRefs.current[slot];
      if (!ring) return out.set(0.6, 0, -Z);
      const box = el.getBoundingClientRect();
      const r = ring.getBoundingClientRect();
      const hy = Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * Z;
      const hx = hy * camera.aspect;
      const nx = ((r.left - box.left + r.width / 2) / box.width) * 2 - 1;
      const ny = -(((r.top - box.top + r.height / 2) / box.height) * 2 - 1);
      // filmOffset slides the view window by (offset / filmWidth) × near, which
      // is this much in NDC – undo it so the ball lands right on the DOM ring
      const ndcShift = camera.filmOffset / camera.getFilmWidth() / (Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
      return out.set((nx + ndcShift) * hx, ny * hy, -Z);
    };
    const slotScale = (slot: number) => {
      const ring = slotRefs.current[slot];
      if (!ring) return 0.2;
      const k = (2 * Z * Math.tan(T.MathUtils.degToRad(camera.fov / 2))) / el.clientHeight;
      return (ring.getBoundingClientRect().width / 2 - 6) * k;
    };
    const present = (b: B, slot: number) => {
      const m = new T.Mesh(ballGeo, b.mesh.material);
      holder.add(m);
      const from = b.p.clone();
      camera.worldToLocal(from);
      shown.push({ m, from, q0: b.q.clone(), s0: b.r, t0: time, slot });
    };

    // ---------------------------------------------------------------- camera
    const cam = { focus: 0, mixing: 0 };
    const cur = { theta: -0.9, phi: 0.34, dist: 20, tx: 0, ty: 2.1, tz: 0.4, shift: 0 };
    const baseDist = () => {
      const half = Math.tan(T.MathUtils.degToRad(15));
      return Math.max(12.5, 3.6 / (half * camera.aspect), 3.3 / half);
    };
    const updateCamera = (dt: number) => {
      const k = 1 - Math.exp(-dt * 1.6);
      const tgt = {
        theta: -0.42 + Math.sin(time * 0.05) * 0.06 + (cam.mixing ? Math.sin(time * 0.3) * 0.12 : 0) + (cam.focus ? -0.32 : 0),
        phi: 0.2 + (cam.focus ? 0.05 : 0),
        dist: baseDist() * (cam.mixing ? 0.94 : 1) * (cam.focus ? 0.74 : 1),
        tx: 0,
        ty: cam.focus ? 1.5 : 2.1,
        tz: cam.focus ? 0.9 : 0.4,
        // the cage sits left of centre (the spots are on the right); less so up close
        shift: cam.focus ? 0.1 : 0.16,
      };
      for (const key of Object.keys(tgt) as (keyof typeof tgt)[]) cur[key] += (tgt[key] - cur[key]) * k;
      camera.position.set(
        cur.tx + Math.sin(cur.theta) * Math.cos(cur.phi) * cur.dist,
        cur.ty + Math.sin(cur.phi) * cur.dist,
        cur.tz + Math.cos(cur.theta) * Math.cos(cur.phi) * cur.dist
      );
      camera.lookAt(cur.tx, cur.ty, cur.tz);
      camera.filmOffset = cur.shift * camera.getFilmWidth();
      camera.updateProjectionMatrix();
    };

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // ---------------------------------------------------------------- frame
    const to = V(0, 0, 0);
    const qUp = new T.Quaternion().setFromEuler(new T.Euler(0.18, 0, 0));
    const spinQ = new T.Quaternion();
    const Y = V(0, 1, 0);
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      time += dt;
      const th0 = theta;
      if (mode === 'crank') {
        omega += (2.8 - omega) * Math.min(1, dt * 1.5);
        theta += omega * dt;
      } else if (mode === 'idle') {
        omega += (0.35 - omega) * Math.min(1, dt * 0.8);
        theta += omega * dt;
      } else if (mode === 'stop' && stopAnim) {
        // keeps the spin speed at the start and lands exactly on the door
        const u = Math.min(1, (time - stopAnim.t0) / stopAnim.D);
        const u2 = u * u;
        const u3 = u2 * u;
        theta = stopAnim.th0 + (u3 - 2 * u2 + u) * stopAnim.m0 + (-2 * u3 + 3 * u2) * stopAnim.delta;
        if (u >= 1) {
          theta = stopAnim.th0 + stopAnim.delta;
          mode = 'held';
          const r = stopAnim.res;
          stopAnim = null;
          r();
        }
      }
      if (mode !== 'crank' && mode !== 'idle') omega = (theta - th0) / Math.max(dt, 1e-4);
      if (closeAt && time > closeAt) {
        closeAt = 0;
        doorT = 0;
      }
      cageRot.rotation.x = theta;
      crankArm.rotation.x = theta;
      door += (doorT - door) * Math.min(1, dt * 4.5);
      slider.position.x = door * door * (3 - 2 * door) * (PORT * 2 + 0.1);

      // pouring in from the top
      for (const b of balls) {
        if (b.state === 'wait' && (time - pourT0) * 1000 > b.delay) {
          b.state = 'mix';
          b.mesh.visible = true;
          b.p.set((Math.random() - 0.5) * 0.25, CY + Rin - b.r - 0.05, (Math.random() - 0.5) * 0.25);
          b.v.set((Math.random() - 0.5) * 1.5, -1.5 - Math.random(), (Math.random() - 0.5) * 1.5);
        }
      }
      for (let i = 0; i < 4; i++) physics(dt / 4);
      for (const b of balls) {
        if (b.state === 'rail') {
          // rolling down a slope: a = (5/7)·g·sinθ, minus rolling resistance; a knock at the stop
          const u = Math.min(1, b.s! / railLen);
          const tg = railCurve.getTangentAt(u);
          b.sp = b.sp! + (-tg.y * 9.8 * (5 / 7) - 0.25) * dt;
          b.sp = Math.max(b.s! < railLen * 0.2 ? 0.5 : 0.12, b.sp);
          b.s = b.s! + b.sp * dt;
          if (b.s >= railLen) {
            b.s = railLen;
            if (b.sp > 0.3) b.sp *= -0.25;
            else {
              b.sp = 0;
              b.state = 'end';
              const r = b.onArrive;
              b.onArrive = null;
              r?.();
            }
          }
          const prev = b.p.clone();
          b.p.copy(railCurve.getPointAt(Math.min(1, b.s / railLen)));
          b.v.subVectors(b.p, prev).divideScalar(Math.max(dt, 1e-4));
        }
        if (b.state === 'pop') {
          const k = Math.min(1, (time - b.t0!) / 0.35);
          b.mesh.scale.setScalar(b.r * (1 + k * 0.4) * (1 - k));
          if (k >= 1) {
            b.state = 'gone';
            b.mesh.visible = false;
          }
          continue;
        }
        if (b.state === 'mix' || b.state === 'drop' || b.state === 'rail') roll(b, dt);
        b.mesh.position.copy(b.p);
        b.mesh.quaternion.copy(b.q);
      }

      // winners lifted up into their spots, turning so cover and title both pass by
      for (const s of shown) {
        slotTarget(s.slot, to);
        const u = Math.min(1, (time - s.t0) / 1.3);
        const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        s.m.position.lerpVectors(s.from, to, e);
        s.m.position.y += Math.sin(u * Math.PI) * 0.25;
        s.m.scale.setScalar(s.s0 + (slotScale(s.slot) - s.s0) * e);
        spinQ.setFromAxisAngle(Y, (time - s.t0) * 0.9);
        s.m.quaternion.copy(s.q0).slerp(qUp, e).multiply(spinQ);
      }

      updateCamera(dt);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    // ---------------------------------------------------------------- the show
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const crank = (on: boolean) => {
      if (mode === 'stop') return;
      if (on) {
        doorT = 0;
        closeAt = 0;
      }
      mode = on ? 'crank' : 'idle';
      cam.mixing = on ? 1 : 0;
    };
    const run = async () => {
      // pour, close the door, crank
      await wait(250 + balls.length * 55 + 1300);
      if (!alive) return;
      doorT = 0;
      crank(true);
      await wait(2600);
      for (let i = 0; i < picked.length && alive; i++) {
        if (i > 0) {
          cam.focus = 0;
          crank(true);
          await wait(1800);
          if (!alive) return;
        }
        cam.mixing = 0;
        await turnTo(0);
        await wait(380);
        doorT = 1;
        await wait(300);
        if (!alive) return;
        const H = V(0, CY - R, 0);
        const b = balls
          .filter((x) => x.state === 'mix' && x.show === picked[i])
          .sort((a, c) => a.p.distanceTo(H) - c.p.distanceTo(H))[0];
        if (!b) continue;
        b.state = 'drop';
        b.v.set(0, -0.4, 0);
        cam.focus = 1;
        await new Promise<void>((res) => (b.onArrive = res));
        await wait(450);
        if (!alive) return;
        cam.focus = 0;
        present(b, i);
        b.state = 'gone';
        b.mesh.visible = false;
        setLanded(i + 1);
        await wait(1300);
        // the drawn show's other balls are done
        for (const o of balls) {
          if (o.state === 'mix' && o.show === b.show) {
            o.state = 'pop';
            o.t0 = time;
          }
        }
      }
      if (!alive) return;
      crank(false);
      setDone(true);
    };
    void run();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => {
          (x as THREE.MeshStandardMaterial).map?.dispose();
          x.dispose();
        });
      });
      (scene.background as THREE.Texture | null)?.dispose();
      scene.environment?.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cut.at]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={host} className="absolute inset-0" />

      {/* the spots: a glass panel on the right; drawn balls fly into the rings */}
      <motion.div
        className="absolute top-[54%] right-[4vw] flex w-[30vw] -translate-y-1/2 flex-col gap-[1.4vw] p-[2vw]"
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.3, type: 'spring', stiffness: 160, damping: 22 }}
      >
        <div>
          <div className="live-shine text-[2.6vw] leading-none font-black tracking-tight">The draw</div>
          <div className="mt-[0.4vw] text-[1vw] text-white/55">
            {cut.candidates.length} shows level on {cut.votes} votes · {cut.slots} spot{cut.slots === 1 ? '' : 's'} left
          </div>
        </div>
        {picked.map((id, i) => {
          const e = cut.candidates.find((c) => c.id === id);
          const filled = landed > i;
          return (
            <div key={id} className="flex items-center gap-[1.2vw]">
              <div
                ref={(r) => {
                  slotRefs.current[i] = r;
                }}
                className={`aspect-square w-[6.4vw] shrink-0 rounded-full border-[0.18vw] transition-colors duration-700 ${
                  filled ? 'border-emerald-300/70 shadow-[0_0_2vw_rgba(110,231,183,.35)]' : 'border-dashed border-white/25'
                }`}
              />
              <div className="min-w-0 flex-1">
                {filled && e ? (
                  <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.9 }}>
                    <div className="line-clamp-2 text-[1.25vw] leading-tight font-bold">{e.title}</div>
                    <span className="mt-[0.3vw] inline-block rounded-[0.3vw] bg-emerald-400 px-[0.5vw] text-[0.8vw] font-black tracking-widest text-emerald-950">
                      QUALIFIED
                    </span>
                  </motion.div>
                ) : (
                  <span className="text-[1vw] font-bold tracking-[0.25em] text-white/35">SPOT {i + 1}</span>
                )}
              </div>
            </div>
          );
        })}
        {/* every show in the drum, and how it fared */}
        <div className="mt-[0.4vw] border-t border-white/10 pt-[1vw]">
          <div className="mb-[0.6vw] text-[0.8vw] font-bold tracking-[0.3em] text-white/45 uppercase">In the drum</div>
          <div className="grid grid-cols-2 gap-x-[1vw] gap-y-[0.5vw]">
            {cut.candidates.map((e) => {
              const k = picked.indexOf(e.id);
              const state = k >= 0 && landed > k ? 'in' : done ? 'out' : 'drum';
              return (
                <motion.div
                  key={e.id}
                  layout
                  className={`flex min-w-0 items-center gap-[0.5vw] transition-opacity duration-700 ${state === 'out' ? 'opacity-40' : ''}`}
                >
                  {e.cover ? (
                    <img src={e.cover} alt="" className={`h-[2.2vw] w-[1.65vw] shrink-0 rounded-[0.25vw] object-cover ${state === 'out' ? 'grayscale' : ''}`} />
                  ) : (
                    <span className="h-[2.2vw] w-[1.65vw] shrink-0 rounded-[0.25vw] bg-white/10" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[0.9vw] font-semibold">{e.title}</span>
                  {state !== 'drum' && (
                    <motion.span
                      initial={{ scale: 1.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className={`shrink-0 rounded-[0.25vw] px-[0.4vw] text-[0.65vw] font-black tracking-widest ${
                        state === 'in' ? 'bg-emerald-400 text-emerald-950' : 'bg-white/10 text-white/50'
                      }`}
                    >
                      {state === 'in' ? 'IN' : 'OUT'}
                    </motion.span>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
