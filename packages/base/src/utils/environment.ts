/** Detects whether the code is running in a Node.js-like environment (works in browsers too, avoids reference errors). */
export function isNodeLike(): boolean {
  const g = globalThis as { process?: { versions?: { node?: string } } };
  return typeof g.process !== "undefined" &&
    typeof g.process?.versions !== "undefined" &&
    typeof g.process?.versions?.node !== "undefined";
}
