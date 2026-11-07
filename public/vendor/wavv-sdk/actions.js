/**
 * The action names this package dispatches at `window.WAVV`.
 *
 * These are deliberately **literal strings rather than imports from `common`**. The published package
 * must have no runtime dependency on repository internals, so the values are restated here and
 * `scripts/check-actions.mjs` asserts every one of them still matches `common/src/types.js`. That check
 * is what prevents the drift that left the old modules advertising a `SettingsTab` enum where 8 of 15
 * values were dead.
 */
/** Authenticate your product and identify the current user. */
export const AUTH = 'AUTH';
/**
 * Open the dialer.
 *
 * With no `id` and no `contacts` this opens the call-list picker (`SHOW_CAMPAIGN_MODAL`, see
 * `storm-js/src/store/middleware/init.js`). It routes through `INIT_DIALER`, whose reducer reads
 * `payload.mini` — which is how the dialer opens as the mini rather than the bar.
 *
 * Not `LOAD_DIALER`: that drops its payload, so mini cannot be requested, and it mounts the legacy
 * full-width bar, which needs a `#wavv-dialer` div in the host page and fails with
 * `Div ID "wavv-dialer" not found in DOM` without one. The bar is a REDX arrangement the new SDK does
 * not offer.
 *
 * Not `SHOW_MINI` either: that is a skin switch, and its reducer no-ops unless a dialer is already
 * visible (`widgetVisible.js`). It cannot open anything.
 */
export const START_CAMPAIGN = 'START_CAMPAIGN';
/** Every dialer surface opens as the mini. "No skins" means the host never chooses. */
export const MINI = { mini: true };
/** Open a saved call list by id. */
export const LOAD_CAMPAIGN = 'LOAD_CAMPAIGN';
/** Create a call list from contacts and get its id back, without starting a dial session. */
export const CREATE_CALL_LIST = 'CREATE_CALL_LIST';
export const CALL_PHONE = 'CALL_PHONE';
/**
 * Adds a number, and optionally the contact it belongs to.
 *
 * The schema is `{ number, oneOf(contactId, contact) }`, which is why `addPhone` and `addContact` are
 * two faces of one action rather than two actions.
 */
export const ADD_PHONE = 'ADD_PHONE';
/**
 * Removes a number from the live dial session.
 *
 * `{ number, contactId?, hangup? }`. Without `contactId` the number is scrubbed from every contact it
 * appears on.
 */
export const REMOVE_PHONE = 'REMOVE_PHONE';
export const REMOVE_CONTACT = 'REMOVE_CONTACT';
/**
 * Recording is controlled by pausing and resuming the stream, not by starting it.
 *
 * WAVV records according to the user's own settings; these mask and unmask it, which is what the PCI
 * case needs. `RECORD_CALL` is a different thing — it marks a recording to be kept — so it is not what
 * `startRecording` maps to.
 *
 * These are the **host-callable** names, not the `BUTTON_*` actions the dialer's own buttons dispatch.
 * Those are internal: dispatching one from a host reaches the reducers but settles no promise, so every
 * call timed out after 15 seconds. `dispatch.js` maps these two onto them through `serverFunctions`.
 */
export const PAUSE_RECORDING = 'PAUSE_RECORDING';
export const RESUME_RECORDING = 'RESUME_RECORDING';
export const OPEN_MESSENGER = 'OPEN_MESSENGER';
export const OPEN_MESSENGER_THREAD = 'OPEN_MESSENGER_THREAD';
/**
 * Every messenger surface opens as the dock — a floating panel over the host page.
 *
 * Without it, core routes the messenger to the wavv-app **sidepanel**, which takes the whole right
 * side of the screen and belongs to WAVV's own app rather than to the product embedding it. Which of
 * the two a user gets is otherwise decided by the `sidepanelMessenger` Statsig flag, so a partner
 * would see the layout change per end user for reasons they cannot see. `dock` is read in
 * `storm-js/src/store/middleware/messenger.js`.
 */
export const DOCK = { dock: true };
/** Opens the boards list, or one board when given a `boardId`. */
export const SHOW_CALLBOARDS = 'SHOW_CALLBOARDS';
export const SHOW_CALL_HISTORY = 'SHOW_CALL_HISTORY';
export const SHOW_CALL_SCRIPTS_DOCK_LIST = 'SHOW_CALL_SCRIPTS_DOCK_LIST';
export const OPEN_SETTINGS = 'OPEN_SETTINGS';
/** Raw listener registration. Every callback goes through this. */
export const SET_CALLBACK = 'SET_CALLBACK';
export const REMOVE_CALLBACK = 'REMOVE_CALLBACK';
/**
 * Manager destinations behind `show()`.
 *
 * `TAB_TEAM_MANAGEMENT` and `TAB_CALL_SCRIPTS` were added to `WAVV_TAB_TYPES` for this; without that,
 * `OPEN_SETTINGS` rejects them outright rather than ignoring them.
 */
export const TAB = {
    GENERAL: 'TAB_GENERAL',
    NUMBERS: 'TAB_NUMBERS',
    SUBSCRIPTION: 'TAB_SUBSCRIPTION',
    TEAM_MANAGEMENT: 'TAB_TEAM_MANAGEMENT',
    CALL_SCRIPTS: 'TAB_CALL_SCRIPTS',
};
/** Widget the Manager opens under. */
export const WIDGET_DIALER = 'DIALER';
/** Event names passed to `SET_CALLBACK`. These are the `ON_*` values in `common/src/types.js`. */
export const EVENT = {
    CALL_STARTED: 'CALL_STARTED',
    CALL_ANSWERED: 'CALL_ANSWERED',
    CALL_INCOMING: 'CALL_INCOMING',
    CALL_ENDED: 'CALL_ENDED',
    CALL_RECORDED: 'CALL_RECORDED',
    MESSAGE_SENT: 'MESSAGE_SENT',
    MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
    MESSAGE_FAILED: 'MESSAGE_FAILED',
    DISPOSITION_SET: 'DISPOSITION_SET',
    CONTACT_SEARCH: 'CONTACT_SEARCH',
    /**
     * The screen pop, with the reason WAVV is asking. Fired by the dialer when it moves to a contact and
     * the user has Jump to Contact on; `CONTACT_LINK` only ever came from callboards.
     */
    OPEN_CONTACT: 'OPEN_CONTACT',
    /** The older event `OPEN_CONTACT` supersedes. Still fired by callboards, with no `reason`. */
    CONTACT_LINK: 'CONTACT_LINK',
};
