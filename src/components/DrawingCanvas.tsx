"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Brush,
  Eraser,
  Maximize2,
  Minimize2,
  PaintBucket,
  Trash2,
  Undo2,
} from "lucide-react";
import type { DrawingEvent, DrawingPoint } from "@/types/game";

const COLORS = [
  "#18181b",
  "#ffffff",
  "#ef4444",
  "#f97316",
  "#facc15",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#38bdf8",
  "#2563eb",
  "#7c3aed",
  "#d946ef",
  "#f472b6",
  "#a16207",
  "#94a3b8",
  "#64748b",
];

const CANVAS_BACKGROUND = "#ffffff";

type DrawingCanvasProps = {
  canDraw: boolean;
  clientId: string;
  incomingEvents: DrawingEvent[];
  onDrawingEvent: (event: DrawingEvent) => void;
};

type DrawingEventDraft =
  | {
      type: "stroke-start" | "stroke-move" | "stroke-end";
      point: DrawingPoint;
      color: string;
      size: number;
    }
  | {
      type: "fill";
      point: DrawingPoint;
      color: string;
      size: number;
    }
  | {
      type: "clear";
      background?: string;
    };

type DrawingTool = "brush" | "eraser" | "fill";

const DRAWING_TOOLS = [
  { id: "brush", label: "Brush", icon: Brush },
  { id: "eraser", label: "Eraser", icon: Eraser },
  { id: "fill", label: "Fill", icon: PaintBucket },
] satisfies { id: DrawingTool; label: string; icon: typeof Brush }[];

function clampPoint(point: DrawingPoint) {
  return {
    x: Math.min(Math.max(point.x, 0), 1),
    y: Math.min(Math.max(point.y, 0), 1),
  };
}

function newEventId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function removeLastAction(events: DrawingEvent[], senderId: string) {
  const nextEvents = [...events];

  for (let index = nextEvents.length - 1; index >= 0; index -= 1) {
    const event = nextEvents[index];

    if (event.senderId !== senderId || event.type === "clear" || event.type === "undo") {
      continue;
    }

    if (event.type === "fill") {
      nextEvents.splice(index, 1);
      return nextEvents;
    }

    let startIndex = index;

    while (startIndex > 0 && nextEvents[startIndex].type !== "stroke-start") {
      startIndex -= 1;
    }

    if (nextEvents[startIndex]?.senderId === senderId) {
      nextEvents.splice(startIndex, index - startIndex + 1);
    }

    return nextEvents;
  }

  return nextEvents;
}

export function DrawingCanvas({
  canDraw,
  clientId,
  incomingEvents,
  onDrawingEvent,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<DrawingEvent[]>([]);
  const backgroundRef = useRef(CANVAS_BACKGROUND);
  const isDrawingRef = useRef(false);
  const lastMoveRef = useRef<{ at: number; point: DrawingPoint } | null>(null);
  const processedIncomingIdsRef = useRef<Set<string>>(new Set());
  const [color, setColor] = useState(COLORS[0]);
  const [background, setBackground] = useState(CANVAS_BACKGROUND);
  const [tool, setTool] = useState<DrawingTool>("brush");
  const [size, setSize] = useState(8);
  const [hasUndo, setHasUndo] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const getCanvasContext = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });

    if (!canvas || !context) {
      return null;
    }

    return { canvas, context };
  }, []);

  const syncUndoState = useCallback(() => {
    setHasUndo(
      historyRef.current.some(
        (event) => event.senderId === clientId && event.type !== "clear" && event.type !== "undo",
      ),
    );
  }, [clientId]);

  const paintBackground = useCallback(
    (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, swatch = backgroundRef.current) => {
      context.save();
      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = swatch;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.restore();
    },
    [],
  );

  const renderEvent = useCallback(
    (event: DrawingEvent) => {
      const target = getCanvasContext();

      if (!target) {
        return;
      }

      const { canvas, context } = target;

      if (event.type === "clear") {
        const nextBackground = event.background ?? backgroundRef.current;
        backgroundRef.current = nextBackground;
        setBackground(nextBackground);
        paintBackground(context, canvas, nextBackground);
        return;
      }

      if (event.type === "fill") {
        if (event.point) {
          floodFill(canvas, context, clampPoint(event.point), event.color);
        } else {
          context.fillStyle = event.color;
          context.fillRect(0, 0, canvas.width, canvas.height);
        }

        return;
      }

      if (event.type === "undo") {
        return;
      }

      const point = clampPoint(event.point);
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;

      context.save();
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = event.color;
      context.lineWidth = event.size * (window.devicePixelRatio || 1);

      if (event.type === "stroke-start") {
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x, y);
        context.stroke();
        context.restore();
        return;
      }

      if (event.type === "stroke-move") {
        context.lineTo(x, y);
        context.stroke();
        context.restore();
        return;
      }

      context.closePath();
      context.restore();
    },
    [getCanvasContext, paintBackground],
  );

  const redrawHistory = useCallback(
    (previewEvents: DrawingEvent[] = []) => {
      const target = getCanvasContext();

      if (!target) {
        return;
      }

      paintBackground(target.context, target.canvas);
      historyRef.current.forEach(renderEvent);
      previewEvents.forEach(renderEvent);
    },
    [getCanvasContext, paintBackground, renderEvent],
  );

  const recordAndRender = useCallback(
    (event: DrawingEvent) => {
      if (event.type === "undo") {
        historyRef.current = removeLastAction(historyRef.current, event.senderId);
        redrawHistory();
        syncUndoState();
        return;
      }

      if (event.type === "clear") {
        historyRef.current = [event];
      } else {
        historyRef.current.push(event);
      }

      renderEvent(event);
      syncUndoState();
    },
    [redrawHistory, renderEvent, syncUndoState],
  );

  const createEvent = useCallback(
    (event: DrawingEventDraft) =>
      ({
        ...event,
        id: newEventId(),
        senderId: clientId,
        at: Date.now(),
      }) as DrawingEvent,
    [clientId],
  );

  const publishEvent = useCallback(
    (event: DrawingEvent) => {
      recordAndRender(event);
      onDrawingEvent(event);
    },
    [onDrawingEvent, recordAndRender],
  );

  const emit = useCallback(
    (event: DrawingEventDraft) => {
      publishEvent(createEvent(event));
    },
    [createEvent, publishEvent],
  );

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
    redrawHistory();
  }, [redrawHistory]);

  useEffect(() => {
    resizeCanvas();

    const observer = new ResizeObserver(resizeCanvas);

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [resizeCanvas]);

  useEffect(() => {
    resizeCanvas();
  }, [isFullscreen, resizeCanvas]);

  useEffect(() => {
    for (const event of incomingEvents) {
      if (event.senderId === clientId || processedIncomingIdsRef.current.has(event.id)) {
        continue;
      }

      processedIncomingIdsRef.current.add(event.id);
      recordAndRender(event);
    }

    if (processedIncomingIdsRef.current.size > 1_000) {
      processedIncomingIdsRef.current = new Set(incomingEvents.map((event) => event.id));
    }
  }, [clientId, incomingEvents, recordAndRender]);

  const pointFromPointer = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return { x: 0, y: 0 };
    }

    const rect = canvas.getBoundingClientRect();
    return clampPoint({
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    });
  }, []);

  const activeColor = tool === "eraser" ? backgroundRef.current : color;

  const startDrawing = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!canDraw) {
        return;
      }

      const point = pointFromPointer(event);

      if (tool === "fill") {
        emit({ type: "fill", point, color: activeColor, size });
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      isDrawingRef.current = true;
      lastMoveRef.current = { at: Date.now(), point };

      emit({
        type: "stroke-start",
        point,
        color: activeColor,
        size,
      });
    },
    [activeColor, canDraw, emit, pointFromPointer, size, tool],
  );

  const moveDrawing = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!canDraw || !isDrawingRef.current) {
        return;
      }

      const point = pointFromPointer(event);
      const now = Date.now();
      const lastMove = lastMoveRef.current;
      const distance = lastMove
        ? Math.hypot(point.x - lastMove.point.x, point.y - lastMove.point.y)
        : Number.POSITIVE_INFINITY;

      if (lastMove && now - lastMove.at < 16 && distance < 0.006) {
        return;
      }

      lastMoveRef.current = { at: now, point };
      emit({
        type: "stroke-move",
        point,
        color: activeColor,
        size,
      });
    },
    [activeColor, canDraw, emit, pointFromPointer, size],
  );

  const endDrawing = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!canDraw || !isDrawingRef.current) {
        return;
      }

      const point = pointFromPointer(event);
      isDrawingRef.current = false;
      lastMoveRef.current = null;

      emit({
        type: "stroke-end",
        point,
        color: activeColor,
        size,
      });
    },
    [activeColor, canDraw, emit, pointFromPointer, size],
  );

  const clear = useCallback(() => {
    emit({ type: "clear", background: backgroundRef.current });
  }, [emit]);

  const replayCurrentCanvas = useCallback(
    (events: DrawingEvent[], nextBackground = backgroundRef.current) => {
      const resetEvent = createEvent({ type: "clear", background: nextBackground });
      const replayEvents = events
        .filter((event) => event.type !== "clear" && event.type !== "undo")
        .map(
          (event) =>
            ({
              ...event,
              id: newEventId(),
              senderId: clientId,
              at: Date.now(),
            }) as DrawingEvent,
        );

      historyRef.current = [];
      publishEvent(resetEvent);
      replayEvents.forEach(publishEvent);
    },
    [clientId, createEvent, publishEvent],
  );

  const undo = useCallback(() => {
    const nextEvents = removeLastAction(historyRef.current, clientId);

    if (nextEvents.length === historyRef.current.length) {
      return;
    }

    replayCurrentCanvas(nextEvents);
  }, [clientId, replayCurrentCanvas]);

  const canvasCursor = tool === "fill" ? "cursor-crosshair" : "cursor-default";

  return (
    <section
      className={`pop-card flex min-h-0 flex-col overflow-hidden bg-white ${
        isFullscreen ? "fixed inset-0 z-40 rounded-none border-0 p-2 sm:p-4" : ""
      }`}
    >
      {canDraw ? (
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b-4 border-ink bg-[linear-gradient(90deg,#fff2c9_0%,#ffe0ef_50%,#d8f2ff_100%)] px-3 py-3">
        <div className="flex items-center gap-2 text-lg font-bold text-ink">
          <Brush aria-hidden className="h-6 w-6 animate-wiggle text-candy" />
          My canvas
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="pop-card flex flex-wrap items-center gap-1 rounded-full bg-white px-2 py-1">
            {DRAWING_TOOLS.map((item) => {
              const Icon = item.icon;

              return (
                <button
                  aria-label={item.label}
                  className={`grid h-10 w-10 place-items-center rounded-full border-[3px] transition sm:h-9 sm:w-9 ${
                    tool === item.id
                      ? "-translate-y-0.5 border-ink bg-sunny text-ink shadow-[0_3px_0_0_#2c2447]"
                      : "border-transparent bg-transparent text-ink/60 hover:bg-ink/5"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                  disabled={!canDraw}
                  key={item.id}
                  onClick={() => setTool(item.id)}
                  title={item.label}
                  type="button"
                >
                  <Icon aria-hidden className="h-5 w-5" />
                </button>
              );
            })}
          </div>

          <div className="pop-card flex max-w-[260px] flex-wrap items-center justify-center gap-1.5 rounded-full bg-white px-3 py-2">
            {COLORS.map((swatch) => (
              <button
                aria-label={`Use ${swatch}`}
                className={`h-8 w-8 rounded-full border-[3px] border-ink transition hover:-translate-y-1 hover:rotate-6 disabled:cursor-not-allowed disabled:opacity-40 sm:h-7 sm:w-7 ${
                  color === swatch ? "-translate-y-1 scale-110 ring-4 ring-sunny" : ""
                }`}
                disabled={!canDraw}
                key={swatch}
                onClick={() => setColor(swatch)}
                style={{ backgroundColor: swatch }}
                type="button"
              />
            ))}
          </div>

          <label className="pop-card flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-ink">
            <span aria-hidden className="text-base">&#128207;</span>
            Size
            <input
              aria-label="Brush size"
              className="h-9 w-28 accent-candy"
              disabled={!canDraw}
              max={32}
              min={2}
              onChange={(event) => setSize(Number(event.target.value))}
              type="range"
              value={size}
            />
            <span
              aria-hidden
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-ink bg-white"
            >
              <span
                className="block rounded-full"
                style={{
                  backgroundColor: tool === "eraser" ? "#e5e7eb" : color,
                  height: Math.max(3, Math.min(size / 2, 18)),
                  width: Math.max(3, Math.min(size / 2, 18)),
                }}
              />
            </span>
          </label>

          <button
            aria-label="Undo"
            className="pop-btn grid h-11 w-11 place-items-center bg-sky text-ink disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canDraw || !hasUndo}
            onClick={undo}
            title="Undo"
            type="button"
          >
            <Undo2 aria-hidden className="h-5 w-5" />
          </button>
          <button
            aria-label={isFullscreen ? "Exit fullscreen canvas" : "Fullscreen canvas"}
            className="pop-btn grid h-11 w-11 place-items-center bg-grape text-white"
            onClick={() => setIsFullscreen((value) => !value)}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            type="button"
          >
            {isFullscreen ? (
              <Minimize2 aria-hidden className="h-5 w-5" />
            ) : (
              <Maximize2 aria-hidden className="h-5 w-5" />
            )}
          </button>
          <button
            aria-label="Clear canvas"
            className="pop-btn grid h-11 w-11 place-items-center bg-candy text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canDraw}
            onClick={clear}
            title="Clear canvas"
            type="button"
          >
            <Trash2 aria-hidden className="h-5 w-5" />
          </button>
        </div>
      </div>
      ) : null}

      <div
        className={`relative flex-1 touch-none ${
          isFullscreen ? "min-h-0" : "min-h-[420px] sm:min-h-[360px]"
        }`}
        ref={containerRef}
        style={{ backgroundColor: background }}
      >
        <canvas
          aria-label={canDraw ? "Drawing canvas" : "Shared drawing canvas"}
          className={`absolute inset-0 h-full w-full touch-none ${canvasCursor}`}
          onPointerCancel={endDrawing}
          onPointerDown={startDrawing}
          onPointerLeave={endDrawing}
          onPointerMove={moveDrawing}
          onPointerUp={endDrawing}
          ref={canvasRef}
        />
        {canDraw ? null : (
          <button
            aria-label={isFullscreen ? "Exit fullscreen canvas" : "Fullscreen canvas"}
            className="pop-btn absolute right-3 top-3 grid h-10 w-10 place-items-center bg-white/90 text-ink"
            onClick={() => setIsFullscreen((value) => !value)}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            type="button"
          >
            {isFullscreen ? (
              <Minimize2 aria-hidden className="h-5 w-5" />
            ) : (
              <Maximize2 aria-hidden className="h-5 w-5" />
            )}
          </button>
        )}
      </div>
    </section>
  );
}
