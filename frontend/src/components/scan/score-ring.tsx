import type { Grade } from "@veritas/shared";
import { gradeTone } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The overall score as a ring that fills to the score, coloured by grade. */
export function ScoreRing({
  score,
  grade,
  size = 128,
}: {
  score: number | null;
  grade: Grade | null;
  size?: number;
}) {
  const stroke = Math.max(8, size / 12);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = score === null ? 0 : (score / 100) * circumference;
  const label =
    score === null || grade === null
      ? "ยังไม่มีคะแนน"
      : `คะแนน ${score.toFixed(1)} จาก 100 เกรด ${grade}`;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="butt"
          strokeDasharray={`${filled} ${circumference}`}
          className={cn(
            "transition-[stroke-dasharray] duration-700",
            grade ? gradeTone(grade) : "",
          )}
          stroke="currentColor"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-4xl leading-none font-black tabular-nums">
          {score === null ? "—" : Math.round(score)}
        </span>
        {grade && (
          <span className={cn("mt-1 font-display text-sm font-bold", gradeTone(grade))}>
            เกรด {grade}
          </span>
        )}
      </div>
    </div>
  );
}
