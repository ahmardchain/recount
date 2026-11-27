import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const manifest = JSON.parse(readFileSync(join(root, "app.json"), "utf8")) as {
  permissions: Array<{ name: string; whitelist?: string[] }>
}
const network = manifest.permissions.find((entry) => entry.name === "network")
const origin = network?.whitelist?.find((url) => url.startsWith("https://"))
if (!origin) {
  console.error("app.json network whitelist needs an https origin before packing a headset build.")
  process.exit(1)
}

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run("npx", ["tsc", "--noEmit"])
run("npx", ["vite", "build"], { VITE_RECOUNT_API: origin })
run("npx", ["evenhub", "pack", "app.json", "dist", "-o", "recount.ehpk"])
console.log(`Packed recount.ehpk for API ${origin}`)
