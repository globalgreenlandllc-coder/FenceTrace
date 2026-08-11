/**
 * Every provider in the registry must render as a card in the admin key
 * vault. The page draws its grid from an explicit CATEGORIES list, and
 * both parcel providers once sat in ALL_PROVIDERS but in no category —
 * counted by the badge, invisible in the grid, and the admin "couldn't
 * see where to add the key". The source of the page is checked as text
 * so this test never has to import a "use client" component tree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALL_PROVIDERS } from "./api-key-providers.ts";

const src = readFileSync(
  new URL("../components/admin/api-keys-page.tsx", import.meta.url),
  "utf8",
);

function block(marker: string): string {
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `page source is missing ${marker}`);
  const end = src.indexOf("\n];", start);
  assert.ok(end > start, `${marker} block has no terminator`);
  return src.slice(start, end);
}

test("every registered provider sits in exactly one CATEGORIES section", () => {
  const cats = block("const CATEGORIES");
  for (const p of ALL_PROVIDERS) {
    const hits = cats.split(`"${p}"`).length - 1;
    assert.equal(
      hits,
      1,
      `${p}: found ${hits} times in CATEGORIES — a provider outside the list renders no card at all`,
    );
  }
});

test("every registered provider has a PROVIDER_META label", () => {
  for (const p of ALL_PROVIDERS) {
    assert.ok(
      src.includes(`${p}: {`),
      `${p}: no PROVIDER_META entry — the card would render without a name`,
    );
  }
});
