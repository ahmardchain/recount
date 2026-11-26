/** Ring gestures closer than this are treated as one flaky repeat. */
export const INPUT_DEBOUNCE_MS = 300

/** How long the wearer can undo a count before it stands. */
export const UNDO_WINDOW_MS = 3000

/**
 * Extra time on the server so a tap that is still inside the glasses
 * window arrives before the token expires.
 */
export const UNDO_GRACE_MS = 800

/** Spoken capture window when Speak is chosen from the menu. */
export const LISTEN_WINDOW_MS = 4000
