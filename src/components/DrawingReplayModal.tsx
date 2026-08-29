"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { PencilDoodle } from "@/components/Doodles";
import type { DrawingEvent, DrawingPoint } from "@/types/game";

type DrawingReplayModalProps = {
  events: DrawingEvent[];
  word: string | null;
  onClose: () => void;
};

function clampPoint(point: DrawingPoint) {
  return {
    x: Math.min(Math.max(point.x, 0), 1),
    y: Math.min(Math.max(point.y, 0), 1),
  };
}

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((part) => part + part).join("") : clean;
  const value = Number.parseInt(full, 16);

  return {
    red: (value >> 16) & 255,
    green: (value >> 8) & 255,
    blue: value & 255,
  };
}

function colorToPixel(color: string): [number, number, number, number] {
  if (color.startsWith("#")) {
    const { red, green, blue } = hexToRgb(color);
    return [red, green, blue, 255];
  }

  const match = color.match(/rgba?\(([^)]+)\)/);

  if (!match) {
    return [24, 24, 27, 255];
  }

  const parts = match[1].split(",").map((part) => part.trim());
  const red = Number(parts[0]);
  const green = Number(parts[1]);
  const blue = Number(parts[2]);
  const alpha = parts[3] === undefined ? 1 : Number(parts[3]);

  return [red, green, blue, Math.round(alpha * 255)];
}

function colorsMatch(
  data: Uint8ClampedArray,
  index: number,
  target: [number, number, number, number],
) {
  const tolerance = 24;

  return (
    Math.abs(data[index] - target[0]) <= tolerance &&
    Math.abs(data[index + 1] - target[1]) <= tolerance &&
    Math.abs(data[index + 2] - target[2]) <= tolerance &&
    Math.abs(data[index + 3] - target[3]) <= tolerance
  );
}

function paintPixel(
  data: Uint8ClampedArray,
  index: number,
  replacement: [number, number, number, number],
) {
  const alpha = replacement[3] / 255;

  data[index] = Math.round(replacement[0] * alpha + data[index] * (1 - alpha));
  data[index + 1] = Math.round(replacement[1] * alpha + data[index + 1] * (1 - alpha));
  data[index + 2] = Math.round(replacement[2] * alpha + data[index + 2] * (1 - alpha));
  data[index + 3] = 255;
}

function floodFill(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  point: DrawingPoint,
  color: string,
) {
  const startX = Math.min(Math.max(Math.floor(point.x * canvas.width), 0), canvas.width - 1);
  const startY = Math.min(Math.max(Math.floor(point.y * canvas.height), 0), canvas.height - 1);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;
  const startIndex = (startY * width + startX) * 4;
  const target: [number, number, number, number] = [
    data[startIndex],
    data[startIndex + 1],
    data[startIndex + 2],
    data[startIndex + 3],
  ];
  const replacement = colorToPixel(color);

  if (colorsMatch(data, startIndex, replacement)) {
    return;
  }

  const visited = new Uint8Array(width * height);
  const stack = [startX, startY];

  while (stack.length > 0) {
    const y = stack.pop();
    const x = stack.pop();

    if (x === undefined || y === undefined || x < 0 || x >= width || y < 0 || y >= height) {
      continue;
    }

    const pixelIndex = y * width + x;
    const dataIndex = pixelIndex * 4;

    if (visited[pixelIndex] || !colorsMatch(data, dataIndex, target)) {
      continue;
    }

    visited[pixelIndex] = 1;
    paintPixel(data, dataIndex, replacement);
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }

  context.putImageData(imageData, 0, 0);
}

export function DrawingReplayModal({ events, word, onClose }: DrawingReplayModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const backgroundRef = useRef("#f8fafc");
  const historyRef = useRef<DrawingEvent[]>([]);
  const [isPlaying, setIsPlaying] = useState(true);

  const clearCanvas = useCallback((background = backgroundRef.current) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });

    if (!canvas || !context) {
      return;
    }

    backgroundRef.current = background;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const drawEvent = useCallback((event: DrawingEvent) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });

    if (!canvas || !context) {
      return;
    }

    if (event.type === "clear") {
      clearCanvas(event.background ?? backgroundRef.current);
      return;
    }

    if (event.type === "fill") {
      floodFill(canvas, context, clampPoint(event.point), event.color);
      return;
    }

    if (event.type === "undo") {
      return;
    }

    const point = clampPoint(event.point);
    const x = point.x * canvas.width;
    const y = point.y * canvas.height;

    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = event.color;
    context.lineWidth = event.size * (window.devicePixelRatio || 1);

    if (event.type === "stroke-start") {
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x, y);
      context.stroke();
      return;
    }

    if (event.type === "stroke-move") {
      context.lineTo(x, y);
      context.stroke();
      return;
    }

    context.closePath();
  }, [clearCanvas]);

  const removeLastReplayAction = useCallback((senderId: string) => {
    const nextEvents = [...historyRef.current];

    for (let index = nextEvents.length - 1; index >= 0; index -= 1) {
      const event = nextEvents[index];

      if (event.senderId !== senderId || event.type === "clear" || event.type === "undo") {
        continue;
      }

      if (event.type === "fill") {
        nextEvents.splice(index, 1);
        historyRef.current = nextEvents;
        return;
      }

      let startIndex = index;

      while (startIndex > 0 && nextEvents[startIndex].type !== "stroke-start") {
        startIndex -= 1;
      }

      nextEvents.splice(startIndex, index - startIndex + 1);
      historyRef.current = nextEvents;
      return;
    }
  }, []);

  const applyReplayEvent = useCallback((event: DrawingEvent) => {
    if (event.type === "undo") {
      removeLastReplayAction(event.senderId);
      clearCanvas();
      historyRef.current.forEach(drawEvent);
      return;
    }

    if (event.type === "clear") {
      historyRef.current = [event];
    } else {
      historyRef.current.push(event);
    }

    drawEvent(event);
  }, [clearCanvas, drawEvent, removeLastReplayAction]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;

    if (!canvas || !container) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = Math.max(Math.floor(rect.width * ratio), 1);
    canvas.height = Math.max(Math.floor(rect.height * ratio), 1);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    clearCanvas();
    historyRef.current.forEach(drawEvent);
  }, [clearCanvas, drawEvent]);

  const saveImage = useCallback(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const link = document.createElement("a");
    link.download = `roomdraw-${word ?? "replay"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [word]);

  useEffect(() => {
    resizeCanvas();

    const observer = new ResizeObserver(resizeCanvas);

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [resizeCanvas]);

  useEffect(() => {
    let timeoutId: number | undefined;
    let cancelled = false;
    const playbackEvents = events.filter(
      (event) =>
        event.type === "clear" ||
        event.type === "fill" ||
        event.type === "undo" ||
        event.type.startsWith("stroke"),
    );

    const play = async () => {
      setIsPlaying(true);
      historyRef.current = [];
      clearCanvas();

      for (let index = 0; index < playbackEvents.length; index += 1) {
        if (cancelled) {
          return;
        }

        applyReplayEvent(playbackEvents[index]);

        const current = playbackEvents[index];
        const next = playbackEvents[index + 1];
        const originalDelay = next ? Math.max(next.at - current.at, 0) : 0;
        const acceleratedDelay = Math.min(Math.max(originalDelay / 8, 8), 70);

        await new Promise<void>((resolve) => {
          timeoutId = window.setTimeout(resolve, acceleratedDelay);
        });
      }

      if (!cancelled) {
        setIsPlaying(false);
      }
    };

    void play();

    return () => {
      cancelled = true;

      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [applyReplayEvent, clearCanvas, events]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/70 px-4 py-6 backdrop-blur-sm">
      <section className="pop-card animate-pop-in w-full max-w-3xl overflow-hidden bg-white">
        <div className="flex items-center justify-between gap-3 border-b-4 border-ink bg-[linear-gradient(90deg,#ffe0ef_0%,#fff2c9_50%,#d8f2ff_100%)] px-4 py-3">
          <div className="flex items-center gap-3">
            <PencilDoodle className="w-14 -rotate-6" />
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-ink/50">
                &#127909; Replay
              </p>
              <h2 className="text-2xl font-bold text-ink">
                {word ? `The word was ${word}!` : "Round replay"}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="pop-btn inline-flex h-11 items-center justify-center gap-2 bg-mint px-4 text-sm font-bold text-ink"
              onClick={saveImage}
              type="button"
            >
              <Download aria-hidden className="h-5 w-5" />
              Save
            </button>
            <button
              aria-label="Close replay"
              className="pop-btn grid h-11 w-11 place-items-center bg-candy text-white"
              onClick={onClose}
              type="button"
            >
              <X aria-hidden className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="p-4">
          <div
            className="relative aspect-[4/3] min-h-[280px] overflow-hidden rounded-2xl border-4 border-ink bg-white"
            ref={containerRef}
          >
            <canvas className="absolute inset-0 h-full w-full" ref={canvasRef} />
            {isPlaying ? (
              <div className="absolute left-3 top-3 animate-bounce-soft rounded-full border-[3px] border-ink bg-sunny px-4 py-1.5 text-sm font-bold text-ink shadow-[0_3px_0_0_#2c2447]">
                &#9193; Fast replay
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
