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
var activePhoneSection = 'dialer';

function getDefaultPhoneSettings() {
    return {
        addToStory: true,          // Inject text messages into ST chat history
        npcAutoTexts: true,        // Allow NPCs to initiate texts
        npcTextFrequency: 5,       // Minutes between auto-texts
        lastAutoText: 0,           // Timestamp of last auto-text
        notifications: true,       // Show toast on new texts
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

function loadPhoneData() {
    var m = typeof chat_metadata !== 'undefined' ? chat_metadata : (typeof window !== 'undefined' ? window.chat_metadata : null);
    if (!m) {
        // Fallback: restore from localStorage if ST metadata isn't available yet
        try {
            var fallback = localStorage.getItem('_phone_data_fallback');
            if (fallback) {
                console.log('[Phone Extension] Restored from localStorage fallback');
                return JSON.parse(fallback);
            }
        } catch(e) {}
        return getEmptyPhoneData();
    }
    if (!m[STORAGE_KEY]) m[STORAGE_KEY] = getEmptyPhoneData();
    
    var data = m[STORAGE_KEY];
    var e = getEmptyPhoneData();
    var k;
    for (k in e) { if (data[k] === undefined) data[k] = e[k]; }
    if (!data.settings) data.settings = getDefaultPhoneSettings();

    // Override/Merge with global API settings
    var global = loadGlobalSettings();
    if (global) {
        var apiFields = ['phoneApiUrl', 'phoneApiKey', 'phoneApiModel', 'phoneApiProvider'];
        for (var f = 0; f < apiFields.length; f++) {
            var field = apiFields[f];
            if (global[field] !== undefined) data.settings[field] = global[field];
        }
    }
    return data;
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
        } catch(e) {}
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
// STORY INTEGRATION
// ============================================================
function injectMessageToStory(text, direction, contactName) {
    if (!getSettings().addToStory) return;
    if (typeof chat === 'undefined' || !Array.isArray(chat)) return;

    var user = (typeof name1 !== 'undefined') ? name1 : 'You';
    var char = contactName || ((typeof name2 !== 'undefined') ? name2 : 'Unknown');
    
    var storyText;
    if (direction === 'sent') {
        storyText = `[📱 You sent ${char} a text: "${text}"]`;
    } else {
        storyText = `[📱 ${char} texted you: "${text}"]`;
    }

    // Push to ST's chat array as a system message
    var sysMsg = {
        is_system: true,
        is_user: false,
        mes: storyText,
        extra: { display_text: storyText },
        send_date: new Date().toLocaleString(),
        creates: []
    };
    chat.push(sysMsg);

    // Trigger ST UI update if available
    if (typeof addOneMessage === 'function') {
        addOneMessage(sysMsg, { type: 'system', chat: chat.length - 1, force: true, power: 2 });
    } else if (typeof reloadMessage === 'function') {
        reloadMessage(chat.length - 1);
    }
    
    // Ensure it's saved
    if (typeof saveChatConditional === 'function') saveChatConditional();
}

// ============================================================
// ============================================================
// CONTACT SCANNING — scan chat messages for mentioned NPCs
// ============================================================

/*
 * Builds a list of known SillyTavern character names to match against.
 * Multi-source: modern ST APIs, DOM scraping, localStorage, window globals.
 */
function getKnownCharacterNames() {
    var names = new Set();

    // 1. Modern ST API: /api/characters/active (newer ST versions)
    try {
        var xhrActive = new XMLHttpRequest();
        xhrActive.open('GET', '/api/characters/active', false);
        xhrActive.send();
        if (xhrActive.status === 200) {
            var activeData = JSON.parse(xhrActive.responseText);
            if (activeData && activeData.name) names.add(activeData.name);
            console.log('[Phone Extension] API /api/characters/active:', activeData.name);
        }
    } catch(e) { /* silent — not all ST versions have this */ }

    // 2. Legacy ST API: /api/characters/get
    try {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/characters/get', false);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify({}));
        if (xhr.status === 200) {
            var data = JSON.parse(xhr.responseText);
            if (data.name) names.add(data.name);
            if (data.data && data.data.name) names.add(data.data.name);
            console.log('[Phone Extension] API /api/characters/active:', data.name || data.data.name);
        }
    } catch(e) { /* silent */ }

    // 3. ST API: /api/characters/list
    try {
        var xhr2 = new XMLHttpRequest();
        xhr2.open('GET', '/api/characters/list', false);
        xhr2.send();
        if (xhr2.status === 200) {
            var charList = JSON.parse(xhr2.responseText);
            if (Array.isArray(charList)) {
                for (var i2 = 0; i2 < charList.length; i2++) {
                    var cn = typeof charList[i2] === 'string' ? charList[i2] : (charList[i2] && charList[i2].name);
                    if (cn) names.add(cn);
                }
            }
        }
    } catch(e) { /* silent */ }

    // 4. DOM: modern selectors (ST v1.10+ / v1.12+)
    var modernSelectors = [
        '.mes .mes_name', '.mes .mes_header span:first-child',
        '#character_header .name', '.char-name-element', '.display-name',
        '.char-name', '#current_char_name', '.character-name-display',
        '[data-character-name]', '.mes[data-id] .mes_name',
        '#character_select .char-name', '.character-block .name',
    ];
    for (var mi = 0; mi < modernSelectors.length; mi++) {
        var els = document.querySelectorAll(modernSelectors[mi]);
        for (var ei = 0; ei < els.length; ei++) {
            var txt = els[ei].textContent.trim().replace(/\s+/g, ' ');
            if (txt && txt.length > 1 && txt.length < 60) names.add(txt);
        }
    }

    // 5. Legacy DOM selectors
    var legacyDom = document.querySelectorAll(
        '.mes_author, #character_name_animation, #character_name, #char_name,' +
        '.menu_character_name, .character-name, .char-name-text,' +
        '#selected_chat_pane .name, .open_menu .name'
    );
    for (var di = 0; di < legacyDom.length; di++) {
        var txt = legacyDom[di].textContent.trim().replace(/\s+/g, ' ');
        if (txt && txt.length > 1 && txt.length < 60) names.add(txt);
    }

    // 6. Parse message blocks for character name attribution (new in scan)
    // ST renders character names in message attribution — try to extract from aria labels
    var mesEls = document.querySelectorAll('.mes[data-author], [data-character], .mes .mes_header');
    for (var ai = 0; ai < mesEls.length; ai++) {
        var author = mesEls[ai].getAttribute('data-author') || mesEls[ai].getAttribute('data-character');
        if (author && author.length > 1 && author.length < 60) names.add(author.trim());
    }

    // 7. Parse document title: "Character Name - SillyTavern" or just "Character Name"
    try {
        var title = document.title;
        var parts = title.split(' - ');
        if (parts.length > 1 && parts[0].trim().length > 1) names.add(parts[0].trim());
        // Also try without separator
        var tparts = title.split('|');
        if (tparts.length > 1 && tparts[0].trim().length > 1) names.add(tparts[0].trim());
    } catch(e) {}

    // 8. window globals
    try {
        if (typeof window.name2 !== 'undefined' && window.name2) names.add(window.name2);
    } catch(e) {}
    try {
        if (typeof window.characters !== 'undefined' && Array.isArray(window.characters)) {
            for (var ci = 0; ci < window.characters.length; ci++) {
                if (window.characters[ci] && window.characters[ci].name) names.add(window.characters[ci].name);
            }
        }
    } catch(e) {}

    // 9. localStorage: ST stores the active chat file name
    try {
        for (var k = 0; k < localStorage.length; k++) {
            var key = localStorage.key(k);
            if (key && key.indexOf('ST:') === 0 && key.indexOf('name2') !== -1) {
                var val = localStorage.getItem(key);
                if (val) { try { var v = JSON.parse(val); if(typeof v === 'string' && v.length > 1) names.add(v); } catch(e2) { if(val.length > 1) names.add(val); } }
            }
        }
    } catch(e) {}

    var result = Array.from(names);
    console.log('[Phone Extension] Found ' + result.length + ' character name(s):', result);
    return result;
}

/*
 * Scans the last N chat messages for character names (both spoken and mentioned).
 * Adds any new characters found as phone contacts.
 * First tries DOM-scraping (rendered HTML), then falls back to JS chat array.
 */
function scanChatForContacts() {
    var knownNames = getKnownCharacterNames();
    if (!knownNames.length) {
        console.log('[Phone Extension] Scan skipped: no known character names found');
        return;
    }

    // Build chat text history from multiple sources
    var chatHist = [];

    // Source A: Scrape text from rendered message blocks in the DOM
    var msgBlocks = document.querySelectorAll('#chat .mes .mes_text, #chat_form .mes .mes_text, .mes .text');
    for (var di = 0; di < msgBlocks.length; di++) {
        var txt = msgBlocks[di].textContent || '';
        if (txt.trim()) chatHist.push(txt.trim());
    }

    // Source B: Also grab the text from ST's chat array if available
    try {
        if (typeof window.chat !== 'undefined' && Array.isArray(window.chat)) {
            var start = Math.max(0, window.chat.length - 80);
            for (var ai = start; ai < window.chat.length; ai++) {
                if (window.chat[ai] && window.chat[ai].mes) {
                    chatHist.push(window.chat[ai].mes);
                }
            }
        }
    } catch(e) {}

    if (!chatHist.length) {
        console.log('[Phone Extension] No chat messages found in DOM or window.chat — trying character header');
        // Last resort: add the character from the header
        var charHeader = document.querySelector('#character_name_animation')
            || document.querySelector('#character_name');
        if (charHeader && charHeader.textContent.trim()) {
            addOrUpdateContact(charHeader.textContent.trim(), true);
        }
        return;
    }

    // Keep only the last 50 entries to avoid over-scraping
    if (chatHist.length > 50) chatHist = chatHist.slice(chatHist.length - 50);

    var found = new Set();
    var lowerKnown = {};
    for (var ki = 0; ki < knownNames.length; ki++) {
        lowerKnown[knownNames[ki].toLowerCase()] = knownNames[ki];
    }

    console.log('[Phone Extension] Scanning ' + chatHist.length + ' message blocks against ' + knownNames.length + ' known names');

    for (var mi = 0; mi < chatHist.length; mi++) {
        var msg = chatHist[mi].toLowerCase();
        for (var ki2 = 0; ki2 < knownNames.length; ki2++) {
            var nm = knownNames[ki2];
            var re = new RegExp('\\b' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
            if (re.test(chatHist[mi])) {
                found.add(nm);
            }
        }
        // Also try to extract names from patterns like "@Name said", "Name texted"
        var extractRe = /(?:@|"|\'|\s|^)([A-Z][a-zA-Z]{1,30})(?:\b\s+(?:said|replied|texted|walked|looked|asked|smiled|laughed|nodded|whispered|shouted|spoke|hugs?|kisses?|sighs|grins))/gi;
        var m;
        while ((m = extractRe.exec(chatHist[mi])) !== null) {
            var candidate = m[1].replace(/["'@\s]/g, '').trim();
            if (lowerKnown[candidate.toLowerCase()]) {
                found.add(lowerKnown[candidate.toLowerCase()]);
            }
        }
    }

    // Add the active character as main contact (from header)
    try {
        var activeChar = document.querySelector('#character_name_animation')
            || document.querySelector('#character_name');
        if (activeChar && activeChar.textContent.trim()) {
            var cn = activeChar.textContent.trim();
            addOrUpdateContact(cn, true);
        }
    } catch(e) {}

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
    } else {
        console.log('[Phone Extension] Contact scan complete: 0 new, ' + phoneData.contacts.length + ' existing');
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
    if (typeof chat !== 'undefined' && chat.length > 0) {
        var last = chat[chat.length - 1];
        if (last && last.send_date) {
            return new Date(last.send_date).getTime();
        }
    }
    return Date.now() - 3600000; // Fallback: 1 hr ago
}

async function generateNpcText(contact) {
    var user = (typeof name1 !== 'undefined') ? name1 : 'You';
    var charName = contact.name;
    var systemPrompt = 'You are ' + charName + '. You are texting ' + user + ' on a phone. Keep the message short, casual, and in character. Max 20 words.';
    var context = 'The last thing you chatted about was a while ago. Text ' + user + ' something relevant to your personality.';

    var s = getSettings();
    var apiBase = (s.phoneApiUrl || '').replace(/\/$/, '');
    var apiModel = s.phoneApiModel || 'gpt-4o-mini';
    var apiKey = s.phoneApiKey || '';var useDedicated = !!(apiBase && apiKey && apiModel);

    if (useDedicated) {
        var url = apiBase + '/chat/completions';
    } else {
        url = '/api/chat/completions';
    }
    var headers = { 'Content-Type': 'application/json' };
    if (useDedicated && apiKey) {
        headers['Authorization'] = 'Bearer ' + apiKey;
    }
    var payload = {
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: context }
        ],
        max_tokens: 50,
        temperature: 1.0
    };
    if (useDedicated) payload.model = apiModel;

    var body = JSON.stringify(payload);

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
            if (useDedicated) console.log('[Phone Extension] NPC text generated via dedicated API (model: ' + apiModel + ')');
            return;
        }
    } catch (e) {
        console.warn('[Phone Extension] LLM text generation failed (url: ' + url + '):', e.message);
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

// NOTE: Event listeners are registered via jQuery DOM-ready at the bottom.

function onUserMessage() {
    scanChatForContacts();
    getSettings().lastAutoText = Date.now();

    // Analyze the latest user message for NPC mentions that should react
    if (typeof chat === 'undefined' || !chat.length) return;
    var lastMsg = chat[chat.length - 1];
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

    if (typeof chat === 'undefined' || !chat.length) return;
    var lastMsg = chat[chat.length - 1];
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
    var apiBase = (s.phoneApiUrl || '').replace(/\/$/, '');
    var apiModel = s.phoneApiModel || 'gpt-4o-mini';
    var apiKey = s.phoneApiKey || '';
    var useDedicated = !!(apiBase && apiKey && apiModel);

    var url = useDedicated ? apiBase + '/chat/completions' : '/api/chat/completions';
    var headers = { 'Content-Type': 'application/json' };
    if (useDedicated && apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
    var body = JSON.stringify({
        model: useDedicated ? apiModel : undefined,
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
        var dialerActive = activePhoneSection === 'dialer' ? ' active' : '';
        var recentActive = activePhoneSection === 'recent' ? ' active' : '';
        var contactsActive = activePhoneSection === 'contacts' ? ' active' : '';
        return '<div class="pa" data-app="call">' +
            '<div class="pa-header"><span class="pa-title"><i class="fa-solid fa-phone"></i> Phone</span>' +
            '<button class="pa-action" data-clear-calls="true"><i class="fa-solid fa-trash"></i></button></div>' +
            '<div class="pa-tabs">' +
            '<button class="pt'+dialerActive+'" data-section="dialer"><i class="fa-solid fa-keypad"></i> Dialer</button>' +
            '<button class="pt'+recentActive+'" data-section="recent"><i class="fa-solid fa-clock-rotate-left"></i> Recent</button>' +
            '<button class="pt'+contactsActive+'" data-section="contacts"><i class="fa-solid fa-address-book"></i> Contacts</button></div>' +
            '<div class="pss'+dialerActive+'" data-section="dialer">' +
                '<div class="pdisp" id="pd"><span id="pdt"> </span></div>' +
                '<div class="ppad">'+keypad+'</div>' +
                '<div class="pcbar"><button class="pccb" data-call="true"><i class="fa-solid fa-phone"></i></button>' +
                '<button class="pbacks" data-backspace="true"><i class="fa-solid fa-delete-left"></i></button></div></div>' +
            '<div class="pss'+recentActive+'" data-section="recent">'+recent+'</div>' +
            '<div class="pss'+contactsActive+'" data-section="contacts">'+contacts+'</div></div>';
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
        var feedActive = activeSocialTab === 'feed' ? ' active' : '';
        var savedActive = activeSocialTab === 'saved' ? ' active' : '';
        var composeActive = activeSocialTab === 'compose' ? ' active' : '';
        return '<div class="pa" data-app="social">' +
            '<div class="pa-header"><span class="pa-title"><i class="fa-solid fa-hashtag"></i> Social</span>' +
            '<button class="pa-action" data-new-post="true"><i class="fa-solid fa-plus"></i></button></div>' +
            '<div class="pa-tabs">' +
            '<button class="pt'+feedActive+'" data-st="feed">Feed</button>' +
            '<button class="pt'+savedActive+'" data-st="saved">Saved ('+phoneData.social.savedPosts.length+')</button>' +
            '<button class="pt'+composeActive+'" data-st="compose">New Post</button></div>' +
            '<div class="pss'+feedActive+'" data-section="feed">'+this._renderFeed()+'</div>' +
            '<div class="pss'+savedActive+'" data-section="saved">'+this._renderSaved()+'</div>' +
            '<div class="pss'+composeActive+'" data-section="compose">'+this._renderCompose()+'</div></div>';
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
            '<button class="cbtn" id="csb" data-submit-post="true" disabled>Post</button></div></div>';
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
            '<div class="pbcont">' + (tab.html || this._newTab()) + '</div>' +
            this._renderSearchBar();
    },
    _renderSearchBar: function() {
        return '<div class="sbcont"><input class="sinput" id="searchBox" placeholder="Search the web..." />' +
            '<button class="sb" data-browser-search="true"><i class="fa-solid fa-magnifying-glass"></i></button></div>';
    },
    _newTab: function() {
        var links=[
            {n:'Wiki',u:'w:Wikipedia',c:'#636363',i:'fa-brands fa-wikipedia-w'},
            {n:'News',u:'w:News',c:'#d32f2f',i:'fa-solid fa-newspaper'},
            {n:'Weather',u:'w:Weather',c:'#f57c00',i:'fa-solid fa-cloud-sun'},
            {n:'Mail',u:'w:Mail',c:'#1565c0',i:'fa-solid fa-envelope'},
            {n:'Tech',u:'w:Technology',c:'#6c71c4',i:'fa-solid fa-microchip'},
            {n:'Social',u:'w:Social',c:'#ad1457',i:'fa-solid fa-users'},
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
        var self = this;
        var tab=phoneData.browser.tabs.find(function(t){return t.id===tabId;});if(!tab)return;
        tab.url=url;
        if(url.startsWith('w:')){
            tab.title=url.substring(2);
            tab.html='<div class="wpage"><div class="ws"><i class="fa-solid fa-spinner fa-spin"></i> Loading <b>'+url.substring(2)+'</b>...</div></div>';
        } else if(url.trim().length>0 && !url.startsWith('http')){
            // Treat as search query
            tab.title = 'Search: ' + url;
            tab.html='<div class="wpage"><div class="ws"><i class="fa-solid fa-spinner fa-spin"></i> Searching...</div></div>';
            url = 's:' + url; // Mark as search
            tab.url = url;
        } else {
            tab.title=url;
            tab.html='<div class="wpage"><div class="ws">Navigating to: '+url+'</div></div>';
        }
        phoneData.browser.history.push({id:randId(),url:url,title:tab.title,ts:Date.now()});
        savePhoneData();renderUI();
        
        // Generate LLM page content async
        if(url.startsWith('w:') || url.startsWith('s:')) {
            this.fetchPageContent(tabId, url);
        }
    },
    fetchPageContent: async function(tabId, url) {
        var self = this;
        var tab = phoneData.browser.tabs.find(function(t) { return t.id === tabId; });
        if (!tab) return;
        var query = url.substring(2); // Strip 'w:' or 's:'
        var isSearch = url.startsWith('s:');
        var user = (typeof name1 !== 'undefined') ? name1 : 'You';
        var charName = (typeof name2 !== 'undefined') ? name2 : 'the character';

        // Extract recent chat context from ST's chat array for roleplay relevance
        var chatContext = '';
        console.log('[Phone Extension] Chat extraction debug — chat type:', typeof chat, '| isArray:', Array.isArray(chat), '| length:', (typeof chat !== 'undefined' && Array.isArray(chat) ? chat.length : 'n/a'), '| name2:', charName, '| name1:', user);
        try {
            if (typeof chat !== 'undefined' && Array.isArray(chat) && chat.length > 0) {
                var recent = chat.slice(-10);
                var messages = [];
                for (var i = 0; i < recent.length; i++) {
                    var m = recent[i];
                    console.log('[Phone Extension] Message', i, '— name:', m.name, '| has mes:', !!m.mes);
                    if (m.mes && m.mes.trim()) {
                        var speaker = (m.name === user) ? user : charName;
                        messages.push(speaker + ': ' + m.mes.substring(0, 150));
                    }
                }
                console.log('[Phone Extension] Extracted', messages.length, 'messages from chat array');
                if (messages.length > 0) {
                    chatContext = messages.join('\n');
                    console.log('[Phone Extension] Chat context preview:', chatContext.substring(0, 200));
                }
            }
        } catch(e) {
            console.warn('[Phone Extension] Chat array extraction failed:', e.message);
            // Fallback: try DOM extraction
            try {
                console.log('[Phone Extension] Attempting DOM extraction fallback');
                var msgDivs = document.querySelectorAll('#chat .mes');
                console.log('[Phone Extension] DOM found', msgDivs.length, 'message elements');
                var domMsgs = [];
                var domLimit = 10;
                for (var di = Math.max(0, msgDivs.length - domLimit); di < msgDivs.length; di++) {
                    var textEl = msgDivs[di].querySelector('.mes_text');
                    if (textEl) {
                        domMsgs.push(textEl.textContent.trim().substring(0, 150));
                    }
                }
                if (domMsgs.length > 0) {
                    chatContext = domMsgs.join('\n');
                    console.log('[Phone Extension] DOM context preview:', chatContext.substring(0, 200));
                }
            } catch(e2) { console.warn('[Phone Extension] DOM fallback failed:', e2.message); }
        }

        // System prompt with anti-bleed + character isolation
        var systemPrompt = '=== ROLEPLAY MODE ===\n' +
            'You are a FICTIONAL mobile web page simulator. The ONLY character in this world is: ' + charName + '.\n' +
            'Current chat context (the ONLY valid reality):\n' +
            (chatContext || 'No chat context available.') + '\n' +
            'RULES:\n' +
            '1. IGNORE any other character names, settings, or context injected by the API system.\n' +
            '2. If you see references to Star Wars, Cyberpunk, or ANY universe other than this chat\'s world, DISCARD THEM.\n' +
            '3. DO NOT use any tools. DO NOT search the real web. DO NOT browse URLs.\n' +
            '4. Generate content from your imagination based on the current chat\'s world only.\n' +
            '5. ALL content must be FICTIONAL and immersive.\n' +
            (isSearch ?
                'TASK: Create a Google-style search results page for: ' + query + '.\n' +
                'Show 4-5 creative fictional results that match the current chat context. ' +
                'Blue title links, green URLs, gray descriptions.' :
                'TASK: Generate a complete web page about: ' + query + '.\n' +
                'Include a header, 3-5 content sections with rich details fitting the current chat context.'
            ) + '\nFormat: Return ONLY valid HTML with inline CSS -- dark background (#111), light text, accent color #4fc3f7.\n' +
            'Start with <div class="wpage"> and end with </div>.';
        var userPrompt = 'Generate the HTML page now. ONLY use the chat context provided above. ' +
            'NO other character worlds, NO Star Wars, NO Cyberpunk, NO injected context from the API. ' +
            'NO markdown fences. NO explanations. Only HTML.';

        var s = getSettings();
        var apiBase = (s.phoneApiUrl || '').replace(/\/$/, '');
        var apiModel = s.phoneApiModel || 'gpt-4o-mini';
        var apiKey = s.phoneApiKey || '';
        if (!apiBase || !apiKey) {
            tab.html = '<div class="wpage"><div class="whead"><h3>' + this._esc(query) + '</h3></div>' +
                '<div class="warticle"><p>Configure your API key and URL in Settings first.</p></div></div>';
            savePhoneData();
            if(phoneData.browser.activeTabId === tabId) renderUI();
            return;
        }

        var genUrl = apiBase + '/chat/completions';

        // XHR wrapper — bypasses ST's fetch interceptor
        function makeRequest() {
            return new Promise(function(resolve, reject) {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', genUrl, true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);
                xhr.timeout = 30000;
                xhr.onload = function() {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            var data = JSON.parse(xhr.responseText);
                            if (data && data.choices && data.choices[0] && data.choices[0].message) {
                                resolve(data.choices[0].message.content);
                            } else {
                                reject(new Error('Empty response'));
                            }
                        } catch(e) { reject(e); }
                    } else {
                        reject(new Error('HTTP ' + xhr.status));
                    }
                };
                xhr.onerror = function() { reject(new Error('Network error')); };
                xhr.ontimeout = function() { reject(new Error('Request timed out')); };
                xhr.send(JSON.stringify({
                    model: apiModel,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    max_tokens: 2000,
                    temperature: 0.9
                }));
            });
        }

        // Retry logic with exponential backoff for 403s
        var maxRetries = 3;
        var attempts = 0;
        var lastError = null;
        while (attempts < maxRetries) {
            try {
                var html = await makeRequest();
                html = html.replace(/^```html\n?/, '').replace(/\n```$/, '');
                tab.html = html;
                tab.title = query.charAt(0).toUpperCase() + query.slice(1);
                savePhoneData();
                if(phoneData.browser.activeTabId === tabId) renderUI();
                console.log('[Phone Extension] Browser page generated: ' + query);
                return;
            } catch(e) {
                lastError = e;
                attempts++;
                var is403 = e.message.indexOf('HTTP 403') !== -1;
                if (is403 && attempts < maxRetries) {
                    var delay = attempts * 1500;
                    console.warn('[Phone Extension] 403 rate-limited, retrying in ' + delay + 'ms (attempt ' + attempts + '/' + maxRetries + ')');
                    await new Promise(function(r) { setTimeout(r, delay); });
                } else if (!is403) {
                    break;
                }
            }
        }

        // All retries failed
        console.warn('[Phone Extension] Browser page generation failed:', lastError ? lastError.message : 'Unknown');
        var fb = '<div class="wpage">' +
            '<div class="whead"><h3>' + self._esc(query) + '</h3></div>' +
            (isSearch ?
                '<div class="warticle"><p>No results found for <b>' + self._esc(query) + '</b>. Try a different search.</p></div>' :
                '<div class="warticle"><p>Unable to load content. Check your API settings.</p></div>'
            ) + '</div>';
        tab.html = fb;
        savePhoneData();
        if(phoneData.browser.activeTabId === tabId) renderUI();
    },
    _esc: function(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },
    bookmarkUrl: function() {
        var tab=phoneData.browser.tabs.find(function(t){return t.id===phoneData.browser.activeTabId;});
        if(!tab||!tab.url){if(typeof toastr!=='undefined')toastr.info('Navigate first');return;}
        var bm=phoneData.browser.bookmarks;
        if(!bm.includes(tab.url)){bm.push(tab.url);savePhoneData();if(typeof toastr!=='undefined')toastr.success('Bookmarked');}
        else{if(typeof toastr!=='undefined')toastr.info('Already bookmarked');}
    },
    viewBookmarks: function() {
        var bm=phoneData.browser.bookmarks;
        if(!bm.length){
            var empty='<div class="wpage"><div class="whead"><h3><i class="fa-regular fa-bookmark"></i> Bookmarks</h3></div>' +
                '<div class="warticle"><p>No bookmarks saved yet.</p></div></div>';
            this._showBookmarkContent(empty);
            return;
        }
        var html = '<div class="wpage"><div class="whead"><h3><i class="fa-regular fa-bookmark"></i> Bookmarks</h3></div>';
        for(var i=0;i<bm.length;i++) {
            var label = bm[i].startsWith('w:') || bm[i].startsWith('s:') ? bm[i].substring(2) : bm[i];
            html += '<div class="wlink" data-browser-nav="'+bm[i]+'">' +
                '<i class="fa-solid fa-link"></i> ' + this._esc(label) + '<br><small>' + this._esc(bm[i]) + '</small></div>';
        }
        html += '</div>';
        this._showBookmarkContent(html);
    },
    _showBookmarkContent: function(html) {
        var tab=phoneData.browser.tabs.find(function(t){return t.id===phoneData.browser.activeTabId;});
        if(!tab) return;
        tab.title='Bookmarks'; tab.url='bookmarks:'; tab.html=html;
        savePhoneData(); renderUI();
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
        if (t.dataset.newPost) { activeSocialTab='compose'; renderUI(); return; }
        if (t.dataset.st) { activeSocialTab=t.dataset.st; renderUI(); return; }
        if (t.dataset.section) { activePhoneSection=t.dataset.section; renderUI(); return; }
        if (t.dataset.postId) {
            var pid=t.dataset.postId;
            if(t.dataset.action==='like') SocialApp.likePost(pid);
            else if(t.dataset.action==='rt') SocialApp.retweetPost(pid);
            else if(t.dataset.action==='save') SocialApp.savePost(pid);
            return;
        }
        if (t.dataset.submitPost) { SocialApp.submitPost(); return; }
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
        if (t.dataset.browserSearch) {
            var sb=document.getElementById('searchBox');
            if(sb && sb.value.trim()) BrowserApp.searchWeb(phoneData.browser.activeTabId || (phoneData.browser.tabs.length ? phoneData.browser.tabs[0].id : null), sb.value.trim());
            return;
        }
        if (t.dataset.bookmarksView) { BrowserApp.viewBookmarks(); return; }
        if (t.dataset.browserNav) { if(phoneData.browser.activeTabId) BrowserApp.navigateTo(phoneData.browser.activeTabId, t.dataset.browserNav); return; }
        // Settings buttons
        if (t.dataset.scan) { scanChatForContacts(); if(typeof toastr!=='undefined') toastr.success('Scan complete — check console'); return; }
        if (t.dataset.reset) { if(confirm('Reset ALL phone data for this chat?')){ phoneData=getEmptyPhoneData(); savePhoneData(); renderUI(); if(typeof toastr!=='undefined') toastr.success('Phone data reset'); } return; }
        if (t.dataset.testApi) { SettingsApp.testApi(); return; }
    } catch(err) { console.warn('[Phone Extension] Click handler error:', err); }
}

function _phoneKeydownHandler(e) {
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
    var m=document.getElementById('pmi');
    if(e.key==='Enter'&&m&&!e.shiftKey){e.preventDefault();var sb=document.querySelector('[data-send-c]');if(sb)MessagesApp.sendMsg(sb.dataset.sendC);}
    var u=document.getElementById('burl');
    if(e.key==='Enter'&&u&&phoneData.browser.activeTabId){e.preventDefault();BrowserApp.navigateTo(phoneData.browser.activeTabId,u.value);}
    // Search bar enter
    var sb2=document.getElementById('searchBox');
    if(sb2 && e.target===sb2 && e.key==='Enter') {
        e.preventDefault();
        if(sb2.value.trim()) BrowserApp.searchWeb(phoneData.browser.activeTabId || (phoneData.browser.tabs.length ? phoneData.browser.tabs[0].id : null), sb2.value.trim());
    }
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

    // Settings toggles (checkboxes)
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

        // Save API provider globally
        if (key === 'phoneApiProvider') {
            var global = loadGlobalSettings() || {};
            global[key] = val;
            saveGlobalSettings(global);
        }

        console.log('[Phone Extension] Setting changed: ' + key + ' = ' + val);
        if(key === 'npcTextFrequency') startNpcAutoTextEngine();
    };})(selects[j]);}
    // Settings text inputs (API config) — use 'input' event for live updates
    var inputs = document.querySelectorAll('input.sett-input');
    var activeInput = document.activeElement ? document.activeElement.dataset && document.activeElement.dataset.set : null;
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
    // Save on blur for inputs
    for(var b=0;b<inputs.length;b++){(function(el){el.onblur=function(){
        var key = el.dataset.set;
        phoneData.settings[key] = el.value;
        savePhoneData();
        // Only re-render if we actually need to update the status icon
        if (key === 'phoneApiKey' || key === 'phoneApiUrl') {
            renderUI();
        }
    };})(inputs[b]);}

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

    // Diagnostic: check ST globals (safe — no direct references to potentially undefined vars)
    function safeVal(name, get) {
        try { var v = get(); return name + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v); }
        catch(e) { return name + ': undefined'; }
    }
    console.log('[Phone Extension] Diagnostics — ' + [
        safeVal('event_types', function(){ return typeof event_types; }),
        safeVal('eventSource', function(){ return typeof eventSource; }),
        safeVal('name2', function(){ return name2; }),
        safeVal('chatLen', function(){ return Array.isArray(chat) ? chat.length : 'n/a'; }),
        safeVal('charNames', function(){ return Array.isArray(characters) ? characters.map(function(c){return c.name;}).join(', ') : 'n/a'; }),
    ].join(' | '));

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
        autoDetectContact();
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
// AUTO-START — jQuery DOM-ready (standard ST extension pattern)
// ============================================================
$(function(){
    var _windowEventSource = window.eventSource;
    var _windowEventTypes = typeof window.event_types !== 'undefined' ? window.event_types : null;
    var _windowChat = window.chat;
    var _windowCharacters = typeof window.characters !== 'undefined' ? window.characters : null;
    var _windowName2 = typeof window.name2 !== 'undefined' ? window.name2 : null;

    console.log('[Phone Extension v0.2.0] jQuery ready — eventSource:', !!_windowEventSource,
        'chat:', _windowChat ? _windowChat.length : 'n/a', 'name2:', _windowName2, 'chars:', _windowCharacters ? _windowCharacters.length : 'n/a');

    injectPhone();

    // ST initializes eventSource AFTER dom-ready — retry with backoff
    function registerEventListeners(attempt) {
        if (attempt === undefined) attempt = 0;
        var es = window.eventSource;
        var et = typeof window.event_types !== 'undefined' ? window.event_types : null;

        if (es && et) {
            es.on(et.CHAT_CHANGED, function() {
                savePhoneData(true);
                phoneData = loadPhoneData();
                activeApp = phoneData._activeApp || 'phone';
                activeContactId = null;
                activeSocialTab = 'feed';
                renderUI();
                scanChatForContacts();
                startNpcAutoTextEngine();
            });
            es.on(et.USER_MESSAGE_RENDERED, onUserMessage);
            es.on(et.CHARACTER_MESSAGE_RENDERED, onCharacterMessage);
            console.log('[Phone Extension] Event listeners registered (attempt ' + (attempt+1) + ')');
        } else if (attempt < 10) {
            var delay = 500 * Math.pow(2, attempt);
            console.log('[Phone Extension] eventSource not ready yet, retrying in ' + delay + 'ms (attempt ' + (attempt+1) + '/10)');
            setTimeout(function() { registerEventListeners(attempt + 1); }, delay);
        } else if (attempt === 10) {
            // Last resort: also try to load fallback data
            try {
                var fb = localStorage.getItem('_phone_data_fallback');
                if (fb) {
                    var data = JSON.parse(fb);
                    if (data && data.settings) {
                        var apiFields = ['phoneApiUrl', 'phoneApiKey', 'phoneApiModel', 'phoneApiProvider'];
                        for (var ai = 0; ai < apiFields.length; ai++) {
                            if (data.settings[apiFields[ai]] !== undefined) {
                                phoneData.settings[apiFields[ai]] = data.settings[apiFields[ai]];
                            }
                        }
                        console.log('[Phone Extension] Loaded API settings from localStorage fallback');
                    }
                }
            } catch(e) {}
            console.warn('[Phone Extension] eventSource never became available after 10 attempts — polling fallback');
            // Fallback: poll for settings changes periodically
            setInterval(function() {
                try {
                    var fb = localStorage.getItem('_phone_data_fallback');
                    if (fb) {
                        var data = JSON.parse(fb);
                        if (data && data.settings) {
                            var apiFields = ['phoneApiUrl', 'phoneApiKey', 'phoneApiModel', 'phoneApiProvider'];
                            for (var ai = 0; ai < apiFields.length; ai++) {
                                if (data.settings[apiFields[ai]] !== undefined && data.settings[apiFields[ai]] !== phoneData.settings[apiFields[ai]]) {
                                    phoneData.settings[apiFields[ai]] = data.settings[apiFields[ai]];
                                }
                            }
                        }
                    }
                } catch(e) {}
            }, 5000);
        }
    }

    registerEventListeners(0);
});
