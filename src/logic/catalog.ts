import type { StockItem } from "./types"

const pending = {
  actual: null,
  damaged: null,
  variance: null,
  status: "Pending" as const,
  countedAt: null,
  counter: null,
}

export const LOCATIONS = ["Aisle B", "Counter", "Cold room"] as const

export const SHOP_CATALOG: StockItem[] = [
  { id: "b3", location: "Aisle B", shelf: "B3", name: "Coke 50cl", expected: 24, ...pending },
  { id: "b4", location: "Aisle B", shelf: "B4", name: "Water 75cl", expected: 40, ...pending },
  { id: "b5", location: "Aisle B", shelf: "B5", name: "Milk 1L", expected: 12, ...pending },
  { id: "b6", location: "Aisle B", shelf: "B6", name: "Oats 500g", expected: 18, ...pending },
  { id: "c1", location: "Counter", shelf: "C1", name: "Espresso cups", expected: 36, ...pending },
  { id: "c2", location: "Counter", shelf: "C2", name: "Paper lids", expected: 50, ...pending },
  { id: "c3", location: "Counter", shelf: "C3", name: "Sugar sticks", expected: 80, ...pending },
  { id: "c4", location: "Counter", shelf: "C4", name: "Napkins", expected: 40, ...pending },
  { id: "f1", location: "Cold room", shelf: "F1", name: "Butter 250g", expected: 16, ...pending },
  { id: "f2", location: "Cold room", shelf: "F2", name: "Yogurt 150g", expected: 20, ...pending },
  { id: "f3", location: "Cold room", shelf: "F3", name: "Eggs 12pk", expected: 8, ...pending },
  { id: "f4", location: "Cold room", shelf: "F4", name: "Cheese 200g", expected: 10, ...pending },
]

export function cloneCatalog(): StockItem[] {
  return SHOP_CATALOG.map((item) => ({ ...item }))
}
