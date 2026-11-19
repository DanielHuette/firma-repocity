import { useEffect, useState } from "preact/hooks";
import { bisVolleMinute } from "./menuepunkte";

export function useJetzt(takt: number): number {
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    const zeitgeber = setInterval(() => { setJetzt(Date.now()); }, takt);
    return () => { clearInterval(zeitgeber); };
  }, [takt]);
  return jetzt;
}

export function useMinute(): number {
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    const zeitgeber = setTimeout(() => { setJetzt(Date.now()); }, bisVolleMinute(jetzt));
    return () => { clearTimeout(zeitgeber); };
  }, [jetzt]);
  return jetzt;
}
