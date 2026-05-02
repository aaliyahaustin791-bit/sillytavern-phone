/**
 * TARGETED FIX for SillyTavern Phone Extension
 * 
 * Issues found in console logs:
 * 1. Context scanning runs before chat is loaded (retries 5 times then gives up)
 * 2. getKnownCharacterNames returns only current character, not all characters
 * 3. Current character name detection fails (returns null from DOM)
 * 4. The extension loads from localStorage fallback, not chat metadata
 * 
 * This patch fixes these specific issues:
 */

// ============================================================
// FIX 1: Delay context scanning until chat is fully loaded
// ============================================================

// Store original scan function
var original_scanChatForContacts = scanChatForContacts;

// Replace with delayed version that waits for chat
scanChatForContacts = function() {
    // Check if chat is actually loaded
    var chatLoaded = false;
    
    // Method 1: Check if chat array exists and has messages
    if (typeof chat !== 'undefined' && Array.isArray(chat) && chat.length > 0) {
        chatLoaded = true;
    }
    
    // Method 2: Check if chat_metadata exists
    if (!chatLoaded && typeof chat_metadata !== 'undefined' && chat_metadata && chat_metadata.chat) {
        if (Array.isArray(chat_metadata.chat) && chat_metadata.chat.length > 0) {
            chatLoaded = true;
        }
    }
    
    // Method 3: Check if DOM has messages
    if (!chatLoaded) {
        var msgCount = document.querySelectorAll('#chat .mes').length;
        if (msgCount > 0) {
            chatLoaded = true;
        }
    }
    
    if (!chatLoaded) {
        console.log('[Phone Extension - Fix] Chat not loaded yet, waiting...');
        // Wait 2 seconds and try again (max 10 retries = 20 seconds)
        if (!window._phone_scan_retries) window._phone_scan_retries = 0;
        window._phone_scan_retries++;
        
        if (window._phone_scan_retries < 10) {
            setTimeout(scanChatForContacts, 2000);
        } else {
            console.log('[Phone Extension - Fix] Chat still not loaded after 20 seconds, scanning anyway');
            window._phone_scan_retries = 0;
            original_scanChatForContacts();
        }
        return;
    }
    
    // Reset retry counter
    window._phone_scan_retries = 0;
    
    console.log('[Phone Extension - Fix] Chat loaded, proceeding with contact scan');
    
    // Now call the original function
    original_scanChatForContacts();
};

// ============================================================
// FIX 2: Better character name detection
// ============================================================

// Store original getKnownCharacterNames
var original_getKnownCharacterNames = getKnownCharacterNames;

// Replace with enhanced version
getKnownCharacterNames = function() {
    var names = new Set();
    
    // Try to get ALL characters from the characters object
    if (typeof characters !== 'undefined') {
        for (var id in characters) {
            if (characters[id] && characters[id].name) {
                names.add(characters[id].name);
            }
        }
    }
    
    // Also try SillyTavern.getContext()
    if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
        try {
            var context = SillyTavern.getContext();
            if (context && context.characters) {
                for (var id2 in context.characters) {
                    if (context.characters[id2] && context.characters[id2].name) {
                        names.add(context.characters[id2].name);
                    }
                }
            }
        } catch(e) {}
    }
    
    // If still no names, fall back to original method
    if (!names.size) {
        var originalNames = original_getKnownCharacterNames();
        if (originalNames && originalNames.length) {
            for (var i = 0; i < originalNames.length; i++) {
                names.add(originalNames[i]);
            }
        }
    }
    
    console.log('[Phone Extension - Fix] getKnownCharacterNames found ' + names.size + ' characters:', Array.from(names));
    return Array.from(names);
};

// ============================================================
// FIX 3: Better current character detection
// ============================================================

// Enhance the part that gets current character name
// This patches the scanChatForContacts function at the point where it gets current character
var original_addOrUpdateContact = addOrUpdateContact;

// We'll also patch the part that detects current character
// Find where it tries to get currentCharName and make it more robust

// Monkey-patch by wrapping the scan function again
var original_scan2 = scanChatForContacts;
scanChatForContacts = function() {
    // First, ensure we have the current character
    var currentCharName = null;
    
    // Method 1: Try name2 (most reliable)
    if (typeof name2 !== 'undefined' && name2) {
        currentCharName = name2;
        console.log('[Phone Extension - Fix] Current character via name2:', currentCharName);
    }
    
    // Method 2: Try characters[this_chid]
    if (!currentCharName && typeof characters !== 'undefined' && typeof this_chid !== 'undefined') {
        if (characters[this_chid] && characters[this_chid].name) {
            currentCharName = characters[this_chid].name;
            console.log('[Phone Extension - Fix] Current character via characters[this_chid]:', currentCharName);
        }
    }
    
    // Method 3: Try SillyTavern context
    if (!currentCharName && typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
        try {
            var ctx = SillyTavern.getContext();
            if (ctx && ctx.characterId && ctx.characters && ctx.characters[ctx.characterId]) {
                currentCharName = ctx.characters[ctx.characterId].name;
                console.log('[Phone Extension - Fix] Current character via SillyTavern.getContext():', currentCharName);
            }
        } catch(e) {}
    }
    
    // Method 4: Try DOM (least reliable)
    if (!currentCharName) {
        var selectors = [
            '#character_name_animation',
            '#character_name',
            '.char-name-element',
            '.character_name',
            '#rightNavHolder .character_name',
            '.mes:last-child .mes_name'  // Last message's character name
        ];
        
        for (var s = 0; s < selectors.length; s++) {
            var el = document.querySelector(selectors[s]);
            if (el && el.textContent.trim()) {
                currentCharName = el.textContent.trim();
                console.log('[Phone Extension - Fix] Current character via DOM (' + selectors[s] + '):', currentCharName);
                break;
            }
        }
    }
    
    // If we found a character, ensure they're added as a contact BEFORE scanning
    if (currentCharName) {
        var knownNames = getKnownCharacterNames();
        if (knownNames.includes(currentCharName)) {
            var added = original_addOrUpdateContact(currentCharName, true);
            console.log('[Phone Extension - Fix] Added current character contact:', currentCharName, 'new:', added);
        }
    }
    
    // Now call the original scan function
    original_scan2();
};

// ============================================================
// FIX 4: Hook into CHAT_CHANGED event to rescan when chat loads
// ============================================================

if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
    // Add a delayed scanner for when chat fully loads
    eventSource.on(event_types.CHAT_CHANGED, function() {
        console.log('[Phone Extension - Fix] CHAT_CHANGED event detected, will scan in 3 seconds');
        setTimeout(function() {
            console.log('[Phone Extension - Fix] Running delayed contact scan after CHAT_CHANGED');
            scanChatForContacts();
        }, 3000);
    });
}

// ============================================================
// FIX 5: Add manual trigger button for testing
// ============================================================

// Add a console command for manual testing
window.testPhoneContacts = function() {
    console.log('[Phone Extension - Test] Manual contact scan triggered');
    console.log('[Phone Extension - Test] Chat loaded?', typeof chat !== 'undefined' && Array.isArray(chat) && chat.length > 0);
    console.log('[Phone Extension - Test] Characters available?', typeof characters !== 'undefined');
    console.log('[Phone Extension - Test] name2?', typeof name2 !== 'undefined' ? name2 : 'undefined');
    console.log('[Phone Extension - Test] this_chid?', typeof this_chid !== 'undefined' ? this_chid : 'undefined');
    
    scanChatForContacts();
};

console.log('[Phone Extension - Fix] Targeted fixes applied');
console.log('[Phone Extension - Fix] Run window.testPhoneContacts() to manually trigger contact scan');
