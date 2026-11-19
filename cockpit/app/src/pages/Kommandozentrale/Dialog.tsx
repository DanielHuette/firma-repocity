import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

export interface DialogProps {
  readonly titelId: string;
  readonly klasse?: string;
  readonly onAbbrechen: (() => void) | null;
  readonly danebenSchliesst?: boolean;
  readonly children: ComponentChildren;
}

type Rahmen = Pick<DOMRect, "left" | "top" | "right" | "bottom">;

export function ausserhalb(rahmen: Rahmen, x: number, y: number): boolean {
  return x < rahmen.left || x > rahmen.right || y < rahmen.top || y > rahmen.bottom;
}

function amRand(dialog: HTMLDialogElement, ereignis: MouseEvent): boolean {
  return ereignis.target === dialog && ausserhalb(dialog.getBoundingClientRect(), ereignis.clientX, ereignis.clientY);
}

export function Dialog({ titelId, klasse = "", onAbbrechen, danebenSchliesst = false, children }: DialogProps) {
  const ort = useRef<HTMLDialogElement>(null);
  const begonnenDaneben = useRef(false);
  useEffect(() => {
    const dialog = ort.current;
    if (dialog === null) return;
    const ausloeser = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      ausloeser?.focus();
    };
  }, []);
  const abbrechen = (ereignis: Event) => {
    ereignis.preventDefault();
    onAbbrechen?.();
  };
  const gedrueckt = (ereignis: MouseEvent) => {
    begonnenDaneben.current = ort.current !== null && amRand(ort.current, ereignis);
  };
  const geklickt = (ereignis: MouseEvent) => {
    if (danebenSchliesst && begonnenDaneben.current && ort.current !== null && amRand(ort.current, ereignis)) onAbbrechen?.();
  };
  return (
    <dialog ref={ort} class={`kz-dialog ${klasse}`} aria-labelledby={titelId} aria-modal="true" onCancel={abbrechen} onMouseDown={gedrueckt} onClick={geklickt}>
      {children}
    </dialog>
  );
}
