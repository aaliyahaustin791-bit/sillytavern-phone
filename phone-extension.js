/**
 * Phone Extension for SillyTavern v0.2.0
 * A fully functional smartphone simulation — calls, texts, social media, and web browser.
 * All data is scoped per-chat and never bleeds between conversations.
 *
 * NEW in v0.2.0:
 * - NPCs can text you on their own via ST's LLM
 * - Toggle: Add phone messages to main chat story
 * - Auto-contact creation for active ST character
 * - Toast notifications for incoming texts
 */

// ============================================================
// STATE & SETTINGS
// ============================================================
var STORAGE_KEY = 'phone_extension';
var GLOBAL_STORAGE_KEY = 'phone_extension_global';
var phoneData = getEmptyPhoneData();
var activeApp = 'phone';
var activeContactId = null;
var activeSocialTab = 'feed';

function getDefaultPhoneSettings() {
    return {
        addToStory: true,          // Inject text messages into ST chat history
        npcAutoTexts: true,        // Allow NPCs to initiate texts
        npcTextFrequency: 5,       // Minutes between auto-texts
        lastAutoText: 0,           // Timestamp of last auto-text
        notifications: true,       // Show toast on new texts,
        // Phone-specific LLM API
        phoneApiUrl: 'https://api.openai.com/v1',
        phoneApiKey: '',
        phoneApiModel: 'gpt-4o-mini',
        phoneApiProvider: 'openai',  // openai | openai-compatible
    };
}

function getSettings() {
    if (!phoneData.settings) phoneData.settings = getDefaultPhoneSettings();
    // Backwards compat — add new fields if missing
    if (!phoneData.settings.hasOwnProperty('addToStory')) phoneData.settings.addToStory = true;
    if (!phoneData.settings.hasOwnProperty('phoneApiUrl')) phoneData.settings.phoneApiUrl = 'https://api.openai.com/v1';
    if (!phoneData.settings.hasOwnProperty('phoneApiKey')) phoneData.settings.phoneApiKey = '';
    if (!phoneData.settings.hasOwnProperty('phoneApiModel')) phoneData.settings.phoneApiModel = 'gpt-4o-mini';
    if (!phoneData.settings.hasOwnProperty('phoneApiProvider')) phoneData.settings.phoneApiProvider = 'openai';
    return phoneData.settings;
}

function getEmptyPhoneData() {
    return {
        contacts: [],
        messages: [],
        phoneCalls: [],
        social: { feed: [], savedPosts: [] },
        browser: { tabs: [], activeTabId: null, bookmarks: [], history: [] },
        settings: getDefaultPhoneSettings(),
        _activeApp: 'phone',
        _nextMsgId: 1,
        _nextSeq: 1
    };
}

// ============================================================
// PERSISTENCE
// ============================================================
function loadPhoneData() {
    var m = typeof chat_metadata !== 'undefined' ? chat_metadata : (typeof window !== 'undefined' ? window.chat_metadata : null);
    
    // Try to load from ST metadata first
    if (m && m[STORAGE_KEY]) {
        var e = getEmptyPhoneData();
        var k;
        for (k in e) { if (m[STORAGE_KEY][k] === undefined) m[STORAGE_KEY][k] = e[k]; }
        if (!m[STORAGE_KEY].settings) m[STORAGE_KEY].settings = getDefaultPhoneSettings();
        
        // Override/Merge with global API settings
        var global = loadGlobalSettings();
        if (global) {
            var apiFields = ['phoneApiUrl', 'phoneApiKey', 'phoneApiModel', 'phoneApiProvider'];
            for (var f = 0; f < apiFields.length; f++) {
                var field = apiFields[f];
                if (global[field] !== undefined) m[STORAGE_KEY].settings[field] = global[field];
            }
        }
        return m[STORAGE_KEY];
    }
    
    // Fallback: try to load from localStorage
    try {
        var fallback = localStorage.getItem('_phone_data_fallback');
        if (fallback) {
            var parsed = JSON.parse(fallback);
            console.log('[Phone Extension] Loaded from localStorage fallback');
            // Merge with defaults
            var e = getEmptyPhoneData();
            for (var k in e) { if (parsed[k] === undefined) parsed[k] = e[k]; }
            if (!parsed.settings) parsed.settings = getDefaultPhoneSettings();
            
            // Also merge with global API settings
            var global = loadGlobalSettings();
            if (global) {
                var apiFields = ['phoneApiUrl', 'phoneApiKey', 'phoneApiModel', 'phoneApiProvider'];
                for (var f = 0; f < apiFields.length; f++) {
                    var field = apiFields[f];
                    if (global[field] !== undefined) parsed.settings[field] = global[field];
                }
            }
            return parsed;
        }
    } catch(e) {
        console.warn('[Phone Extension] Failed to load fallback data:', e);
    }
    
    return getEmptyPhoneData();
}

function loadGlobalSettings() {
    try {
        var global = localStorage.getItem(GLOBAL_STORAGE_KEY);
        return global ? JSON.parse(global) : null;
    } catch(e) { return null; }
}

function saveGlobalSettings(settings) {
    try {
        localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(settings));
    } catch(e) { console.warn('[Phone Extension] Failed to save global settings:', e); }
}

function savePhoneData(shouldSave) {
    if (shouldSave === undefined) shouldSave = true;
    var m = typeof chat_metadata !== 'undefined' ? chat_metadata : (typeof window !== 'undefined' ? window.chat_metadata : null);
    if (!m) {
        // Fallback: persist to localStorage if ST metadata isn't available
        try {
            localStorage.setItem('_phone_data_fallback', JSON.stringify(phoneData));
            console.log('[Phone Extension] Saved to localStorage fallback (ST metadata not ready)');
        } catch(e) { console.warn('[Phone Extension] Fallback save failed:', e); }
        return;
    }
    if (!m[STORAGE_KEY]) m[STORAGE_KEY] = {};
    Object.assign(m[STORAGE_KEY], phoneData);
    if (shouldSave) {
        // ST's settings/save systems can fail during init — guard against it
        if (typeof saveChatConditional === 'function') { saveChatConditional(false); }
        if (typeof saveSettingsDebounced === 'function') { saveSettingsDebounced(); }
        // ALSO save to localStorage directly so API settings survive reloads
        try {
            localStorage.setItem('_phone_data_fallback', JSON.stringify(phoneData));
        } catch(e) { /* silent */ }
    }
}

function resetPhoneData() {
    phoneData = getEmptyPhoneData();
    activeApp = 'phone';
    activeContactId = null;
    savePhoneData();
}

function randId() { return Date.now().toString(36) + Math.random().toString(36).substring(2,9); }
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
function fmtAgo(ts) { var d=Date.now()-ts; if(d<6e4) return 'just now'; if(d<36e5) return Math.floor(d/6e4)+'m'; if(d<864e5) return fmtTime(ts); return new Date(ts).toLocaleDateString(); }

// ============================================================
// SAFE CHAT ACCESSORS — bridge to ST's chat system with fallbacks
// ============================================================

/**
 * Safely retrieve the ST chat message array with multiple fallback methods.
 * Returns an array of message objects or an empty array.
 */
function getChatMessagesSafe() {
    // Method 1: Direct chat array (ST's global)
    if (typeof chat !== 'undefined' && Array.isArray(chat)) {
        return chat;
    }
    // Method 2: chat_metadata.chat
    try {
        if (typeof chat_metadata !== 'undefined' && chat_metadata && Array.isArray(chat_metadata.chat)) {
            return chat_metadata.chat;
        }
    } catch(e) {}
    // Method 3: SillyTavern.getContext()
    try {
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
            var ctx = SillyTavern.getContext();
            if (ctx && Array.isArray(ctx.chat)) return ctx.chat;
        }
    } catch(e) {}
    // Method 4: jQuery-based access (common in ST)
    try {
        if (typeof jQuery !== 'undefined') {
            var $ = jQuery;
            var chatEl = $('#chat');
            if (chatEl.length && chatEl.data('chat')) {
                return chatEl.data('chat');
            }
        }
    } catch(e) {}
    // Method 5: DOM scrape — build a fake chat array from rendered messages
    try {
        var msgEls = document.querySelectorAll('#chat .mes');
        var result = [];
        for (var i = 0; i < msgEls.length; i++) {
            var mesText = msgEls[i].querySelector('.mes_text, .text');
            var text = mesText ? mesText.textContent.trim() : '';
            var sender = msgEls[i].classList.contains('me') ? (typeof name1 !== 'undefined' ? name1 : 'You') : 'Unknown';
            result.push({ mes: text, name: sender, is_user: sender !== 'Unknown' });
        }
        return result;
    } catch(e) {}
    return [];
}

/**
 * Safely push a message object into ST's chat array.
 * Returns true if successful, false otherwise.
 */
function pushChatMessageSafe(msgObj) {
    // Method 1: Direct chat array
    if (typeof chat !== 'undefined' && Array.isArray(chat)) {
        chat.push(msgObj);
        return true;
    }
    // Method 2: chat_metadata.chat
    try {
        if (typeof chat_metadata !== 'undefined' && chat_metadata && Array.isArray(chat_metadata.chat)) {
            chat_metadata.chat.push(msgObj);
            return true;
        }
    } catch(e) {}
    // Method 3: SillyTavern.getContext()
    try {
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
            var ctx = SillyTavern.getContext();
            if (ctx && Array.isArray(ctx.chat)) {
                ctx.chat.push(msgObj);
                return true;
            }
        }
    } catch(e) {}
    console.warn('[Phone Extension] pushChatMessageSafe: could not push message — chat not available');
    return false;
}

/**
 * Safely get the current chat message count.
 */
function getChatLengthSafe() {
    var msgs = getChatMessagesSafe();
    return msgs ? msgs.length : 0;
}

// ============================================================
// CHAT DATABANK — Hybrid: ST chat array (primary) + DOM (fallback)
// ============================================================
var ChatDatabank = {
    messages: [],   // [{ speaker: string, text: string, timestamp: number, raw: object }]
    _pollInterval: null,
    _observer: null,
    _stEventBound: false,

    /**
     * Primary: Pull from ST's internal chat array. Fallback: DOM scrape.
     */
    scrape: function() {
        var result = [];
        var chatArr = null;

        // Method 1: ST global chat array (confirmed working in this version)
        if (typeof chat !== 'undefined' && Array.isArray(chat) && chat.length > 0) {
            chatArr = chat;
        }
        // Method 2: chat_metadata.chat
        if (!chatArr) {
            try {
                if (typeof chat_metadata !== 'undefined' && Array.isArray(chat_metadata.chat) && chat_metadata.chat.length > 0) {
                    chatArr = chat_metadata.chat;
                }
            } catch(e) {}
        }
        // Method 3: SillyTavern.getContext()
        if (!chatArr) {
            try {
                if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
                    var ctx = SillyTavern.getContext();
                    if (ctx && Array.isArray(ctx.chat) && ctx.chat.length > 0) {
                        chatArr = ctx.chat;
                    }
                }
            } catch(e) {}
        }

        if (chatArr) {
            for (var i = 0; i < chatArr.length; i++) {
                var msg = chatArr[i];
                if (!msg || !msg.mes) continue;
                var speaker = 'Unknown';
                if (typeof name1 !== 'undefined' && msg.is_user) speaker = name1;
                else if (typeof name2 !== 'undefined' && !msg.is_user) speaker = name2;
                else {
                    // Try to extract from msg name field
                    if (msg.name) speaker = msg.name;
                    else if (msg.is_user) speaker = 'You';
                }
                result.push({
                    speaker: speaker,
                    text: msg.mes.trim().substring(0, 500),
                    timestamp: msg.send_date ? new Date(msg.send_date).getTime() : Date.now(),
                    raw: msg
                });
            }
            this.messages = result;
            return;
        }

        // Fallback: DOM scrape (only when internal access fails)
        console.log('[Phone Extension] Databank: No internal chat available, falling back to DOM');
        var msgEls = document.querySelectorAll('#chat .mes');
        if (!msgEls.length) { return; }
        for (var i = 0; i < msgEls.length; i++) {
            var mesText = msgEls[i].querySelector('.mes_text, .text');
            var text = mesText ? mesText.textContent.trim().substring(0, 500) : '';
            if (!text) continue;
            var speaker = 'Unknown';
            var mesBlock = msgEls[i];
            // Try data attributes first
            var authorAttr = mesBlock.getAttribute('data-author')
                || mesBlock.getAttribute('data-character')
                || mesBlock.getAttribute('ch_name');
            if (authorAttr) {
                speaker = authorAttr.trim();
            } else if (msgEls[i].classList.contains('me')) {
                speaker = (typeof name1 !== 'undefined') ? name1 : 'You';
            } else {
                // Try extracting from DOM structure
                var nameEl = mesBlock.querySelector('.mes_name, .char-name, [data-name]');
                if (nameEl) speaker = nameEl.textContent.trim();
            }
            result.push({ speaker: speaker, text: text, timestamp: Date.now(), raw: null });
        }
        this.messages = result;
    },

    /**
     * Get the last N messages from the databank.
     */
    getLastMessages: function(count) {
        if (!count) count = 10;
        if (this.messages.length === 0) this.scrape();
        return this.messages.slice(-count);
    },

    /**
     * Get recent messages as a single string for LLM context.
     */
    getContextString: function(count) {
        var recent = this.getLastMessages(count || 10);
        if (recent.length === 0) return '';
        var parts = [];
        for (var i = 0; i < recent.length; i++) {
            parts.push(recent[i].speaker + ': ' + recent[i].text);
        }
        return parts.join('\n');
    },

    /**
     * Refresh from ST chat array if available. Used after chat load.
     */
    forceRefresh: function() {
        this.scrape();
        console.log('[Phone Extension] Databank forceRefresh: ' + this.messages.length + ' messages cached');
        // Auto-trigger contact scan after refresh
        if (this.messages.length > 0) {
            performContactScan();
        }
    },

    /**
     * Start: polling + MutationObserver + ST event hooks.
     */
    start: function() {
        this.scrape();
        var self = this;

        // Poll every 3s (less aggressive, ST chat array is now primary)
        if (this._pollInterval) clearInterval(this._pollInterval);
        this._pollInterval = setInterval(function() {
            var oldLen = self.messages.length;
            self.scrape();
            if (self.messages.length !== oldLen) {
                console.log('[Phone Extension] Databank: detected change, ' + self.messages.length + ' messages');
            }
        }, 3000);

        // MutationObserver for DOM-based fallback
        if (window.MutationObserver && !this._observer) {
            var chatContainer = document.querySelector('#chat');
            if (chatContainer) {
                this._observer = new MutationObserver(function(mutations) {
                    var changed = false;
                    for (var m = 0; m < mutations.length; m++) {
                        if (mutations[m].addedNodes.length > 0) { changed = true; break; }
                    }
                    if (changed) { self.scrape(); }
                });
                this._observer.observe(chatContainer, { childList: true, subtree: true });
            }
        }

        // Hook into ST's chat events
        if (!this._stEventBound) {
            this._stEventBound = true;
            // ST fires chat_updated when a new message arrives
            if (typeof jQuery !== 'undefined') {
                $(document).on('chat_updated', function() {
                    self.forceRefresh();
                });
                // Also listen for chatChanged (character switch)
                $(document).on('chatChanged', function() {
                    self.forceRefresh();
                });
            }
            // Also try SillyTavern's event system
            if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.subscribe === 'function') {
                try {
                    SillyTavern.subscribe('chat_updated', function() { self.forceRefresh(); });
                    SillyTavern.subscribe('chatChanged', function() { self.forceRefresh(); });
                } catch(e) {}
            }
        }
        console.log('[Phone Extension] ChatDatabank started');
    },

    stop: function() {
        if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
        if (this._observer) { this._observer.disconnect(); this._observer = null; }
        if (typeof jQuery !== 'undefined') {
            $(document).off('chat_updated');
            $(document).off('chatChanged');
        }
        this._stEventBound = false;
    }
};

// ============================================================
// CHAT LORE EXTRACTOR — pulls world-building facts from chat
// ============================================================
var ChatLoreExtractor = {
    /* Pattern-matchers for fictional world details embedded in RP messages */
    patterns: [
        { key: 'locations', re: /(?:at|in|near|to|from|entering?|leaving?|arriving?\s+(?:at|in))\s+([A-Z][A-Za-z\s\'-]{2,40}(?:Street|Road|Avenue|City|Town|Village|District|Forest|Mountain|Temple|School|Castle|Palace|Bar|Caf[eé]|Restaurant|Market|Arena|Tower|Gates|Bridge|River|Lake|Sea|Ocean|Park|Garden|Library|Inn|Shop|Hall|Ramen|Station|Dungeon|Base|Room))/gi },
        { key: 'characters', re: /(?:\b(?:the\s+)?[Cc]haracter\s+(?:named\s+)?|\b(?:called|named)\s+)([A-Z][A-Za-z\'-]{1,30})\b/gi },
        { key: 'items', re: /(?:hold(?:ing|s)?|pull(?:ing|s)?|take(?:ing|s)?|grab(?:bing)?|pick(?:ing)?\s+up|use(?:ing)?|wield(?:ing)?|draw(?:ing)?|equip(?:ping)?)\s+(?:the\s+)?(?:a\s+)?([A-Za-z][A-Za-z\s\'-]{2,30})(?:\s+(?:sword|blade|dagger|staff|wand|potion|scroll|book|ring|amulet|armor|weapon|tool|device|object|item|map|key|note|letter|coin))?/gi },
        { key: 'places', re: /(?:go(?:ing|es)?\s+)?(?:to|at)\s+(?:the\s+)?([A-Z][A-Za-z\s\'-]{2,40}(?:Village|City|Town|School|Ramen|Shop|Inn|Library|Forest|Temple|Castle|Palace|Tower|Market|District|Arena))/gi },
    ],

    /**
     * Extract lore facts from the last N chat messages.
     * Returns an object like { locations: ['Ichiraku Ramen'], characters: [...], items: [...] }
     */
    extract: function(count) {
        if (!count) count = 50;
        var facts = { locations: [], characters: [], items: [], relationships: [], events: [] };
        var chatMessages = this._getChatMessages(count);
        if (!chatMessages.length) return facts;

        var seen = {};
        for (var mi = 0; mi < chatMessages.length; mi++) {
            var text = chatMessages[mi];
            // Run all regex patterns
            for (var pi = 0; pi < this.patterns.length; pi++) {
                var pat = this.patterns[pi];
                var m;
                pat.re.lastIndex = 0; // reset
                while ((m = pat.re.exec(text)) !== null) {
                    var val = m[1].trim();
                    if (val.length < 2 || val.length > 50) continue;
                    var key = val.toLowerCase();
                    if (!seen[key]) {
                        seen[key] = true;
                        facts[pat.key].push(val);
                    }
                }
            }

            // Heuristic: anything after colon that looks like a named location
            var locRe = /(?:at|near|inside|outside|beside|in front of)\s+(?:the\s+)?([A-Z][A-Za-z\s']{2,40})/g;
            var m2;
            locRe.lastIndex = 0;
            while ((m2 = locRe.exec(text)) !== null) {
                var loc = m2[1].trim();
                if (loc.length > 2 && loc.length < 50 && !seen[loc.toLowerCase()]) {
                    // Filter out common false positives
                    var stopWords = ['the','same','time','moment','dark','light','middle','center','front','back','side','top','bottom','room','corner','door','window','wall','floor','ceiling','sky','ground','water','fire','air','earth'];
                    if (stopWords.indexOf(loc.toLowerCase()) === -1 && loc.split(' ').length <= 6) {
                        seen[loc.toLowerCase()] = true;
                        facts.locations.push(loc);
                    }
                }
            }
        }

        // Keep only what we actually found
        var result = {};
        for (var fk in facts) {
            if (facts[fk].length > 0) result[fk] = facts[fk];
        }
        console.log('[Phone Extension] Lore extraction:', JSON.stringify(result));
        return result;
    },

    /**
     * Format lore facts into a readable string for LLM prompts.
     */
    formatForPrompt: function(facts) {
        var lines = [];
        if (facts.locations && facts.locations.length) {
            lines.push('Known places/locations: ' + facts.locations.slice(0, 15).join(', '));
        }
        if (facts.characters && facts.characters.length) {
            lines.push('Characters mentioned: ' + facts.characters.slice(0, 15).join(', '));
        }
        if (facts.items && facts.items.length) {
            lines.push('Items/objects: ' + facts.items.slice(0, 10).join(', '));
        }
        return lines.join('\n');
    },

    /**
     * Get chat messages from multiple sources (DOM scrape, ST array, ST object).
     */
    _getChatMessages: function(count) {
        var messages = [];

        // Source 1: ChatDatabank (already DOM-scraped)
        if (ChatDatabank && ChatDatabank.messages && ChatDatabank.messages.length > 0) {
            for (var di = 0; di < ChatDatabank.messages.length; di++) {
                messages.push(ChatDatabank.messages[di].text);
            }
            if (messages.length > count) messages = messages.slice(messages.length - count);
            return messages;
        }

        // Source 2: ST chat as array
        try {
            if (typeof chat !== 'undefined' && Array.isArray(chat) && chat.length > 0) {
                var start = Math.max(0, chat.length - count);
                for (var ai = start; ai < chat.length; ai++) {
                    if (chat[ai] && chat[ai].mes) messages.push(chat[ai].mes);
                }
                return messages;
            }
        } catch(e) {}

        // Source 3: ST chat as object (newer ST versions store as { 0: {...}, 1: {...}, ... })
        try {
            if (typeof chat !== 'undefined' && chat !== null && typeof chat === 'object' && !Array.isArray(chat)) {
                var keys = Object.keys(chat).filter(function(k) { return !isNaN(k); }).sort(function(a, b) { return parseInt(a) - parseInt(b); });
                var startKeys = keys.slice(Math.max(0, keys.length - count));
                for (var ki = 0; ki < startKeys.length; ki++) {
                    var entry = chat[startKeys[ki]];
                    if (entry) {
                        var mes = entry.mes || entry.message || entry.content || '';
                        if (mes) messages.push(mes);
                    }
                }
                return messages;
            }
        } catch(e) {}

        // Source 4: DOM scrape one-time
        var selectors = ['#chat .mes .mes_text', '.mes .mes_text', '#chat .mes .text'];
        for (var s = 0; s < selectors.length; s++) {
            var els = document.querySelectorAll(selectors[s]);
            if (els.length > 0) {
                var start2 = Math.max(0, els.length - count);
                for (var ei = start2; ei < els.length; ei++) {
                    var t = (els[ei].textContent || '').trim();
                    if (t) messages.push(t);
                }
                return messages;
            }
        }
        return messages;
    }
};

// ============================================================
// STORY INTEGRATION
// ============================================================
function injectMessageToStory(text, direction, contactName) {
    if (!getSettings().addToStory) return;
    var chatMsgs = getChatMessagesSafe();
    if (!chatMsgs) return;

    var user = (typeof name1 !== 'undefined') ? name1 : 'You';
    var char = contactName || ((typeof name2 !== 'undefined') ? name2 : 'Unknown');
    
    var storyText;
    if (direction === 'sent') {
        storyText = `[📱 You sent ${char} a text: "${text}"]`;
    } else {
        storyText = `[📱 ${char} texted you: "${text}"]`;
    }

    var storyObj = {
        is_system: true,
        is_user: false,
        mes: storyText,
        extra: { display_text: storyText },
        send_date: new Date().toLocaleString(),
        creates: []
    };
    // Push via the safe accessor
    pushChatMessageSafe(storyObj);

    // Trigger ST UI update if available
    if (typeof addOneMessage === 'function') {
        var idx = getChatLengthSafe() - 1;
        addOneMessage(storyObj, { type: 'system', chat: idx, force: true, power: 2 });
    } else if (typeof reload_message === 'function') {
        reload_message(getChatLengthSafe() - 1);
    } else if (typeof reloadMessage === 'function') {
        reloadMessage(getChatLengthSafe() - 1);
    }
    
    // Ensure it's saved
    if (typeof saveChatConditional === 'function') saveChatConditional();
}

// ============================================================
// ============================================================
// CONTACT SCANNING — scan chat messages for mentioned NPCs
// ============================================================

/*
 * Builds a list of known character names for the current chat session.
 * Multi-method: globals → SillyTavern.getContext() → DOM → characters array scan.
 */
function getKnownCharacterNames() {
    var names = new Set();

    // 1. Global name2 (works in some ST versions)
    if (typeof name2 !== 'undefined' && name2) {
        names.add(name2);
    }

    // 2. SillyTavern.getContext() — most reliable for newer ST
    try {
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
            var ctx = SillyTavern.getContext();
            if (ctx) {
                // Try ctx.name2
                if (ctx.name2) names.add(ctx.name2);
                // Try ctx.chat[0] for the character name
                if (ctx.name1 || ctx.name2) {
                    // Some ST versions have ctx.name2
                }
                // Try group members if in group chat
                if (ctx.groupMembers && Array.isArray(ctx.groupMembers)) {
                    for (var gm = 0; gm < ctx.groupMembers.length; gm++) {
                        if (ctx.groupMembers[gm] && ctx.groupMembers[gm].name) {
                            names.add(ctx.groupMembers[gm].name);
                        }
                    }
                }
            }
        }
    } catch(e) {}

    // 3. characters array — scan for active character via this_chid or index 0
    if (typeof characters !== 'undefined') {
        if (typeof this_chid !== 'undefined' && characters[this_chid]) {
            if (characters[this_chid].name) names.add(characters[this_chid].name);
        } else if (typeof chid !== 'undefined' && characters[chid]) {
            if (characters[chid].name) names.add(characters[chid].name);
        } else if (Array.isArray(characters) && characters.length > 0) {
            // Some ST versions store as array
            for (var c = 0; c < characters.length && c < 5; c++) {
                if (characters[c] && characters[c].name) names.add(characters[c].name);
            }
        } else if (typeof characters === 'object') {
            // Some ST versions store as object {0: {...}, 1: {...}}
            var keys = Object.keys(characters).sort(function(a, b) { return parseInt(a) - parseInt(b); });
            for (var k = 0; k < keys.length && k < 5; k++) {
                if (characters[keys[k]] && characters[keys[k]].name) names.add(characters[keys[k]].name);
            }
        }
    }

    // 4. DOM extraction — always run as final catch
    var domSelectors = [
        '#character_name_animation',
        '#character_name',
        '.char-name-element',
        '.character_name',
        '#rightNavHolder .char_name',
        '#rm_info_char_name',
        '.interact_p .character_name',
        '.mes_group .mes_name'
    ];
    for (var s = 0; s < domSelectors.length; s++) {
        var el = document.querySelector(domSelectors[s]);
        if (el && el.textContent.trim()) {
            names.add(el.textContent.trim());
        }
    }

    // 5. jQuery-based: get the current character from ST's internal state
    if (typeof jQuery !== 'undefined' && !names.size) {
        try {
            var $ = jQuery;
            // Try #selected_t character textarea
            var selectedChar = $('#selected_t').val();
            if (selectedChar) names.add(selectedChar);
        } catch(e) {}
    }

    console.log('[Phone Extension] getKnownCharacterNames returning ' + names.size + ' characters:', Array.from(names));
    return Array.from(names);
}

/*
 * Gets a batch of recent chat message texts for scanning.
 * Returns an array of message text strings.
 */
function _getSafeChatTextBatch(count) {
    var result = [];
    try {
        // Try to use SillyTavern's getChatMessagesSafe if available
        var msgs = null;
        if (typeof getChatMessagesSafe === 'function') {
            msgs = getChatMessagesSafe();
        } else if (typeof SillyTavern !== 'undefined' && SillyTavern.getChatMessages) {
            msgs = SillyTavern.getChatMessages();
        } else if (typeof chat_metadata !== 'undefined' && chat_metadata && chat_metadata.chat && Array.isArray(chat_metadata.chat)) {
            msgs = chat_metadata.chat;
        }
        
        if (msgs && msgs.length) {
            var start = Math.max(0, msgs.length - count);
            for (var i = start; i < msgs.length; i++) {
                if (msgs[i] && msgs[i].mes) {
                    result.push(msgs[i].mes);
                }
            }
            return result;
        }
        
        // Fallback: scrape from DOM
        console.log('[Phone Extension] Falling back to DOM scraping for chat messages');
        var messageElements = document.querySelectorAll('#chat .mes .mes_text, .mes .mes_text, #chat .mes .text, .mes .text');
        var limit = Math.min(count, messageElements.length);
        var startIdx = messageElements.length - limit;
        for (var i = startIdx; i < messageElements.length; i++) {
            var text = messageElements[i].textContent.trim();
            if (text) {
                result.push(text);
            }
        }
    } catch(e) {
        console.warn('[Phone Extension] _getSafeChatTextBatch error:', e);
    }
    return result;
}

/*
 * Scans the last N chat messages for character names (both spoken and mentioned).
 * Adds any new characters found as phone contacts.
 */
var scanRetryCount = 0;
var MAX_SCAN_RETRIES = 5;

function scanChatForContacts() {
    // Check if chat is loaded before scanning
    var chatLoaded = false;
    if (typeof chat !== 'undefined' && Array.isArray(chat) && chat.length > 0) {
        chatLoaded = true;
    } else if (typeof chat_metadata !== 'undefined' && chat_metadata && chat_metadata.chat && Array.isArray(chat_metadata.chat) && chat_metadata.chat.length > 0) {
        chatLoaded = true;
    } else {
        var msgCount = document.querySelectorAll('#chat .mes').length;
        if (msgCount > 0) chatLoaded = true;
    }
    
    if (!chatLoaded) {
        scanRetryCount++;
        if (scanRetryCount <= 10) {
            console.log('[Phone Extension] Chat not loaded yet (attempt ' + scanRetryCount + '/10), waiting...');
            setTimeout(scanChatForContacts, 2000);
        } else {
            console.log('[Phone Extension] Chat still not loaded after 20s, scanning anyway');
            scanRetryCount = 0;
            performContactScan();
        }
        return;
    }
    
    scanRetryCount = 0;
    performContactScan();
}

function performContactScan() {
    var knownNames = getKnownCharacterNames();
    
    // Debug logging
    console.log('[Phone Extension] scanChatForContacts: knownNames=', knownNames);
    
    // Always ensure the current character is added as a contact
    var currentCharName = null;
    
    // Method 1: Try name2 (most reliable)
    if (typeof name2 !== 'undefined' && name2) {
        currentCharName = name2;
        console.log('[Phone Extension] Current character via name2:', currentCharName);
    }
    
    // Method 2: Try characters[this_chid]
    if (!currentCharName && typeof characters !== 'undefined' && typeof this_chid !== 'undefined') {
        if (characters[this_chid] && characters[this_chid].name) {
            currentCharName = characters[this_chid].name;
            console.log('[Phone Extension] Current character via characters[this_chid]:', currentCharName);
        }
    }
    
    // Method 3: Try DOM (least reliable)
    if (!currentCharName) {
        var selectors = ['#character_name_animation', '#character_name', '.char-name-element', '.character_name'];
        for (var s = 0; s < selectors.length; s++) {
            var charHeader = document.querySelector(selectors[s]);
            if (charHeader && charHeader.textContent.trim()) {
                currentCharName = charHeader.textContent.trim();
                console.log('[Phone Extension] Current character via DOM (' + selectors[s] + '):', currentCharName);
                break;
            }
        }
    }
    if (currentCharName && knownNames.includes(currentCharName)) {
        var added = addOrUpdateContact(currentCharName, true);
        console.log('[Phone Extension] Added/updated current character contact:', currentCharName, 'new=', added);
    }
    
    if (!knownNames.length) return;

    var chatHist = _getSafeChatTextBatch(50);
    // Also scrape from DOM as a second source
    var msgBlocks = document.querySelectorAll('#chat .mes .mes_text, .mes .mes_text, #chat .mes .text');
    var domLimit = Math.min(50, msgBlocks.length);
    var domStart = msgBlocks.length - domLimit;
    for (var dm = domStart; dm < msgBlocks.length; dm++) {
        var t = (msgBlocks[dm].textContent || '').trim();
        if (t) chatHist.push(t);
    }
    // Deduplicate while preserving order
    var seenText = {};
    var deduped = [];
    for (var dd = chatHist.length - 1; dd >= 0; dd--) {
        if (!seenText[chatHist[dd]]) {
            seenText[chatHist[dd]] = true;
            deduped.unshift(chatHist[dd]);
        }
    }
    chatHist = deduped;
    if (!chatHist.length) {
        console.log('[Phone Extension] Contact scan: no chat text available');
        return;
    }

    var found = new Set();
    var lowerKnown = {};
    for (var ki = 0; ki < knownNames.length; ki++) {
        lowerKnown[knownNames[ki].toLowerCase()] = knownNames[ki];
    }

    for (var mi = 0; mi < chatHist.length; mi++) {
        var msg = chatHist[mi].toLowerCase();
        for (var ki2 = 0; ki2 < knownNames.length; ki2++) {
            var nm = knownNames[ki2];
            // Match the character name as a whole word (with word boundaries)
            var re = new RegExp('\\b' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
            if (re.test(msg)) {
                found.add(nm);
            }
        }
        // Also try to extract names from common patterns like "@Name", "Name said", etc.
        var extractRe = /(?:@|"|\'|\s|^)([A-Z][a-zA-Z\s]{1,20})(?:\b(?:said|replied|texted|walked|looked|asked|smiled|laughed| nodded|whispered|shouted|spoke))?/g;
        var m;
        while ((m = extractRe.exec(chatHist[mi])) !== null) {
            var candidate = m[1].replace(/["'@\s]/g, '').trim();
            if (lowerKnown[candidate.toLowerCase()]) {
                found.add(lowerKnown[candidate.toLowerCase()]);
            }
        }
    }

    // Add all found characters as contacts
    var newContacts = 0;
    var foundArr = Array.from(found);
    for (var fi = 0; fi < foundArr.length; fi++) {
        if (addOrUpdateContact(foundArr[fi], false)) {
            newContacts++;
        }
    }

    if (newContacts > 0) {
        console.log('[Phone Extension] Scanned chat: found ' + newContacts + ' new contact(s)');
        savePhoneData();
        renderUI();
    }
}

/*
 * Adds a character as a phone contact if it doesn't already exist.
 * Returns true if a new contact was added, false if it already existed.
 */
function addOrUpdateContact(charName, isMainCharacter) {
    if (!charName) return false;
    var existing = phoneData.contacts.find(function(c) { return c.name === charName; });
    if (existing) {
        if (isMainCharacter && !existing.isMainCharacter) {
            existing.isMainCharacter = true;
            savePhoneData();
        }
        return false;
    }
    var contact = {
        id: randId(),
        name: charName,
        phone: 'N/A',
        avatar: '',
        isCharacter: true,
        isMainCharacter: !!isMainCharacter,
    };
    phoneData.contacts.push(contact);
    console.log('[Phone Extension] Added contact:', charName, isMainCharacter ? '(main)' : '(mentioned in chat)');
    return true;
}

// Backwards-compatible alias
var autoDetectContact = scanChatForContacts;

// ============================================================
// NPC AUTO-TEXT ENGINE
// ============================================================
var npcTimer = null;

function startNpcAutoTextEngine() {
    stopNpcAutoTextEngine();
    if (!getSettings().npcAutoTexts) return;

    var ms = getSettings().npcTextFrequency * 60000;
    npcTimer = setInterval(triggerNpcAutoText, ms);
    console.log('[Phone Extension] NPC auto-text engine started (every ' + getSettings().npcTextFrequency + 'm)');
}

function stopNpcAutoTextEngine() {
    if (npcTimer) { clearInterval(npcTimer); npcTimer = null; }
}

function triggerNpcAutoText() {
    if (!getSettings().npcAutoTexts) return;

    // Prevent if chatting happened recently (e.g., within 2 mins)
    var lastChat = getLastChatTimestamp();
    if (Date.now() - lastChat < 120000) return;

    // Gather all character contacts
    var allContacts = phoneData.contacts.filter(function(c){ return c.isCharacter; });
    if (!allContacts.length) return;

    // Pick randomly among them, but slightly weight toward the main character
    var mainContacts = allContacts.filter(function(c){ return c.isMainCharacter; });
    var contact;
    if (mainContacts.length > 0 && Math.random() < 0.6) {
        contact = mainContacts[Math.floor(Math.random() * mainContacts.length)];
    } else {
        // Pick from ALL contacts, avoiding the one who texted most recently
        var sorted = allContacts.slice().sort(function(a, b) {
            var aLast = getLastMessageTimestamp(a.id) || 0;
            var bLast = getLastMessageTimestamp(b.id) || 0;
            return aLast - bLast;
        });
        contact = sorted[0];
    }

    generateNpcText(contact);
}

function getLastMessageTimestamp(contactId) {
    if (!phoneData.messages || !phoneData.messages.length) return 0;
    var last = 0;
    for (var i = 0; i < phoneData.messages.length; i++) {
        if (phoneData.messages[i].contactId === contactId && phoneData.messages[i].timestamp > last) {
            last = phoneData.messages[i].timestamp;
        }
    }
    return last;
}

function getLastChatTimestamp() {
    try {
        var msgs = getChatMessagesSafe();
        if (msgs && msgs.length > 0) {
            var last = msgs[msgs.length - 1];
            if (last && last.send_date) {
                return new Date(last.send_date).getTime();
            }
        }
    } catch(e) {}
    return Date.now() - 3600000; // Fallback: 1 hr ago
}

async function generateNpcText(contact) {
    var user = (typeof name1 !== 'undefined') ? name1 : 'You';
    var charName = contact.name;
    var systemPrompt = `You are ${charName}. You are texting the user on a phone. Keep the message short, casual, and in character. Max 20 words.`;
    var context = `The last thing you chatted about was a while ago. Text ${user} something relevant to your personality.`;

    var s = getSettings();
    var apiBase = s.phoneApiUrl || '';
    var apiKey = s.phoneApiKey || '';
    var apiModel = s.phoneApiModel || 'gpt-4o-mini';
    
    // If API settings are configured, use them; otherwise, fallback to built-in API
    if (apiBase && apiKey) {
        apiBase = apiBase.replace(/\/$/, '');
        var url = apiBase + '/chat/completions';
        var headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
        };
        var body = JSON.stringify({
            model: apiModel,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: context }
            ],
            max_tokens: 50,
            temperature: 1.0
        });
        
        try {
            var res = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: body
            });
            var data = await res.json();
            if (data && data.choices && data.choices[0] && data.choices[0].message) {
                var text = data.choices[0].message.content.replace(/^["']|["']$/g,'').substring(0, 140);
                receiveNpcText(contact, text);
                console.log('[Phone Extension] NPC text generated via dedicated API (model: ' + apiModel + ')');
                return;
            }
        } catch (e) {
            console.warn('[Phone Extension] LLM text generation failed (url: ' + url + '):', e.message);
        }
    }
    
    // Fallback to local API if dedicated API fails or is not configured
    try {
        var res = await fetch('/api/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer no-key-needed-for-localhost' },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: context }
                ],
                max_tokens: 50,
                temperature: 1.0
            })
        });
        var data = await res.json();
        if (data && data.choices && data.choices[0] && data.choices[0].message) {
            var text = data.choices[0].message.content.replace(/^["']|["']$/g,'').substring(0, 140);
            receiveNpcText(contact, text);
            return;
        }
    } catch (e) {
        console.warn('[Phone Extension] Local LLM text generation failed:', e.message);
    }

    // Fallback: contextual generic
    var fallbacks = [
        "Hey, just thinking about you.", "What are you up to?", "Miss our last chat.",
        "Random thought: the world's weird, huh?", "Coffee? 🍵", "How's your day going?",
        "Sent you a meme, check it later. 😂"
    ];
    receiveNpcText(contact, fallbacks[Math.floor(Math.random()*fallbacks.length)]);
}

function receiveNpcText(contact, text) {
    phoneData.messages.push({
        id: randId(), contactId: contact.id, text: text,
        direction: 'received', timestamp: Date.now()
    });
    savePhoneData();
    injectMessageToStory(text, 'received', contact.name);
    
    // Show notification if enabled and not currently in messages
    if (getSettings().notifications && activeApp !== 'messages') {
        if (typeof toastr !== 'undefined') {
            toastr.info(`${contact.name}: ${text.substring(0,30)}${text.length>30?'...':''}`, '📱 New Text');
        }
    }

    // Update UI if messages app open
    if (activeContactId === contact.id && activeApp === 'messages') {
        renderUI();
    } else {
        // Update dock badge or pulse if implemented
        var dock = document.querySelector('[data-dock="messages"]');
        if (dock) dock.style.color = '#ff4444';
    }
}

// ============================================================
// NPC FOLLOW-UP TEXT — triggered after ST chat messages
// ============================================================
function triggerNpcFollowUpText() {
    if (!getSettings().npcAutoTexts) return;
    var allContacts = phoneData.contacts.filter(function(c){ return c.isCharacter; });
    if (!allContacts.length) return;

    // 30% chance to send a follow-up text after a chat message
    if (Math.random() > 0.3) return;

    // Pick main character first, otherwise random
    var mains = allContacts.filter(function(c){ return c.isMainCharacter; });
    var contact = mains.length > 0
        ? mains[Math.floor(Math.random() * mains.length)]
        : allContacts[Math.floor(Math.random() * allContacts.length)];

    generateNpcText(contact, true);
}

// Backwards-compatible alias — in case old code references it
var autoDetectContact = scanChatForContacts;

// ============================================================
// EVENT SYNC
// ============================================================
if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
    eventSource.on(event_types.CHAT_CHANGED, function() {
        savePhoneData(true);
        phoneData = loadPhoneData();
        activeApp = phoneData._activeApp || 'phone';
        activeContactId = null;
        activeSocialTab = 'feed';
        renderUI();
        scanChatForContacts();
        startNpcAutoTextEngine();
    });
    eventSource.on(event_types.USER_MESSAGE_RENDERED, onUserMessage);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onCharacterMessage);
}

function onUserMessage() {
    scanChatForContacts();
    getSettings().lastAutoText = Date.now();

    // Analyze the latest user message for NPC mentions that should react
    var msgs = getChatMessagesSafe();
    if (!msgs || !msgs.length) return;
    var lastMsg = msgs[msgs.length - 1];
    if (!lastMsg || lastMsg.is_user !== true) return;
    var text = lastMsg.mes || '';
    var lowerText = text.toLowerCase();
    var contacts = phoneData.contacts.filter(function(c) { return c.isCharacter; });

    // Check if user mentioned other characters by name
    for (var i = 0; i < contacts.length; i++) {
        var c = contacts[i];
        var re = new RegExp('\\b' + c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        if (re.test(text) && !c.isMainCharacter) {
            // Check cooldown — don't spam reactions for the same contact
            var lastMsgTime = getLastMessageTimestamp(c.id);
            if (Date.now() - lastMsgTime < 300000) continue; // 5 min cooldown
            triggerContextualReaction(c, text, 'mentioned');
            break; // only one reaction per user message
        }
    }
}

function onCharacterMessage() {
    scanChatForContacts();
    getSettings().lastAutoText = Date.now();

    var msgs = getChatMessagesSafe();
    if (!msgs || !msgs.length) return;
    var lastMsg = msgs[msgs.length - 1];
    if (!lastMsg || lastMsg.is_user === true) return;
    var text = lastMsg.mes || '';
    var lowerText = text.toLowerCase();
    var charName = (typeof name2 !== 'undefined') ? name2 : null;
    if (typeof characters !== 'undefined' && typeof this_chid !== 'undefined' && characters[this_chid]) {
        charName = characters[this_chid].name || charName;
    }
    var contacts = phoneData.contacts.filter(function(c) { return c.isCharacter; });

    // Check if the speaking character mentioned other characters
    for (var i = 0; i < contacts.length; i++) {
        var c = contacts[i];
        if (c.name === charName) continue;
        var re = new RegExp('\\b' + c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        if (re.test(text)) {
            var lastMsgTime = getLastMessageTimestamp(c.id);
            if (Date.now() - lastMsgTime < 300000) continue;
            triggerContextualReaction(c, text, 'mentioned_by_' + (charName || 'character'));
            break;
        }
    }

    // Check if the speaking character seems to be reacting to something dramatic
    var dramatic = /(?:goodbye|bye|leave|going|die|death|kill|hurt|cry|angry|upset|scared|love|kiss|hit|fight|run|hide)/i;
    if (dramatic.test(text) && charName) {
        var mainContact = contacts.find(function(c) { return c.isMainCharacter; });
        if (mainContact) {
            var lastTime = getLastMessageTimestamp(mainContact.id);
            if (Date.now() - lastTime > 180000) { // 3 min since last text
                triggerContextualReaction(mainContact, text, 'dramatic_event');
            }
        }
    }
}

/*
 * Triggers an LLM-generated text from a character contact based on a chat event.
 * eventType: 'mentioned' | 'mentioned_by_X' | 'dramatic_event' | 'follow_up'
 */
function triggerContextualReaction(contact, chatText, eventType) {
    if (!getSettings().npcAutoTexts) return;
    var user = (typeof name1 !== 'undefined') ? name1 : 'You';
    var charName = contact.name;

    var systemPrompt = `You are ${charName}. You are texting the user on a phone. Keep the message short, casual, and in character. Max 20 words.`;
    var context = '';
    switch (eventType) {
        case 'mentioned':
            context = `The user (${user}) just mentioned your name in a conversation. React naturally — you could be curious, amused, annoyed, or want to join in. Here's what they said: "${chatText.substring(0, 200)}". Text them about it.`;
            break;
        case 'mentioned_by_character':
        default:
            if (eventType.indexOf('mentioned_by_') === 0) {
                var speaker = eventType.replace('mentioned_by_', '');
                context = `${speaker} just talked about you in a conversation with ${user}. React as if you heard about it through a friend or somehow sensed it. Here's what was said: "${chatText.substring(0, 200)}". Text ${user} about it.`;
            } else if (eventType === 'dramatic_event') {
                context = `Something dramatic just happened in ${user}'s conversation. Here's what was said: "${chatText.substring(0, 200)}". Send a concerned, curious, or reactive text to ${user}.`;
            } else if (eventType === 'follow_up') {
                context = `You just finished chatting with ${user} in person. Send them a follow-up text — something casual, like a thought you had after, a joke, or a question. Keep it natural.`;
            }
            break;
    }

    // Add delay to feel realistic (2-8 seconds)
    var delay = 2000 + Math.floor(Math.random() * 6000);
    setTimeout(function() {
        generateNpcTextWithContext(contact, systemPrompt, context);
    }, delay);
}

async function generateNpcTextWithContext(contact, systemPrompt, context) {
    var s = getSettings();
    var apiBase = s.phoneApiUrl || '';
    var apiKey = s.phoneApiKey || '';
    var apiModel = s.phoneApiModel || 'gpt-4o-mini';
    
    // If API settings are configured, use them; otherwise, fallback to built-in API
    if (apiBase && apiKey) {
        apiBase = apiBase.replace(/\/$/, '');
        var url = apiBase + '/chat/completions';
        var headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
        };
        var body = JSON.stringify({
            model: apiModel,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: context }
            ],
            max_tokens: 50,
            temperature: 1.0
        });
        
        try {
            var res = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: body
            });
            var data = await res.json();
            if (data && data.choices && data.choices[0] && data.choices[0].message) {
                var text = data.choices[0].message.content.replace(/^["']|["']$/g, '').substring(0, 140);
                receiveNpcText(contact, text);
                console.log('[Phone Extension] Contextual text via dedicated API (model: ' + apiModel + ')');
                return;
            }
        } catch (e) {
            console.warn('[Phone Extension] Contextual LLM text generation failed (url: ' + url + '):', e.message);
        }
    }
    
    // Fallback to local API if dedicated API fails or is not configured
    try {
        var res = await fetch('/api/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer no-key-needed-for-localhost' },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: context }
                ],
                max_tokens: 50,
                temperature: 1.0
            })
        });
        var data = await res.json();
        if (data && data.choices && data.choices[0] && data.choices[0].message) {
            var text = data.choices[0].message.content.replace(/^["']|["']$/g, '').substring(0, 140);
            receiveNpcText(contact, text);
            return;
        }
    } catch (e) {
        console.warn('[Phone Extension] Contextual LLM text failed:', e.message);
    }
    // Fallback with contextual flavor
    var fallbacks = [
        "Hey, I heard something wild happened... what's going on?",
        "Did I just hear my name? 👀",
        "Saw the drama unfolding, you okay?",
        "Just checking in — everything good?",
        "That conversation looked intense lol"
    ];
    receiveNpcText(contact, fallbacks[Math.floor(Math.random() * fallbacks.length)]);
}

// ============================================================
// PHONE APP
// ============================================================
var PhoneApp = {
    _dialPad: '',
    render: function() {
        var keypad = '';
        var keys = ['1','2','3','4','5','6','7','8','9','*','0','#'];
        var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        for (var ki=0;ki<keys.length;ki++) {
            var k = keys[ki];
            var sub = '';
            if (k >= '2' && k <= '9') sub = '<small>' + letters[parseInt(k)-2] + '</small>';
            keypad += '<button class="pk" data-key="'+k+'"><span>'+k+'</span>'+sub+'</button>';
        }
        var recent = phoneData.phoneCalls.length === 0
            ? '<div class="pempty">No recent calls</div>'
            : phoneData.phoneCalls.slice().sort(function(a,b){return b.timestamp-a.timestamp;})
                .map(function(c) {
                    var co = phoneData.contacts.find(function(x){return x.id===c.contactId});
                    var nm = co ? co.name : 'Unknown';
                    var ph = co ? co.phone : 'Unknown';
                    var ic = c.status==='missed' ? 'fa-circle-xmark pcm' : c.type==='outgoing' ? 'fa-arrow-up pco' : 'fa-arrow-down pci';
                    return '<div class="pii">' +
                        '<div class="pav"><i class="fa-solid '+ic+'"></i></div>' +
                        '<div class="pinf"><span class="pname">'+nm+' <small>(' + ph + ')</small></span>' +
                        '<span class="pdet">' + fmtTime(c.timestamp) + ' \u00B7 ' + (c.status==='missed' ? 'Missed' : c.duration+'s') + '</span></div></div>';
                }).join('');
        var contacts = phoneData.contacts.length === 0
            ? '<div class="pempty">No contacts<br><small>Add via dialer</small></div>'
            : phoneData.contacts.map(function(c) {
                return '<div class="pii">' +
                    '<div class="pav">' + c.name[0].toUpperCase() + '</div>' +
                    '<div class="pinf"><span class="pname">' + c.name + '</span>' +
                    '<span class="pdet">' + c.phone + '</span></div>' +
                    '<button class="pmbtn" data-call-c="'+c.id+'"><i class="fa-solid fa-phone"></i></button></div>';
            }).join('');
        return '<div class="pa" data-app="call">' +
            '<div class="pa-header"><span class="pa-title"><i class="fa-solid fa-phone"></i> Phone</span>' +
            '<button class="pa-action" data-clear-calls="true"><i class="fa-solid fa-trash"></i></button></div>' +
            '<div class="pa-tabs">' +
            '<button class="pt active" data-section="dialer"><i class="fa-solid fa-keypad"></i> Dialer</button>' +
            '<button class="pt" data-section="recent"><i class="fa-solid fa-clock-rotate-left"></i> Recent</button>' +
            '<button class="pt" data-section="contacts"><i class="fa-solid fa-address-book"></i> Contacts</button></div>' +
            '<div class="pss active" data-section="dialer">' +
                '<div class="pdisp" id="pd"><span id="pdt"> </span></div>' +
                '<div class="ppad">'+keypad+'</div>' +
                '<div class="pcbar"><button class="pccb" data-call="true"><i class="fa-solid fa-phone"></i></button>' +
                '<button class="pbacks" data-backspace="true"><i class="fa-solid fa-delete-left"></i></button></div></div>' +
            '<div class="pss" data-section="recent">'+recent+'</div>' +
            '<div class="pss" data-section="contacts">'+contacts+'</div></div>';
    },
    addDigit: function(k) { if(this._dialPad.length<15){this._dialPad+=k;var e=document.getElementById('pdt');if(e)e.textContent+=k;} },
    backspace: function() { this._dialPad=this._dialPad.slice(0,-1); var e=document.getElementById('pdt'); if(e)e.textContent=this._dialPad||' '; },
    startCall: function() {
        var num=this._dialPad.trim(); if(!num){if(typeof toastr!=='undefined')toastr.info('Enter a number');return;}
        var co=phoneData.contacts.find(function(c){return c.phone===num;});
        if(!co){co={id:randId(),name:num,phone:num};phoneData.contacts.push(co);}
        var call={id:randId(),contactId:co.id,type:'outgoing',duration:0,status:'answered',timestamp:Date.now()};
        phoneData.phoneCalls.push(call); savePhoneData();
        var dur=20+Math.floor(Math.random()*260);
        var self=this;
        setTimeout(function(){call.duration=dur;savePhoneData();renderUI();
            if(typeof toastr!=='undefined') toastr.success('Call with '+co.name+' ('+dur+'s)');
            self._dialPad=''; document.getElementById('pdt').textContent=' ';
        },2000);
    },
    callContact: function(cid) {
        var co=phoneData.contacts.find(function(c){return c.id===cid;});if(!co)return;
        var call={id:randId(),contactId:co.id,type:'outgoing',duration:0,status:'answered',timestamp:Date.now()};
        phoneData.phoneCalls.push(call); savePhoneData();
        var dur=10+Math.floor(Math.random()*300);
        setTimeout(function(){call.duration=dur;savePhoneData();renderUI();
            if(typeof toastr!=='undefined') toastr.success('Call with '+co.name+' ('+dur+'s)');
        },2000);
    },
    clearCalls: function() { phoneData.phoneCalls=[];savePhoneData();renderUI(); }
};

// ============================================================
// MESSAGES APP
// ============================================================
var MessagesApp = {
    render: function() {
        var isConvo = !!activeContactId;
        var convos = this._getConvos();
        return '<div class="pa" data-app="messages">' +
            '<div class="pa-header"><span class="pa-title"><i class="fa-brands fa-telegram"></i> Messages</span></div>' +
            '<div class="pa-tabs">' +
            '<button class="pt ' + (!isConvo?'active':'') + '" data-msg-view="list">Conversations</button>' +
            '<button class="pt ' + (isConvo?'active':'') + '" data-msg-view="back">Back</button></div>' +
            (isConvo ? this._renderConvo() : this._renderConvoList(convos)) + '</div>';
    },
    _getConvos: function() {
        var m={};
        for(var i=0;i<phoneData.messages.length;i++){
            var msg=phoneData.messages[i];if(!m[msg.contactId])m[msg.contactId]=[];m[msg.contactId].push(msg);
        }
        var out=[];
        for(var cid in m){
            var co=phoneData.contacts.find(function(x){return x.id===cid});if(!co)continue;
            out.push({contact:co, msgs:m[cid], last:m[cid][m[cid].length-1]});
        }
        out.sort(function(a,b){return b.last.timestamp-a.last.timestamp});
        return out;
    },
    _renderConvoList: function(convos) {
        if(!convos.length) return '<div class="pempty">No conversations yet</div>';
        var html='';
        for(var ci=0;ci<convos.length;ci++){
            var v=convos[ci];
            html+='<div class="pii" data-open-c="'+v.contact.id+'">' +
                '<div class="pav">'+v.contact.name[0].toUpperCase()+'</div>' +
                '<div class="pinf"><div class="prow"><span class="pname">'+v.contact.name+'</span>' +
                '<span class="ptm">'+fmtAgo(v.last.timestamp)+'</span></div>' +
                '<span class="plast">'+v.last.text+'</span></div></div>';
        }
        return html;
    },
    _renderConvo: function() {
        var co=phoneData.contacts.find(function(c){return c.id===activeContactId;});
        if(!co) return '<div class="pempty">Contact not found</div>';
        var msgs=phoneData.messages.filter(function(m){return m.contactId===activeContactId}).sort(function(a,b){return a.timestamp-b.timestamp});
        var html='';
        for(var mi=0;mi<msgs.length;mi++){
            var m=msgs[mi];
            var cls=m.direction==='sent'?'sent':'received';
            html+='<div class="pm '+cls+'">' +
                '<div class="pbub"><span class="ptx">'+this._escapeHtml(m.text)+'</span></div>' +
                '<span class="ptm">'+fmtTime(m.timestamp)+'</span></div>';
        }
        return '<div class="pch">'+co.name+'</div>' +
            '<div class="pmsgs" id="pmsgs">'+html+'</div>' +
            '<div class="pinbar"><input class="ptxt" id="pmi" placeholder="Type a message..." />' +
            '<button class="psbtn" data-send-c="'+activeContactId+'"><i class="fa-solid fa-paper-plane"></i></button></div>';
    },
    _escapeHtml: function(t) { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); },
    sendMsg: function(cid) {
        var inp=document.getElementById('pmi');
        var txt=inp?inp.value.trim():'';if(!txt)return;
        
        phoneData.messages.push({id:randId(),contactId:cid,text:txt,direction:'sent',timestamp:Date.now()});
        savePhoneData();
        
        var co=phoneData.contacts.find(function(c){return c.id===cid;});
        if(co) {
            injectMessageToStory(txt, 'sent', co.name);
            renderUI();
            // Trigger auto-reply engine after user text
            if(getSettings().npcAutoTexts) {
                var self=this;
                setTimeout(function(){
                    generateNpcText(co);
                }, 2000 + Math.random()*3000);
            }
        } else {
            renderUI();
        }
    }
};

// ============================================================
// SOCIAL MEDIA APP
// ============================================================
var SocialApp = {
    render: function() {
        return '<div class="pa" data-app="social">' +
            '<div class="pa-header"><span class="pa-title"><i class="fa-solid fa-hashtag"></i> Social</span>' +
            '<button class="pa-action" data-new-post="true"><i class="fa-solid fa-plus"></i></button></div>' +
            '<div class="pa-tabs">' +
            '<button class="pt active" data-st="feed">Feed</button>' +
            '<button class="pt" data-st="saved">Saved ('+phoneData.social.savedPosts.length+')</button>' +
            '<button class="pt" data-st="compose">New Post</button></div>' +
            '<div class="pss active" data-section="feed">'+this._renderFeed()+'</div>' +
            '<div class="pss" data-section="saved">'+this._renderSaved()+'</div>' +
            '<div class="pss" data-section="compose">'+this._renderCompose()+'</div></div>';
    },
    _renderFeed: function() {
        if(!phoneData.social.feed.length) return '<div class="pempty">Nothing here yet<br><small>Compose a post!</small></div>';
        var sorted = phoneData.social.feed.slice().sort(function(a,b){return b.timestamp-a.timestamp;});
        var html='';
        for(var fi=0;fi<sorted.length;fi++) html+=this._renderPost(sorted[fi]);
        return html;
    },
    _renderSaved: function() {
        if(!phoneData.social.savedPosts.length) return '<div class="pempty">No saved posts yet</div>';
        var html='';
        for(var si=0;si<phoneData.social.savedPosts.length;si++) html+=this._renderPost(phoneData.social.savedPosts[si],true);
        return html;
    },
    _renderPost: function(post, isSaved) {
        var content = (post.content||'').replace(/\n/g,'<br>');
        var heartClass = 'fa-regular fa-heart' + (post.liked?' fa-solid tpink':'');
        var rtClass = 'fa-regular fa-retweet' + (post.retweeted?' fa-solid tgreen':'');
        var savedIcon = isSaved ? '<i class="fa-solid fa-bookmark pbsave" style="color:#4fc3f7"></i>' : '';
        return '<div class="ppost">' +
            '<div class="ppost-hdr">' +
            '<div class="ppost-auth"><span class="paname">'+post.author+'</span>' +
            '<span class="pahnd">'+post.authorHandle+'</span></div>' + savedIcon + '</div>' +
            '<div class="ppost-ct">' + content + '</div>' +
            '<div class="ppost-acts">' +
            '<button class="paction" data-action="like" data-post-id="'+post.id+'">' +
            '<i class="'+heartClass+'"></i> ' + (post.likes||0) + '</button>' +
            '<button class="paction" data-action="rt" data-post-id="'+post.id+'">' +
            '<i class="'+rtClass+'"></i> ' + (post.retweets||0) + '</button>' +
            '<button class="paction" data-action="save" data-post-id="'+post.id+'">' +
            '<i class="fa-regular fa-bookmark"></i></button></div></div>';
    },
    _renderCompose: function() {
        return '<div class="cform">' +
            '<textarea class="ctxt" id="sci" placeholder="What is happening?" maxlength="500"></textarea>' +
            '<div class="cact"><span class="ccount" id="cc">0/500</span>' +
            '<button class="cbtn" id="csb" disabled>Post</button></div></div>';
    },
    submitPost: function() {
        var inp=document.getElementById('sci');
        if(!inp||!inp.value.trim())return;
        phoneData.social.feed.push({
            id:randId(),author:'Me',authorHandle:'@user',content:inp.value.trim(),
            images:[],likes:0,retweets:0,timestamp:Date.now(),liked:false,retweeted:false,
        });
        savePhoneData();renderUI();
        if(typeof toastr!=='undefined') toastr.success('Post published!');
    },
    likePost: function(pid) {
        var arr=phoneData.social.feed.concat(phoneData.social.savedPosts);
        var p=arr.find(function(x){return x.id===pid});if(!p)return;
        p.liked=!p.liked;p.likes+=p.liked?1:-1;savePhoneData();renderUI();
    },
    retweetPost: function(pid) {
        var arr=phoneData.social.feed.concat(phoneData.social.savedPosts);
        var p=arr.find(function(x){return x.id===pid});if(!p)return;
        p.retweeted=!p.retweeted;p.retweets+=p.retweeted?1:-1;savePhoneData();renderUI();
    },
    savePost: function(pid) {
        var fed=phoneData.social.feed,sav=phoneData.social.savedPosts;
        var all=fed.concat(sav);
        var p=all.find(function(x){return x.id===pid});if(!p)return;
        var fromFed=fed.indexOf(p)>-1;
        if(fromFed){fed.splice(fed.indexOf(p),1);sav.push(JSON.parse(JSON.stringify(p)));}
        else{var i=sav.indexOf(p);if(i>-1)sav.splice(i,1);fed.push(p);}
        savePhoneData();renderUI();
    }
};

// ============================================================
// WEB BROWSER APP
// ============================================================
var BrowserApp = {
    render: function() {
        return '<div class="pa" data-app="browser">' +
            '<div class="pa-header"><span class="pa-title"><i class="fa-solid fa-globe"></i> Browser</span>' +
            '<button class="pa-action" data-urlbar="true"><i class="fa-solid fa-link"></i></button></div>' +
            '<div class="ptbar">'+this._renderTabs()+
            '<button class="ptadd" data-new-tab="true"><i class="fa-solid fa-plus"></i></button></div>' +
            this._renderContent() + '</div>';
    },
    _renderTabs: function() {
        if(!phoneData.browser.tabs.length) return '<div class="pempty">No tabs open</div>';
        var html='';
        for(var ti=0;ti<phoneData.browser.tabs.length;ti++){
            var t=phoneData.browser.tabs[ti];
            var a=t.id===phoneData.browser.activeTabId?' active':'';
            html+='<button class="ptr'+a+'" data-tid="'+t.id+'">' +
                '<span class="tt">'+(t.title||'New Tab')+'</span>' +
                '<button class="tclos" data-ctab="'+t.id+'"><i class="fa-solid fa-xmark"></i></button>' +
                '</button>';
        }
        return html;
    },
    _renderContent: function() {
        var tab=phoneData.browser.tabs.find(function(t){return t.id===phoneData.browser.activeTabId;});
        if(!tab) return '<div class="pempty">No tabs<br><small>Open a new tab!</small></div>';
        var urlVal=tab.url?tab.url.replace(/"/g,'&quot;'):'';
        return '<div class="pubar" id="pbar">' +
            '<input class="put" id="burl" value="'+urlVal+'" placeholder="Enter URL or search..."/>' +
            '<button class="pgobtn" data-gourl="true"><i class="fa-solid fa-arrow-right"></i></button>' +
            '<button class="pkmbtn" data-bookmark="true"><i class="fa-regular fa-bookmark"></i></button>' +
            '</div>' +
            '<div class="pbcont">' + (tab.html || this._newTab()) + '</div>';
    },
    _newTab: function() {
        var links=[
            {n:'Wiki',u:'w:Wikipedia',c:'#636363',i:'fa-brands fa-wikipedia-w'},
            {n:'Example',u:'w:Example',c:'#2aa198',i:'fa-solid fa-paragraph'},
            {n:'News',u:'w:News',c:'#dc322f',i:'fa-solid fa-newspaper'},
            {n:'Tech',u:'w:Technology',c:'#6c71c4',i:'fa-solid fa-microchip'},
        ];
        var lk='';
        for(var li=0;li<links.length;li++){
            lk+='<button class="ql" data-nav="'+links[li].u+'">' +
                '<div class="qli" style="background:'+links[li].c+'"><i class="'+links[li].i+'"></i></div><span>'+links[li].n+'</button>';
        }
        return '<div class="ntp"><h2><i class="fa-solid fa-globe"></i> Quick Browse</h2>' +
            '<div class="qlinks">'+lk+'</div></div>';
    },
    openNewTab: function() {
        var id=randId();
        phoneData.browser.tabs.push({id:id,title:'New Tab',url:'',html:this._newTab(),ts:Date.now()});
        phoneData.browser.activeTabId=id;savePhoneData();renderUI();
    },
    navigateTo: function(tabId, url) {
        var tab=phoneData.browser.tabs.find(function(t){return t.id===tabId;});if(!tab)return;
        tab.url=url;
        if(url.startsWith('w:')){
            tab.title=url.substring(2);
            tab.html='<div class="wpage"><div class="ws">Loading <b>'+url.substring(2)+'</b>...</div></div>';
        } else {
            tab.title=url;
            tab.html='<div class="wpage">Navigating to: '+url+'</div>';
        }
        phoneData.browser.history.push({id:randId(),url:url,title:tab.title,ts:Date.now()});
        savePhoneData();renderUI();
    },
    bookmarkUrl: function() {
        var tab=phoneData.browser.tabs.find(function(t){return t.id===phoneData.browser.activeTabId;});
        if(!tab||!tab.url){if(typeof toastr!=='undefined')toastr.info('Navigate first');return;}
        var bm=phoneData.browser.bookmarks;
        if(!bm.includes(tab.url)){bm.push(tab.url);savePhoneData();if(typeof toastr!=='undefined')toastr.success('Bookmarked');}
    }
};

// ============================================================
// SETTINGS APP
// ============================================================
var SettingsApp = {
    render: function() {
        var s = getSettings();
        var statusIcon = (s.phoneApiKey && s.phoneApiUrl) ? '<i class="fa-solid fa-circle" style="color:#4caf50;font-size:8px"></i>' : '<i class="fa-solid fa-circle" style="color:#f44336;font-size:8px"></i>';
        var statusText = (s.phoneApiKey && s.phoneApiUrl) ? 'Configured' : 'Not configured';
        return '<div class="pa">' +
            '<div class="pa-header"><span class="pa-title"><i class="fa-solid fa-gear"></i> Settings</span></div>' +
            '<div class="sett">' +
            this._toggle('addToStory', 'Add texts to chat story', 'Inject phone messages into the main chat for context.') +
            this._toggle('npcAutoTexts', 'Enable NPC auto-texts', 'Let the character text you on their own.') +
            this._select('npcTextFrequency', 'Auto-text interval', [
                {v:2,l:'Every 2 min'}, {v:5,l:'Every 5 min'}, {v:10,l:'Every 10 min'}, {v:20,l:'Every 20 min'}
            ], s.npcTextFrequency) +
            this._toggle('notifications', 'Notifications', 'Show toast alerts for new texts.') +
            this._renderApiSection(s, statusIcon, statusText) +
            '<button class="sbtn sbtn-scan" data-scan="true"><i class="fa-solid fa-address-book"></i> Scan for Contacts</button>' +
            '<button class="sbtn" data-reset="true"><i class="fa-solid fa-trash-can"></i> Reset Phone Data</button>' +
            '</div></div>';
    },
    _toggle: function(key, label, desc) {
        var s = getSettings();
        var checked = s[key] ? 'checked' : '';
        return '<div class="sett-item">' +
            '<label class="sett-label"><input type="checkbox" class="sett-chk" data-set="'+key+'" '+checked+'>' +
            '<span>'+label+'</span></label>' +
            '<small>'+desc+'</small></div>';
    },
    _select: function(key, label, opts, curr) {
        var html = '<div class="sett-item"><label class="sett-label"><span>'+label+'</span>' +
            '<select class="sett-sel" data-set="'+key+'">';
        for(var i=0;i<opts.length;i++) {
            var sel = (parseFloat(opts[i].v)===parseFloat(curr)) ? 'selected' : '';
            html += '<option value="'+opts[i].v+'" '+sel+'>'+opts[i].l+'</option>';
        }
        return html + '</select></label></div>';
    },
    _renderApiSection: function(s, statusIcon, statusText) {
        var html = '<div class="sett-item" style="margin-top:8px;padding:10px;border:1px solid rgba(79,195,247,.3);border-radius:4px;">' +
            '<label class="sett-label" style="margin-bottom:6px"><span><i class="fa-solid fa-plug"></i> Text Generation API</span>' +
            ' <small>'+statusIcon+' '+statusText+'</small></label>' +
            '<small style="display:block;margin-bottom:4px">Dedicated LLM for NPC phone texts. Faster, cheaper, separate from your main ST API.</small>' +
            '<label class="sett-label" style="margin-top:6px"><span>Provider</span>' +
            '<select class="sett-sel" data-set="phoneApiProvider" style="width:100%">' +
            '<option value="openai"'+(s.phoneApiProvider==='openai'?' selected':'')+'>OpenAI Compatible</option>' +
            '</select></label>' +
            '<label class="sett-label" style="margin-top:6px"><span>API Base URL</span>' +
            '<input class="sett-input" data-set="phoneApiUrl" value="'+this._esc(s.phoneApiUrl||'')+'" placeholder="https://api.openai.com/v1" style="width:100%;box-sizing:border-box"/></label>' +
            '<label class="sett-label" style="margin-top:6px"><span>API Key</span>' +
            '<input class="sett-input" type="password" data-set="phoneApiKey" value="'+this._esc(s.phoneApiKey||'')+'" placeholder="sk-..." style="width:100%;box-sizing:border-box"/></label>' +
            '<label class="sett-label" style="margin-top:6px"><span>Model</span>' +
            '<input class="sett-input" data-set="phoneApiModel" value="'+this._esc(s.phoneApiModel||'gpt-4o-mini')+'" placeholder="gpt-4o-mini" style="width:100%;box-sizing:border-box"/></label>' +
            '<button class="sbtn sbtn-test" data-test-api="true" style="margin-top:8px"><i class="fa-solid fa-flask"></i> Test API Connection</button>' +
            '</div>';
        return html;
    },
    _esc: function(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },
    testApi: function() {
        var s = getSettings();
        if (!s.phoneApiKey || !s.phoneApiUrl) {
            if (typeof toastr !== 'undefined') toastr.warning('Set API Key and URL first');
            return;
        }
        var url = (s.phoneApiUrl || '').replace(/\/$/, '') + '/chat/completions';
        var btn = document.querySelector('[data-test-api]');
        if (btn) btn.textContent = 'Testing...';
        console.log('[Phone Extension] Testing API at ' + url + ' with model ' + s.phoneApiModel);
        // Use XMLHttpRequest to bypass ST's fetch interceptor which blocks external APIs
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', 'Bearer ' + s.phoneApiKey);
        xhr.timeout = 15000;
        xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
                var data = JSON.parse(xhr.responseText);
                console.log('[Phone Extension] API test OK:', data);
                if (typeof toastr !== 'undefined') toastr.success('API test successful!');
            } else {
                console.warn('[Phone Extension] API test failed: HTTP ' + xhr.status);
                if (typeof toastr !== 'undefined') toastr.error('API test failed: HTTP ' + xhr.status);
            }
            renderUI();
        };
        xhr.ontimeout = function() {
            console.warn('[Phone Extension] API test timed out');
            if (typeof toastr !== 'undefined') toastr.error('API test timed out');
            renderUI();
        };
        xhr.onerror = function() {
            console.warn('[Phone Extension] API test failed: network error');
            if (typeof toastr !== 'undefined') toastr.error('API test failed: network error');
            renderUI();
        };
        xhr.send(JSON.stringify({
            model: s.phoneApiModel || 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'Reply with OK' }],
            max_tokens: 5
        }));
    }
};

// ============================================================
// MAIN RENDER & UI LOOP
// ============================================================
function renderBody() {
    switch(activeApp){
        case 'phone': return PhoneApp.render();
        case 'messages': return MessagesApp.render();
        case 'social': return SocialApp.render();
        case 'browser': return BrowserApp.render();
        case 'settings': return SettingsApp.render();
        default: return PhoneApp.render();
    }
}

function renderUI() {
    var body=document.getElementById('phone-body');
    if(!body)return;
    body.innerHTML=renderBody();
    updateDock();
    bindEvents();
    setTimeout(function(){var m=document.getElementById('pmsgs');if(m)m.scrollTop=m.scrollHeight;},60);
}

function updateDock() {
    var btns=document.querySelectorAll('.dock-btn');
    for(var bi=0;bi<btns.length;bi++){
        btns[bi].classList.toggle('active',btns[bi].dataset.dock===activeApp);
        if(btns[bi].dataset.dock==='messages') btns[bi].style.color=''; // Clear alert color
    }
}

// ============================================================
// EVENT BINDING — Single delegated click handler + keydown
// ============================================================
function _phoneClickHandler(e) {
    var t = e.target.closest('[data-dock],[data-key],[data-backspace],[data-call],[data-clear-calls],[data-call-c],'+
        '[data-msg-view],[data-open-c],[data-send-c],[data-new-post],[data-st],[data-post-id],[data-new-tab],'+
        '[data-tid],[data-ctab],[data-gourl],[data-bookmark],[data-nav],[data-urlbar],[data-reset],[data-scan],[data-section],[data-submit-post],[data-test-api],'+
        '[data-browser-search],[data-bookmarks-view],[data-browser-nav]');
    if (!t) return;
    try {
        // Dock
        if (t.dataset.dock) {
            activeApp = t.dataset.dock;
            if(activeApp!=='messages') activeContactId=null;
            if(activeApp!=='social') activeSocialTab='feed';
            if(activeApp==='settings') stopNpcAutoTextEngine();
            if(activeApp==='settings' && phoneData._activeApp !== 'settings') startNpcAutoTextEngine();
            renderUI(); return;
        }
        // Phone dialer
        if (t.dataset.key) { PhoneApp.addDigit(t.dataset.key); var dt=document.getElementById('pdt'); if(dt) dt.textContent=PhoneApp._dialPad; return; }
        if (t.dataset.backspace) { PhoneApp.backspace(); var dt2=document.getElementById('pdt'); if(dt2) dt2.textContent=PhoneApp._dialPad; return; }
        if (t.dataset.call) { PhoneApp.startCall(); return; }
        if (t.dataset.clearCalls) { PhoneApp.clearCalls(); renderUI(); return; }
        if (t.dataset.callC) { PhoneApp.callContact(t.dataset.callC); return; }
        // Messages
        if (t.dataset.msgView) { activeContactId=null; renderUI(); return; }
        if (t.dataset.openC) { activeContactId=t.dataset.openC; renderUI(); return; }
        if (t.dataset.sendC) { MessagesApp.sendMsg(t.dataset.sendC); return; }
        // Social
        if (t.dataset.newPost) { renderUI(); return; }
        if (t.dataset.st) { activeSocialTab=t.dataset.st; renderUI(); return; }
        if (t.dataset.postId) {
            var pid=t.dataset.postId;
            if(t.dataset.action==='like') SocialApp.likePost(pid);
            else if(t.dataset.action==='rt') SocialApp.retweetPost(pid);
            else if(t.dataset.action==='save') SocialApp.savePost(pid);
            return;
        }
        if (t.id==='csb') { SocialApp.submitPost(); return; }
        // Phone section tabs (Dialer/Recent/Contacts)
        if (t.dataset.section && t.closest('[data-app="call"]')) {
            var section = t.dataset.section;
            var sections = document.querySelectorAll('[data-app="call"] .pss');
            var tabs = document.querySelectorAll('[data-app="call"] .pt');
            sections.forEach(function(s) { s.classList.remove('active'); });
            tabs.forEach(function(tb) { tb.classList.remove('active'); });
            var targetSection = document.querySelector('[data-app="call"] .pss[data-section="' + section + '"]');
            var targetTab = document.querySelector('[data-app="call"] .pt[data-section="' + section + '"]');
            if (targetSection) targetSection.classList.add('active');
            if (targetTab) targetTab.classList.add('active');
            return;
        }
        // Browser
        if (t.dataset.newTab) { BrowserApp.openNewTab(); return; }
        if (t.dataset.tid) { phoneData.browser.activeTabId=t.dataset.tid; savePhoneData(); renderUI(); return; }
        if (t.dataset.ctab) {
            e.stopPropagation(); var tid=t.dataset.ctab;
            phoneData.browser.tabs=phoneData.browser.tabs.filter(function(tk){return tk.id!==tid;});
            if(phoneData.browser.activeTabId===tid){phoneData.browser.activeTabId=phoneData.browser.tabs.length>0?phoneData.browser.tabs[phoneData.browser.tabs.length-1].id:null;}
            savePhoneData(); renderUI(); return;
        }
        if (t.dataset.gourl) { var u=document.getElementById('burl'); if(u&&phoneData.browser.activeTabId) BrowserApp.navigateTo(phoneData.browser.activeTabId,u.value); return; }
        if (t.dataset.bookmark) { BrowserApp.bookmarkUrl(); return; }
        if (t.dataset.nav) { if(phoneData.browser.activeTabId) BrowserApp.navigateTo(phoneData.browser.activeTabId,t.dataset.nav); return; }
        if (t.dataset.urlbar) { var bar=document.getElementById('pbar'); if(bar) bar.style.display=bar.style.display==='flex'?'none':'flex'; return; }
        // Settings / presets
        if (t.dataset.set) { PhoneApp.applyPreset(t.dataset.set); return; }
        if (t.dataset.scan) { scanChatForContacts(); if(typeof toastr !== 'undefined') toastr.info('Scanning chat for contacts...'); return; }
        if (t.dataset.testApi) { SettingsApp.testApi(); return; }
        if (t.dataset.reset) { if(confirm('Reset ALL phone data for this chat?')){ phoneData=getEmptyPhoneData(); savePhoneData(); renderUI(); if(typeof toastr!=='undefined') toastr.success('Phone data reset'); } return; }
    } catch(err) { console.warn('[Phone Extension] Click handler error:', err); }
}

function _phoneKeydownHandler(e) {
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
    var m=document.getElementById('pmi');
    if(e.key==='Enter'&&m&&!e.shiftKey){e.preventDefault();var sb=document.querySelector('[data-send-c]');if(sb)MessagesApp.sendMsg(sb.dataset.sendC);}
    var u=document.getElementById('burl');
    if(e.key==='Enter'&&u&&phoneData.browser.activeTabId){e.preventDefault();BrowserApp.navigateTo(phoneData.browser.activeTabId,u.value);}
}

function bindEvents() {
    var shell = document.getElementById('pshell');
    var body = document.getElementById('phone-body');
    var pbody = document.querySelector('.pbody');
    // Remove old listeners if any
    // Bind click to shell (contains body + dock + toolbar) so dock buttons work
    if(shell) { shell.removeEventListener('click', _phoneClickHandler); shell.addEventListener('click', _phoneClickHandler); }
    if(body && body !== shell) { body.removeEventListener('click', _phoneClickHandler); body.addEventListener('click', _phoneClickHandler); }
    if(pbody) { pbody.removeEventListener('keydown', _phoneKeydownHandler); pbody.addEventListener('keydown', _phoneKeydownHandler); }

    // Settings toggles (need change input, not click)
    var settings = document.querySelectorAll('[data-set].sett-chk');
    for(var i=0;i<settings.length;i++){(function(el){el.onchange=function(){
        var key = el.dataset.set;
        phoneData.settings[key] = el.checked;
        savePhoneData();
        console.log('[Phone Extension] Setting changed: ' + key + ' = ' + el.checked);
        if(key === 'npcAutoTexts') startNpcAutoTextEngine();
        if(key === 'npcTextFrequency') startNpcAutoTextEngine();
    };})(settings[i]);}
    // Settings selects
    var selects = document.querySelectorAll('select.sett-sel');
    for(var j=0;j<selects.length;j++){(function(el){el.onchange=function(){
        var key = el.dataset.set;
        var val = (key === 'phoneApiProvider') ? el.value : parseFloat(el.value);
        phoneData.settings[key] = val;
        savePhoneData();
        console.log('[Phone Extension] Setting changed: ' + key + ' = ' + val);
        if(key === 'npcTextFrequency') startNpcAutoTextEngine();
    };})(selects[j]);}
    // Settings text inputs (API config) — use 'input' event for live updates
    var inputs = document.querySelectorAll('input.sett-input');
    for(var k=0;k<inputs.length;k++){(function(el){el.oninput=function(){
        var key = el.dataset.set;
        phoneData.settings[key] = el.value;
        
        // Save API settings globally so they persist across chats and restarts
        var apiFields = ['phoneApiUrl', 'phoneApiKey', 'phoneApiModel', 'phoneApiProvider'];
        if (apiFields.indexOf(key) > -1) {
            var global = loadGlobalSettings() || {};
            global[key] = el.value;
            saveGlobalSettings(global);
            // Debounced save — only save after user pauses typing for 500ms
            clearTimeout(el._saveTimeout);
            el._saveTimeout = setTimeout(function() {
                savePhoneData();
            }, 500);
        }
    };})(inputs[k]);}

    // Compose area character counter
    var sci = document.getElementById('sci');
    if(sci) { sci.removeEventListener('input', _phoneInputHandler); sci.addEventListener('input', _phoneInputHandler); }
}

function _phoneInputHandler() {
    var sci=document.getElementById('sci'); var cc=document.getElementById('cc');
    if(cc && sci) cc.textContent=sci.value.length+'/500';
    var sb=document.getElementById('csb'); if(sb) sb.disabled=!sci.value.trim();
}

// ============================================================
// INJECTION & INIT
// ============================================================
function injectPhone() {
    if(document.getElementById('phone-wrap'))return;
    var wrap=document.createElement('div');wrap.id='phone-wrap';
    wrap.innerHTML =
        '<div class="pshell" id="pshell">' +
        '<div class="pbar"><span class="ptime">'+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'</span>' +
        '<div class="pst"><i class="fa-solid fa-signal"></i><i class="fa-solid fa-wifi"></i><i class="fa-solid fa-battery-full"></i></div></div>' +
        '<div class="pbody" id="phone-body"></div>' +
        '<div class="pdock">' +
        '<button class="dock-btn active" data-dock="phone"><i class="fa-solid fa-phone"></i></button>' +
        '<button class="dock-btn" data-dock="messages"><i class="fa-brands fa-telegram"></i></button>' +
        '<button class="dock-btn" data-dock="social"><i class="fa-solid fa-hashtag"></i></button>' +
        '<button class="dock-btn" data-dock="browser"><i class="fa-solid fa-globe"></i></button>' +
        '<button class="dock-btn" data-dock="settings"><i class="fa-solid fa-gear"></i></button>' +
        '</div></div>';
    wrap.style.position='fixed'; wrap.style.bottom='0px'; wrap.style.right='20px';
    wrap.style.width='360px'; wrap.style.height='680px'; wrap.style.zIndex='10000';
    document.body.appendChild(wrap);

    setTimeout(function(){
        phoneData=loadPhoneData();
        activeApp=phoneData._activeApp||'phone';
        // Start the ChatDatabank — it will auto-scan contacts when chat is ready
        ChatDatabank.start();
        // Delayed contact scan (1s) for initial load
        setTimeout(function() {
            scanChatForContacts();
        }, 1000);
        // Additional delayed scan (3s) to catch late-loading character data
        setTimeout(function() {
            if (getKnownCharacterNames().length === 0) {
                console.log('[Phone Extension] Re-attempting character detection after delay');
            }
            scanChatForContacts();
        }, 3000);
        renderUI();
        startNpcAutoTextEngine();
    },300);

    setTimeout(function(){
        var cont=document.getElementById('chatformbuttonssend')
            ||document.getElementById('send_form')
            ||document.querySelector('#send_form .form-buttons')
            ||document.querySelector('.bottom-bar');
        var btn=document.createElement('button');btn.id='phone-toggle-btn';
        btn.innerHTML='<i class="fa-solid fa-mobile-screen-button"></i>'; btn.title='Toggle Phone';
        btn.onclick=function(){wrap.classList.toggle('popen');if(wrap.classList.contains('popen'))renderUI();};
        if(cont) cont.insertBefore(btn,cont.firstChild);
        else {
            if(!document.getElementById('phone-toggle-btn')){
                btn.style.position='fixed'; btn.style.bottom='70px'; btn.style.right='12px';
                btn.style.zIndex='9999'; btn.style.width='48px'; btn.style.height='48px';
                btn.style.borderRadius='50%'; btn.style.background='rgba(79,195,247,.25)';
                btn.style.border='1px solid rgba(79,195,247,.3)'; btn.style.color='#4fc3f7';
                btn.style.fontSize='20px'; btn.style.cursor='pointer'; btn.style.backdropFilter='blur(8px)';
                btn.style.boxShadow='0 4px 12px rgba(0,0,0,.4)'; btn.style.display='flex';
                btn.style.alignItems='center'; btn.style.justifyContent='center';
                document.body.appendChild(btn);
            }
        }
    },500);

    setInterval(function(){var e=document.querySelector('.ptime');if(e)e.textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});},60000);
}

// ============================================================
// AUTO-START
// ============================================================
(function(){
    var initialized = false;
    function tryInit(){
        if(initialized) return;
        if(typeof toastr !== 'undefined'){
            initialized = true;
            injectPhone();
            console.log('[Phone Extension v0.2.1] Initialized');
        }
    }
    tryInit();
    if(!initialized){
        var attempts = 0;
        var poll = setInterval(function(){ attempts++; tryInit(); if(attempts >= 100) clearInterval(poll); }, 100);
    }
})();
