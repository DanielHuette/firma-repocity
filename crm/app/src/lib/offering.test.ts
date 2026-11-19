import { describe, expect, it } from "vitest";
import type { Product } from "../api/types";
import {
  CATEGORY_MAX_LENGTH, NAME_MAX_LENGTH, centsToAmount, emptyOffering, groupByCategory, itemNotes, parsePriceCents, priceInput, priceLabel, validatedOffering, vatLabel,
} from "./offering";

const plain = (text: string) => text.replaceAll(" ", " ");

function product(changes: Partial<Product>): Product {
  return { id: "p", name: "Leistung", category: "", description: "", scope: "", unit: "Pauschal", price_net: 100, vat_rate: 19, vat_note: "", billing: "once", active: true, ...changes };
}

describe("parsePriceCents", () => {
  it.each([
    ["1.500,00", 150000],
    ["1500", 150000],
    ["1.500", 150000],
    ["12.345.678,9", 1234567890],
    ["19,9", 1990],
    ["19.99", 1999],
    ["0", 0],
    ["0,05", 5],
    ["  80 € ", 8000],
    ["9999999999,99", 999999999999],
  ])("reads %s as %i cents", (input, cents) => {
    expect(parsePriceCents(input)).toBe(cents);
  });

  it.each([
    [""],
    ["abc"],
    ["-5"],
    ["1,234"],
    ["1234.567"],
    ["1.5.0"],
    ["10000000000"],
    ["1,2,3"],
  ])("refuses %s", (input) => {
    expect(parsePriceCents(input)).toBeNull();
  });
});

describe("priceInput", () => {
  it.each([[19.99, "19,99"], [1500, "1500,00"], [0, "0,00"], [0.5, "0,50"], [1234.1, "1234,10"]])("writes %d as %s", (amount, text) => {
    expect(priceInput(amount)).toBe(text);
  });

  it("round-trips through parsePriceCents", () => {
    for (const cents of [1, 99, 100, 1999, 123456789]) expect(parsePriceCents(priceInput(centsToAmount(cents)))).toBe(cents);
  });
});

describe("priceLabel", () => {
  it.each([
    ["once", "1.500,00 € einmalig"],
    ["monthly", "1.500,00 € / Monat"],
    ["hourly", "1.500,00 € / Stunde"],
    ["piece", "1.500,00 € / Stück"],
  ] as const)("shows %s", (billing, text) => {
    expect(plain(priceLabel({ price_net: 1500, billing }))).toBe(text);
  });
});

describe("vatLabel", () => {
  it("names the rate alone without a note", () => {
    expect(vatLabel({ vat_rate: 7, vat_note: "" })).toBe("7 % USt.");
  });

  it("appends the note", () => {
    expect(vatLabel({ vat_rate: 19, vat_note: "Kleinunternehmer bis Ende 2026" })).toBe("19 % USt. · Kleinunternehmer bis Ende 2026");
  });
});

describe("itemNotes", () => {
  it("names the price kind and the VAT note", () => {
    expect(itemNotes({ billing: "monthly", vat_note: "zzgl. 19 % USt." })).toEqual(["Preisart: Monatlich", "Mehrwertsteuer: zzgl. 19 % USt."]);
  });

  it("leaves out what is empty", () => {
    expect(itemNotes({ billing: "hourly", vat_note: "" })).toEqual(["Preisart: Je Stunde"]);
    expect(itemNotes({ billing: null, vat_note: "Hinweis" })).toEqual(["Mehrwertsteuer: Hinweis"]);
  });

  it("gives nothing for a free line or an invoice line", () => {
    expect(itemNotes({ billing: null, vat_note: "" })).toEqual([]);
    expect(itemNotes({})).toEqual([]);
  });
});

describe("validatedOffering", () => {
  const filled = { ...emptyOffering(), name: "  Webseite  ", category: " Webseiten ", description: " kurz ", scope: " fünf Seiten ", vat_note: " zzgl. USt. ", billing: "hourly" as const };

  it("trims the texts, derives the unit from the price kind and converts the price", () => {
    expect(validatedOffering(filled, "80,50")).toMatchObject({
      name: "Webseite", category: "Webseiten", description: "kurz", scope: "fünf Seiten", vat_note: "zzgl. USt.", unit: "Stunde", price_net: 80.5,
    });
  });

  it("keeps the id of an existing product", () => {
    expect(validatedOffering({ ...filled, id: "abc" }, "1").id).toBe("abc");
  });

  it("refuses an empty name", () => {
    expect(() => validatedOffering({ ...filled, name: "   " }, "1")).toThrow("Der Name fehlt.");
  });

  it("accepts a name of 200 characters and refuses 201", () => {
    expect(validatedOffering({ ...filled, name: "a".repeat(NAME_MAX_LENGTH) }, "1").name).toHaveLength(NAME_MAX_LENGTH);
    expect(() => validatedOffering({ ...filled, name: "a".repeat(NAME_MAX_LENGTH + 1) }, "1")).toThrow("höchstens 200");
  });

  it("accepts a category of 100 characters and refuses 101", () => {
    expect(validatedOffering({ ...filled, category: "a".repeat(CATEGORY_MAX_LENGTH) }, "1").category).toHaveLength(CATEGORY_MAX_LENGTH);
    expect(() => validatedOffering({ ...filled, category: "a".repeat(CATEGORY_MAX_LENGTH + 1) }, "1")).toThrow("höchstens 100");
  });

  it("refuses a price that is not an amount", () => {
    expect(() => validatedOffering(filled, "viel")).toThrow("Eurobetrag");
  });
});

describe("groupByCategory", () => {
  it("sorts the categories, puts the uncategorised last and keeps the order inside", () => {
    const groups = groupByCategory([
      product({ id: "1", name: "A", category: "Webseiten" }),
      product({ id: "2", name: "B", category: "" }),
      product({ id: "3", name: "C", category: "Audits" }),
      product({ id: "4", name: "D", category: "Webseiten" }),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["Audits", "Webseiten", "Ohne Kategorie"]);
    expect(groups[1]?.products.map((item) => item.id)).toEqual(["1", "4"]);
  });

  it("gives nothing for nothing", () => {
    expect(groupByCategory([])).toEqual([]);
  });
});
