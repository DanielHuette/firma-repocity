import path from "node:path";

export function isInside(folder: string, candidate: string): boolean {
  const relative = path.relative(folder, candidate);
  return relative === "" || (relative.split(path.sep)[0] !== ".." && !path.isAbsolute(relative));
}
