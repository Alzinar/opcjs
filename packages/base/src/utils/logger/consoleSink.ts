
import { LogRecord } from "./logRecord";
import { ISink } from "./iSink";
import { LevelName } from "./levelName";
import { isNodeLike } from "../environment.js";

export function supportsAnsiColors(): boolean {
  // Basic heuristic for Node TTY
  const g = globalThis as { process?: { stdout?: { isTTY?: boolean } } };
  return isNodeLike() && !!(g.process?.stdout?.isTTY);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatTime(d: Date): string {
  // ISO-like but shorter
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function levelColor(level: LevelName): { ansi: string; css: string } {
  // A small palette. Extend as desired.
  switch (level) {
    case "TRACE":
      return { ansi: "\x1b[90m", css: "color: #9aa0a6" }; // gray
    case "DEBUG":
      return { ansi: "\x1b[36m", css: "color: #00acc1" }; // cyan
    case "INFO":
      return { ansi: "\x1b[32m", css: "color: #34a853" }; // green
    case "WARN":
      return { ansi: "\x1b[33m", css: "color: #fbbc05" }; // yellow
    case "ERROR":
      return { ansi: "\x1b[31m", css: "color: #ea4335" }; // red
    case "FATAL":
      return { ansi: "\x1b[41m\x1b[97m", css: "color: white; background: #d93025" }; // red bg + white
    default:
      return { ansi: "", css: "" };
  }
}

export function ansiReset(): string {
  return "\x1b[0m";
}

export class ConsoleSink implements ISink {
  constructor(private opts: { includeTimestamp: boolean; } = { includeTimestamp: true }) { }

  log(record: LogRecord): void {
    const { level, category, message, args, time } = record;
    const timePart = this.opts.includeTimestamp ? `${formatTime(time)} ` : "";
    const base = `${timePart}[${level}] [${category}] ${message}`;

    const color = levelColor(level);

    if (isNodeLike()) {
      if (supportsAnsiColors() && color.ansi) {
        // Color just the prefix, keep args normal
        consoleMethod(level)(`${color.ansi}${base}${ansiReset()}`, ...args);
      } else {
        consoleMethod(level)(base, ...args);
      }
    } else {
      // Browser: CSS styling works with %c
      if (color.css) {
        consoleMethod(level)(`%c${base}`, color.css, ...args);
      } else {
        consoleMethod(level)(base, ...args);
      }
    }
  }
}
function consoleMethod(level: LevelName): (...data: unknown[]) => void {
  switch (level) {
    case "TRACE":
      return console.debug?.bind(console) ?? console.log.bind(console);
    case "DEBUG":
      return console.debug?.bind(console) ?? console.log.bind(console);
    case "INFO":
      return console.info?.bind(console) ?? console.log.bind(console);
    case "WARN":
      return console.warn.bind(console);
    case "ERROR":
    case "FATAL":
      return console.error.bind(console);
    default:
      return console.log.bind(console);
  }
}
