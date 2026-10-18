import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { textureUrl } from './ids';
import { matchLabel } from '~/lib/tournament';
import { cn } from '~/lib/utils';
import Confetti, { type ConfettiHandle } from '../confetti';
import Cover from '../cover';

// A tied 1v1 (or two shows level for the last spot) goes to the coin. A
// real gold coin with a ridged rim and a cover on each face (heads = the
// first show) is tossed end over end, lands on the table, bounces, wobbles
// down like a real coin, and the camera tips over to read the winning face.

const COIN_R = 1.25;
const COIN_H = 0.13;
const REST_S = 0.9; // lying on the table before the toss
const AIR_S = 2.3;
const BOUNCE_S = 0.35;
const WOBBLE_S = 1.9;
const LOOK_S = 1.1;
const TURNS = 8;

export default function CoinScreen({ t }: { t: PublicTournament }) {
  const coin = t.coin!;
  const onLine = coin.key === 'cut' && t.cut?.candidates.length === 2;
  const m = onLine ? null : [...t.rounds.flat(), t.third].find((x) => x?.key === coin.key);
  const heads = onLine ? t.cut!.candidates[0] : (m?.a ?? null);
  const tails = onLine ? t.cut!.candidates[1] : (m?.b ?? null);
  const winsHeads = coin.winner === heads?.id;
  const winner = winsHeads ? heads : tails;

  const host = useRef<HTMLDivElement>(null);
  const confetti = useRef<ConfettiHandle>(null);
  const [landed, setLanded] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el || !heads || !tails) return;
    setLanded(false);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;

    const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 100);
    const camToss = new THREE.Vector3(0, 3.4, 12);
    const camRead = new THREE.Vector3(0, 7.2, 3.2);
    const lookToss = new THREE.Vector3(0, 1.9, 0);
    const lookRead = new THREE.Vector3(0, 0, 0);
    const lookAt = new THREE.Vector3();
    camera.position.copy(camToss);
    camera.lookAt(lookToss);

    scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const key = new THREE.SpotLight(0xffffff, 120, 40, Math.PI / 5, 0.5);
    key.position.set(2.5, 9, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 8;
    scene.add(key);
    scene.add(key.target);
    const rimA = new THREE.PointLight(0x7c5cff, 50, 30);
    rimA.position.set(-6, 3, -2);
    scene.add(rimA);
    const rimB = new THREE.PointLight(0xff4d6d, 35, 30);
    rimB.position.set(6, 2, -3);
    scene.add(rimB);

    const table = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.5 }));
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    scene.add(table);
    // a soft pool of light on the table
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 64),
      new THREE.MeshBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: 0.08 })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.001;
    scene.add(pool);

    // ---------------------------------------------------------- the coin
    const gold = new THREE.MeshStandardMaterial({ color: 0xe8b84a, metalness: 1, roughness: 0.22 });
    const goldDark = new THREE.MeshStandardMaterial({ color: 0xb8862b, metalness: 1, roughness: 0.32 });
    // reeded edge
    const ridges = new THREE.CanvasTexture(
      (() => {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 8;
        const g = c.getContext('2d')!;
        for (let i = 0; i < 128; i++) {
          g.fillStyle = i % 2 ? '#7a5a14' : '#f0c75e';
          g.fillRect(i * 4, 0, 4, 8);
        }
        return c;
      })()
    );
    ridges.colorSpace = THREE.SRGBColorSpace;
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(COIN_R, COIN_R, COIN_H, 120, 1, true),
      new THREE.MeshStandardMaterial({ map: ridges, metalness: 1, roughness: 0.3 })
    );
    rim.castShadow = true;

    const coinObj = new THREE.Group();
    coinObj.add(rim);
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const face = (e: PublicEntry, up: boolean) => {
      const y = up ? COIN_H / 2 : -COIN_H / 2;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(COIN_R, 96), gold);
      disc.rotation.x = up ? -Math.PI / 2 : Math.PI / 2;
      disc.position.y = y;
      disc.castShadow = true;
      coinObj.add(disc);
      // raised lip around the face
      const lip = new THREE.Mesh(new THREE.TorusGeometry(COIN_R - 0.07, 0.05, 12, 96), goldDark);
      lip.rotation.x = Math.PI / 2;
      lip.position.y = y;
      coinObj.add(lip);
      // the show's cover, minted in
      const art = new THREE.MeshStandardMaterial({ color: new THREE.Color(e.color ?? '#7c5cff'), metalness: 0.25, roughness: 0.45 });
      const inlay = new THREE.Mesh(new THREE.CircleGeometry(COIN_R - 0.16, 96), art);
      inlay.rotation.x = up ? -Math.PI / 2 : Math.PI / 2;
      inlay.position.y = y + (up ? 0.004 : -0.004);
      // tails is read with the coin turned over about x: keep its art upright then
      if (!up) inlay.rotation.z = Math.PI;
      coinObj.add(inlay);
      if (e.cover) {
        loader.load(
          textureUrl(e.cover),
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            // crop the 3:4 poster to a centred square
            tex.repeat.set(1, 0.75);
            tex.offset.set(0, 0.125);
            art.map = tex;
            art.color.set(0xffffff);
            art.needsUpdate = true;
          },
          undefined,
          () => {} // no CORS for this image: the face keeps the show's colour
        );
      }
    };
    face(heads, true);
    face(tails, false);
    scene.add(coinObj);

    // ---------------------------------------------------------- motion
    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // whole turns, plus half a turn when tails wins
    const flipEnd = Math.PI * 2 * TURNS + (winsHeads ? 0 : Math.PI);
    const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
    const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const qFlip = new THREE.Quaternion();
    const qTilt = new THREE.Quaternion();
    const qSpin = new THREE.Quaternion();
    const X = new THREE.Vector3(1, 0, 0);
    const Y = new THREE.Vector3(0, 1, 0);
    const Z = new THREE.Vector3(0, 0, 1);
    const REST_Y = COIN_H / 2;
    const PEAK = 2.9;
    let told = false;
    const start = performance.now();

    let raf = 0;
    const loop = (now: number) => {
      const s = (now - start) / 1000;
      let y = REST_Y;
      let flip = 0;
      let tilt = 0;
      let spin = 0;
      let x = 0;
      let look = 0;
      const t1 = REST_S;
      const t2 = t1 + AIR_S;
      const t3 = t2 + BOUNCE_S;
      const t4 = t3 + WOBBLE_S;

      if (s < t1) {
        spin = s * 0.6; // resting heads up, turning a touch
      } else if (s < t2) {
        // up and back down, end over end
        const k = (s - t1) / AIR_S;
        y = REST_Y + PEAK * 4 * k * (1 - k);
        flip = flipEnd * easeOut(Math.min(1, k * 1.02));
        spin = t1 * 0.6 + k * 1.4;
        x = Math.sin(k * Math.PI) * -0.4;
      } else if (s < t3) {
        // a bounce off the table
        const k = (s - t2) / BOUNCE_S;
        y = REST_Y + Math.sin(k * Math.PI) * 0.35;
        flip = flipEnd;
        tilt = Math.sin(k * Math.PI) * 0.35;
        spin = t1 * 0.6 + 1.4 + k * 2;
      } else if (s < t4) {
        // the wobble: the lean dies away while it whirls faster (Euler's disk)
        const k = (s - t3) / WOBBLE_S;
        flip = flipEnd;
        tilt = 0.32 * Math.pow(1 - k, 2);
        spin = t1 * 0.6 + 3.4 + (k + k * k * 2) * 9;
        y = REST_Y + Math.sin(tilt) * COIN_R;
      } else {
        flip = flipEnd;
        spin = t1 * 0.6 + 3.4 + 27;
        look = easeInOut(Math.min(1, (s - t4) / LOOK_S));
        if (!told) {
          told = true;
          setLanded(true);
        }
      }

      qSpin.setFromAxisAngle(Y, spin);
      qTilt.setFromAxisAngle(Z, tilt);
      qFlip.setFromAxisAngle(X, flip);
      coinObj.quaternion.copy(qSpin).multiply(qTilt).multiply(qFlip);
      coinObj.position.set(x, y, 0);

      // once it settles, tip the camera over to read the face
      camera.position.lerpVectors(camToss, camRead, look);
      lookAt.lerpVectors(lookToss, lookRead, look);
      camera.lookAt(lookAt);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => {
          (x as THREE.MeshStandardMaterial).map?.dispose();
          x.dispose();
        });
      });
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin.at]);

  useEffect(() => {
    if (landed && winner) confetti.current?.burst(['#f5c542', '#ffe9a3', '#ffffff', winner.color ?? '#7c5cff']);
  }, [landed, winner]);

  if (!heads || !tails) return null;
  const caption = onLine
    ? `Qualifying line · level on ${t.cut!.votes} for the last spot`
    : `${matchLabel(m!.key, t.rounds.length)} · tied ${m!.votes?.[0] ?? 0}–${m!.votes?.[1] ?? 0}`;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={host} className="absolute inset-0" />
      <Confetti ref={confetti} />

      <motion.div
        className="pointer-events-none absolute inset-x-0 top-[8.2vw] flex flex-col items-center gap-[0.3vw]"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <span className="text-[0.95vw] font-bold tracking-[0.35em] text-white/50 uppercase">{caption}</span>
        <span className="live-shine text-[3vw] leading-none font-black tracking-tight">Coin flip</span>
      </motion.div>

      <Side entry={heads} label="Heads" won={landed && winsHeads} lost={landed && !winsHeads} className="left-[5vw]" />
      <Side entry={tails} label="Tails" won={landed && !winsHeads} lost={landed && winsHeads} className="right-[5vw]" />

      <motion.div
        className="pointer-events-none absolute inset-x-0 bottom-[2.6vw] text-center"
        initial={{ opacity: 0, scale: 0.7 }}
        animate={landed ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.7 }}
        transition={{ type: 'spring', stiffness: 260, damping: 16, delay: landed ? 0.5 : 0 }}
      >
        <span className="live-gold text-[2.6vw] font-black tracking-wide">
          {winner?.title} {onLine ? 'takes the last spot' : 'wins the toss'}
        </span>
      </motion.div>
    </div>
  );
}

function Side({
  entry,
  label,
  won,
  lost,
  className,
}: {
  entry: PublicEntry;
  label: string;
  won: boolean;
  lost: boolean;
  className?: string;
}) {
  return (
    <motion.div
      className={cn('pointer-events-none absolute top-1/2 flex w-[16vw] -translate-y-1/2 flex-col items-center gap-[0.8vw] text-center', className)}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: lost ? 0.35 : 1, y: 0, scale: won ? 1.08 : lost ? 0.92 : 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 18 }}
    >
      <span
        className={cn(
          'rounded-full px-[1vw] py-[0.2vw] text-[0.9vw] font-black tracking-[0.3em] uppercase',
          won ? 'bg-amber-300 text-black' : 'bg-white/10 text-white/70'
        )}
      >
        {label}
      </span>
      <Cover
        entry={entry}
        className={cn(
          'aspect-[3/4] w-[11vw] rounded-[1vw] shadow-2xl shadow-black/60 transition-[filter] duration-700',
          won && 'ring-[0.3vw] ring-amber-300',
          lost && 'grayscale'
        )}
      />
      <span className="line-clamp-2 text-[1.25vw] leading-tight font-bold">{entry.title}</span>
    </motion.div>
  );
}
