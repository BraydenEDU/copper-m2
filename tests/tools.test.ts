// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateCost,
  calculateCostInput,
  checkAvailability,
  checkAvailabilityInput,
  copperTools,
  getPrices,
  listProducts,
} from "@/lib/copper/assistant/tools";
import { readInventory } from "@/lib/copper/inventory";

vi.mock("@/lib/copper/inventory", () => ({ readInventory: vi.fn() }));

const row = (product: string, color: string, units: number) => ({
  sku: "X",
  product,
  color,
  units_in_stock: units,
  next_shipment: "2026-11-14",
});

beforeEach(() => {
  vi.mocked(readInventory).mockResolvedValue([
    row("Copper Home", "Night Sky", 185),
    row("Copper Home", "Patina Teal", 6),
    row("Copper Notes", "Night Sky", 0),
  ]);
});

describe("catalog tools", () => {
  it("get_products lists colors", () => {
    const notes = listProducts().products.find((p) => p.id === "copper-notes");
    expect(notes?.colors).toEqual([
      "Brushed Copper",
      "Desert Sand",
      "Night Sky",
    ]);
  });

  it("get_prices lists products and plans", () => {
    const prices = getPrices();
    expect(prices.products).toHaveLength(2);
    expect(prices.plans.map((p) => p.id)).toEqual(["free", "copper-plus"]);
  });

  it("copperTools has the four described tools", () => {
    expect(Object.keys(copperTools).sort()).toEqual([
      "calculate_cost",
      "check_availability",
      "get_prices",
      "get_products",
    ]);
    for (const t of Object.values(copperTools))
      expect(t.description).toBeTruthy();
  });
});

describe("calculate_cost", () => {
  it("totals Copper Home with Copper Plus yearly for 2 years at $307", () => {
    const result = calculateCost({
      products: ["copper-home"],
      plan: "copper-plus",
      billing: "annual",
      years: 2,
    });
    expect(result.totalUsd).toBe(307);
    expect(result.lines.reduce((s, l) => s + l.usd, 0)).toBe(307);
  });

  it("counts Copper Plus once for two devices", () => {
    const result = calculateCost({
      products: ["copper-home", "copper-notes"],
      plan: "copper-plus",
      billing: "monthly",
      years: 1,
    });
    expect(result.lines).toHaveLength(3);
  });

  it("adds no line for the free plan", () => {
    const result = calculateCost({
      products: ["copper-home"],
      plan: "free",
      billing: "annual",
      years: 3,
    });
    expect(result.lines).toHaveLength(1);
    expect(result.totalUsd).toBe(149);
  });

  it("rejects input outside the contract", () => {
    const ok = { products: [], plan: "free", billing: "annual", years: 1 };
    expect(calculateCostInput.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, products: ["copper-phone"] },
      { ...ok, plan: "gold" },
      { ...ok, years: 0 },
      { ...ok, years: 6 },
      { ...ok, years: 1.5 },
      { ...ok, products: Array(6).fill("copper-home") },
    ]) {
      expect(calculateCostInput.safeParse(bad).success).toBe(false);
    }
  });
});

describe("check_availability", () => {
  it("classifies stock levels and restock dates", async () => {
    const home = await checkAvailability({ product: "copper-home" });
    expect(home).toEqual({
      status: "ok",
      product: "Copper Home",
      colors: [
        { color: "Patina Teal", stock: "low_stock", restockDate: null },
        { color: "Night Sky", stock: "in_stock", restockDate: null },
      ],
    });
    const notes = await checkAvailability({
      product: "copper-notes",
      color: "night sky",
    });
    expect(notes).toMatchObject({
      colors: [
        { color: "Night Sky", stock: "backordered", restockDate: "2026-11-14" },
      ],
    });
  });

  it("says not_a_color even when stock can't be read", async () => {
    vi.mocked(readInventory).mockResolvedValue(null);
    const result = await checkAvailability({
      product: "copper-notes",
      color: "Patina Teal",
    });
    expect(result).toMatchObject({
      status: "not_a_color",
      colors: ["Brushed Copper", "Desert Sand", "Night Sky"],
    });
  });

  it("says unavailable, with no stock words, when stock is unreadable", async () => {
    vi.mocked(readInventory).mockResolvedValue(null);
    const json = JSON.stringify(
      await checkAvailability({ product: "copper-home" }),
    );
    expect(json).toContain("unavailable");
    expect(json).not.toMatch(/in_stock|low_stock|backordered/);
  });

  it("reads stock fresh each time", async () => {
    await checkAvailability({ product: "copper-home" });
    await checkAvailability({ product: "copper-home" });
    expect(readInventory).toHaveBeenCalledTimes(2);
  });

  it("only accepts Copper products", () => {
    expect(checkAvailabilityInput.safeParse({ product: "phone" }).success).toBe(
      false,
    );
  });
});
