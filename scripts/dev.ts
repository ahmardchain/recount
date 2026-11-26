import { spawn, type ChildProcess } from "node:child_process"

const children: ChildProcess[] = [
  spawn("npx", ["tsx", "server/index.ts"], { stdio: "inherit", env: process.env }),
  spawn("npx", ["vite", "--host", "0.0.0.0", "--port", "4179", "--strictPort"], {
    stdio: "inherit",
    env: process.env,
  }),
]

function shutdown(): void {
  for (const child of children) child.kill("SIGTERM")
}

process.on("SIGINT", () => {
  shutdown()
  process.exit(0)
})
process.on("SIGTERM", () => {
  shutdown()
  process.exit(0)
})

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown()
      process.exit(code)
    }
  })
}
