# Draft: Translated-Only Mode Feature

## Requirements (from user)
- **Core Feature**: Toggle in settings to show only translated text in message bubbles
- **Scope**: TEXT messages only (not images, videos, etc.)
- **Behavior**: Original message hidden, only translated text visible
- **Analogy**: Like WhatsApp but showing only translated text
- **Edge Cases**: Need to handle various scenarios carefully

## Key Requirements to Clarify
1. **Message Direction**: Is this for received messages, sent messages, or both?
   - Based on your description ("other person's text"), I assume **received messages only** - is that correct?

2. **Toggle Location**: Where should this toggle live?
   - Option A: In each chat's header (per-conversation setting like language picker)
   - Option B: In Profile screen (global setting for all chats)
   - Option C: Both (global default, can override per-chat)

3. **Fallback Behavior**: When translation is not available (e.g., translation fails, message in your native language):
   - Show original message text?
   - Show a "translation unavailable" placeholder?
   - Something else?

4. **Visual Distinction**: In the translated-only mode:
   - Should the bubble look the same as a normal message?
   - Or should it have some indicator it's a translation (e.g., small label, different bubble style)?

5. **Language Selection**: When translated-only mode is on:
   - Should it use the user's preferred language (from settings)?
   - Or should users be able to select which language to translate to?

6. **Edge Cases to Handle**:
   - What if no translation exists for the message?
   - What if the message is already in the user's native language?
   - Handle empty translations?

## Technical Considerations
- Where is settings state stored? (localStorage, backend, etc.)
- How is translation triggered and cached?
- Current message component structure
- State management approach

## Research in Progress
- Exploring codebase structure
- Finding settings implementation
- Finding message display components
- Finding translation logic

## Open Questions
- [To be populated as research completes]

## Technical Findings (from code exploration)

### Project Architecture:
- **Type**: React Native (Expo) + NestJS backend monorepo
- **State Management**: React Context API only (no Redux/Zustand)
- **Storage**: expo-secure-store for preferences

### Current Architecture:
- **Message Display**: `apps/mobile/src/components/chat/MessageBubble.tsx` - Main component for rendering messages
- **Translation Section**: Lines 804-969 - Shows translated text in a separate card below the message
- **Preferred Language**: Managed via `ChatListContext`, passed from `ChatScreen` route params
- **User Settings**: Profile screen at `apps/mobile/src/screens/ProfileScreen.tsx` - stores dialect preference
- **Storage**: Uses `secureStorage` for user preferences, synced with backend API
- **Settings Pattern**: Theme toggle uses Pressable with Ionicons icon in ChatsListScreen header

### Key Message Types:
- TEXT (line 54): `contentType: 'TEXT' | 'AUDIO' | 'IMAGE' | 'DOCUMENT'`
- Has `translations` object with `english`, `singlish`, `tanglish` fields
- Has `rawContent` - the original message text

### Current Behavior for TEXT:
- `rawContent` is displayed in the message bubble (lines 1116-1117)
- `TranslationSection` shows a separate card below with translated text
- Original message is ALWAYS visible in the bubble
- Own messages: TranslationSection returns null (line 857) - no translation shown

### Key Finding:
**This is a NEW feature** - no existing "show original" or "translated-only" toggle exists.

### Files to Modify:
1. `MessageBubble.tsx` - TEXT case rendering (lines 1111-1124)
2. New context or extend `ChatListContext` - for toggle state
3. `secureStorage.ts` - for persistence
4. UI placement: ChatsListScreen header OR ChatHeader OR ProfileScreen
