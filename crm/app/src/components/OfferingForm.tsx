import { useState } from "preact/hooks";
import { saveProduct } from "../api/crm";
import type { Billing, VatRate } from "../api/types";
import { useAction } from "../hooks/useAsync";
import { BILLING_LABEL, BILLING_ORDER, CATEGORY_MAX_LENGTH, NAME_MAX_LENGTH, VAT_RATES, priceInput, validatedOffering } from "../lib/offering";
import type { OfferingDraft } from "../lib/offering";
import { ErrorNote, Field } from "./ui";

interface FieldsProps {
  draft: OfferingDraft;
  onChange: (next: OfferingDraft) => void;
}

function TextFields({ draft, onChange }: FieldsProps) {
  return (
    <div class="form-grid">
      <Field label="Name" wide><input class="input" maxLength={NAME_MAX_LENGTH} value={draft.name} onInput={(event) => { onChange({ ...draft, name: event.currentTarget.value }); }} /></Field>
      <Field label="Kategorie"><input class="input" maxLength={CATEGORY_MAX_LENGTH} value={draft.category} onInput={(event) => { onChange({ ...draft, category: event.currentTarget.value }); }} /></Field>
      <Field label="Kurzbeschreibung" wide><textarea class="textarea textarea--short" value={draft.description} onInput={(event) => { onChange({ ...draft, description: event.currentTarget.value }); }} /></Field>
      <Field label="Leistungsumfang" wide><textarea class="textarea" value={draft.scope} onInput={(event) => { onChange({ ...draft, scope: event.currentTarget.value }); }} /></Field>
    </div>
  );
}

function PriceFields({ draft, price, onChange, onPrice }: FieldsProps & { price: string; onPrice: (next: string) => void }) {
  return (
    <div class="form-grid">
      <Field label="Preisart">
        <select class="select" value={draft.billing} onChange={(event) => { onChange({ ...draft, billing: event.currentTarget.value as Billing }); }}>
          {BILLING_ORDER.map((billing) => <option key={billing} value={billing}>{BILLING_LABEL[billing]}</option>)}
        </select>
      </Field>
      <Field label="Preis netto in Euro"><input class="input num" inputMode="decimal" value={price} onInput={(event) => { onPrice(event.currentTarget.value); }} /></Field>
      <Field label="Umsatzsteuer">
        <select class="select" value={String(draft.vat_rate)} onChange={(event) => { onChange({ ...draft, vat_rate: Number(event.currentTarget.value) as VatRate }); }}>
          {VAT_RATES.map((rate) => <option key={rate} value={String(rate)}>{rate} %</option>)}
        </select>
      </Field>
      <Field label="Hinweis zur Mehrwertsteuer"><input class="input" value={draft.vat_note} onInput={(event) => { onChange({ ...draft, vat_note: event.currentTarget.value }); }} /></Field>
    </div>
  );
}

export function OfferingForm({ initial, onDone, onCancel }: { initial: OfferingDraft; onDone: () => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [price, setPrice] = useState(priceInput(initial.price_net));
  const action = useAction();
  const submit = (event: Event) => {
    event.preventDefault();
    void action.run(async () => { await saveProduct(validatedOffering(draft, price)); onDone(); });
  };
  return (
    <form class="panel stack" onSubmit={submit}>
      <h2>{initial.id === undefined ? "Neu im Angebot" : "Angebot bearbeiten"}</h2>
      <TextFields draft={draft} onChange={setDraft} />
      <PriceFields draft={draft} price={price} onChange={setDraft} onPrice={setPrice} />
      <label class="check"><input type="checkbox" checked={draft.active} onChange={(event) => { setDraft({ ...draft, active: event.currentTarget.checked }); }} /><span>Aktiv (in Auswahllisten für Angebote und Abos sichtbar)</span></label>
      <ErrorNote message={action.error} />
      <div class="cluster">
        <button class="button button--gold" type="submit" disabled={action.busy}>Speichern</button>
        <button class="button button--quiet" type="button" onClick={onCancel}>Abbrechen</button>
      </div>
    </form>
  );
}
