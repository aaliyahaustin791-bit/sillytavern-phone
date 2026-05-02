# Installing Context Integration Fixes for SillyTavern Phone Extension

## Overview

This guide shows you how to fix the three major context issues in the SillyTavern Phone Extension:

1. **Contacts not scanning properly** - The extension fails to detect characters from chat
2. **NPC texts lack personality** - Messages don't reflect character cards or conversation history  
3. **Browser search is fake** - No real search integration

## Prerequisites

- SillyTavern installed and running
- Phone Extension already installed
- Basic text editing skills

## Step-by-Step Installation

### Option A: Quick Fix (Recommended for most users)

This adds the context integration functions to your existing extension with minimal changes.

1. **Backup your current extension**
   ```bash
   cp sillytavern-phone/phone-extension.js sillytavern-phone/phone-extension.js.backup
   ```

2. **Add the context functions**
   - Open `phone-extension.js` in a text editor
   - Find the line that says `// ============================================================`
   - After the state declarations (around line 50), paste the entire contents of `context-integration-patch.js`
   - Save the file

3. **Replace the old functions**
   - In the same file, find these functions and replace them with the new versions from the patch:
     - `getKnownCharacterNames()` → Replace with new version
     - `_getSafeChatTextBatch()` → Replace with new version  
     - `scanChatForContacts()` → Replace with new version
     - `generateNpcTextWithContext()` → Replace with new version
     - `generateNpcText()` → Replace with new version

4. **Reload SillyTavern**
   - Refresh your browser page
   - Open the phone extension
   - Check the browser console for `[Phone Extension] Context Integration Patch loaded`

### Option B: Full Replacement (Clean install)

Replace the entire phone-extension.js with a version that includes all fixes.

1. **Download the patched version**
   - The maintainer should create a new release (v0.2.1 or later) with these fixes included
   - Or manually combine the original file with the patch

2. **Replace the file**
   ```bash
   # In your SillyTavern extensions directory
   cp /path/to/patched/phone-extension.js sillytavern-phone/phone-extension.js
   ```

3. **Reload SillyTavern**

### Option C: Separate Patch File (Safest)

Load the patch as a separate script after the main extension.

1. **Create a loader script**
   - In your SillyTavern `third-party/extensions/` directory, create `phone-context-fix.js`
   - Paste the contents of `context-integration-patch.js` into it

2. **Modify your extension loader**
   - In SillyTavern's extension settings, add `phone-context-fix.js` as an additional script to load after `phone-extension.js`
   - Or manually add a `<script>` tag in your HTML (not recommended)

3. **Reload SillyTavern**

## Testing the Fixes

### Test 1: Contact Scanning

1. Open a chat with a character
2. Open the phone extension
3. Go to Settings → Click "Scan for Contacts"
4. Check console logs for:
   ```
   [Phone Extension] getAllCharacterNames found X characters
   [Phone Extension] scanChatForContacts: found X known characters
   ```
5. Verify contacts appear in the Phone app

**Expected:** Current character should always appear, plus any other characters mentioned in chat.

### Test 2: NPC Text Personality

1. Ensure API settings are configured (Settings → API section)
2. Wait for an auto-text or send a message to trigger a reply
3. Check console for:
   ```
   [Phone Extension] Generated rich context for CharacterName: { hasCharacterCard: true, ... }
   [Phone Extension] Rich context text via dedicated API
   ```
4. Read the received text - it should reflect the character's personality

**Expected:** Texts should feel in-character, referencing personality traits and recent conversation.

### Test 3: Chat History Context

1. Have a multi-message conversation in the main chat
2. Trigger an NPC text (mention their name or wait for auto-text)
3. Check console for:
   ```
   [Phone Extension] Got X messages via getChatMessagesSafe
   ```
4. The NPC's text should reference the recent conversation

**Expected:** NPC should acknowledge or respond to what was just discussed.

## Troubleshooting

### Contacts still not appearing

**Check console for errors:**
```javascript
// In browser console, run:
console.log(typeof characters);
console.log(typeof this_chid);
console.log(typeof name2);
```

If these are undefined, your SillyTavern version may have changed the API. Try:
```javascript
console.log(typeof SillyTavern);
console.log(typeof SillyTavern.getContext);
```

**Solution:** Update the `getContextData()` function to match your ST version.

### NPC texts still generic

**Verify API settings:**
1. Open phone Settings
2. Check that API URL, Key, and Model are set
3. Click "Test API Connection"

**Check context building:**
```javascript
// In console, run:
var contact = phoneData.contacts[0];
var ctx = buildLLMContext(contact, 'test', '');
console.log(ctx.system);
console.log(ctx.user);
```

If character card data is missing, check:
```javascript
console.log(getCharacterCard(contact.name));
```

### Errors in console

**`getContextData is not defined`**
- The patch wasn't loaded properly. Ensure it's included after state declarations.

**`getFullChatHistory is not a function`**
- Function name mismatch. Check you copied the entire patch.

**`Cannot read property 'characters' of undefined`**
- SillyTavern context not available. Try reloading the page.

## Advanced: Customizing Context

### Adjust how much chat history is used

Find `buildLLMContext()` and change:
```javascript
var chatHistory = getFullChatHistory(15);  // Change 15 to more/fewer messages
```

### Change character card fields used

In `buildLLMContext()`, modify which card fields are included:
```javascript
if (charCard.personality) cardParts.push('• Personality: ' + charCard.personality.substring(0, 300));
// Add or remove fields as needed
```

### Adjust text generation parameters

In `generateNpcTextWithContext()`, modify:
```javascript
var body = JSON.stringify({
    model: apiModel,
    messages: [...],
    max_tokens: 100,      // Change max length
    temperature: 0.8      // Change creativity (0-1)
});
```

## Uninstalling

To revert to the original extension:

1. Restore from backup:
   ```bash
   cp sillytavern-phone/phone-extension.js.backup sillytavern-phone/phone-extension.js
   ```

2. Reload SillyTavern

Or simply remove the patch functions you added.

## Reporting Issues

If you encounter problems:

1. Check the browser console for errors
2. Verify your SillyTavern version (these fixes target v1.10.0+)
3. Ensure no other extensions are conflicting
4. Report to: https://github.com/aaliyahaustin791-bit/sillytavern-phone/issues

## Credits

- Original extension by aaliyahaustin791-bit
- Context integration patch by [your name/assistant]
- Based on analysis of SillyTavern's internal APIs

## Additional Resources

- SillyTavern documentation: https://docs.sillytavern.app/
- Extension development guide: See SillyTavern's docs
- Community support: SillyTavern Discord
