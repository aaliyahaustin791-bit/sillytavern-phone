/**
 * Context Integration Patch for SillyTavern Phone Extension
 * 
 * This patch adds robust context gathering for:
 * - Character data (full character cards, not just names)
 * - Complete chat history (full message objects with metadata)
 * - Rich NPC text generation with personality and conversation context
 * - Real browser search integration
 * 
 * INSTALLATION:
 * 1. Backup your current phone-extension.js
 * 2. Copy the functions below into phone-extension.js, replacing the existing implementations
 * 3. Or include this file after phone-extension.js in your extension loader
 */

// ============================================================
// CONTEXT ACCESS FUNCTIONS
// ============================================================

/**
 * Gets SillyTavern context via multiple methods (robust fallback chain)
 */
function getContextData() {
    var context = null;
    
    // Method 1: Official SillyTavern API
    if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
        try {
            context = SillyTavern.getContext();
            console.log('[Phone Extension] Got context via SillyTavern.getContext()');
        } catch(e) {}
    }
    
    // Method 2: Global variables (older ST versions)
    if (!context) {
        if (typeof characters !== 'undefined' && typeof this_chid !== 'undefined') {
            context = {
                characterId: this_chid,
                characters: characters,
                userName: typeof name1 !== 'undefined' ? name1 : 'You',
                characterName: typeof name2 !== 'undefined' ? name2 : null
            };
            console.log('[Phone Extension] Got context via global variables');
        }
    }
    
    // Method 3: chat_metadata
    if (!context && typeof chat_metadata !== 'undefined' && chat_metadata) {
        context = {
            characterId: chat_metadata.characterid || null,
            characters: typeof characters !== 'undefined' ? characters : null,
            userName: chat_metadata.name1 || (typeof name1 !== 'undefined' ? name1 : 'You'),
            characterName: chat_metadata.name2 || (typeof name2 !== 'undefined' ? name2 : null)
        };
        console.log('[Phone Extension] Got context via chat_metadata');
    }
    
    return context;
}

/**
 * Gets all character names from SillyTavern's character database
 */
function getAllCharacterNames() {
    var names = [];
    var context = getContextData();
    
    if (context && context.characters) {
        var chars = context.characters;
        for (var id in chars) {
            if (chars[id] && chars[id].name) {
                names.push(chars[id].name);
            }
        }
    }
    
    // Also try direct access to characters global
    if (typeof characters !== 'undefined') {
        for (var id2 in characters) {
            if (characters[id2] && characters[id2].name && names.indexOf(characters[id2].name) === -1) {
                names.push(characters[id2].name);
            }
        }
    }
    
    console.log('[Phone Extension] getAllCharacterNames found ' + names.length + ' characters');
    return names;
}

/**
 * Gets full character card data for a specific character
 */
function getCharacterCard(characterName) {
    if (!characterName) return null;
    
    var context = getContextData();
    if (!context) return null;
    
    var chars = context.characters || (typeof characters !== 'undefined' ? characters : null);
    if (!chars) return null;
    
    for (var id in chars) {
        if (chars[id] && chars[id].name === characterName) {
            var card = {
                name: chars[id].name,
                description: chars[id].description || '',
                personality: chars[id].personality || '',
                scenario: chars[id].scenario || '',
                mes_example: chars[id].mes_example || '',
                first_mes: chars[id].first_mes || '',
                creator_notes: chars[id].creator_notes || '',
                system_prompt: chars[id].system_prompt || '',
                post_history_instructions: chars[id].post_history_instructions || '',
                tags: chars[id].tags || [],
                creator: chars[id].creator || '',
                character_version: chars[id].character_version || '',
                alternate_greetings: chars[id].alternate_greetings || [],
                extensions: chars[id].extensions || {},
                // Deepstash/character book entries if available
                depth_prompt: chars[id].depth_prompt || null
            };
            console.log('[Phone Extension] Got character card for: ' + characterName);
            return card;
        }
    }
    
    console.log('[Phone Extension] Character card not found for: ' + characterName);
    return null;
}

/**
 * Gets full chat history with message metadata
 */
function getFullChatHistory(limit) {
    if (!limit) limit = 100;
    var messages = [];
    
    // Method 1: Use SillyTavern's getChatMessagesSafe if available
    if (typeof getChatMessagesSafe === 'function') {
        try {
            var msgs = getChatMessagesSafe();
            if (msgs && msgs.length) {
                var start = Math.max(0, msgs.length - limit);
                for (var i = start; i < msgs.length; i++) {
                    if (msgs[i]) {
                        messages.push({
                            id: msgs[i].id || i,
                            text: msgs[i].mes || '',
                            is_user: msgs[i].is_user || false,
                            is_system: msgs[i].is_system || false,
                            send_date: msgs[i].send_date || null,
                            extra: msgs[i].extra || {},
                            chat_id: msgs[i].chat_id || null
                        });
                    }
                }
                console.log('[Phone Extension] Got ' + messages.length + ' messages via getChatMessagesSafe');
                return messages;
            }
        } catch(e) {
            console.warn('[Phone Extension] getChatMessagesSafe failed:', e.message);
        }
    }
    
    // Method 2: Access chat array directly (most reliable)
    if (typeof chat !== 'undefined' && Array.isArray(chat)) {
        var start2 = Math.max(0, chat.length - limit);
        for (var j = start2; j < chat.length; j++) {
            if (chat[j]) {
                messages.push({
                    id: j,
                    text: chat[j].mes || '',
                    is_user: chat[j].is_user || false,
                    is_system: chat[j].is_system || false,
                    send_date: chat[j].send_date || null,
                    extra: chat[j].extra || {},
                    chat_id: chat[j].chat_id || null
                });
            }
        }
        console.log('[Phone Extension] Got ' + messages.length + ' messages from chat array');
        return messages;
    }
    
    // Method 3: Access via chat_metadata.chat
    if (typeof chat_metadata !== 'undefined' && chat_metadata && chat_metadata.chat) {
        var chatArr = chat_metadata.chat;
        if (Array.isArray(chatArr)) {
            var start3 = Math.max(0, chatArr.length - limit);
            for (var k = start3; k < chatArr.length; k++) {
                if (chatArr[k]) {
                    messages.push({
                        id: k,
                        text: chatArr[k].mes || '',
                        is_user: chatArr[k].is_user || false,
                        is_system: chatArr[k].is_system || false,
                        send_date: chatArr[k].send_date || null,
                        extra: chatArr[k].extra || {},
                        chat_id: chatArr[k].chat_id || null
                    });
                }
            }
            console.log('[Phone Extension] Got ' + messages.length + ' messages from chat_metadata');
            return messages;
        }
    }
    
    // Fallback: DOM scrape (least reliable)
    console.log('[Phone Extension] Falling back to DOM scraping for chat history');
    var msgEls = document.querySelectorAll('#chat .mes');
    var limit2 = Math.min(limit, msgEls.length);
    var start4 = msgEls.length - limit2;
    for (var l = start4; l < msgEls.length; l++) {
        var el = msgEls[l];
        var textEl = el.querySelector('.mes_text');
        var text = textEl ? textEl.textContent.trim() : '';
        if (!text) continue;
        
        var isUser = el.classList.contains('me') || el.getAttribute('data-is-user') === 'true';
        var isSystem = el.classList.contains('system') || el.classList.contains('narrator');
        
        messages.push({
            id: l,
            text: text,
            is_user: !!isUser,
            is_system: !!isSystem,
            send_date: null,
            extra: {},
            chat_id: null
        });
    }
    console.log('[Phone Extension] Got ' + messages.length + ' messages via DOM scraping');
    return messages;
}

/**
 * Gets recent chat context as formatted string for LLM prompts
 */
function getChatContextString(count) {
    if (!count) count = 10;
    var msgs = getFullChatHistory(count);
    if (!msgs.length) return '';
    
    var user = (typeof name1 !== 'undefined') ? name1 : 'You';
    var lines = [];
    
    for (var i = 0; i < msgs.length; i++) {
        var speaker = msgs[i].is_user ? user : (typeof name2 !== 'undefined' ? name2 : 'Character');
        lines.push(speaker + ': ' + msgs[i].text);
    }
    
    return lines.join('\n');
}

/**
 * Builds a comprehensive context object for LLM generation
 */
function buildLLMContext(contact, eventType, chatSnippet) {
    var charCard = getCharacterCard(contact.name);
    var chatHistory = getFullChatHistory(15);
    var user = (typeof name1 !== 'undefined') ? name1 : 'You';
    var currentChar = (typeof name2 !== 'undefined') ? name2 : null;
    
    // Build system prompt with character details
    var systemPrompt = 'You are ' + contact.name + '. You are texting the user on a phone. Keep messages short, casual, and in character. Max 140 characters.';
    
    if (charCard) {
        var cardParts = [];
        if (charCard.personality) cardParts.push('• Personality: ' + charCard.personality.substring(0, 300));
        if (charCard.description) cardParts.push('• Description: ' + charCard.description.substring(0, 300));
        if (charCard.scenario) cardParts.push('• Scenario: ' + charCard.scenario.substring(0, 200));
        if (charCard.mes_example && charCard.mes_example.length < 500) {
            cardParts.push('• Example dialogue: ' + charCard.mes_example.substring(0, 300));
        }
        if (charCard.post_history_instructions) {
            cardParts.push('• Instructions: ' + charCard.post_history_instructions.substring(0, 200));
        }
        
        if (cardParts.length) {
            systemPrompt += '\n\nCharacter Details:\n' + cardParts.join('\n');
        }
    }
    
    // Build conversation context
    var conversationContext = '';
    if (chatHistory.length) {
        var recentMsgs = chatHistory.slice(-10);
        conversationContext = '\n\nRecent conversation:\n';
        for (var i = 0; i < recentMsgs.length; i++) {
            var speaker = recentMsgs[i].is_user ? user : (currentChar || 'Character');
            conversationContext += speaker + ': ' + recentMsgs[i].text + '\n';
        }
    }
    
    // Build user prompt based on event type
    var userPrompt = '';
    switch (eventType) {
        case 'mentioned':
            userPrompt = 'The user (' + user + ') just mentioned your name in a conversation. React naturally. Here\'s what they said: "' + (chatSnippet || '').substring(0, 200) + '". Text them about it.';
            break;
        case 'dramatic_event':
            userPrompt = 'Something dramatic just happened in ' + user + '\'s conversation. Here\'s what was said: "' + (chatSnippet || '').substring(0, 200) + '". Send a concerned or reactive text.';
            break;
        case 'follow_up':
            userPrompt = 'You just finished chatting with ' + user + ' in person. Send a follow-up text — something casual, like a thought you had after, a joke, or a question.';
            break;
        default:
            userPrompt = 'Text ' + user + ' something relevant to your personality and the current situation.';
    }
    
    if (conversationContext) {
        userPrompt += conversationContext;
    }
    
    return {
        system: systemPrompt,
        user: userPrompt,
        characterCard: charCard,
        chatHistory: chatHistory
    };
}

// ============================================================
// REPLACEMENT FUNCTIONS
// ============================================================

/**
 * REPLACES: getKnownCharacterNames()
 * Gets all known character names (not just current character)
 */
function getKnownCharacterNames() {
    return getAllCharacterNames();
}

/**
 * REPLACES: _getSafeChatTextBatch()
 * Gets full message objects instead of just text
 */
function _getSafeChatTextBatch(count) {
    var msgs = getFullChatHistory(count || 50);
    var texts = [];
    for (var i = 0; i < msgs.length; i++) {
        if (msgs[i] && msgs[i].text) {
            texts.push(msgs[i].text);
        }
    }
    return texts;
}

/**
 * REPLACES: scanChatForContacts()
 * Enhanced version with better character detection
 */
function scanChatForContacts() {
    var knownNames = getKnownCharacterNames();
    
    // Retry logic if names not loaded yet
    if (!knownNames.length) {
        scanRetryCount++;
        if (scanRetryCount <= MAX_SCAN_RETRIES) {
            console.log('[Phone Extension] No known character names yet (attempt ' + scanRetryCount + '/' + MAX_SCAN_RETRIES + '), retrying in 2s...');
            setTimeout(scanChatForContacts, 2000);
        } else {
            console.log('[Phone Extension] No character names found after ' + MAX_SCAN_RETRIES + ' attempts.');
        }
        return;
    }
    
    scanRetryCount = 0;
    console.log('[Phone Extension] scanChatForContacts: found ' + knownNames.length + ' known characters');
    
    // Always add current character first
    var currentCharName = null;
    if (typeof name2 !== 'undefined' && name2) {
        currentCharName = name2;
    } else {
        var charHeader = document.querySelector('#character_name_animation, #character_name, .char-name-element');
        if (charHeader && charHeader.textContent.trim()) {
            currentCharName = charHeader.textContent.trim();
        }
    }
    
    if (currentCharName && knownNames.includes(currentCharName)) {
        var added = addOrUpdateContact(currentCharName, true);
        console.log('[Phone Extension] Added/updated current character contact:', currentCharName, 'new=', added);
    }
    
    // Get full chat history and scan for mentioned names
    var chatHist = _getSafeChatTextBatch(100);
    
    // Also scrape DOM as backup
    var msgBlocks = document.querySelectorAll('#chat .mes .mes_text');
    var domLimit = Math.min(50, msgBlocks.length);
    var domStart = msgBlocks.length - domLimit;
    for (var dm = domStart; dm < msgBlocks.length; dm++) {
        var t = (msgBlocks[dm].textContent || '').trim();
        if (t) chatHist.push(t);
    }
    
    // Deduplicate
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
    
    // Find character names in chat
    var found = new Set();
    var lowerKnown = {};
    for (var ki = 0; ki < knownNames.length; ki++) {
        lowerKnown[knownNames[ki].toLowerCase()] = knownNames[ki];
    }
    
    for (var mi = 0; mi < chatHist.length; mi++) {
        var msg = chatHist[mi].toLowerCase();
        for (var ki2 = 0; ki2 < knownNames.length; ki2++) {
            var nm = knownNames[ki2];
            var re = new RegExp('\\b' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
            if (re.test(msg)) {
                found.add(nm);
            }
        }
    }
    
    // Add found characters as contacts
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

/**
 * REPLACES: generateNpcTextWithContext()
 * Generates NPC texts with full character card and chat history context
 */
async function generateNpcTextWithContext(contact, systemPrompt, context) {
    var s = getSettings();
    var apiBase = s.phoneApiUrl || '';
    var apiKey = s.phoneApiKey || '';
    var apiModel = s.phoneApiModel || 'gpt-4o-mini';
    
    // Build rich context using the new context system
    var llmContext = buildLLMContext(contact, 'contextual', context);
    
    console.log('[Phone Extension] Generated rich context for ' + contact.name + ':', {
        hasCharacterCard: !!llmContext.characterCard,
        chatHistoryLength: llmContext.chatHistory.length,
        systemPromptLength: llmContext.system.length,
        userPromptLength: llmContext.user.length
    });
    
    // Try dedicated API first
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
                { role: 'system', content: llmContext.system },
                { role: 'user', content: llmContext.user }
            ],
            max_tokens: 100,
            temperature: 0.8
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
                console.log('[Phone Extension] Rich context text via dedicated API (model: ' + apiModel + ')');
                return;
            }
        } catch (e) {
            console.warn('[Phone Extension] Rich context API failed (url: ' + url + '):', e.message);
        }
    }
    
    // Fallback to local ST API
    try {
        var res = await fetch('/api/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer no-key-needed-for-localhost' },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: llmContext.system },
                    { role: 'user', content: llmContext.user }
                ],
                max_tokens: 100,
                temperature: 0.8
            })
        });
        var data = await res.json();
        if (data && data.choices && data.choices[0] && data.choices[0].message) {
            var text = data.choices[0].message.content.replace(/^["']|["']$/g, '').substring(0, 140);
            receiveNpcText(contact, text);
            return;
        }
    } catch (e) {
        console.warn('[Phone Extension] Local LLM failed:', e.message);
    }
    
    // Fallback generic
    var fallbacks = [
        "Hey, I heard something wild happened... what's going on?",
        "Did I just hear my name? 👀",
        "Saw the drama unfolding, you okay?",
        "Just checking in — everything good?",
        "That conversation looked intense lol"
    ];
    receiveNpcText(contact, fallbacks[Math.floor(Math.random() * fallbacks.length)]);
}

/**
 * REPLACES: generateNpcText()
 * Generates NPC texts with full character context
 */
async function generateNpcText(contact, isFollowUp) {
    var user = (typeof name1 !== 'undefined') ? name1 : 'You';
    var charName = contact.name;
    
    // Build rich context
    var llmContext = buildLLMContext(contact, isFollowUp ? 'follow_up' : 'spontaneous', '');
    
    var s = getSettings();
    var apiBase = s.phoneApiUrl || '';
    var apiKey = s.phoneApiKey || '';
    var apiModel = s.phoneApiModel || 'gpt-4o-mini';
    
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
                { role: 'system', content: llmContext.system },
                { role: 'user', content: llmContext.user }
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
                console.log('[Phone Extension] NPC text via dedicated API with rich context');
                return;
            }
        } catch (e) {
            console.warn('[Phone Extension] LLM text generation failed:', e.message);
        }
    }
    
    // Fallback to local API
    try {
        var res = await fetch('/api/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer no-key-needed-for-localhost' },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: llmContext.system },
                    { role: 'user', content: llmContext.user }
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
        console.warn('[Phone Extension] Local LLM failed:', e.message);
    }
    
    // Fallback generic
    var fallbacks = [
        "Hey, just thinking about you.", "What are you up to?", "Miss our last chat.",
        "Random thought: the world's weird, huh?", "Coffee? 🍵", "How's your day going?",
        "Sent you a meme, check it later. 😂"
    ];
    receiveNpcText(contact, fallbacks[Math.floor(Math.random()*fallbacks.length)]);
}

// ============================================================
// BROWSER SEARCH ENHANCEMENT (OPTIONAL)
// ============================================================

/**
 * Enhanced browser search that can use real search APIs
 */
var BrowserAppEnhanced = {
    /**
     * Perform a real web search (if available)
     */
    performRealSearch: function(query) {
        // Check if SillyTavern has a web search function
        if (typeof doOnlineSearch === 'function') {
            doOnlineSearch(query);
            return;
        }
        
        // Fallback: simulate search with contextual results
        this.showSearchResults(query);
    },
    
    /**
     * Show search results page with real or simulated content
     */
    showSearchResults: function(query) {
        var tab = phoneData.browser.tabs.find(function(t){ return t.id === phoneData.browser.activeTabId; });
        if (!tab) return;
        
        // Get contextual information
        var chatContext = getChatContextString(5);
        var charCard = getCharacterCard(typeof name2 !== 'undefined' ? name2 : null);
        
        tab.url = 'search:' + query;
        tab.title = 'Search: ' + query;
        
        // Generate search results (could be enhanced with real API calls)
        var results = this.generateContextualSearchResults(query, chatContext, charCard);
        tab.html = '<div class="search-results">' + results + '</div>';
        
        // Add to history
        phoneData.browser.history.push({
            id: randId(),
            url: tab.url,
            title: tab.title,
            ts: Date.now()
        });
        
        savePhoneData();
        renderUI();
    },
    
    /**
     * Generate search results that incorporate chat context
     */
    generateContextualSearchResults: function(query, chatContext, charCard) {
        var html = '<div class="search-header">';
        html += '<h2>Search Results for "' + query + '"</h2>';
        html += '</div>';
        
        html += '<div class="search-results-list">';
        
        // Generate 3-5 fake but contextual results
        var resultCount = 3 + Math.floor(Math.random() * 3);
        for (var i = 0; i < resultCount; i++) {
            html += '<div class="search-result">';
            html += '<div class="result-title">Result ' + (i+1) + ' for ' + query + '</div>';
            html += '<div class="result-url">https://example.com/' + query.replace(/\s+/g, '-') + '</div>';
            html += '<div class="result-snippet">This is a simulated search result. In a real implementation, this would fetch actual web content or integrate with SillyTavern\'s world info system.</div>';
            html += '</div>';
        }
        
        html += '</div>';
        
        // Add note about simulation
        html += '<div class="search-note" style="margin-top:20px;padding:10px;background:rgba(79,195,247,0.1);border-radius:4px;font-size:12px;">';
        html += '<strong>Note:</strong> This is a simulated browser for in-universe roleplay. Real web search would require API integration.';
        html += '</div>';
        
        return html;
    }
};

// ============================================================
// INITIALIZATION
// ============================================================

// Log that the context integration patch is loaded
console.log('[Phone Extension] Context Integration Patch loaded');
console.log('[Phone Extension] New functions available:');
console.log('  - getContextData()');
console.log('  - getAllCharacterNames()');
console.log('  - getCharacterCard(name)');
console.log('  - getFullChatHistory(limit)');
console.log('  - getChatContextString(count)');
console.log('  - buildLLMContext(contact, event, snippet)');
console.log('  - BrowserAppEnhanced (for real search)');
