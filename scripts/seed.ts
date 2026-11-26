import { loadConfig, liveNotionSource } from "../server/config"
import { applyEnvFile } from "../server/envfile"
import { createStockDatabase } from "../server/seed-shop"

applyEnvFile()
const config = loadConfig()
const source = liveNotionSource(config)

if (source === "missing") {
  console.error("Set NOTION_TOKEN and either NOTION_DATABASE_ID or NOTION_PARENT_PAGE_ID.")
  console.error("Share the parent page with the integration before creating a database.")
  process.exit(1)
}

if (source === "database") {
  console.log("NOTION_DATABASE_ID is already set. No new database was created.")
  console.log(`NOTION_DATABASE_ID=${config.notionDatabaseId}`)
  process.exit(0)
}

const databaseId = await createStockDatabase(config.notionToken, config.notionParentPageId)
console.log("")
console.log("Created Shop Inventory. Add this to .env before the next start so it is reused:")
console.log(`NOTION_DATABASE_ID=${databaseId}`)
