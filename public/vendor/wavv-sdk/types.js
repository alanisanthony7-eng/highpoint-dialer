/** Public types for `@wavv/sdk`. */
/**
 * Where `show()` can send the user.
 *
 * These are destinations inside WAVV's manager rather than products of their own, which is why they are
 * named rather than given a function each: nothing here implies one section belongs to another.
 */
export const Target = {
    CALL_HISTORY: 'CALL_HISTORY',
    BILLING: 'BILLING',
    NUMBERS: 'NUMBERS',
    TEAM: 'TEAM',
    CALL_SCRIPTS: 'CALL_SCRIPTS',
    SETTINGS: 'SETTINGS',
};
