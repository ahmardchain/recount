import { createRecountServer } from "./http"

const app = createRecountServer()
const { config } = app

if (config.mode === "live" && !config.notionLive) {
  console.error("RECOUNT_MODE=live needs NOTION_TOKEN and NOTION_DATABASE_ID")
  process.exit(1)
}

app.server.listen(config.port, "0.0.0.0", () => {
  console.log(`Recount API  http://127.0.0.1:${config.port}`)
  console.log(`Notion        ${config.notionLive ? "live" : "mock"}`)
  console.log(`Telegram      ${config.telegramLive ? "live" : "mock outbox"}`)
  console.log(`Count parser  ${config.llm ? `llm (${config.llmModel})` : "regex"}`)
})
