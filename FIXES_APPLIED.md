# Fixes Applied to SillyTavern-phpne

## Date: 2026-05-01

### Issues Fixed

#### 1. API Settings Not Persisting ✅
**Problem:** API settings (URL, key, model, provider) were being saved to `localStorage` fallback but never loaded from it, causing settings to reset on page reload.

**Fix:** Modified `loadPhoneData()` to check localStorage fallback (`_phone_data_fallback`) when ST metadata isn't available. Now settings persist across sessions.

**Changes:**
- Added fallback loading logic in `loadPhoneData()`
- Merges fallback data with defaults and global settings
- Logs when fallback data is loaded for debugging

#### 2. Contacts Not Populating ✅
**Problem:** Contact scanning only worked when chat history contained character names. If starting a new chat or the character wasn't mentioned, no contacts were added.

**Fix:** Modified `scanChatForContacts()` to always add the current active character as a contact first, before scanning chat history.

**Changes:**
- Gets current character name from `name2` or DOM
- Calls `addOrUpdateContact()` with `isMainCharacter=true` immediately
- Simplified empty chat handling (no longer tries to re-add current character)

#### 3. Browser App
**Note:** The browser is a simulated in-universe browser. It doesn't actually fetch web pages — it shows a UI that simulates browsing. This is by design for the phone simulation experience.

### Remaining Issues (Not in Extension)

#### 1. `api_key_comfy_runpod` Warning
**Source:** SillyTavern core (`secrets.js:571`)
**Impact:** Harmless warning, occurs when Comfy RunPod API isn't enabled
**Action:** Can be ignored or suppressed in ST core if desired

#### 2. RPG Companion Crash
**Source:** Third-party extension (not part of ST core or phone extension)
**Error:** `TypeError: Cannot read properties of null (reading '0')` at `rerenderRpgState`
**Impact:** Breaking event handlers, affecting multiple features
**Action:** Update or disable the RPG Companion extension on your phone instance

### Testing Recommendations

1. **Test API persistence:**
   - Set API settings in phone Settings app
   - Reload the page
   - Verify settings are retained

2. **Test contact population:**
   - Open a chat with a character
   - Open the phone
   - Verify the current character appears in contacts
   - Send messages mentioning other characters
   - Verify they get added as contacts

3. **Check console:**
   - Look for `[Phone Extension] Loaded from localStorage fallback` on reload
   - Verify no new errors appear

### Git Commit
```
5f85a58 - fix: persist API settings via localStorage fallback and ensure current character is always added as contact
```
