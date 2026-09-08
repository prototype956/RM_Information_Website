import React, { useEffect, useRef } from "react";

export default function Robot({ motion = true, large = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const media = matchMedia(
      "(prefers-reduced-motion: reduce), (max-width: 767px)",
    );
    if (!motion || media.matches) return;
    let tween,
      context,
      loading = false,
      visible = false,
      alive = true;
    const sync = () => {
      if (document.hidden || !visible || media.matches) tween?.pause();
      else tween?.play();
    };
    const observer = new IntersectionObserver(async (entries) => {
      visible = entries[0].isIntersecting;
      sync();
      if (!visible || loading || media.matches) return;
      loading = true;
      try {
        const { gsap } = await import("gsap");
        if (!alive || media.matches) return;
        context = gsap.context(() => {
          tween = gsap.fromTo(
            ".robot-model",
            { scale: 1.05, transformOrigin: "50% 50%" },
            { scale: 1, duration: 10, ease: "none", paused: true },
          );
        }, ref);
        sync();
      } catch {}
    });
    const reduced = () => {
      if (media.matches) context?.revert();
    };
    observer.observe(ref.current);
    document.addEventListener("visibilitychange", sync);
    media.addEventListener("change", reduced);
    return () => {
      alive = false;
      observer.disconnect();
      context?.revert();
      document.removeEventListener("visibilitychange", sync);
      media.removeEventListener("change", reduced);
    };
  }, [motion]);
  return (
    <div
      className={`robot-art ${large ? "large" : ""}`}
      ref={ref}
      aria-hidden="true"
    >
      <svg viewBox="0 0 620 380" fill="none">
        <defs>
          <pattern
            id="grid"
            width="30"
            height="30"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M30 0H0V30"
              stroke="#a1a1aa"
              strokeOpacity=".08"
              strokeWidth=".5"
            />
          </pattern>
          <linearGradient
            id="panel"
            x1="220"
            y1="180"
            x2="440"
            y2="290"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#3f3f46" stopOpacity=".7" />
            <stop offset="1" stopColor="#18181b" stopOpacity=".9" />
          </linearGradient>
          <linearGradient id="barrel" x1="340" y1="100" x2="470" y2="65">
            <stop stopColor="#52525b" />
            <stop offset="1" stopColor="#27272a" />
          </linearGradient>
          <radialGradient id="aura">
            <stop stopColor="#ccff00" stopOpacity=".10" />
            <stop offset="1" stopColor="#ccff00" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="620" height="380" fill="url(#grid)" />
        <ellipse cx="328" cy="224" rx="245" ry="170" fill="url(#aura)" />
        <g stroke="#52525b" strokeWidth=".7" opacity=".5">
          <path d="M70 300 315 158 552 294 310 437Z" />
          <path d="M101 319 347 178 M133 337 379 196 M167 356 411 214 M201 374 443 232 M104 280 343 418 M138 261 375 399 M171 242 407 380 M202 225 441 361 M236 204 474 342" />
        </g>
        <g className="robot-model" strokeLinecap="round" strokeLinejoin="round">
          <ellipse
            cx="315"
            cy="297"
            rx="150"
            ry="31"
            fill="#080808"
            opacity=".5"
          />
          <g stroke="#a1a1aa" strokeWidth="1.2">
            <path d="M188 219 327 141 460 218 320 303Z" fill="url(#panel)" />
            <path d="M188 219v38l132 80v-34Z" fill="#18181b" />
            <path d="M320 303v34l140-82v-37Z" fill="#27272a" />
            <path d="M208 218 327 155 438 218 320 287Z" stroke="#71717a" />
            <path d="M255 204 312 173 363 202 309 234Z" fill="#3f3f46" />
            <path d="M255 204v16l54 32v-18 M309 252l54-33v-17" />
            <path d="M252 205v-65l58-33 54 31v65l-54 32Z" fill="#27272a" />
            <path d="m252 140 58 34 54-36 M310 174v61" />
            <path d="m264 139 46-26 41 25-41 26Z" fill="#52525b" />
            <path d="m271 143 37-21 29 17-36 22Z" fill="#3f3f46" />
            <path d="M285 125V94l32-18 31 18v36l-31 19Z" fill="#3f3f46" />
            <path d="m285 94 32 18 31-18 M317 112v37" />
            <path
              d="m317 115 107-62 14 8v19l-106 62-15-8Z"
              fill="url(#barrel)"
            />
            <path d="m317 115 15 9 106-63 M332 124v18 M411 62l15 9v18 M399 69l15 9v18" />
            <path d="m424 53 14 8v19l-14-8Z" fill="#111111" />
            <path d="m427 60 7 4v10l-7-4Z" stroke="#ccff00" />
            <path d="M256 194v-12l-30-17v30l30 17" fill="#52525b" />
            <path d="m227 166 10-5 29 16-10 5 M266 177v23l-10 12" />
            <path d="M349 209v-13l25-14 31 18v30l-31 18v-33Z" fill="#3f3f46" />
            <path d="m374 215 31-15 M374 215v33" />
            <path
              d="m271 266 26 15v18l-26-15Z"
              fill="#ccff00"
              fillOpacity=".55"
              stroke="#ccff00"
            />
            <path d="m354 280 48-29v20l-48 28Z" fill="#3f3f46" />
            <path d="m363 280 30-18 M363 286l30-18" stroke="#ccff00" />
          </g>
          {[
            { x: 203, y: 258 },
            { x: 276, y: 303 },
            { x: 376, y: 292 },
            { x: 440, y: 253 },
          ].map(({ x, y }, i) => (
            <g
              key={i}
              transform={`translate(${x} ${y}) rotate(${i < 2 ? -30 : 30})`}
              stroke="#a1a1aa"
              strokeWidth="1.3"
            >
              <rect
                x="-18"
                y="-27"
                width="33"
                height="58"
                rx="15"
                fill="#111111"
              />
              <ellipse cx="-2" cy="2" rx="14" ry="25" fill="#27272a" />
              <ellipse cx="-2" cy="2" rx="6" ry="12" stroke="#ccff00" />
              {[-16, -7, 3, 13].map((n) => (
                <path key={n} d={`M-12 ${n} 8 ${n + 7}`} stroke="#71717a" />
              ))}
            </g>
          ))}
          <g stroke="#ccff00" strokeWidth="1">
            <path d="M310 77V46 M306 46h8" />
            <path d="m354 146 81 2 35-25h44" opacity=".8" />
            <circle cx="354" cy="146" r="3" fill="#ccff00" />
            <path d="m238 233-89-7-34-25H70" opacity=".7" />
            <circle cx="238" cy="233" r="3" fill="#ccff00" />
          </g>
        </g>
        <g
          fontFamily="monospace"
          fontSize="8"
          letterSpacing="1.1"
          fill="#a1a1aa"
        >
          <text x="469" y="115">
            GIMBAL SYSTEM
          </text>
          <text x="51" y="193">
            OMNI CHASSIS
          </text>
          <text x="478" y="337">
            ISOMETRIC / 30°
          </text>
          <text x="62" y="337">
            DESIGN STUDY
          </text>
        </g>
        <g stroke="#71717a" strokeWidth="1">
          <path d="M44 58v-14h14 M576 58V44h-14 M44 322v14h14 M576 322v14h-14" />
          <path d="M537 270v26h25 M537 296l-13 8" />
          <path d="M527 296h10v-10" stroke="#ccff00" />
        </g>
      </svg>
      <div className="art-caption">
        <span className="live-dot" /> ENGINEERED TO LEARN
        <span>RM / KNOWLEDGE BASE</span>
      </div>
    </div>
  );
}
