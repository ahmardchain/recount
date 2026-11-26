import { loadConfig, liveNotionSource } from "./config"
import { applyEnvFile } from "./envfile"
import { createRecountServer } from "./http"
import { createStockDatabase } from "./seed-shop"

applyEnvFile()

const preview = loadConfig()
if (preview.mode === "live") {
  const source = liveNotionSource(preview)
  if (source === "missing") {
    console.error("RECOUNT_MODE=live needs NOTION_TOKEN and either NOTION_DATABASE_ID or NOTION_PARENT_PAGE_ID")
    process.exit(1)
  }
  if (source === "parent") {
    console.log("NOTION_DATABASE_ID is unset. Creating Shop Inventory under NOTION_PARENT_PAGE_ID.")
    const databaseId = await createStockDatabase(preview.notionToken, preview.notionParentPageId)
    process.env.NOTION_DATABASE_ID = databaseId
    console.log(`NOTION_DATABASE_ID=${databaseId}`)
  }
}

const app = createRecountServer()
const { config } = app

app.server.listen(config.port, "0.0.0.0", () => {
  console.log(`Recount API  http://127.0.0.1:${config.port}`)
  console.log(`Notion        ${config.notionLive ? "live" : "mock"}`)
  console.log(`Telegram      ${config.telegramLive ? "live (one alert per process)" : "mock outbox"}`)
  console.log(`Count parser  ${config.llm ? `llm (${config.llmModel})` : "regex"}`)
})
