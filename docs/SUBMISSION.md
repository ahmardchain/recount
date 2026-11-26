# DoraHacks BUIDL draft

Do not submit this file as-is. The owner reviews it and posts it. Links below are placeholders.

## Name

Recount

## Tagline

Count a shelf without putting the box down.

## Track

04 · AI Assistants & Work

Also entered for Best Telegram. The glasses send one `sendMessage` at the end of an aisle, then the aisle count as an `.xlsx` with `sendDocument`. Shortages are listed first. The sheet caption is the aisle and the date, for example `Recount · Aisle B · 26 Nov 2026`.

## Description

Small shops, pharmacies, cafés, and stockrooms still count stock with a clipboard. It takes both hands, and a shortage waits until the owner happens to look.

Recount is an Even Hub app for Even Realities G2 and the R1 ring. It loads one aisle from a Notion database onto the 576×288 display: shelf, item, expected quantity, and the live count. The ring scrolls the count. Tap opens a confirm card. Tap again writes the counted quantity, the variance, the time, and the counter back to that Notion row, with a three-second undo. A spoken line such as “twelve” or “two boxes of six” is parsed into the same card. At the end of the aisle, one tap sends the owner a Telegram report and the aisle spreadsheet. The glasses card then shows that the sheet was sent.

Notion uses a server-side internal integration, because Google OAuth does not work in the Even Hub WebView and the glasses app must not hold a token. Speech parsing has a provider-shaped interface and a deterministic fallback, so the demo runs with no model key. The simulator path is ring-first. A dev hook injects a transcript or a WAV file where the microphone is unreliable.

## Built with

- `@evenrealities/even_hub_sdk` 0.0.16
- `@evenrealities/evenhub-simulator` 0.9.5
- Notion API (internal integration)
- Telegram Bot API (`sendMessage` and `sendDocument`)
- `exceljs` 4.4.0 for the aisle workbook, with a CSV fallback
- Optional OpenAI-compatible chat and audio transcription

## Links

| Field | Value |
| --- | --- |
| Repository | PLACEHOLDER — public git URL after the owner creates the remote |
| Demo video | PLACEHOLDER — POV stockroom video, under 2 minutes. Script in `docs/DEMO_SCRIPT.md` |
| Even Hub build | PLACEHOLDER — `.ehpk` only if the owner packs and uploads it |
| Live server | Not deployed. Mock mode runs locally with `npm run dev` |

## Deadline note

The owner’s cutoff is Sunday 29 November 2026, 20:59 WAT. The published DoraHacks deadline is 23:59 Dubai time the same evening.
