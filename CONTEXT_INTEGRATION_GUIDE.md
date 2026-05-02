# SillyTavern Phone Extension - Context Integration Guide

## Current Problems

### 1. Contact Scanning Fails
- `getKnownCharacterNames()` only gets the current character name via fragile fallbacks
- Never scans the full character roster
- Doesn't access character card data (personality, scenario, etc.)

### 2. Chat Context Not Used
- `_getSafeChatTextBatch()` only gets message text, not full message objects
- No access to timestamps, speaker info, or message metadata
- Limited to 50 messages via DOM scraping

### 3. NPC Texts Lack Character Depth
- `generateNpcTextWithContext()` only passes a 200-char snippet
- No character card info (personality, traits, background)
- No conversation history beyond the immediate message
- No world info or lore integration

### 4. Browser Search is Fake
- Browser app doesn't actually search anything
- No integration with real search APIs or ST's world info
- Completely simulated experience

## How to Fix Each Issue

### Fix 1: Robust Character Data Access

Replace `getKnownCharacterNames()` with a function that accesses SillyTavern's character database:

```javascript
function getContextData() {
    var context = null;
    
    // Try multiple methods to get ST context
    if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
        context = SillyTavern.getContext();
    }
    
    if (!context) {
        // Fallback: try to access global variables
        if (typeof characters !== 'undefined' && typeof this_chid !== 'undefined') {
            context = {
                characterId: this_chid,
                characters: characters
            };
        }
    }
    
    return context;
}

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
    
    // Also try direct access to characters array
    if (typeof characters !== 'undefined') {
        for (var id2 in characters) {
            if (characters[id2] && characters[id2].name && names.indexOf(characters[id2].name) === -1) {
                names.push(characters[id2].name);
            }
        }
    }
    
    return names;
}

function getCharacterCard(characterName) {
    var context = getContextData();
    if (!context) return null;
    
    var chars = context.characters || characters;
    if (!chars) return null;
    
    for (var id in chars) {
        if (chars[id] && chars[id].name === characterName) {
            return {
                name: chars[id].name,
                personality: chars[id].personality || '',
                scenario: chars[id].scenario || '',
                mes_example: chars[id].mes_example || '',
                creator_notes: chars[id].creator_notes || '',
                system_prompt: chars[id].system_prompt || '',
                post_history_instructions: chars[id].post_history_instructions || '',
                tags: chars[id].tags || [],
                creator: chars[id].creator || '',
                character_version: chars[id].character_version || '',
                extensions: chars[id].extensions || {}
            };
        }
    }
    return null;
}
```

### Fix 2: Complete Chat History Access

Replace `_getSafeChatTextBatch()` with a function that gets full message objects:

```javascript
function getFullChatHistory(limit) {
    if (!limit) limit = 100;
    var messages = [];
    
    // Method 1: Use SillyTavern's getChatMessages if available
    if (typeof getChatMessagesSafe === 'function') {
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
                        extra: msgs[i].extra || {}
                    });
                }
            }
            return messages;
        }
    }
    
    // Method 2: Access chat array directly
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
                    extra: chat[j].extra || {}
                });
            }
        }
        return messages;
    }
    
    // Method 3: Access via chat_metadata
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
                        extra: chatArr[k].extra || {}
                    });
                }
            }
            return messages;
        }
    }
    
    // Fallback: DOM scrape (limited)
    var msgEls = document.querySelectorAll('#chat .mes .mes_text');
    var limit2 = Math.min(limit, msgEls.length);
    var start4 = msgEls.length - limit2;
    for (var l = start4; l < msgEls.length; l++) {
        var el = msgEls[l];
        var mesBlock = el.closest('.mes');
        var isUser = mesBlock && (mesBlock.classList.contains('me') || mesBlock.getAttribute('data-is-user') === 'true');
        messages.push({
            id: l,
            text: el.textContent.trim(),
            is_user: !!isUser,
            is_system: false,
            send_date: null,
            extra: {}
        });
    }
    return messages;
}
```

### Fix 3: Rich NPC Text Generation with Full Context

Replace `generateNpcTextWithContext()` to include character card, chat history, and world info:

```javascript
async function generateNpcTextWithContext(contact, systemPrompt, context) {
    var s = getSettings();
    var apiBase = s.phoneApiUrl || '';
    var apiKey = s.phoneApiKey || '';
    var apiModel = s.phoneApiModel || 'gpt-4o-mini';
    
    // Build rich context
    var charCard = getCharacterCard(contact.name);
    var chatHistory = getFullChatHistory(20);
    var user = (typeof name1 !== 'undefined') ? name1 : 'You';
    
    // Build system prompt with character details
    var fullSystemPrompt = systemPrompt;
    if (charCard) {
        var cardInfo = [];
        if (charCard.personality) cardInfo.push('Personality: ' + charCard.personality);
        if (charCard.scenario) cardInfo.push('Scenario: ' + charCard.scenario);
        if (charCard.mes_example) cardInfo.push('Example messages: ' + charCard.mes_example);
        if (charCard.post_history_instructions) cardInfo.push('Instructions: ' + charCard.post_history_instructions);
        
        if (cardInfo.length) {
            fullSystemPrompt += '\n\nCharacter Details:\n' + cardInfo.join('\n');
        }
    }
    
    // Build conversation context
    var conversationContext = '';
    if (chatHistory.length) {
        var recentMsgs = chatHistory.slice(-10);
        for (var i = 0; i < recentMsgs.length; i++) {
            var speaker = recentMsgs[i].is_user ? user : contact.name;
            conversationContext += speaker + ': ' + recentMsgs[i].text + '\n';
        }
    }
    
    // Build final prompt
    var finalPrompt = context;
    if (conversationContext) {
        finalPrompt += '\n\nRecent conversation:\n' + conversationContext;
    }
    
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
                { role: 'system', content: fullSystemPrompt },
                { role: 'user', content: finalPrompt }
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
                console.log('[Phone Extension] Rich context text via dedicated API');
                return;
            }
        } catch (e) {
            console.warn('[Phone Extension] Rich context API failed:', e.message);
        }
    }
    
    // Fallback to local ST API
    try {
        var res = await fetch('/api/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer no-key-needed-for-localhost' },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: fullSystemPrompt },
                    { role: 'user', content: finalPrompt }
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
```

### Fix 4: Real Browser Search Integration

Replace the fake browser with real search capabilities:

```javascript
var BrowserApp = {
    // ... existing properties ...
    
    performRealSearch: function(query) {
        // Use SillyTavern's built-in web search if available
        if (typeof doOnlineSearch === 'function') {
            doOnlineSearch(query);
            return;
        }
        
        // Fallback: open real search in new tab (if allowed)
        var encoded = encodeURIComponent(query);
        var url = 'https://www.google.com/search?q=' + encoded;
        
        // Or use a simulated search result page with real data
        this.showSearchResults(query, url);
    },
    
    showSearchResults: function(query, realUrl) {
        var tab = phoneData.browser.tabs.find(function(t){ return t.id === phoneData.browser.activeTabId; });
        if (!tab) return;
        
        tab.url = realUrl;
        tab.title = 'Search: ' + query;
        
        // Create a simulated search results page
        var results = this.generateSearchResults(query);
        tab.html = '<div class="search-results">' + results + '</div>';
        
        savePhoneData();
        renderUI();
    },
    
    generateSearchResults: function(query) {
        // This would generate fake but contextual search results
        // Could integrate with world info or character lore
        return '<div class="result">Search results for: ' + query + '</div>';
    }
};
```

## Implementation Steps

1. **Add the new context functions** to the top of `phone-extension.js` (after state declarations)
2. **Replace `getKnownCharacterNames()`** with `getAllCharacterNames()`
3. **Replace `_getSafeChatTextBatch()`** with `getFullChatHistory()`
4. **Update `scanChatForContacts()`** to use the new character access
5. **Replace `generateNpcTextWithContext()`** with the rich context version
6. **Optional: Enhance browser** with real search integration

## Testing

After implementing:
1. Open a chat with a character
2. Open phone settings and verify API is configured
3. Send some messages in the main chat
4. Check console for context logs
5. Wait for NPC auto-text or trigger one manually
6. Verify the text reflects character personality and recent chat
7. Check contacts - should include all mentioned characters
8. Test browser search (if implemented)

## Note on SillyTavern API Access

The extension runs in the same context as SillyTavern, so it has access to:
- `chat` array (all messages)
- `characters` object (all character data)
- `this_chid` (current character ID)
- `name1` (user name)
- `name2` (current character name)
- `chat_metadata` (chat metadata)
- `getChatMessagesSafe()` function
- `SillyTavern.getContext()` (if available)

Use these directly instead of DOM scraping when possible.
