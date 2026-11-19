import type { Product } from "../api/types";
import { BILLING_LABEL, priceLabel, vatLabel } from "../lib/offering";
import { Badge } from "./ui";

export function OfferingView({ product, onEdit, onClose }: { product: Product; onEdit: () => void; onClose: () => void }) {
  return (
    <section class="panel stack">
      <div class="spread">
        <h2>{product.name}</h2>
        {product.active ? <Badge tone="good">Aktiv</Badge> : <Badge>Inaktiv</Badge>}
      </div>
      <dl class="contact-line">
        <dt>Kategorie</dt><dd>{product.category === "" ? "–" : product.category}</dd>
        <dt>Preisart</dt><dd>{BILLING_LABEL[product.billing]}</dd>
        <dt>Preis netto</dt><dd class="num">{priceLabel(product)}</dd>
        <dt>Mehrwertsteuer</dt><dd>{vatLabel(product)}</dd>
        <dt>Kurzbeschreibung</dt><dd>{product.description === "" ? "–" : product.description}</dd>
      </dl>
      {product.scope !== "" && <div class="stack stack--tight"><strong>Leistungsumfang</strong><p class="message">{product.scope}</p></div>}
      <div class="cluster">
        <button class="button button--gold" type="button" onClick={onEdit}>Bearbeiten</button>
        <button class="button button--quiet" type="button" onClick={onClose}>Schließen</button>
      </div>
    </section>
  );
}
