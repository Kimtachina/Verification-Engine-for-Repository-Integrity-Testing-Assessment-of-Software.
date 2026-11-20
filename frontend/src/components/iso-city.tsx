/**
 * Decorative isometric line drawing: a block of towers made of slatted shafts, drawn
 * in hairlines on the page's paper colour. Generated from a fixed seed, so the server
 * and the browser draw the same picture (no hydration mismatch) and it never changes.
 */

const COS = Math.cos(Math.PI / 6);
const SIN = 0.5;

type Point = readonly [number, number];

/** Isometric projection: x to the lower right, y to the lower left, z up. */
const project = (x: number, y: number, z: number): Point => [(x - y) * COS, (x + y) * SIN - z];

const poly = (points: Point[]) =>
  points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

/** Small deterministic PRNG (mulberry32). */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Box {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** Vertical slats on the two visible sides, as in a curtain-wall facade. */
  slats: number;
}

function buildCity(seed: number, size: number, unit: number): Box[] {
  const rand = random(seed);
  const boxes: Box[] = [];
  for (let gx = 0; gx < size; gx++) {
    for (let gy = 0; gy < size; gy++) {
      // Taller towards the middle of the block, like a downtown seen from above.
      const centre = 1 - Math.hypot(gx - size / 2, gy - size / 2) / size;
      if (rand() < 0.18) continue;
      const height = unit * (0.6 + rand() * 9 * centre * centre + (rand() < 0.12 ? 4 : 0));
      const inset = rand() < 0.5 ? unit * 0.12 : 0;
      const box: Box = {
        x: gx * unit + inset,
        y: gy * unit + inset,
        z: 0,
        w: unit - inset * 2,
        d: unit - inset * 2,
        h: height,
        slats: height > unit * 2.5 ? 2 + Math.floor(rand() * 3) : 0,
      };
      boxes.push(box);
      // A setback on top of some towers.
      if (height > unit * 3 && rand() < 0.45) {
        const s = box.w * (0.35 + rand() * 0.25);
        boxes.push({
          x: box.x + (box.w - s) / 2,
          y: box.y + (box.d - s) / 2,
          z: height,
          w: s,
          d: s,
          h: unit * (0.4 + rand() * 1.6),
          slats: 0,
        });
      }
    }
  }
  // Painter's order: far (small x + y) first, lower first.
  return boxes.sort((a, b) => a.x + a.y - (b.x + b.y) || a.z - b.z);
}

const UNIT = 26;
interface Drawing {
  shapes: Array<{
    key: number;
    top: Point[];
    right: Point[];
    left: Point[];
    slats: Array<[Point, Point]>;
  }>;
  viewBox: string;
}

/** Each (seed, size) is drawn once per process and reused. */
const drawings = new Map<string, Drawing>();

function drawing(seed: number, size: number): Drawing {
  const key = `${seed}:${size}`;
  const cached = drawings.get(key);
  if (cached) return cached;

  const shapes = buildCity(seed, size, UNIT).map((b, i) => {
    const top = [
      project(b.x, b.y, b.z + b.h),
      project(b.x + b.w, b.y, b.z + b.h),
      project(b.x + b.w, b.y + b.d, b.z + b.h),
      project(b.x, b.y + b.d, b.z + b.h),
    ];
    const right = [
      project(b.x + b.w, b.y, b.z),
      project(b.x + b.w, b.y + b.d, b.z),
      project(b.x + b.w, b.y + b.d, b.z + b.h),
      project(b.x + b.w, b.y, b.z + b.h),
    ];
    const left = [
      project(b.x, b.y + b.d, b.z),
      project(b.x + b.w, b.y + b.d, b.z),
      project(b.x + b.w, b.y + b.d, b.z + b.h),
      project(b.x, b.y + b.d, b.z + b.h),
    ];
    const slats: Array<[Point, Point]> = [];
    for (let s = 1; s <= b.slats; s++) {
      const f = s / (b.slats + 1);
      slats.push([
        project(b.x + b.w, b.y + b.d * f, b.z),
        project(b.x + b.w, b.y + b.d * f, b.z + b.h),
      ]);
      slats.push([
        project(b.x + b.w * f, b.y + b.d, b.z),
        project(b.x + b.w * f, b.y + b.d, b.z + b.h),
      ]);
    }
    return { key: i, top, right, left, slats };
  });

  const points = shapes.flatMap((s) => [...s.top, ...s.left, ...s.right]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const pad = 2;
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + pad * 2;
  const h = Math.max(...ys) - Math.min(...ys) + pad * 2;
  const result = {
    shapes,
    viewBox: `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`,
  };
  drawings.set(key, result);
  return result;
}

/** `seed` picks the skyline; `size` is how many blocks along each side. */
export function IsoCity({
  className,
  seed = 7,
  size = 9,
}: {
  className?: string;
  seed?: number;
  size?: number;
}) {
  const { shapes, viewBox } = drawing(seed, size);
  return (
    <svg
      viewBox={viewBox}
      className={className}
      aria-hidden
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={0.75}
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
    >
      {shapes.map((s) => (
        <g key={s.key}>
          {/* Faces are filled with the paper colours so nearer towers hide farther ones. */}
          <polygon points={poly(s.left)} fill="var(--card)" />
          <polygon points={poly(s.right)} fill="var(--background)" />
          <polygon points={poly(s.top)} fill="var(--card)" />
          {s.slats.map(([a, b], j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed drawing, never reordered
            <line key={j} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth={0.5} />
          ))}
        </g>
      ))}
    </svg>
  );
}
