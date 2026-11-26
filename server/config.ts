export interface RecountConfig {
  port: number
  mode: "mock" | "live"
  notionLive: boolean
  telegramLive: boolean
  llm: boolean
  stt: boolean
  notionToken: string
  notionDatabaseId: string
  notionParentPageId: string
  telegramToken: string
  telegramChatId: string
  llmApiKey: string
  llmBaseUrl: string
  llmModel: string
  llmSttModel: string
  persist: boolean
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { persist?: boolean } = {},
): RecountConfig {
  const notionToken = env.NOTION_TOKEN?.trim() ?? ""
  const notionDatabaseId = env.NOTION_DATABASE_ID?.trim() ?? ""
  const telegramToken = env.TELEGRAM_BOT_TOKEN?.trim() ?? ""
  const telegramChatId = env.TELEGRAM_CHAT_ID?.trim() ?? ""
  const llmApiKey = env.LLM_API_KEY?.trim() ?? ""
  const requested = env.RECOUNT_MODE === "live" ? "live" : "mock"
  const notionReady = Boolean(notionToken && notionDatabaseId)
  const telegramReady = Boolean(telegramToken && telegramChatId)
  const liveRequested = requested === "live"
  return {
    port: Number(env.PORT || 4187),
    mode: liveRequested ? "live" : "mock",
    notionLive: liveRequested && notionReady,
    telegramLive: liveRequested && telegramReady,
    llm: liveRequested && Boolean(llmApiKey),
    stt: liveRequested && Boolean(llmApiKey),
    notionToken,
    notionDatabaseId,
    notionParentPageId: env.NOTION_PARENT_PAGE_ID?.trim() ?? "",
    telegramToken,
    telegramChatId,
    llmApiKey,
    llmBaseUrl: (env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, ""),
    llmModel: env.LLM_MODEL?.trim() || "gpt-4o-mini",
    llmSttModel: env.LLM_STT_MODEL?.trim() || "whisper-1",
    persist: options.persist ?? true,
  }
}

/** Live Notion uses a database id when set, otherwise a parent page to create one. */
export function liveNotionSource(
  config: Pick<RecountConfig, "notionToken" | "notionDatabaseId" | "notionParentPageId">,
): "database" | "parent" | "missing" {
  if (!config.notionToken) return "missing"
  if (config.notionDatabaseId) return "database"
  if (config.notionParentPageId) return "parent"
  return "missing"
}
