# Recount

Count a shelf without putting the box down.

A worker in a small shop, pharmacy, café, or stockroom still counts with a clipboard. Both hands are on the boxes, the count is slow, and a shortage sits there until the owner notices it late. Recount puts one shelf item at a time on Even Realities G2 glasses. The Even R1 ring changes the count. One tap confirms it. At the end of the aisle, one more tap sends the owner a Telegram message with the short items first.

The glasses page is an Even Hub app. It uses `@evenrealities/even_hub_sdk` **0.0.16** (Even App 2.2.10 or newer) and is exercised in `@evenrealities/evenhub-simulator` **0.9.5**. The phone WebView never talks to Notion, Telegram, or a model vendor. A small Node server holds those tokens.

This is an entry for the DoraHacks “Heads Up: Even Realities Hackathon”, Track 04 (AI Assistants & Work), also aimed at Best Telegram. Nothing here is deployed or submitted.

## How it works

1. The glasses load one location from the Shop Inventory database. In mock mode that database is built in. With a Notion token, the same screen reads the live database.
2. One card shows the shelf, the item, the expected quantity, and the count. Scroll the R1 ring to add or subtract one. Tap to open a confirm card. Tap again to write the count, the variance (counted minus expected), the time, and the counter’s name. A second tap inside 3 seconds undoes it. Double-tap skips the item. Hold the ring, or choose Speak, and a phrase such as “twelve” or “two boxes of six” becomes the number on that confirm card.
3. The last card shows how many items were counted and the total variance. One tap sends the owner a Telegram `sendMessage`. Shortages are listed before overs and exact matches.

The ring path does not need a microphone. The simulator has no reliable mic, so the page can inject a transcript or a WAV file and run the same parser.

## Run it

Node 22 or newer.

```bash
npm install
npm test
npm run dev
```

In a second terminal, with the [WebKitGTK 4.1](https://hub.evenrealities.com/docs/test/simulator) libraries installed:

```bash
npm run sim
```

In a third terminal, once the glasses show the first item:

```bash
npm run demo
```

- Glasses and this page: [http://127.0.0.1:4179/?demo=1](http://127.0.0.1:4179/?demo=1)
- API: [http://127.0.0.1:4187/api/health](http://127.0.0.1:4187/api/health)
- Simulator control plane: `http://127.0.0.1:9898`

`npm run demo` drives the simulator from the Coke card through three counts, one skip, and the Telegram outbox. It writes `docs/screens/`. Those files are the glasses framebuffer with brightness, which the simulator stores in the alpha channel, drawn onto black so the text is visible. Restart the simulator before running the demo again. The `demo=1` query holds the loading card for a moment so that screen can be captured. Leave it off on a headset (`http://<lan-ip>:4179`).

On the glasses, or with the simulator window:

| Gesture | Counting | Confirm card | After save | Summary |
| --- | --- | --- | --- | --- |
| Scroll up / down | Count +1 / −1 | Adjust the number | | |
| Tap | Open confirm | Save | Undo, within 3 s | Send the report |
| Double-tap | Skip | Cancel | | |
| Hold | Listen | | | |

After the report, double-tap asks the system to close the app. Aisle B, Counter, and Cold room are on the glasses menu, next to Speak.

The page beside the glasses is the shop view: the same card text, the Notion-shaped table, a transcript or WAV injector, and the last Telegram message.

## Setup

Copy `.env.example` to `.env`. With the file empty, `npm run dev` stays in mock mode: twelve shop items, an on-disk outbox at `data/telegram-outbox.json`, and the built-in count parser.

### Notion

Create an internal integration and share one parent page with it. Do not use Google OAuth. The Even Hub WebView cannot complete it, and the glasses app should not hold a user token.

```bash
NOTION_TOKEN=secret_...
NOTION_PARENT_PAGE_ID=the_shared_page
npm run seed
```

The script creates a **Shop Inventory** database with 12 items in Aisle B, Counter, and Cold room. Put the printed id in `.env`, then:

```bash
RECOUNT_MODE=live
NOTION_DATABASE_ID=the_printed_id
```

Columns: Name, Location, Shelf, Expected, Actual, Variance, Damaged, Status, Counted at, Counter. A save writes the counted quantity, variance, damaged quantity, time, counter, and status. Undo within the window restores the previous values.

### Telegram

Create a bot with BotFather. Put the bot token and the owner’s chat id in `.env` and set `RECOUNT_MODE=live`. The report is a plain `sendMessage`. Short rows come first.

### Optional speech model

Leave `LLM_API_KEY` empty and the server parses transcripts itself. It understands whole numbers, “twelve”, “a dozen”, “two boxes of six”, and “twenty-one, two damaged”.

To use a model, set an OpenAI-compatible base URL. Any bad or empty reply falls back to the same parser.

```bash
LLM_API_KEY=
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_STT_MODEL=whisper-1
```

A WAV with no key and no transcript is refused. Queue a transcript, or a transcript plus a WAV, from the page or `POST /api/dev/voice`. Hold the ring to pull that queue. On a real headset, hold also records glasses PCM (16 kHz, 16-bit mono) and the server can send it to `{LLM_BASE_URL}/audio/transcriptions`.

`RECOUNT_MODE=live` refuses to start unless the Notion token and database id are set. Telegram and the model are used when their own variables are set, and otherwise the mock outbox and the regex parser stay in place.

## Judging

| Criterion | Weight | What Recount does |
| --- | --- | --- |
| Usefulness on G2 | 30% | The count happens while both hands stay on the stock. One item, one number, the controls on the same card. |
| Read and write | 25% | The aisle is read from Notion. Each confirmed count is written back. The owner receives the variance on Telegram, shortages first. |
| Technical | 20% | SDK 0.0.16 page containers, a 300 ms ring debounce, a two-step confirm, a 3 s undo, and a provider-shaped parser with a deterministic fallback. Mock mode needs no keys. |
| UX | 15% | 576×288 monochrome text. Scroll, tap, double-tap, and a short phrase. The confirm card is a second look, not a form. |
| Business and safety | 10% | The buyer is the shop owner who finds shortages late. No payments, no customer data, no OAuth in the WebView. Tokens stay on the server. The worker’s name is the only identity stored on the row. |

## Layout

```
src/logic        variance, parser, ring state machine, report text
src/glasses      Even Hub page and ring / voice session
src/status.ts    shop page shown in the phone WebView
server           Notion, Telegram, speech, mock mode
scripts/seed.ts  Shop Inventory database
scripts/demo-flow.ts
```

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Variance, parser, ring state machine, report order, mock API |
| `npm run dev` | API on port 4187 and the page on port 4179 |
| `npm run sim` | Simulator against the page, automation on port 9898 |
| `npm run demo` | Count three Aisle B items and send the mock report |
| `npm run seed` | Create the Notion database |
| `npm run build && npm start` | Typecheck, build the page, serve it from the API |

## Limitations

- This copy has not been deployed, packed for Even Hub, or sent to DoraHacks.
- The simulator is not the headset. It has no IMU, camera, or location, and its microphone should not be trusted. Recount does not use IMU or location. Voice in the simulator goes through the transcript or WAV hook.
- Text-container events in SDK 0.0.16 do not carry a ring-versus-temple source. Scroll, tap, and double-tap from the ring and from either temple run the same count. A hold does include the source, and the server log prints it. The simulator itself reports the right temple for system events.
- Double-tap during a count skips the item, so a worker does not leave the aisle by accident. Close stays on the system menu. After the report is sent, double-tap calls `shutDownPageContainer(1)`, which is the system exit dialog.
- The OS may take a tap-then-hold for its own menu. Speak is also a menu item, and it listens for four seconds.
- The undo window is three seconds on the glasses, plus a short grace on the server for the round trip. The count is written immediately and reverted if the worker undoes it. If the glasses disconnect, the count stands.
- Counts are whole units from 0 to 999. Variance is counted minus expected. Damaged units are noted beside the count. They do not change the variance.
- One location is open at a time. There is no barcode scan and no camera count. The G2 has no camera.
- Notion access is one internal integration for the shop, not a login per worker. Live mode with a bad token fails the load. It does not silently switch to the mock shop.
- Speech-to-text needs an OpenAI-compatible audio endpoint. Without a key, only a transcript is parsed.
- The glasses font is the firmware font. Copy stays in basic Latin. The simulator’s pixels are not a sign-off for legibility on the headset.
- Network permission in `app.json` lists localhost for this repo. A headset build has to add the server’s origin before `evenhub pack`.
- `libwebkit2gtk-4.1` is required to launch the simulator on Linux. It is not an npm dependency.
