import { bridgeTarget, budgetFrom, deadlineFromProcessStart, parseObject, readInput, sendToBridge } from "./melden.mjs";

const GOLD = "\u001b[38;2;201;169;110m";
const RESET = "\u001b[0m";
const LAST_C0_CONTROL = 0x1f;
const FIRST_DELETE_OR_C1_CONTROL = 0x7f;
const LAST_C1_CONTROL = 0x9f;
const UNKNOWN_MODEL = "Modell unbekannt";
const NO_DATA = "keine Daten";

function isPrintable(character) {
  const code = character.codePointAt(0) ?? 0;
  return code > LAST_C0_CONTROL && (code < FIRST_DELETE_OR_C1_CONTROL || code > LAST_C1_CONTROL);
}

function modelName(data) {
  const name = data?.model?.display_name;
  if (typeof name !== "string") return UNKNOWN_MODEL;
  const clean = [...name].filter(isPrintable).join("");
  return clean === "" ? UNKNOWN_MODEL : clean;
}

function contextShown(data) {
  const used = data?.context_window?.used_percentage;
  return typeof used === "number" && Number.isFinite(used) && used >= 0 ? `${String(Math.round(used))} %` : NO_DATA;
}

export function statusLine(data) {
  return `${GOLD}${modelName(data)} · Kontext ${contextShown(data)}${RESET}`;
}

async function main() {
  const data = parseObject(await readInput());
  process.stdout.write(`${statusLine(data)}\n`);
  const target = bridgeTarget(process.env);
  if (target !== undefined && data !== undefined) await sendToBridge(target, "statuszeile", data, deadlineFromProcessStart(budgetFrom(process.argv.slice(2))));
}

if (import.meta.main) {
  await main();
}
