import { SHOP_CATALOG } from "../src/logic/catalog"
import { createShopDatabase, createShopPage } from "./notion"

export async function createStockDatabase(token: string, parentPageId: string): Promise<string> {
  const databaseId = await createShopDatabase(token, parentPageId)
  for (const item of SHOP_CATALOG) {
    await createShopPage(token, databaseId, item)
    console.log(`  ${item.shelf}  ${item.name}  expected ${item.expected}`)
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  return databaseId
}
