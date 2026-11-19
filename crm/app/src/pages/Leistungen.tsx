import { useState } from "preact/hooks";
import { listProducts } from "../api/crm";
import type { Product } from "../api/types";
import { OfferingForm } from "../components/OfferingForm";
import { OfferingView } from "../components/OfferingView";
import { Badge, Empty, ErrorNote, Loading, PageHead } from "../components/ui";
import { useAsync } from "../hooks/useAsync";
import { emptyOffering, groupByCategory, priceLabel, vatLabel } from "../lib/offering";
import type { OfferingDraft } from "../lib/offering";

function OfferingTable({ products, onSelect }: { products: Product[]; onSelect: (product: Product) => void }) {
  return (
    <div class="table-wrap panel panel--flat">
      <table class="table table--rows">
        <thead><tr><th>Name</th><th class="num">Preis netto</th><th>Mehrwertsteuer</th><th>Status</th></tr></thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id}>
              <td data-label="Name"><button class="button button--quiet" type="button" onClick={() => { onSelect(product); }}>{product.name}</button><div class="small muted">{product.description}</div></td>
              <td data-label="Preis netto" class="num">{priceLabel(product)}</td>
              <td data-label="Mehrwertsteuer">{vatLabel(product)}</td>
              <td data-label="Status">{product.active ? <Badge tone="good">Aktiv</Badge> : <Badge>Inaktiv</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Catalogue({ products, onSelect }: { products: Product[]; onSelect: (product: Product) => void }) {
  return (
    <div class="stack stack--loose">
      {groupByCategory(products).map((group) => (
        <section key={group.label} class="stack stack--tight">
          <h2>{group.label}</h2>
          <OfferingTable products={group.products} onSelect={onSelect} />
        </section>
      ))}
    </div>
  );
}

export function Leistungen() {
  const products = useAsync(() => listProducts(true), []);
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [draft, setDraft] = useState<OfferingDraft | null>(null);
  const visible = (products.data ?? []).filter((product) => showInactive || product.active);
  const finish = () => { setDraft(null); setSelected(null); products.reload(); };
  return (
    <div class="stack stack--loose">
      <PageHead kicker="Angebot" title="Produkte und Dienstleistungen">
        {draft === null && <button class="button button--gold" type="button" onClick={() => { setSelected(null); setDraft(emptyOffering()); }}>+ Neu</button>}
      </PageHead>
      {draft !== null && <OfferingForm key={draft.id ?? "neu"} initial={draft} onDone={finish} onCancel={() => { setDraft(null); }} />}
      {draft === null && selected !== null && <OfferingView product={selected} onEdit={() => { setDraft(selected); }} onClose={() => { setSelected(null); }} />}
      <label class="check"><input type="checkbox" checked={showInactive} onChange={(event) => { setShowInactive(event.currentTarget.checked); }} /><span>Inaktive zeigen</span></label>
      <ErrorNote message={products.error} />
      {products.data === undefined ? <Loading /> : visible.length === 0 ? <Empty>Noch nichts im Angebot. Mit „+ Neu“ legst du das erste Produkt oder die erste Dienstleistung an.</Empty> : <Catalogue products={visible} onSelect={setSelected} />}
    </div>
  );
}
