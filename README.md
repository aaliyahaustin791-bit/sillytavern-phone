# Phone Extension for SillyTavern

A fully functional smartphone simulation for SillyTavern — with calls, texts, social media, and a web browser.

## Features

- **Phone** — Dialer with contacts, call history (incoming/outgoing/missed)
- **Messages** — Text messaging with conversation list and chat view. Auto-replies from contacts
- **Social** — Social media feed with like, retweet, and save posts functionality
- **Browser** — Web browser with tabs, URL bar, bookmarks, and Wikipedia integration
- **Per-Chat Data** — All phone data is stored per-chat and never bleeds between conversations

## Installation

1. Copy the `phone-extension` folder into your SillyTavern `third-party/extensions/` directory
2. Or in SillyTavern: Extensions → Manage Extensions → Install Extension → paste the repo URL
3. Reload SillyTavern
4. Click the "Phone" button in the toolbar to open the phone

## Data Isolation

Each chat's phone data is stored independently in SillyTavern's chat metadata. When you switch chats:
- Current phone state is saved
- The new chat's phone state is loaded
- Data never leaks between conversations

## License

MIT
