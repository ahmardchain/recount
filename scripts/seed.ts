import { SHOP_CATALOG } from "../src/logic/catalog"
import { loadConfig } from "../server/config"
import { createShopDatabase, createShopPage } from "../server/notion"

const config = loadConfig()

if (!config.notionToken || !config.notionParentPageId) {
  console.error("Set NOTION_TOKEN and NOTION_PARENT_PAGE_ID. Share the parent page with the integration first.")
  process.exit(1)
}

const databaseId = await createShopDatabase(config.notionToken, config.notionParentPageId)
console.log(`Created Shop Inventory ${databaseId}`)

for (const item of SHOP_CATALOG) {
  await createShopPage(config.notionToken, databaseId, item)
  console.log(`  ${item.shelf}  ${item.name}  expected ${item.expected}`)
  await new Promise((resolve) => setTimeout(resolve, 350))
}

console.log("")
console.log("Add this to .env and set RECOUNT_MODE=live:")
console.log(`NOTION_DATABASE_ID=${databaseId}`)
