"use client";

import { useEffect, useRef, useState } from "react";

export function ArrowIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg
      className="brand-mark"
      width="32"
      height="36"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 4h37l11 13-12 15 3 4-29-10-10-5V4Zm0 25 44 15 4 4-11 12H8V29Z"
        fill="var(--ink)"
      />
      <path d="m8 20 10 6-10 6V20Z" fill="currentColor" />
    </svg>
  );
}

/** A single, bounded entrance for sections; content stays visible without JS. */
export function PageMotion() {
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const animations: Animation[] = [];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (!motion.matches) {
            animations.push(
              entry.target.animate(
                [
                  { opacity: 0, transform: "translateY(24px)" },
                  { opacity: 1, transform: "translateY(0)" },
                ],
                { duration: 650, easing: "cubic-bezier(.22,1,.36,1)" },
              ),
            );
          }
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12 },
    );
    document
      .querySelectorAll("[data-reveal]")
      .forEach((el) => observer.observe(el));
    const cancel = () => {
      if (motion.matches) animations.forEach((animation) => animation.cancel());
    };
    motion.addEventListener("change", cancel);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", cancel);
      animations.forEach((animation) => animation.cancel());
    };
  }, []);
  return null;
}

/** Original procedural artwork: orange halftone waves on a violet field. */
export function HalftoneArt() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsedRef = useRef(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let visible = true;
    let last = -Infinity;
    let elapsed = elapsedRef.current;
    let width = 0;
    let height = 0;

    const draw = (time: number) => {
      if (width <= 0 || height <= 0) return;
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#fc5000";
      context.beginPath();
      const gap = 8;
      const phase = time * 0.00016;
      for (let y = 0; y < height + gap; y += gap) {
        for (let x = 0; x < width + gap; x += gap) {
          const nx = x / width;
          const ny = y / height;
          const dx = (nx - 0.57) * 1.08;
          const dy = (ny - 0.43) * 0.87;
          const distance = Math.hypot(dx, dy);
          const angle = Math.atan2(dy, dx);
          const wave = Math.sin(
            distance * 20 - phase + Math.sin(angle * 2 + phase * 0.4) * 1.8,
          );
          const flood = Math.max(0, nx * 0.72 - ny * 0.75 + 0.18);
          const radius = Math.max(
            0.65,
            Math.min(6, (wave + 1) * 1.9 + flood * 6),
          );
          context.moveTo(x + radius, y);
          context.arc(x, y, radius, 0, Math.PI * 2);
        }
      }
      context.fill();
    };
    const tick = (time: number) => {
      if (time - last >= 1000 / 30) {
        elapsed += last === -Infinity ? 0 : Math.min(time - last, 60);
        elapsedRef.current = elapsed;
        draw(elapsed);
        last = time;
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      last = -Infinity;
      if (!paused && !reducedMotion.matches && visible && !document.hidden) {
        frame = requestAnimationFrame(tick);
      } else draw(elapsed);
    };
    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw(elapsed);
    });
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    resize.observe(canvas);
    visibility.observe(canvas);
    reducedMotion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      visibility.disconnect();
      reducedMotion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [paused]);

  return (
    <div className="hero-art">
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="art-topline">
        <span>Intent without boundaries</span>
        <BrandMark />
      </div>
      <div className="art-bottomline">
        <span>
          One intent.
          <br />
          Two chains.
        </span>
        <span className="art-orbit" aria-hidden="true">
          ↗
        </span>
      </div>
      <button
        className="motion-toggle"
        aria-label={
          paused ? "Play artwork animation" : "Pause artwork animation"
        }
        aria-pressed={paused}
        onClick={() => setPaused(!paused)}
      >
        {paused ? (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="m4 2 8 5-8 5Z" fill="currentColor" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M4 3v8M10 3v8" stroke="currentColor" strokeWidth="2" />
          </svg>
        )}
      </button>
    </div>
  );
}
