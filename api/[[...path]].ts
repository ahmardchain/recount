import type { IncomingMessage, ServerResponse } from "node:http"
import { createRecountServer } from "../server/http"

const app = createRecountServer({ persist: false })

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  app.server.emit("request", req, res)
}
