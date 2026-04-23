# Translated-Only Mode - Learnings

## Session Start
- Started: 2026-04-23
- Plan: translated-only-mode

## Conventions
- Use secureStorage for user preferences (not AsyncStorage)
- State lives in ChatListContext for chat-related state
- MessageBubble is the main component for rendering messages
- TranslationSection shows translation BELOW the bubble

## Key Patterns
- Theme toggle: Pressable + Ionicons in ChatsListScreen header
- secureStorage pattern: setSecureItem(key, value), getSecureItem(key)
- Context pattern: createContext, useMemo, useContext

## Decisions
- showTranslatedOnly: boolean (default false)
- Persisted key: 'translated_only_mode'
- Fallback: "Translation unavailable" with retry button

## Task 3: Retry Translation API
- `retryTranslation(messageId: string)` added to api.ts at line 321
- Endpoint: POST `/chat/messages/${messageId}/retranslate`
- Returns: `TranslationResult`
- Note: `retranslateMessage` already existed - added `retryTranslation` as primary name per task spec
- Pattern: follows existing API patterns with apiClient.post

## TranslationUnavailable Component (Created)
- Path: apps/mobile/src/components/chat/TranslationUnavailable.tsx
- Props: onRetry: () => void
- Uses ThemeContext for colors (bubbleReceivedText for text, link for retry)
- Styled to match messageText: fontSize 15, lineHeight 21
- memo wrapped for performance
- Retry button uses Pressable + colors.link

## Implementation
- 2026-04-23: Added `showTranslatedOnly: boolean` to ChatListContextType interface
- Prop passed through ChatListProvider to useChatList hook
- Included in useMemo dependency array for proper memoization

## secureStorage Implementation
- 2026-04-23: Added getTranslatedOnlyMode() and setTranslatedOnlyMode() to secureStorage.ts
- Storage key constant: TRANSLATED_ONLY_MODE_KEY = 'translated_only_mode'
- getTranslatedOnlyMode returns Promise<boolean> (compares value === 'true')
- setTranslatedOnlyMode accepts boolean and converts to String for storage
- Follows same pattern as getSecureItem/setSecureItem

## Task 4: Profile Screen Toggle (2026-04-23)
- Added translated-only mode toggle to ProfileScreen.tsx
- State: `translatedOnlyMode` (boolean, default false) with setter `setTranslatedOnlyModeState`
- Load on mount via useEffect calling getTranslatedOnlyMode()
- Toggle UI: View with Ionicons language icon, label, and React Native Switch
- Save on change: async handler calls setTranslatedOnlyMode(value)
- Placement: After Native Dialect section, before My Dictionary link
- Switch styled with trackColor (false: border, true: primaryFaded) and white thumb
- No existing Switch import in file - added to React Native imports
- Section header comment matches existing file conventions

## Task 5: ChatScreen State Wiring
- 2026-04-23: Wired ChatScreen to load and pass showTranslatedOnly to ChatListProvider
- Added import: `import { getTranslatedOnlyMode } from '../services/secureStorage';`
- Added state: `const [showTranslatedOnly, setShowTranslatedOnly] = useState<boolean>(false);`
- Added useEffect to load on mount: `getTranslatedOnlyMode().then(setShowTranslatedOnly)`
- Passed `showTranslatedOnly` prop to ChatListProvider
- ChatListProvider already had showTranslatedOnly in interface (from Task 4)
- No provider interface changes needed — already defined
