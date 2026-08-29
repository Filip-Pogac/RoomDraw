/**
 * Hand-drawn style SVG illustrations used across the game.
 * Everything is inline SVG so it scales, themes with currentColor and costs no extra request.
 */

const INK = "#2c2447";

type DoodleProps = {
  className?: string;
};

/** Smiling crayon mascot — used as the main hero character. */
export function CrayonMascot({ className }: DoodleProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 120 190" role="img" aria-label="Vesela bojica">
      <path
        d="M60 6 96 52H24L60 6Z"
        fill="#ff5da2"
        stroke={INK}
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <rect x="24" y="52" width="72" height="128" rx="18" fill="#ffc93c" stroke={INK} strokeWidth="6" />
      <rect x="24" y="76" width="72" height="26" fill="#ff8a3d" stroke={INK} strokeWidth="6" />
      <circle cx="47" cy="128" r="6" fill={INK} />
      <circle cx="75" cy="128" r="6" fill={INK} />
      <path d="M46 146c5 8 23 8 29 0" stroke={INK} strokeWidth="6" strokeLinecap="round" />
      <circle cx="36" cy="141" r="6" fill="#ff5da2" opacity="0.7" />
      <circle cx="86" cy="141" r="6" fill="#ff5da2" opacity="0.7" />
    </svg>
  );
}

/** Paint palette with a face — secondary mascot. */
export function PaletteMascot({ className }: DoodleProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 160 140" role="img" aria-label="Paleta boja">
      <path
        d="M80 8c40 0 72 26 72 58 0 20-16 26-30 26-10 0-16 6-16 14 0 10-10 26-30 26-38 0-68-30-68-66S40 8 80 8Z"
        fill="#fffdf7"
        stroke={INK}
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <circle cx="46" cy="48" r="11" fill="#ff5da2" stroke={INK} strokeWidth="5" />
      <circle cx="82" cy="36" r="11" fill="#45c4ff" stroke={INK} strokeWidth="5" />
      <circle cx="116" cy="52" r="11" fill="#35d6a4" stroke={INK} strokeWidth="5" />
      <circle cx="40" cy="86" r="11" fill="#ffc93c" stroke={INK} strokeWidth="5" />
      <circle cx="72" cy="98" r="11" fill="#a06bff" stroke={INK} strokeWidth="5" />
    </svg>
  );
}

/** Chunky pencil, good for headers and empty states. */
export function PencilDoodle({ className }: DoodleProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 140 60" role="img" aria-label="Olovka">
      <path d="M8 30 34 12v36L8 30Z" fill="#2c2447" stroke={INK} strokeWidth="5" strokeLinejoin="round" />
      <path d="M34 12h18v36H34V12Z" fill="#fff0d1" stroke={INK} strokeWidth="5" />
      <rect x="52" y="12" width="60" height="36" fill="#45c4ff" stroke={INK} strokeWidth="5" />
      <rect x="112" y="12" width="20" height="36" rx="8" fill="#ff5da2" stroke={INK} strokeWidth="5" />
    </svg>
  );
}

export function StarDoodle({ className }: DoodleProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 60 60" aria-hidden>
      <path
        d="m30 4 8 16 18 3-13 13 3 18-16-9-16 9 3-18L4 23l18-3 8-16Z"
        fill="#ffc93c"
        stroke={INK}
        strokeWidth="5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CloudDoodle({ className }: DoodleProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 120 70" aria-hidden>
      <path
        d="M32 62c-14 0-24-9-24-21s10-20 22-19C34 10 46 4 58 6c13 2 21 12 22 23 10-2 20 5 20 16 0 10-8 17-19 17H32Z"
        fill="#ffffff"
        stroke={INK}
        strokeWidth="5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RainbowDoodle({ className }: DoodleProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 160 90" aria-hidden>
      {[
        ["#ff5da2", 12],
        ["#ff8a3d", 26],
        ["#ffc93c", 40],
        ["#35d6a4", 54],
        ["#45c4ff", 68],
      ].map(([stroke, offset]) => (
        <path
          d={`M${offset} 84a${80 - Number(offset)} ${80 - Number(offset)} 0 0 1 ${160 - Number(offset) * 2} 0`}
          key={stroke}
          stroke={stroke as string}
          strokeWidth="11"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

export function SquiggleDoodle({ className }: DoodleProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 200 24" aria-hidden preserveAspectRatio="none">
      <path
        d="M2 14c14-16 28 16 42 0s28 16 42 0 28 16 42 0 28 16 42 0"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SunDoodle({ className }: DoodleProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 100 100" aria-hidden>
      <g className="animate-spin-slow" style={{ transformOrigin: "50px 50px" }}>
        {Array.from({ length: 8 }).map((_, index) => (
          <line
            key={index}
            x1="50"
            y1="6"
            x2="50"
            y2="20"
            stroke="#ffc93c"
            strokeWidth="7"
            strokeLinecap="round"
            transform={`rotate(${index * 45} 50 50)`}
          />
        ))}
      </g>
      <circle cx="50" cy="50" r="24" fill="#ffc93c" stroke={INK} strokeWidth="5" />
      <circle cx="42" cy="46" r="3.5" fill={INK} />
      <circle cx="58" cy="46" r="3.5" fill={INK} />
      <path d="M42 58c4 5 12 5 16 0" stroke={INK} strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** Soft floating shapes behind the whole page. */
export function BackgroundDoodles() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <CloudDoodle className="absolute left-[4%] top-[10%] w-28 opacity-70 animate-floaty" />
      <CloudDoodle className="absolute right-[8%] top-[22%] w-20 opacity-50 animate-floaty [animation-delay:1.2s]" />
      <StarDoodle className="absolute left-[16%] bottom-[16%] w-10 opacity-70 animate-wiggle" />
      <StarDoodle className="absolute right-[12%] bottom-[28%] w-14 opacity-60 animate-wiggle [animation-delay:0.6s]" />
      <StarDoodle className="absolute left-[48%] top-[6%] w-8 opacity-50 animate-wiggle [animation-delay:0.9s]" />
      <SunDoodle className="absolute right-[3%] top-[4%] w-24 opacity-80" />
      <RainbowDoodle className="absolute -left-6 bottom-[4%] w-44 opacity-40" />
    </div>
  );
}

const CONFETTI_COLORS = ["#ff5da2", "#ffc93c", "#45c4ff", "#35d6a4", "#a06bff", "#ff8a3d"];

/** Celebratory confetti rain — mounted only when somebody wins. */
export function Confetti({ pieces = 40 }: { pieces?: number }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {Array.from({ length: pieces }).map((_, index) => (
        <span
          className="absolute block rounded-[2px]"
          key={index}
          style={{
            left: `${(index * 97) % 100}%`,
            width: index % 3 === 0 ? 10 : 7,
            height: index % 4 === 0 ? 16 : 11,
            backgroundColor: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
            animation: `confetti-fall ${2.6 + (index % 5) * 0.45}s linear ${(index % 9) * 0.28}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
