# SillyTavern Phone Extension - Context Integration Problems & Solutions

## Executive Summary

The SillyTavern Phone Extension currently fails to properly gather and use context from three key sources:

1. **Character data** - Only gets character names, not personality/scenario/card details
2. **Chat history** - Scrapes limited DOM text instead of accessing full message objects
3. **Browser search** - Completely simulated with no real search capability

**Root cause:** The extension relies on fragile DOM scraping and fallback chains instead of accessing SillyTavern's internal APIs and data structures directly.

**Solution:** Replace the context-gathering functions with robust versions that access SillyTavern's native data: `characters` object, `chat` array, and `SillyTavern.getContext()`.

---

## Problem 1: Contact Scanning Fails

### Current Implementation (BROKEN)

```javascript
function getKnownCharacterNames() {
    var names = new Set();
    var context = null;
    
    // Tries SillyTavern.getContext() - may not exist
    if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
        context = SillyTavern.getContext();
    }
    
    // Fallback to name2 - only gets current character
    if (!context && typeof name2 !== 'undefined') {
        currentCharName = name2;
    }
    
    // Fallback to DOM - unreliable
    if (!currentCharName) {
        var charNameEl = document.querySelector('#character_name_animation, #character_name, .char-name-element');
        if (charNameEl) currentCharName = charNameEl.textContent.trim();
    }
    
    // Only adds ONE character (current) to known names
    if (currentCharName) names.add(currentCharName);
    
    return Array.from(names);  // Returns array with 0-1 names
}
```

**Issues:**
- Only returns the current character, never other characters in the roster
- Relies on `SillyTavern.getContext()` which may not exist in all ST versions
- DOM selectors may not match current ST UI
- Never accesses the full `characters` object

### Fixed Implementation

```javascript
function getAllCharacterNames() {
    var names = [];
    var context = getContextData();  // Robust multi-method context getter
    
    // Access the full characters database
    if (context && context.characters) {
        var chars = context.characters;
        for (var id in chars) {
            if (chars[id] && chars[id].name) {
                names.push(chars[id].name);
            }
        }
    }
    
    // Fallback to global characters object
    if (typeof characters !== 'undefined') {
        for (var id2 in characters) {
            if (characters[id2] && characters[id2].name && names.indexOf(characters[id2].name) === -1) {
                names.push(characters[id2].name);
            }
        }
    }
    
    return names;  // Returns ALL character names
}
```

**Improvements:**
- Accesses full character roster via `characters` object
- Multiple fallback methods for different ST versions
- Returns all character names, not just the current one
- Enables scanning chat for ANY mentioned character

---

## Problem 2: Chat Context Not Used

### Current Implementation (BROKEN)

```javascript
function _getSafeChatTextBatch(count) {
    var result = [];
    try {
        // Tries multiple methods but only extracts text strings
        var msgs = null;
        if (typeof getChatMessagesSafe === 'function') {
            msgs = getChatMessagesSafe();
        } else if (typeof SillyTavern !== 'undefined' && SillyTavern.getChatMessages) {
            msgs = SillyTavern.getChatMessages();
        }
        
        if (msgs && msgs.length) {
            var start = Math.max(0, msgs.length - count);
            for (var i = start; i < msgs.length; i++) {
                if (msgs[i] && msgs[i].mes) {
                    result.push(msgs[i].mes);  // Only text, no metadata
                }
            }
            return result;
        }
        
        // Fallback: DOM scrape (very limited)
        var messageElements = document.querySelectorAll('#chat .mes .mes_text');
        // ... more text-only extraction
    } catch(e) {
        console.warn('[Phone Extension] _getSafeChatTextBatch error:', e);
    }
    return result;
}
```

**Issues:**
- Only extracts message text, loses all metadata (timestamps, speaker, is_user flag)
- Can't distinguish user vs character messages
- Can't access message order or timing
- DOM scraping limited to 50 messages
- No access to message extra data (emotions, actions, etc.)

### Fixed Implementation

```javascript
function getFullChatHistory(limit) {
    if (!limit) limit = 100;
    var messages = [];
    
    // Method 1: Use SillyTavern's getChatMessagesSafe (preserves full objects)
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
                            is_user: msgs[i].is_user || false,  // KEY: know who spoke
                            is_system: msgs[i].is_system || false,
                            send_date: msgs[i].send_date || null,  // KEY: timing
                            extra: msgs[i].extra || {},  // KEY: metadata
                            chat_id: msgs[i].chat_id || null
                        });
                    }
                }
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
        return messages;
    }
    
    // ... additional fallbacks ...
}
```

**Improvements:**
- Returns full message objects with all metadata
- Preserves `is_user` flag to distinguish speakers
- Includes timestamps for conversation flow
- Access to `extra` data (emotions, actions, etc.)
- Supports up to 100 messages (configurable)
- Multiple fallback methods for reliability

---

## Problem 3: NPC Texts Lack Character Depth

### Current Implementation (BROKEN)

```javascript
async function generateNpcTextWithContext(contact, systemPrompt, context) {
    var s = getSettings();
    var apiBase = s.phoneApiUrl || '';
    var apiKey = s.phoneApiKey || '';
    
    // System prompt is just "You are NAME. You are texting..."
    // Context is just a short snippet like "The user mentioned your name"
    
    var body = JSON.stringify({
        model: apiModel,
        messages: [
            { role: 'system', content: systemPrompt },  // Minimal character info
            { role: 'user', content: context }  // Minimal conversation context
        ],
        max_tokens: 50,
        temperature: 1.0
    });
    
    // ... API call ...
}
```

**Issues:**
- System prompt has no character personality or background
- User prompt only includes a 200-character snippet
- No access to character card (personality, scenario, examples)
- No conversation history beyond the immediate trigger
- No world info or lore integration
- Result: Generic, out-of-character responses

### Fixed Implementation

```javascript
async function generateNpcTextWithContext(contact, systemPrompt, context) {
    // Build rich context using new context system
    var llmContext = buildLLMContext(contact, 'contextual', context);
    
    // llmContext includes:
    // - Full character card (personality, description, scenario, examples)
    // - Recent conversation history (last 10 messages)
    // - Enhanced system prompt with character details
    // - Rich user prompt with conversation context
    
    var body = JSON.stringify({
        model: apiModel,
        messages: [
            { role: 'system', content: llmContext.system },  // Full character info
            { role: 'user', content: llmContext.user }  // Full conversation context
        ],
        max_tokens: 100,
        temperature: 0.8
    });
    
    // ... API call ...
}

function buildLLMContext(contact, eventType, chatSnippet) {
    var charCard = getCharacterCard(contact.name);  // Get FULL character card
    var chatHistory = getFullChatHistory(15);  // Get FULL chat history
    var user = (typeof name1 !== 'undefined') ? name1 : 'You';
    
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
            var speaker = recentMsgs[i].is_user ? user : 'Character';
            conversationContext += speaker + ': ' + recentMsgs[i].text + '\n';
        }
    }
    
    // Build user prompt
    var userPrompt = context;
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
```

**Improvements:**
- System prompt includes full character personality, description, scenario
- Includes example dialogue from character card
- User prompt includes last 10 messages of conversation
- NPC can reference specific things that were said
- Responses feel in-character and context-aware
- Configurable context size and content

---

## Problem 4: Browser Search is Fake

### Current Implementation

The browser app is entirely simulated:
- `navigateTo()` just shows "Navigating to: URL"
- Wikipedia searches show "Loading Wikipedia..."
- No actual web content is fetched
- Completely disconnected from chat context

### Solution (Optional Enhancement)

```javascript
var BrowserAppEnhanced = {
    performRealSearch: function(query) {
        // Use SillyTavern's built-in web search if available
        if (typeof doOnlineSearch === 'function') {
            doOnlineSearch(query);
            return;
        }
        
        // Fallback: show contextual search results
        this.showSearchResults(query);
    },
    
    showSearchResults: function(query) {
        var tab = phoneData.browser.tabs.find(function(t){ return t.id === phoneData.browser.activeTabId; });
        if (!tab) return;
        
        // Get contextual information from chat
        var chatContext = getChatContextString(5);
        var charCard = getCharacterCard(typeof name2 !== 'undefined' ? name2 : null);
        
        tab.url = 'search:' + query;
        tab.title = 'Search: ' + query;
        
        // Generate search results that incorporate chat context
        var results = this.generateContextualSearchResults(query, chatContext, charCard);
        tab.html = '<div class="search-results">' + results + '</div>';
        
        savePhoneData();
        renderUI();
    },
    
    generateContextualSearchResults: function(query, chatContext, charCard) {
        // Could integrate with real search APIs or world info
        // For now, shows note about simulation
        return '<div class="search-note">This is a simulated browser for in-universe roleplay.</div>';
    }
};
```

**Note:** Real browser search would require:
- API integration (Google Custom Search, Bing API, etc.)
- Or integration with SillyTavern's world info system
- Or a proxy server to fetch and sanitize web content
- Security considerations (XSS, content filtering)

The simulated browser is intentional for the "in-universe phone" experience.

---

## Implementation Checklist

### Phase 1: Core Context Functions ✅
- [x] `getContextData()` - Robust ST context access
- [x] `getAllCharacterNames()` - Get all character names
- [x] `getCharacterCard(name)` - Get full character data
- [x] `getFullChatHistory(limit)` - Get messages with metadata
- [x] `getChatContextString(count)` - Format chat as text
- [x] `buildLLMContext(contact, event, snippet)` - Build rich LLM prompts

### Phase 2: Replace Broken Functions ✅
- [x] Replace `getKnownCharacterNames()` with `getAllCharacterNames()`
- [x] Replace `_getSafeChatTextBatch()` with `getFullChatHistory()`
- [x] Replace `scanChatForContacts()` with enhanced version
- [x] Replace `generateNpcTextWithContext()` with rich context version
- [x] Replace `generateNpcText()` with rich context version

### Phase 3: Optional Enhancements ⚠️
- [ ] Real browser search integration (requires API keys)
- [ ] World info integration for searches
- [ ] Character book/lorebook integration
- [ ] Memory system integration
- [ ] Emotional context from message extra data

---

## Testing Strategy

### Unit Tests (Manual)

```javascript
// Test context access
console.log(getContextData());  // Should return ST context object
console.log(getAllCharacterNames());  // Should return array of names
console.log(getCharacterCard('CharacterName'));  // Should return card object

// Test chat history
var history = getFullChatHistory(10);
console.log(history[0]);  // Should have id, text, is_user, send_date, extra

// Test LLM context building
var contact = phoneData.contacts[0];
var ctx = buildLLMContext(contact, 'test', 'Hello');
console.log(ctx.system);  // Should include character details
console.log(ctx.user);    // Should include conversation context
```

### Integration Tests

1. **Contact scanning test:**
   - Open chat with character
   - Open phone → Settings → Scan for Contacts
   - Verify current character appears
   - Mention another character in chat
   - Scan again
   - Verify mentioned character appears

2. **NPC text personality test:**
   - Configure API settings
   - Wait for auto-text or trigger manually
   - Verify text reflects character personality
   - Check console for rich context logs

3. **Chat context test:**
   - Have multi-message conversation
   - Trigger NPC text
   - Verify NPC references recent conversation

---

## Performance Considerations

### Memory Usage
- `getFullChatHistory()` loads up to 100 message objects
- Each message object is ~200-500 bytes
- Total memory: ~50KB per call (acceptable)

### API Token Usage
- Rich context increases prompt size
- Character card: ~500-1000 tokens
- Chat history (10 msgs): ~200-500 tokens
- Total per NPC text: ~700-1500 tokens
- At $0.002/1K tokens (gpt-4o-mini): ~$0.001-0.003 per text

**Mitigation:**
- Limit chat history to 5-10 messages
- Truncate character card fields
- Use cheaper models for NPC texts
- Cache context between texts

### Execution Time
- Context gathering: ~10-50ms
- LLM API call: ~500-2000ms
- Total: ~1-2 seconds (acceptable for NPC texts)

---

## Security Notes

### Data Access
- Extension runs in same context as SillyTavern
- Has access to all chat data and character cards
- Can read API keys from settings
- **Trust level:** Same as any ST extension

### API Key Handling
- Keys stored in localStorage (browser-side)
- Sent to external APIs (OpenAI, etc.)
- **Recommendation:** Use separate API key for phone texts
- **Recommendation:** Set spending limits on API keys

### Content Filtering
- NPC texts not filtered before sending
- Could generate inappropriate content
- **Mitigation:** Use content-filtered models
- **Mitigation:** Add user confirmation for outgoing texts

---

## Future Improvements

1. **World Info Integration**
   - Scan world info entries for relevant lore
   - Include in NPC text generation
   - Use for browser search results

2. **Memory System**
   - Remember important events from chat
   - Reference them in future texts
   - Build long-term character relationships

3. **Emotional Context**
   - Extract emotions from message extra data
   - Adjust NPC text tone based on emotional state
   - Track relationship dynamics

4. **Multi-Character Conversations**
   - Support group chats
   - Characters can text each other
   - NPC reactions to other NPCs

5. **Real Browser Integration**
   - Actual web search via API
   - Content scraping and summarization
   - In-universe news and information

---

## Conclusion

The context integration issues stem from relying on fragile DOM scraping instead of accessing SillyTavern's internal data structures. By replacing the broken functions with robust versions that use `characters`, `chat`, and `SillyTavern.getContext()`, we can:

- ✅ Properly scan for contacts (all characters, not just current)
- ✅ Generate NPC texts with full character personality
- ✅ Include recent conversation history in texts
- ✅ Access complete message metadata
- ✅ Build rich LLM prompts with character cards

The fixes are backwards-compatible, require minimal changes, and dramatically improve the phone extension's immersion and functionality.
