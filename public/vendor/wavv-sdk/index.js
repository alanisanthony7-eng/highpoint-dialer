/**
 * `@wavv/sdk` — embed WAVV's dialer, messenger and callboards in your product.
 *
 * Four rules shape everything here:
 *
 *  - **Namespaced by product.** `dialer.call()` says which part of WAVV it belongs to without anyone
 *    reading the docs. Two levels only — autocomplete should work after one dot.
 *  - **`show` opens a product, `open` loads one thing into it.**
 *  - **Every function takes one options object**, so parameters can be added without a breaking change.
 *  - **The SDK never acts for the user.** It can compose a message; only they can send it.
 *
 * Minting a token is the one thing a partner must build before any of this does anything.
 */
import * as A from './actions.js';
import { authenticate, dispatch, notify } from './transport.js';
export { Target } from './types.js';
const toCoreContact = (contact) => ({
    contactId: contact.id,
    numbers: [contact.number],
    primaryNumber: contact.number,
    name: contact.name,
    firstName: contact.firstName,
    lastName: contact.lastName,
    address: contact.address,
    city: contact.city,
    state: contact.state,
    zip: contact.zip,
    timezone: contact.timezone,
});
// ---------------------------------------------------------------------------
// Listener plumbing
// ---------------------------------------------------------------------------
/**
 * `SET_CALLBACK` registers a listener and never settles, so it goes through `notify` rather than
 * `dispatch` — a promise for it would reject on core's 15 second timeout and surface as an unhandled
 * rejection.
 */
const listen = (event, handler) => {
    notify(A.SET_CALLBACK, { event, callback: handler });
    // Remove this handler only. `all: true` would also drop every other component's listener for the
    // event — in React, one unmount would silence the rest of the page.
    return { remove: () => notify(A.REMOVE_CALLBACK, { event, callback: handler }) };
};
// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
/**
 * Authenticate your product and identify the current user.
 *
 * Call once on load. Calling it again for the **same** user, with a fresh token, is fine. If the
 * signed-in user changes, reload the page (or otherwise remount WAVV) before calling `init` for the new
 * one: WAVV cannot switch users in place, so an `init` naming a different user while a session is live
 * rejects with `USER_CHANGED_RELOAD_REQUIRED`, and so does every call after it until the page reloads.
 * There is no sign-out: that belongs to the user, not to your product.
 *
 * Calls made before this settles wait for it. They are delivered once it resolves and rejected with the
 * same reason if it rejects. A second `init` waits for the first to settle.
 */
export const init = ({ token, server }) => authenticate(A.AUTH, { token }, server);
// ---------------------------------------------------------------------------
// Manager destinations
// ---------------------------------------------------------------------------
/**
 * Send the user to a place inside WAVV's manager.
 *
 * Named rather than given a function each, so nothing implies one section lives under another. The
 * products — dialer, messenger, callboards — have their own namespaces instead.
 */
export const show = (target, options = {}) => {
    if (target === 'CALL_HISTORY') {
        return dispatch(A.SHOW_CALL_HISTORY, { callId: options.callId, type: options.type });
    }
    if (target === 'CALL_SCRIPTS') {
        return dispatch(A.SHOW_CALL_SCRIPTS_DOCK_LIST, { scriptId: options.scriptId });
    }
    const tabs = {
        BILLING: A.TAB.SUBSCRIPTION,
        NUMBERS: A.TAB.NUMBERS,
        TEAM: A.TAB.TEAM_MANAGEMENT,
        SETTINGS: A.TAB.GENERAL,
    };
    return dispatch(A.OPEN_SETTINGS, { type: A.WIDGET_DIALER, tab: tabs[target] });
};
// ---------------------------------------------------------------------------
// Cross-product callbacks
// ---------------------------------------------------------------------------
/**
 * WAVV asking your product to display a contact.
 *
 * You do not need to infer this from call state — whenever WAVV wants a contact on screen this fires
 * with a `reason`, and you honour the ones you care about. Respecting `DIALER_FOCUS` alone gives you a
 * screen pop.
 *
 * Registers for both events: `CONTACT_LINK` is what ships today and only ever meant the user asked to
 * see a contact, so it maps to `USER_CLICK`. `OPEN_CONTACT` carries its own reason and passes through.
 */
export const onOpenContact = (handler) => {
    // Core wraps the contact and hands over a callback that closes its panels, or shows its "Unable to redirect"
    // toast, once the host has answered.
    const link = listen(A.EVENT.CONTACT_LINK, ({ contact, callback }) => {
        const contactId = contact?.contactId;
        if (!contactId) {
            callback?.({ displayError: true });
            return;
        }
        handler({ contactId, reason: 'USER_CLICK' });
        callback?.({ closeSettings: true, closeModal: true });
    });
    const open = listen(A.EVENT.OPEN_CONTACT, handler);
    return {
        remove: () => {
            link.remove();
            open.remove();
        },
    };
};
/**
 * A contact search WAVV needs answered from your page.
 *
 * The quickest way to get searching working — no endpoint to build. It only runs while your page is
 * open, though, so a user on the WAVV mobile app gets nothing back. Configure the contacts endpoint in
 * the portal once you are past the first integration; that one always works.
 */
export const onContactSearch = (handler) => listen(A.EVENT.CONTACT_SEARCH, async ({ search, callback }) => {
    // Core hands the search a callback to answer and expects contacts in its own shape, so this is a
    // bridge rather than a pass-through: the handler is asked in the published shape (`query`, and a
    // plain `Contact[]` back) and the translation happens here.
    if (typeof callback !== 'function')
        return;
    try {
        const results = await handler({ query: search });
        callback((results ?? []).map(toCoreContact));
    }
    catch {
        // A handler that throws should not leave the search spinning.
        callback([]);
    }
});
// ---------------------------------------------------------------------------
// Dialer
// ---------------------------------------------------------------------------
export const dialer = {
    /** Open the dialer on the user's call lists. */
    show: () => dispatch(A.START_CAMPAIGN, { ...A.MINI }),
    /** Open one saved call list, by the id `createCallList` returned. */
    openCallList: ({ listId }) => dispatch(A.LOAD_CAMPAIGN, { id: listId, ...A.MINI }),
    /**
     * Create a call list and get its id back.
     *
     * Convenient for small lists. For anything substantial create it over REST instead — the browser is
     * a less reliable place to send data from, and REST gives you positioning and incremental inserts.
     */
    createCallList: (options) => dispatch(A.CREATE_CALL_LIST, {
        name: options.name,
        contacts: options.contacts.map(toCoreContact),
        show: options.show,
        ...A.MINI,
    }),
    /**
     * Dial one contact.
     *
     * Saves no call list and is not resumable, but it appears in call history and emits the same events
     * as any other call. Core wants `number` beside the contact as well as inside it, so we lift it
     * rather than making you pass it twice.
     */
    call: ({ contact }) => dispatch(A.CALL_PHONE, { contact: toCoreContact(contact), number: contact.number, ...A.MINI }),
    /** Add a contact to the live dial session. For an extra number on someone already there, use `addPhone`. */
    addContact: ({ contact }) => dispatch(A.ADD_PHONE, { contact: toCoreContact(contact), number: contact.number }),
    /** Remove a contact from the live dial session. */
    removeContact: ({ contactId, hangup }) => dispatch(A.REMOVE_CONTACT, { contactId, hangup }),
    /** Add a number to a contact already in the session. */
    addPhone: ({ number, contactId }) => dispatch(A.ADD_PHONE, { number, contactId }),
    /**
     * Remove a number from the live dial session.
     *
     * Without `contactId` the number is scrubbed from every contact it appears on, which is the usual
     * do-not-call case. `hangup` ends a call already in progress on it.
     */
    removePhone: ({ number, contactId, hangup }) => dispatch(A.REMOVE_PHONE, { number, contactId, hangup }),
    /**
     * Resume recording after a pause.
     *
     * WAVV records according to the user's own settings — this does not switch recording on for someone
     * who has it off. It unmasks a stream `pauseRecording` masked.
     */
    startRecording: () => dispatch(A.RESUME_RECORDING, {}),
    /** Pause recording — the PCI case, while a payment screen is open. */
    pauseRecording: () => dispatch(A.PAUSE_RECORDING, {}),
    onCallStarted: (handler) => listen(A.EVENT.CALL_STARTED, handler),
    onCallAnswered: (handler) => listen(A.EVENT.CALL_ANSWERED, handler),
    onCallIncoming: (handler) => listen(A.EVENT.CALL_INCOMING, handler),
    onCallEnded: (handler) => listen(A.EVENT.CALL_ENDED, handler),
    onCallRecorded: (handler) => listen(A.EVENT.CALL_RECORDED, handler),
    /** Fires when the user dispositions a call. WAVV owns dispositions, so this is how you learn the outcome. */
    onDispositionSet: (handler) => listen(A.EVENT.DISPOSITION_SET, handler),
};
// ---------------------------------------------------------------------------
// Messenger
// ---------------------------------------------------------------------------
export const messenger = {
    /** Open the messenger on the user's conversations. */
    show: () => dispatch(A.OPEN_MESSENGER, { ...A.DOCK }),
    /** Open one existing conversation — the `conversationId` a message event carries. */
    openConversation: ({ conversationId }) => dispatch(A.OPEN_MESSENGER_THREAD, { conversationId, ...A.DOCK }),
    /**
     * Open a message to a contact, optionally pre-filled.
     *
     * The user reads it and presses send. There is deliberately no way to send programmatically: a
     * message that leaves without them seeing it is still attributed to them, and carries their consent
     * and A2P obligations.
     */
    compose: ({ contact, body }) => dispatch(A.OPEN_MESSENGER_THREAD, { contact: toCoreContact(contact), number: contact.number, body, ...A.DOCK }),
    onMessageSent: (handler) => listen(A.EVENT.MESSAGE_SENT, handler),
    onMessageReceived: (handler) => listen(A.EVENT.MESSAGE_RECEIVED, handler),
    onMessageFailed: (handler) => listen(A.EVENT.MESSAGE_FAILED, handler),
};
// ---------------------------------------------------------------------------
// Callboards
// ---------------------------------------------------------------------------
export const callboards = {
    /** Open callboards on the user's boards. */
    show: () => dispatch(A.SHOW_CALLBOARDS, {}),
    /**
     * Open one board, by WAVV's id for it.
     *
     * Boards are read-only to the SDK: starting the dial session is the user's action, and boards are
     * built in WAVV rather than through the SDK.
     */
    openBoard: ({ boardId }) => dispatch(A.SHOW_CALLBOARDS, { boardId }),
};
export default { init, show, onOpenContact, onContactSearch, dialer, messenger, callboards };
