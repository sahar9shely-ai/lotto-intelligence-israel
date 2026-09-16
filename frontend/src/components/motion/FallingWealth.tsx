import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useMotionPrefs } from "../../hooks/useMotionPrefs";

const SPRING = { stiffness: 70, damping: 18, mass: 0.4 };

type Kind = "disc" | "shekel" | "btc" | "glyph";
type Depth = "far" | "mid" | "near";

type Particle = {
  id: string;
  kind: Kind;
  depth: Depth;
  x: number;
  size: number;
  opacity: number;
  duration: number;
  drift: number;
  rotateFrom: number;
  rotateTo: number;
  restY: number;
  phase: number;
  mobile: boolean;
};

const PARTICLES: Particle[] = [
  { id: "w1", kind: "disc", depth: "far", x: 7, size: 15, opacity: 0.2, duration: 24, drift: 11, rotateFrom: -10, rotateTo: 8, restY: 16, phase: 0.12, mobile: true },
  { id: "w2", kind: "btc", depth: "far", x: 19, size: 13, opacity: 0.18, duration: 26, drift: -9, rotateFrom: 8, rotateTo: -6, restY: 48, phase: 0.58, mobile: false },
  { id: "w3", kind: "glyph", depth: "far", x: 31, size: 18, opacity: 0.16, duration: 22, drift: 14, rotateFrom: -4, rotateTo: 10, restY: 72, phase: 0.33, mobile: true },
  { id: "w4", kind: "shekel", depth: "far", x: 86, size: 14, opacity: 0.2, duration: 25, drift: -12, rotateFrom: 6, rotateTo: -9, restY: 22, phase: 0.71, mobile: false },
  { id: "w5", kind: "disc", depth: "far", x: 94, size: 12, opacity: 0.17, duration: 23, drift: 8, rotateFrom: -7, rotateTo: 5, restY: 64, phase: 0.21, mobile: true },
  { id: "w6", kind: "shekel", depth: "mid", x: 12, size: 22, opacity: 0.34, duration: 16.5, drift: 16, rotateFrom: -12, rotateTo: 14, restY: 28, phase: 0.44, mobile: true },
  { id: "w7", kind: "disc", depth: "mid", x: 26, size: 18, opacity: 0.3, duration: 17.5, drift: -14, rotateFrom: 9, rotateTo: -11, restY: 58, phase: 0.08, mobile: false },
  { id: "w8", kind: "btc", depth: "mid", x: 41, size: 20, opacity: 0.28, duration: 18, drift: 12, rotateFrom: -6, rotateTo: 13, restY: 14, phase: 0.63, mobile: true },
  { id: "w9", kind: "glyph", depth: "mid", x: 58, size: 24, opacity: 0.26, duration: 15.8, drift: -18, rotateFrom: 11, rotateTo: -8, restY: 78, phase: 0.29, mobile: false },
  { id: "w10", kind: "disc", depth: "mid", x: 71, size: 17, opacity: 0.32, duration: 16.2, drift: 10, rotateFrom: -14, rotateTo: 7, restY: 36, phase: 0.81, mobile: true },
  { id: "w11", kind: "shekel", depth: "mid", x: 83, size: 21, opacity: 0.3, duration: 17.2, drift: -11, rotateFrom: 5, rotateTo: -13, restY: 52, phase: 0.17, mobile: true },
  { id: "w12", kind: "btc", depth: "mid", x: 4, size: 16, opacity: 0.24, duration: 19, drift: 13, rotateFrom: -8, rotateTo: 9, restY: 84, phase: 0.52, mobile: false },
  { id: "w13", kind: "shekel", depth: "near", x: 16, size: 26, opacity: 0.46, duration: 12.4, drift: 18, rotateFrom: -16, rotateTo: 12, restY: 20, phase: 0.37, mobile: true },
  { id: "w14", kind: "disc", depth: "near", x: 48, size: 23, opacity: 0.4, duration: 11.6, drift: -15, rotateFrom: 10, rotateTo: -14, restY: 42, phase: 0.74, mobile: false },
  { id: "w15", kind: "btc", depth: "near", x: 64, size: 22, opacity: 0.38, duration: 13.1, drift: 14, rotateFrom: -9, rotateTo: 11, restY: 68, phase: 0.11, mobile: true },
  { id: "w16", kind: "glyph", depth: "near", x: 78, size: 28, opacity: 0.34, duration: 12, drift: -17, rotateFrom: 13, rotateTo: -10, restY: 24, phase: 0.56, mobile: false },
  { id: "w17", kind: "disc", depth: "near", x: 91, size: 20, opacity: 0.42, duration: 11.2, drift: 12, rotateFrom: -11, rotateTo: 8, restY: 80, phase: 0.88, mobile: true },
  { id: "w18", kind: "shekel", depth: "far", x: 52, size: 14, opacity: 0.18, duration: 24.5, drift: -8, rotateFrom: 4, rotateTo: -7, restY: 10, phase: 0.41, mobile: false },
];

function readMq(query: string): boolean {
  return typeof window !== "undefined" && window.matchMedia(query).matches;
}

function CoinMark({
  kind,
  uid,
}: {
  kind: Kind;
  uid: string;
}) {
  if (kind === "glyph") {
    return (
      <svg viewBox="0 0 32 32" className="falling-wealth__svg" aria-hidden="true">
        <text
          x="16"
          y="22"
          textAnchor="middle"
          fontFamily='Rubik, Assistant, "Segoe UI", sans-serif'
          fontSize="20"
          fontWeight="600"
          fill="#e8d8a8"
          fillOpacity="0.92"
        >
          ₪
        </text>
      </svg>
    );
  }

  const mark = kind === "shekel" ? "₪" : kind === "btc" ? "₿" : null;

  return (
    <svg viewBox="0 0 32 32" className="falling-wealth__svg" aria-hidden="true">
      <circle cx="16" cy="16" r="14.4" fill={`url(#${uid}-face)`} />
      <circle cx="16" cy="16" r="14.4" fill={`url(#${uid}-sheen)`} />
      <circle
        cx="16"
        cy="16"
        r="12.15"
        fill="none"
        stroke="#f6f3ea"
        strokeOpacity="0.38"
        strokeWidth="0.85"
      />
      {mark ? (
        <text
          x="16"
          y="21.2"
          textAnchor="middle"
          fontFamily='Rubik, Assistant, "Segoe UI", sans-serif'
          fontSize={mark === "₿" ? 13 : 13.5}
          fontWeight="600"
          fill="#f6f3ea"
          fillOpacity="0.92"
        >
          {mark}
        </text>
      ) : (
        <circle
          cx="16"
          cy="16"
          r="3.1"
          fill="none"
          stroke="#f6f3ea"
          strokeOpacity="0.42"
          strokeWidth="1"
        />
      )}
    </svg>
  );
}

function WealthItem({
  particle,
  uid,
  reduceMotion,
}: {
  particle: Particle;
  uid: string;
  reduceMotion: boolean;
}) {
  const phaseDelay = -particle.duration * particle.phase;

  if (reduceMotion) {
    return (
      <div
        className={`falling-wealth__item falling-wealth__item--${particle.depth}`}
        style={{
          left: `${particle.x}%`,
          top: `${particle.restY}%`,
          width: particle.size,
          height: particle.size,
          marginLeft: -particle.size / 2,
          opacity: particle.opacity * 0.72,
        }}
      >
        <CoinMark kind={particle.kind} uid={uid} />
      </div>
    );
  }

  return (
    <motion.div
      className={`falling-wealth__item falling-wealth__item--${particle.depth}`}
      style={{
        left: `${particle.x}%`,
        width: particle.size,
        height: particle.size,
        marginLeft: -particle.size / 2,
        opacity: particle.opacity,
      }}
      initial={false}
      animate={{
        y: ["-18vh", "118vh"],
        x: [0, particle.drift, -particle.drift * 0.55, 0],
        rotate: [particle.rotateFrom, particle.rotateTo, particle.rotateFrom],
      }}
      transition={{
        y: {
          duration: particle.duration,
          delay: phaseDelay,
          repeat: Infinity,
          ease: "linear",
        },
        x: {
          duration: particle.duration * 0.72,
          delay: phaseDelay,
          repeat: Infinity,
          repeatType: "mirror",
          ease: "easeInOut",
        },
        rotate: {
          duration: particle.duration * 0.9,
          delay: phaseDelay,
          repeat: Infinity,
          repeatType: "mirror",
          ease: "easeInOut",
        },
      }}
    >
      <CoinMark kind={particle.kind} uid={uid} />
    </motion.div>
  );
}

function WealthLayer({
  depth,
  x,
  y,
  follow,
  children,
}: {
  depth: Depth;
  x: MotionValue<number>;
  y: MotionValue<number>;
  follow: boolean;
  children: ReactNode;
}) {
  if (!follow) {
    return <div className={`falling-wealth__layer falling-wealth__layer--${depth}`}>{children}</div>;
  }

  return (
    <motion.div
      className={`falling-wealth__layer falling-wealth__layer--${depth}`}
      style={{ x, y }}
    >
      {children}
    </motion.div>
  );
}

export function FallingWealth() {
  const rawId = useId();
  const uid = rawId.replace(/:/g, "");
  const { reduceMotion, allowMouseFollow } = useMotionPrefs();
  const [compact, setCompact] = useState(
    () => readMq("(max-width: 820px), (pointer: coarse)"),
  );

  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, SPRING);
  const sy = useSpring(py, SPRING);
  const farX = useTransform(sx, (v) => v * 8);
  const farY = useTransform(sy, (v) => v * 5);
  const midX = useTransform(sx, (v) => v * 16);
  const midY = useTransform(sy, (v) => v * 10);
  const nearX = useTransform(sx, (v) => v * 26);
  const nearY = useTransform(sy, (v) => v * 16);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px), (pointer: coarse)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!allowMouseFollow) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      px.set(event.clientX / w - 0.5);
      py.set(event.clientY / h - 0.5);
    };
    const onLeave = () => {
      px.set(0);
      py.set(0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      px.set(0);
      py.set(0);
    };
  }, [allowMouseFollow, px, py]);

  const items = useMemo(() => {
    const pool = compact ? PARTICLES.filter((p) => p.mobile) : PARTICLES;
    if (reduceMotion) {
      return pool.filter((p) => p.depth !== "near").slice(0, compact ? 5 : 7);
    }
    return pool;
  }, [compact, reduceMotion]);

  const byDepth = useMemo(
    () => ({
      far: items.filter((p) => p.depth === "far"),
      mid: items.filter((p) => p.depth === "mid"),
      near: items.filter((p) => p.depth === "near"),
    }),
    [items],
  );

  const follow = allowMouseFollow && !reduceMotion;

  return (
    <div className="falling-wealth" aria-hidden="true">
      <svg className="falling-wealth__defs" width="0" height="0" aria-hidden="true">
        <defs>
          <linearGradient id={`${uid}-face`} x1="7" y1="3" x2="26" y2="29" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#f6f3ea" />
            <stop offset="42%" stopColor="#d4b56a" />
            <stop offset="100%" stopColor="#9a7530" />
          </linearGradient>
          <radialGradient id={`${uid}-sheen`} cx="36%" cy="30%" r="62%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.32" />
            <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>

      <WealthLayer depth="far" x={farX} y={farY} follow={follow}>
        {byDepth.far.map((particle) => (
          <WealthItem
            key={particle.id}
            particle={particle}
            uid={uid}
            reduceMotion={reduceMotion}
          />
        ))}
      </WealthLayer>
      <WealthLayer depth="mid" x={midX} y={midY} follow={follow}>
        {byDepth.mid.map((particle) => (
          <WealthItem
            key={particle.id}
            particle={particle}
            uid={uid}
            reduceMotion={reduceMotion}
          />
        ))}
      </WealthLayer>
      <WealthLayer depth="near" x={nearX} y={nearY} follow={follow}>
        {byDepth.near.map((particle) => (
          <WealthItem
            key={particle.id}
            particle={particle}
            uid={uid}
            reduceMotion={reduceMotion}
          />
        ))}
      </WealthLayer>
    </div>
  );
}
