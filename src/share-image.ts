import type { Journey, TransitLeg } from "../convex/lib/journeys";
import {
  actualArrival,
  actualDeparture,
  formatDay,
  formatDuration,
  formatTime,
  formatTimeMs,
  isWalk,
  totalMinutes,
  transferRisk,
  transfers,
  vehicles,
} from "./format";
import { transfersText } from "./share-text";

const WIDTH = 420;
const SCALE = 2.5;
const PADDING = 20;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** The same colours as the chips in the app. */
const MODE_COLOURS: Record<string, [string, string]> = {
  R: ["#dfe5ee", "#1a2230"],
  S: ["#1e8a4f", "#ffffff"],
  U: ["#2360c4", "#ffffff"],
  T: ["#b5322a", "#ffffff"],
  B: ["#7a3f9d", "#ffffff"],
  F: ["#0d7a8a", "#ffffff"],
};

interface Palette {
  bg: string;
  surface: string;
  strong: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  late: string;
  warn: string;
}

function palette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(`--${name}`).trim();
  return {
    bg: token("bg"),
    surface: token("surface"),
    strong: token("surface-strong"),
    line: token("line"),
    text: token("text"),
    muted: token("muted"),
    accent: token("accent"),
    late: token("late"),
    warn: token("warn"),
  };
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= width || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Draws the card and returns its height. Run once to measure, then again to paint. */
function draw(
  ctx: CanvasRenderingContext2D,
  colours: Palette,
  from: string,
  to: string,
  journey: Journey,
  takenAt: number,
): number {
  const legs = vehicles(journey);
  const first = legs[0];
  const last = legs[legs.length - 1];
  const list = transfers(journey);
  const risk = transferRisk(journey);
  const inner = WIDTH - PADDING * 2;
  const font = (size: number, weight = 400) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
  };
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = colours.bg;
  ctx.fillRect(0, 0, WIDTH, 4000);

  let y = PADDING + 16;
  font(16, 700);
  ctx.fillStyle = colours.accent;
  ctx.fillText("Nahfahrt", PADDING, y);
  font(14);
  ctx.fillStyle = colours.muted;
  const day = formatDay(actualDeparture(first));
  ctx.fillText(day, WIDTH - PADDING - ctx.measureText(day).width, y);
  y += 16;

  const block = (text: string, size: number, weight: number, colour: string, width = inner) => {
    font(size, weight);
    ctx.fillStyle = colour;
    for (const line of wrap(ctx, text, width)) {
      y += size * 1.3;
      ctx.fillText(line, PADDING, y);
    }
  };

  block(`${from} → ${to}`, 20, 700, colours.text);
  y += 6;

  // Times at the top, in the colours of the results list.
  font(26, 700);
  y += 32;
  let x = PADDING;
  const big = (text: string, colour: string) => {
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
    x += ctx.measureText(text).width;
  };
  big(formatTime(actualDeparture(first)), first.x ? colours.late : colours.text);
  big(" – ", colours.muted);
  big(formatTime(actualArrival(last)), last.y ? colours.late : colours.text);

  block(`${formatDuration(totalMinutes(journey))} · ${transfersText(journey.u)}`, 15, 500, colours.muted);

  if (legs.some((leg) => leg.c)) block("Ein Teil fällt aus", 15, 600, colours.late);
  else if (risk === "broken") block("Anschluss nicht erreichbar", 15, 600, colours.late);
  else if (risk === "tight") block("Knapper Umstieg", 15, 600, colours.warn);

  y += 14;
  const cardTop = y;
  const cardHeightMarker = y;
  // The card is painted beneath its content, so its height comes from the measuring pass.
  const card = cardHeights.get(ctx.canvas);
  if (card) {
    ctx.fillStyle = colours.surface;
    ctx.beginPath();
    ctx.roundRect(PADDING - 6, cardTop, inner + 12, card, 14);
    ctx.fill();
  }

  y += 14;
  const left = PADDING + 8;
  const nameX = left + 74;

  const stop = (scheduled: number, delay: number | undefined, name: string, track?: string) => {
    const platform = track ? `Gl. ${track}` : "";
    font(14);
    const platformWidth = platform ? ctx.measureText(platform).width + 10 : 0;
    font(15, 500);
    const lines = wrap(ctx, name, WIDTH - PADDING - 6 - nameX - platformWidth);
    y += 21;
    const baseline = y;
    font(15, 700);
    ctx.fillStyle = delay ? colours.late : colours.text;
    const shown = formatTime(scheduled + (delay ?? 0));
    ctx.fillText(shown, left, baseline);
    if (delay) {
      font(12, 500);
      ctx.fillStyle = colours.muted;
      const old = formatTime(scheduled);
      const oldY = baseline + 14;
      ctx.fillText(old, left, oldY);
      const width = ctx.measureText(old).width;
      ctx.fillRect(left, oldY - 4, width, 1);
    }
    font(15, 500);
    ctx.fillStyle = colours.text;
    lines.forEach((line, index) => ctx.fillText(line, nameX, baseline + index * 20));
    if (platform) {
      font(14);
      ctx.fillStyle = colours.muted;
      ctx.fillText(platform, WIDTH - PADDING - 6 - ctx.measureText(platform).width, baseline);
    }
    y += (lines.length - 1) * 20 + (delay && lines.length === 1 ? 15 : 0);
  };

  const legBlock = (leg: TransitLeg) => {
    const [background, foreground] = MODE_COLOURS[leg.m] ?? [colours.strong, colours.text];
    font(14, 700);
    const label = leg.n || "Linie";
    const chip = ctx.measureText(label).width + 16;
    ctx.fillStyle = background;
    ctx.beginPath();
    ctx.roundRect(left, y + 2, chip, 24, 6);
    ctx.fill();
    ctx.fillStyle = foreground;
    ctx.fillText(label, left + 8, y + 19);
    if (leg.c) ctx.fillRect(left + 6, y + 13, chip - 12, 1.5);
    if (leg.h) {
      font(14);
      ctx.fillStyle = colours.muted;
      const [line] = wrap(ctx, `Richtung ${leg.h}`, WIDTH - PADDING - 6 - left - chip - 8);
      ctx.fillText(line, left + chip + 8, y + 19);
    }
    y += 28;
    if (leg.e || leg.c) {
      font(13, 600);
      ctx.fillStyle = leg.c ? colours.late : colours.muted;
      y += 16;
      ctx.fillText(leg.c ? "Fällt aus" : "Ersatzverkehr", left, y);
    }
    stop(leg.a, leg.x, leg.f, leg.g);
    stop(leg.b, leg.y, leg.t, leg.k);
    y += 12;
  };

  let vehicleIndex = -1;
  journey.l.forEach((leg, index) => {
    if (isWalk(leg)) {
      const next = journey.l[index + 1];
      const buffer = vehicleIndex >= 0 && next && !isWalk(next) ? list[vehicleIndex] : undefined;
      font(14);
      ctx.fillStyle = colours.muted;
      y += 14;
      ctx.fillText(
        `Zu Fuß ${leg.d} Min.${buffer ? ` · ${buffer.minutes} Min. Umstiegszeit` : ""}`,
        left,
        y,
      );
      y += 12;
      return;
    }
    vehicleIndex += 1;
    legBlock(leg);
  });

  const height = y - cardHeightMarker;
  cardHeights.set(ctx.canvas, height);

  y += 22;
  font(12);
  ctx.fillStyle = colours.muted;
  ctx.fillText(`Stand ${formatTimeMs(takenAt)} Uhr · Daten: Transitous · Nahfahrt`, PADDING, y);
  return y + PADDING - 4;
}

const cardHeights = new WeakMap<HTMLCanvasElement, number>();

/** A picture of the connection in the app's look, as a PNG data URL. */
export function renderShareImage(from: string, to: string, journey: Journey): string {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  const colours = palette();
  const takenAt = Date.now();

  canvas.width = WIDTH;
  canvas.height = 10;
  const height = draw(ctx, colours, from, to, journey, takenAt);

  canvas.width = Math.ceil(WIDTH * SCALE);
  canvas.height = Math.ceil(height * SCALE);
  ctx.scale(SCALE, SCALE);
  draw(ctx, colours, from, to, journey, takenAt);
  return canvas.toDataURL("image/png");
}
