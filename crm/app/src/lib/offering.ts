import type { Billing, LineItem, Product, VatRate } from "../api/types";
import { euro } from "./format";

export type OfferingDraft = Omit<Product, "id"> & { id?: string };

export const BILLING_ORDER: Billing[] = ["once", "monthly", "hourly", "piece"];
export const BILLING_LABEL: Record<Billing, string> = { once: "Einmalig", monthly: "Monatlich", hourly: "Je Stunde", piece: "Je Stück" };
export const BILLING_UNIT: Record<Billing, string> = { once: "Pauschal", monthly: "Monat", hourly: "Stunde", piece: "Stück" };
const BILLING_SUFFIX: Record<Billing, string> = { once: "einmalig", monthly: "/ Monat", hourly: "/ Stunde", piece: "/ Stück" };
export const VAT_RATES: VatRate[] = [19, 7, 0];

export const NAME_MAX_LENGTH = 200;
export const CATEGORY_MAX_LENGTH = 100;
const MAX_INTEGER_DIGITS = 10;
const UNCATEGORISED = "Ohne Kategorie";
const GERMAN_AMOUNT = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;
const PLAIN_AMOUNT = /^(\d+)\.(\d{1,2})$/;

export function parsePriceCents(input: string): number | null {
  const text = input.replace(/[\s€]/g, "");
  const match = GERMAN_AMOUNT.exec(text) ?? PLAIN_AMOUNT.exec(text);
  if (match === null) return null;
  const whole = (match[1] ?? "").replaceAll(".", "");
  if (whole.length > MAX_INTEGER_DIGITS) return null;
  return Number(whole) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export function centsToAmount(cents: number): number {
  return cents / 100;
}

export function priceInput(amount: number): string {
  const cents = Math.round(amount * 100);
  return `${String(Math.trunc(cents / 100))},${String(cents % 100).padStart(2, "0")}`;
}

export function priceLabel(product: Pick<Product, "price_net" | "billing">): string {
  return `${euro(product.price_net)} ${BILLING_SUFFIX[product.billing]}`;
}

export function vatLabel(product: Pick<Product, "vat_rate" | "vat_note">): string {
  const rate = `${String(product.vat_rate)} % USt.`;
  return product.vat_note === "" ? rate : `${rate} · ${product.vat_note}`;
}

export function itemNotes(item: Pick<LineItem, "billing" | "vat_note">): string[] {
  const billing = item.billing === undefined || item.billing === null ? "" : `Preisart: ${BILLING_LABEL[item.billing]}`;
  const vat = item.vat_note === undefined || item.vat_note === "" ? "" : `Mehrwertsteuer: ${item.vat_note}`;
  return [billing, vat].filter((note) => note !== "");
}

export function validatedOffering(draft: OfferingDraft, priceText: string): OfferingDraft {
  const name = draft.name.trim();
  const category = draft.category.trim();
  if (name === "") throw new Error("Der Name fehlt.");
  if (name.length > NAME_MAX_LENGTH) throw new Error(`Der Name darf höchstens ${String(NAME_MAX_LENGTH)} Zeichen lang sein.`);
  if (category.length > CATEGORY_MAX_LENGTH) throw new Error(`Die Kategorie darf höchstens ${String(CATEGORY_MAX_LENGTH)} Zeichen lang sein.`);
  const cents = parsePriceCents(priceText);
  if (cents === null) throw new Error("Der Preis ist kein gültiger Eurobetrag mit höchstens zwei Nachkommastellen.");
  return {
    ...draft, name, category, description: draft.description.trim(), scope: draft.scope.trim(), vat_note: draft.vat_note.trim(),
    unit: BILLING_UNIT[draft.billing], price_net: centsToAmount(cents),
  };
}

export function emptyOffering(): OfferingDraft {
  return { name: "", category: "", description: "", scope: "", unit: BILLING_UNIT.once, price_net: 0, vat_rate: 19, vat_note: "", billing: "once", active: true };
}

export interface CategoryGroup {
  label: string;
  products: Product[];
}

export function groupByCategory(products: Product[]): CategoryGroup[] {
  const groups = new Map<string, Product[]>();
  for (const product of products) {
    const label = product.category === "" ? UNCATEGORISED : product.category;
    groups.set(label, [...(groups.get(label) ?? []), product]);
  }
  return [...groups.entries()]
    .map(([label, members]) => ({ label, products: members }))
    .sort((a, b) => Number(a.label === UNCATEGORISED) - Number(b.label === UNCATEGORISED) || a.label.localeCompare(b.label, "de"));
}
