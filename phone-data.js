/**
 * Phone Data Layer — per-chat isolation
 * All phone data is stored in SillyTavern's chat_metadata, scoped by key.
 */

const STORAGE_KEY = 'phone_extension';

/**
 * @typedef {object} Contact
 * @property {string} id
 * @property {string} name
 * @property {string} avatar
 * @property {string} phone
 */

/**
 * @typedef {object} TextMessage
 * @property {string} id
 * @property {string} contactId
 * @property {string} text
 * @property {'sent'|'received'} direction
 * @property {number} timestamp
 */

/**
 * @typedef {object} CallRecord
 * @property {string} id
 * @property {string} contactId
 * @property {'incoming'|'outgoing'} type
 * @property {number} duration
 * @property {'missed'|'answered'} status
 * @property {number} timestamp
 */

/**
 * @typedef {object} SocialPost
 * @property {string} id
 * @property {string} author
 * @property {string} authorHandle
 * @property {string} content
 * @property {string[]} images
 * @property {number} likes
 * @property {number} retweets
 * @property {boolean} liked
 * @property {boolean} retweeted
 */

/**
 * @typedef {object} BrowserTab
 * @property {string} id
 * @property {string} title
 * @property {string} url
 * @property {string} html
 * @property {number} timestamp
 */

function getEmptyPhoneData() {
    return {
        contacts: [],
        messages: [],
        phoneCalls: [],
        social: { feed: [], savedPosts: [], _nextPostId: 100 },
        browser: {
            tabs: [],
            activeTabId: null,
            bookmarks: [],
            history: [],
            _nextTabId: 1,
        },
        _activeApp: 'phone',
        _nextMsgId: 1,
        _nextCallId: 1,
        _nextContactId: 1,
        _nextSocialId: 1,
        _nextBrowserTabId: 1,
    };
}

function loadPhoneData() {
    if (!window.chat_metadata) return getEmptyPhoneData();
    const existing = window.chat_metadata[STORAGE_KEY];
    if (!existing) return getEmptyPhoneData();

    // Ensure all fields exist (for backwards compat)
    const empty = getEmptyPhoneData();
    for (const key of Object.keys(empty)) {
        if (existing[key] === undefined) {
            existing[key] = empty[key];
        }
    }
    return existing;
}

function savePhoneData(shouldSave = true) {
    if (!window.chat_metadata) return;
    if (!window.chat_metadata[STORAGE_KEY]) {
        window.chat_metadata[STORAGE_KEY] = {};
    }
    // Deep copy to avoid issues with circular refs
    const saved = { ...phoneData, _activeApp: activeApp };
    Object.assign(window.chat_metadata[STORAGE_KEY], saved);

    if (shouldSave && typeof saveChatConditional === 'function') {
        saveChatConditional(false);
    }
    if (shouldSave && typeof saveSettingsDebounced === 'function') {
        saveSettingsDebounced();
    }
}

/**
 * Resets phone data completely (e.g. when clearing all phone data).
 */
function resetPhoneData() {
    phoneData = getEmptyPhoneData();
    activeApp = 'phone';
    activeContactId = null;
    activeTabId = null;
    savePhoneData();
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function formatTimestamp(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatFullDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString();
}
