# Draft: Translation Display Toggle Feature

## Requirements (confirmed)
- Feature: "Show translated text only" toggle in chat
- When enabled: message bubbles show translated text instead of original `rawContent`
- When disabled (default): current behavior — original text in bubble, translation in separate card below
- User wants this as a per-chat or global setting (TBD)

## Research Findings

### Translation Feature Architecture
- **API**: TranslationService (`apps/api/src/modules/translation/translation.service.ts`) generates translations
- **Entity**: Message entity has `translations` (jsonb: {english, singlish, tanglish}), `detectedLanguage`, `translatedAudioUrls`, `confidenceScore`
- **Supported languages**: english, singlish, tanglish (Sri Lankan dialects)
- **API types**: `Translations`, `SupportedLanguage`, `DetectedLanguage`, `TranslatedAudioUrls` defined in translation.service.ts

### Message Rendering Pipeline
- **ChatScreen** → FlashList → MessageBubble → TranslationSection
- `ChatListContext` distributes `preferredLanguage` to all MessageBubbles
- `MessageBubble` TEXT path (lines 1115-1123): renders `rawContent` as bubble text
- `TranslationSection` (lines 787-969): renders as separate card BELOW bubble
- Own messages: TranslationSection returns null (line 857: `if (isOwn) return null`)
- IMAGE/DOCUMENT: TranslationSection returns null (no translation for media)
- Translation card has expand/collapse, confidence badge, audio buttons

### Settings/Preferences System
- **State management**: React Context API only (no Redux/Zustand)
- **Storage**: expo-secure-store (sensitive), AsyncStorage (non-sensitive app state)
- **Theme toggle**: Pressable + Ionicons icon in ChatsListScreen header (not Switch component)
- **No dedicated Settings screen** — settings are scattered (ProfileScreen for profile, ChatsListScreen header for theme)
- **Persistence keys**: `app_theme_preference` (ThemeContext), user profile keys in AuthContext
- **Language preference**: Per-chat via `LanguagePickerModal`, stored in ChatScreen local state (not persisted)

### Test Infrastructure
- No test framework configured (no jest/vitest/bun test config found)
- No test files in the mobile app
- No CI/CD test pipeline

## Technical Decisions
- [PENDING] Toggle scope: per-chat vs global
- [PENDING] Storage mechanism: AsyncStorage (local-only) vs SecureStore (user preference) vs server-synced
- [PENDING] UI placement: ChatScreen header, chat settings, or new Settings screen
- [PENDING] Toggle component: Pressable icon (like theme) vs Switch widget
- [PENDING] Own message behavior: show translated for own messages too, or keep current (no translation for own)

## Open Questions
1. Should this toggle be per-chat (like language picker) or global across all chats?
2. Where should the toggle UI live? (ChatScreen header next to language picker? ProfileScreen? New SettingsScreen?)
3. Should the setting persist across app restarts? (AsyncStorage vs just in-memory)
4. When "show translated text only" is on, should the original text be completely hidden, or accessible via tap/expand?
5. Should own messages also show translated text, or only other people's messages?
6. Do you want tests set up as part of this work, or no tests?

## Scope Boundaries
- INCLUDE: Toggle UI, state management, persistence, message rendering modification
- EXCLUDE: [TBD — depends on answers above]
