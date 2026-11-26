# Deck outline

Seven slides. Flat type on white. Black rules. No navy, no glow, no gradient. Green appears only where it refers to the G2 display.

## 1. Problem

Title: The count still needs a clipboard.

A short aisle. Both hands on a case. The number is written later, or not written. The owner finds the shortage when a customer asks for the item.

One line under it: Count a shelf without putting the box down.

## 2. Who it’s for

The person counting: shop, pharmacy, café, or stockroom staff who cannot spare a hand.

The person who pays: the owner, who wants the gap the same hour, on Telegram, not in a spreadsheet they open at night.

Not for: warehouses with scan guns, or anything that moves money.

## 3. Demo flow

Five beats, one aisle:

1. Notion row appears as one card on the glasses. Expected quantity is the starting count.
2. R1 scroll changes it by one. Tap opens the confirm card. Tap writes variance, time, and name.
3. Three seconds to undo.
4. A phrase (“thirty-eight, one damaged”, “two boxes of six”) fills the same confirm card.
5. Summary. One tap. Telegram lists shortages first.

## 4. Why glasses

The phone is the wrong tool because using it means putting the box down.

G2 is a private 576×288 green display in front of the shelf label. The R1 ring is already on the hand that is steadying the case. One item on screen. The controls are printed on that item. No dashboard.

## 5. Tech

- Even Hub web app, `@evenrealities/even_hub_sdk` 0.0.16.
- Ring gestures on one text container: scroll, tap, double-tap, hold. 300 ms debounce. Two-step confirm.
- Node server. Notion internal integration for read and write. No Google OAuth in the WebView.
- Count parser behind one interface. Regex fallback so a demo runs with no model key. Optional OpenAI-compatible chat and speech endpoint.
- Telegram `sendMessage` for the aisle report.
- Mock Notion and mock Telegram when the env file is empty. Simulator run from load to report.

## 6. Business

Price it as a shop tool, not a gadget demo. A small monthly fee per location: the Notion database the owner already understands, plus the Telegram chat they already read.

The first sale is the owner who walks the aisle on Sunday night. The staff count during the week. The owner gets the short list without being in the room.

What we do not do: take payment, hold stock value, or give stock advice.

## 7. Safety

- Tokens live in server env vars. The glasses bundle has none.
- One shop integration, shared on purpose by the owner. Workers do not connect their own Google accounts.
- The row stores a name, a time, and quantities. No customer data.
- A count is written, then reversible for three seconds, then it stands even if the glasses drop.
- Double-tap skips. It does not close the app in the middle of an aisle. Close is the system menu. Exit confirmation is after the report.
- Track 04. The Telegram report is the Best Telegram entry: a bot message the owner can act on, sent from the glasses in one tap.
