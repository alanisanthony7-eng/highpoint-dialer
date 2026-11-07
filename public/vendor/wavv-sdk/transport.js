/**
 * Transport: get `wavv.js` onto the page, then turn calls into promises at `window.WAVV.dispatch`.
 *
 * This replaces `common/utils.ts`, which was copy-pasted byte-identically into all four of the old
 * modules. There is one copy now, and it lives in the same repository as the actions it dispatches.
 *
 * One rule decides when a call goes out: a call waits for the init it was made behind. A call made while
 * an init is in flight waits for that init; one made before the first init waits for the next. When the
 * init resolves the calls go out in order, and when it rejects they reject with the same reason, so
 * nothing runs as a user the page did not ask for and nothing replays behind a later init. Listener
 * registrations (`notify`) are the exception: they belong to the page rather than to a user, so they only
 * wait for `wavv.js` and survive a failed init.
 */
import { MODULE, VERSION } from './version.js';
const DEFAULT_SERVER = 'app.wavv.com';
/** How long to wait for `window.WAVV` to appear before giving up on buffered calls. */
const BOOTSTRAP_TIMEOUT = 10000;
/** How long a call made before any `init` waits for one before it is refused. */
const INIT_WAIT_TIMEOUT = 30000;
export const LOAD_FAILED = 'WAVV failed to load';
export const NOT_INITIALIZED = 'NOT_INITIALIZED';
/** Core refuses an init for a different user on a live session (`storm-js/src/userSwitch.js`). */
export const USER_CHANGED_RELOAD_REQUIRED = 'USER_CHANGED_RELOAD_REQUIRED';
// ---------------------------------------------------------------------------
// Loading wavv.js
// ---------------------------------------------------------------------------
let load = 'idle';
let script = null;
let scriptErrored = false;
/** Bumped per load attempt, so a poll from an earlier attempt cannot fail a later one. */
let attempt = 0;
/** Calls waiting for `window.WAVV`. Flushed in order once it exists. */
const buffer = [];
/** The `notify` actions in `buffer`: a failed load keeps them for the retry. */
const notifies = new WeakSet();
const markReady = () => {
    load = 'ready';
    while (buffer.length) {
        const action = buffer.shift();
        if (action)
            window.WAVV?.dispatch(action);
    }
};
const failLoad = () => {
    if (load !== 'loading')
        return;
    load = 'failed';
    for (const action of buffer.splice(0)) {
        if (notifies.has(action))
            buffer.push(action);
        else
            action.reject(LOAD_FAILED);
    }
};
/**
 * Poll for `window.WAVV`. The snippet installs it synchronously once `wavv.js` has run, so this is a
 * short wait rather than a real handshake.
 */
const waitForWavv = () => {
    const mine = ++attempt;
    const started = Date.now();
    const tick = () => {
        if (mine !== attempt || load !== 'loading')
            return;
        if (window.WAVV)
            return markReady();
        if (Date.now() - started > BOOTSTRAP_TIMEOUT)
            return failLoad();
        setTimeout(tick, 50);
    };
    tick();
};
/**
 * Inject `wavv.js`, once per page. After a failed load, the next `init` tries again.
 *
 * A script that errored is replaced. One that simply has not run by the timeout is waited on again
 * rather than injected a second time: it may still arrive, and two copies would start WAVV twice.
 */
export const bootstrap = (server = DEFAULT_SERVER) => {
    if (load === 'ready' || load === 'loading')
        return;
    load = 'loading';
    // A copy that arrived after an earlier attempt gave up.
    if (window.WAVV)
        return markReady();
    if (!script || scriptErrored) {
        script?.remove();
        const element = document.createElement('script');
        element.src = `https://${server}/wavv.js`;
        element.async = true;
        element.onerror = () => {
            if (element !== script)
                return;
            scriptErrored = true;
            failLoad();
        };
        script = element;
        scriptErrored = false;
        document.head.appendChild(element);
    }
    waitForWavv();
};
/** Hand an action to core, or hold it until `wavv.js` is up. A call made after a failed load is refused. */
const send = (action) => {
    if (load === 'ready' && window.WAVV)
        return window.WAVV.dispatch(action);
    if (load === 'failed' && !notifies.has(action))
        return action.reject(LOAD_FAILED);
    buffer.push(action);
};
const toAction = (type, payload, resolve, reject) => ({
    type,
    payload,
    resolve,
    reject,
    module: MODULE,
    version: VERSION,
});
/** Inits not yet settled, oldest first. A new call waits on the last. */
const inits = [];
/** Calls made before any init, each with the timer that refuses it if none comes. */
const early = [];
/** An init has resolved, so calls go straight out. */
let initialized = false;
/** Core refused a user switch; calls are refused too until an init resolves. */
let refusal = null;
/** Each AUTH goes out once the one before it has settled: core answers them all under one promise id. */
let authTail = Promise.resolve();
const settle = (init, ok, reason) => {
    inits.splice(inits.indexOf(init), 1);
    if (ok) {
        initialized = true;
        refusal = null;
        for (const action of init.held)
            send(action);
        return;
    }
    if (reason === USER_CHANGED_RELOAD_REQUIRED)
        refusal = reason;
    for (const action of init.held)
        action.reject(reason);
};
/**
 * Send AUTH, after any init still in flight has settled, and hold the calls made behind it.
 *
 * Calls made before this one are claimed by it, so the first init on a page delivers what was queued
 * for it.
 */
export const authenticate = (type, payload, server) => {
    const init = { held: [] };
    for (const { action, timer } of early.splice(0)) {
        clearTimeout(timer);
        init.held.push(action);
    }
    inits.push(init);
    const run = authTail.then(() => new Promise((resolve, reject) => {
        bootstrap(server);
        send(toAction(type, payload, resolve, reject));
    }));
    const result = run.then((data) => {
        settle(init, true);
        return data;
    }, (reason) => {
        settle(init, false, reason);
        throw reason;
    });
    authTail = result.catch(() => { });
    return result;
};
/**
 * Dispatch one action and resolve when core settles it.
 *
 * Core reads `resolve`/`reject` straight off the action and holds them against a 15 second timeout
 * (30 for `AUTH`) — see `registerPromise` in `storm-js/src/dispatch.js`. That timer starts when the
 * call reaches core. Before then the wait is bounded here instead: by the init it is held for, which
 * settles within core's AUTH timeout or the load timeout, or by `INIT_WAIT_TIMEOUT` if no init comes.
 *
 * Core validates every payload from this module against its AJV schemas, whatever the version
 * (`transformAndValidate` in `storm-js/src/validate.js`). A payload that fails rejects with
 * 'Validation failed', and fields a schema does not list are stripped.
 */
export const dispatch = (type, payload) => new Promise((resolve, reject) => {
    const action = toAction(type, payload, resolve, reject);
    const pending = inits[inits.length - 1];
    if (pending)
        return void pending.held.push(action);
    if (refusal)
        return reject(refusal);
    if (initialized)
        return send(action);
    if (load === 'failed')
        return reject(LOAD_FAILED);
    const timer = setTimeout(() => {
        const index = early.findIndex((entry) => entry.action === action);
        if (index === -1)
            return;
        early.splice(index, 1);
        reject(NOT_INITIALIZED);
    }, INIT_WAIT_TIMEOUT);
    early.push({ action, timer });
});
/**
 * Dispatch without waiting for a reply.
 *
 * `SET_CALLBACK` and `REMOVE_CALLBACK` register listeners and never settle, so a promise for them would
 * reject on core's 15 second timeout and surface as an unhandled rejection. Core still calls
 * `registerPromise` for every action, so we hand it no-ops to discard.
 */
export const notify = (type, payload) => {
    const action = toAction(type, payload, () => { }, () => { });
    notifies.add(action);
    send(action);
};
/** True once `window.WAVV` has been seen. */
export const isReady = () => load === 'ready';
