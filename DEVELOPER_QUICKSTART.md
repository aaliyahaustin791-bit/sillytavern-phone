# Developer Quickstart: Context Integration for SillyTavern Phone

## TL;DR - What's Broken and How to Fix It

### Problem 1: Contacts Don't Scan
**Symptom:** Phone contacts list is empty or only has current character  
**Cause:** `getKnownCharacterNames()` only returns 0-1 names  
**Fix:** Replace with `getAllCharacterNames()` that accesses `characters` object

### Problem 2: NPC Texts Are Generic  
**Symptom:** Phone messages don't reflect character personality  
**Cause:** `generateNpcTextWithContext()` uses minimal context  
**Fix:** Use `buildLLMContext()` to include full character card + chat history

### Problem 3: Chat Context Not Used
**Symptom:** Can't tell who said what in chat  
**Cause:** `_getSafeChatTextBatch()` only extracts text strings  
**Fix:** Use `getFullChatHistory()` to get full message objects with metadata

## Key Functions Reference

### Context Access
```javascript
// Get SillyTavern context (robust, multi-method)
var ctx = getContextData();

// Get ALL character names from database
var names = getAllCharacterNames();

// Get full character card with personality, scenario, etc.
var card = getCharacterCard('CharacterName');

// Get chat history with full message objects
var messages = getFullChatHistory(20);

// Format chat as string for prompts
var chatStr = getChatContextString(10);

// Build rich LLM context (character + chat)
var llmCtx = buildLLMContext(contact, 'event_type', 'snippet');
```

### Message Object Structure
```javascript
{
    id: number,                    // Message index
    text: string,                  // Message content
    is_user: boolean,              // True if user sent it
    is_system: boolean,            // True if system message
    send_date: string|null,        // Timestamp
    extra: object,                 // Metadata (emotions, actions, etc.)
    chat_id: string|null           // Chat identifier
}
```

### Character Card Structure
```javascript
{
    name: string,
    description: string,
    personality: string,
    scenario: string,
    mes_example: string,
    first_mes: string,
    creator_notes: string,
    system_prompt: string,
    post_history_instructions: string,
    tags: array,
    creator: string,
    character_version: string,
    alternate_greetings: array,
    extensions: object,
    depth_prompt: object|null
}
```

## Code Snippets

### Scan Chat for Contacts (Fixed)
```javascript
function scanChatForContacts() {
    var knownNames = getAllCharacterNames();  // Get ALL characters
    if (!knownNames.length) {
        // Retry logic...
        return;
    }
    
    // Add current character
    var currentChar = (typeof name2 !== 'undefined') ? name2 : null;
    if (currentChar) addOrUpdateContact(currentChar, true);
    
    // Get full chat history
    var chatHist = getFullChatHistory(100);
    
    // Scan for mentioned names
    var found = new Set();
    for (var i = 0; i < chatHist.length; i++) {
        var msg = chatHist[i].text.toLowerCase();
        for (var j = 0; j < knownNames.length; j++) {
            var nm = knownNames[j];
            var re = new RegExp('\\b' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
            if (re.test(msg)) found.add(nm);
        }
    }
    
    // Add found contacts
    var foundArr = Array.from(found);
    for (var k = 0; k < foundArr.length; k++) {
        addOrUpdateContact(foundArr[k], false);
    }
}
```

### Generate NPC Text with Context (Fixed)
```javascript
async function generateNpcTextWithContext(contact, systemPrompt, context) {
    // Build rich context
    var llmCtx = buildLLMContext(contact, 'contextual', context);
    
    // API call with rich context
    var body = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: llmCtx.system },  // Full character card
            { role: 'user', content: llmCtx.user }       // Full chat history
        ],
        max_tokens: 100,
        temperature: 0.8
    });
    
    var res = await fetch('/api/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body
    });
    
    var data = await res.json();
    if (data && data.choices && data.choices[0]) {
        var text = data.choices[0].message.content.substring(0, 140);
        receiveNpcText(contact, text);
    }
}
```

## Debugging Commands

Run these in browser console to test context access:

```javascript
// Test context retrieval
console.log('Context:', getContextData());

// Test character access
console.log('All names:', getAllCharacterNames());
console.log('Character card:', getCharacterCard('YourCharacterName'));

// Test chat history
var hist = getFullChatHistory(5);
console.log('Chat history:', hist);
console.log('First message:', hist[0]);

// Test LLM context building
var contact = phoneData.contacts[0];
var ctx = buildLLMContext(contact, 'test', 'Hello');
console.log('System prompt:', ctx.system);
console.log('User prompt:', ctx.user);
console.log('Has card:', !!ctx.characterCard);
console.log('History length:', ctx.chatHistory.length);
```

## Common Issues and Fixes

### Issue: `getContextData is not defined`
**Fix:** Ensure context-integration-patch.js is loaded before use

### Issue: `getAllCharacterNames()` returns empty array
**Fix:** Check that `characters` global exists:
```javascript
console.log(typeof characters);  // Should be 'object'
console.log(Object.keys(characters).length);  // Should be > 0
```

### Issue: `getFullChatHistory()` returns empty array
**Fix:** Check that `chat` global exists:
```javascript
console.log(typeof chat);  // Should be 'object'
console.log(Array.isArray(chat));  // Should be true
console.log(chat.length);  // Should be > 0
```

### Issue: Character card is null
**Fix:** Verify character name matches exactly:
```javascript
console.log('Looking for:', contact.name);
console.log('Available:', Object.keys(characters).map(id => characters[id].name));
```

### Issue: API call fails
**Fix:** Check API settings and test connection:
```javascript
console.log('API URL:', getSettings().phoneApiUrl);
console.log('API Key set:', !!getSettings().phoneApiKey);
SettingsApp.testApi();  // Built-in test function
```

## Performance Tips

### Reduce Token Usage
```javascript
// Limit chat history
var chatHistory = getFullChatHistory(5);  // Instead of 15

// Truncate character card fields
if (charCard.personality) {
    cardParts.push('• Personality: ' + charCard.personality.substring(0, 200));
}

// Use cheaper model
phoneData.settings.phoneApiModel = 'gpt-3.5-turbo';
```

### Cache Context
```javascript
var contextCache = {};
var cacheTime = 0;
var CACHE_DURATION = 30000;  // 30 seconds

function getCachedContext(contactName) {
    var now = Date.now();
    if (contextCache[contactName] && (now - cacheTime) < CACHE_DURATION) {
        return contextCache[contactName];
    }
    var ctx = buildLLMContext(contact, 'cached', '');
    contextCache[contactName] = ctx;
    cacheTime = now;
    return ctx;
}
```

## Best Practices

1. **Always use robust context access**
   - Don't rely on single method (SillyTavern.getContext may not exist)
   - Use fallback chain: getContext() → global variables → DOM

2. **Preserve message metadata**
   - Don't just extract text - keep is_user, timestamps, extra data
   - Enables better context understanding

3. **Include character card in prompts**
   - Personality, description, scenario, examples
   - Makes NPC texts feel in-character

4. **Limit context size**
   - Chat history: 5-10 messages (not 50+)
   - Character card: truncate to 300-500 chars per field
   - Controls token usage and cost

5. **Test across ST versions**
   - Different versions have different APIs
   - Use multiple access methods for compatibility

## Resources

- **SillyTavern Docs:** https://docs.sillytavern.app/
- **Extension API:** Check SillyTavern's extension documentation
- **Community:** SillyTavern Discord for support
- **Source:** https://github.com/aaliyahaustin791-bit/sillytavern-phone

## Next Steps

1. Install the context integration patch (see INSTALLATION_GUIDE.md)
2. Test with your characters and chats
3. Adjust context size and content as needed
4. Consider adding world info integration
5. Implement real browser search if needed

---

**Remember:** The extension runs in the same JavaScript context as SillyTavern, so you have direct access to all ST data structures. Use them instead of DOM scraping whenever possible!
