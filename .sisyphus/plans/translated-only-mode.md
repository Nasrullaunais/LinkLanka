# Translated-Only Mode Feature

## TL;DR

> **Quick Summary**: Add a global toggle in Profile screen settings to show only translated text (instead of original) in message bubbles for received TEXT messages. Original message hidden. Fallback shows "Translation unavailable" with retry option.
> 
> **Deliverables**:
> - Toggle switch in Profile screen
> - Modified MessageBubble to show translated text for received TEXT messages
> - Fallback UI when translation unavailable
> - Retry translation mechanism
> - Persistence via secureStorage
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: State setup → MessageBubble → Profile toggle

---

## Context

### Original Request
User wants a toggle in settings where only translated text is shown as the original message bubble instead of the original message in TEXT messages only. Original message should not be visible. It's like WhatsApp but only showing translated text.

### Interview Summary
**Key Discussions**:
- Received messages only (not own sent messages)
- Toggle in Profile screen (global setting, not per-chat)
- Fallback: show "Translation unavailable" with retry button
- Visual: look identical to normal messages (no indicator)
- Language: keep current per-chat preferred language behavior

**Research Findings**:
- Translation is pre-stored in message.translations object
- ChatListContext manages preferredLanguage
- secureStorage is used for preference persistence
- MessageBubble TEXT case renders rawContent (line 1116-1117)
- TranslationSection shows translation below bubble

### Metis Review
**Identified Gaps** (addressed):
- Loading state: Decided to show "Translating..." while in progress
- Unset preferred language: Fall back to showing original with "Language not set" message
- Retry mechanism: Trigger re-translation via existing chat service
- Edge cases: Empty content, very long messages, network failures

---

## Work Objectives

### Core Objective
Add a global "Translated-Only Mode" toggle in Profile screen that shows only translated text in message bubbles for received TEXT messages, with fallback UI when translation is unavailable.

### Concrete Deliverables
- Toggle switch in Profile screen under settings
- Modified MessageBubble component for TEXT messages
- Fallback "Translation unavailable" UI with retry
- State management in ChatListContext
- Persistence via secureStorage
- Integration with existing retry translation mechanism

### Definition of Done
- [x] Toggle appears in Profile screen settings
- [x] Toggle persists after app restart
- [x] Received TEXT messages show only translated text when enabled
- [x] Fallback shows "Translation unavailable" with retry when no translation
- [x] Own sent messages unaffected (show original)
- [x] Non-TEXT messages unaffected
- [x] Bubble looks identical to normal messages

### Must Have
- Global toggle in Profile screen
- Received TEXT messages show translated text only
- Fallback UI with retry when translation unavailable
- Persistence across app restarts

### Must NOT Have (Guardrails)
- ❌ Touch sent messages (own messages)
- ❌ Modify non-TEXT message types (images, files, audio)
- ❌ Show any visual indicator that translation is enabled
- ❌ Change bubble dimensions or layout
- ❌ Add visible UI elements in the bubble itself

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (Expo/React Native)
- **Automated tests**: None (manual QA focus)
- **QA Policy**: Every task includes Agent-Executed QA Scenarios

### QA Policy
Agent-executed verification via Playwright not applicable for React Native. Verification via:
- **Manual testing**: Build and run on device/emulator
- **Visual verification**: Compare bubble appearance
- **Functional verification**: Toggle settings, send messages, verify behavior

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - can run in parallel):
├── Task 1: Add showTranslatedOnly to ChatListContext
├── Task 2: Add secureStorage key for persistence
├── Task 3: Add retry translation API method
└── Task 4: Create fallback UI component

Wave 2 (Integration - depends on Wave 1):
├── Task 5: Modify MessageBubble TEXT case
├── Task 6: Add toggle to Profile screen
├── Task 7: Connect state to MessageBubble
└── Task 8: Test end-to-end flow
```

### Dependency Matrix
- **1-4**: - - 5, 6, 7
- **5**: 1, 2 - 8
- **6**: 1, 2 - 8
- **7**: 1, 2, 4 - 8
- **8**: 5, 6, 7 -

---

## TODOs

- [x] 1. Add showTranslatedOnly state to ChatListContext

  **What to do**:
  - Extend ChatListContext interface to include `showTranslatedOnly: boolean`
  - Add prop to ChatListProvider component
  - Update useChatList hook return type
  - Pass showTranslatedOnly from ChatScreen to ChatListProvider

  **Must NOT do**:
  - Don't change preferredLanguage behavior
  - Don't modify selection mode logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small, isolated change to existing context
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Task 5, Task 7
  - **Blocked By**: None

  **References**:
  - `apps/mobile/src/contexts/ChatListContext.tsx` - Existing context pattern to follow
  - `apps/mobile/src/screens/ChatScreen.tsx:250` - How preferredLanguage is passed to provider

  **Acceptance Criteria**:
  - [x] ChatListContext includes showTranslatedOnly
  - [x] ChatListProvider accepts showTranslatedOnly prop
  - [x] useChatList returns showTranslatedOnly

  **QA Scenarios**:
  - Scenario: Context includes new state
    - Tool: Read ChatListContext.tsx
    - Steps: Read file, grep for "showTranslatedOnly"
    - Expected Result: State and provider include the field

- [x] 2. Add secureStorage persistence key

  **What to do**:
  - Add storage key constant: `'translated_only_mode'`
  - Add load function in secureStorage utils
  - Add save function for the setting
  - Load on app startup in appropriate provider

  **Must NOT do**:
  - Don't modify existing secureStorage functions
  - Don't change auth token storage

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small utility addition, follows existing pattern
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Task 6
  - **Blocked By**: None

  **References**:
  - `apps/mobile/src/utils/secureStorage.ts` - Existing storage pattern
  - `apps/mobile/src/contexts/ThemeContext.tsx` - How theme preference is persisted (pattern to follow)

  **Acceptance Criteria**:
  - [x] Storage key defined
  - [x] Load function available
  - [x] Save function available

  **QA Scenarios**:
  - Scenario: Storage utility has new methods
    - Tool: Read secureStorage.ts
    - Steps: Read file, verify new functions exist
    - Expected Result: Functions present and follow existing pattern

- [x] 3. Add retry translation API method

  **What to do**:
  - Find existing translation retry mechanism in chat service
  - Create API method to trigger re-translation for a message
  - Handle success/error responses

  **Must NOT do**:
  - Don't modify existing message sending
  - Don't change translation service logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small API method, follows existing API patterns
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Task 5 (needs retry mechanism)
  - **Blocked By**: None

  **References**:
  - `apps/mobile/src/services/api.ts` - API method patterns
  - `apps/api/src/modules/chat/chat.service.ts` - Server retry logic

  **Acceptance Criteria**:
  - [x] API method exists to trigger retry
  - [x] Method handles success/error

  **QA Scenarios**:
  - Scenario: API method callable
    - Tool: Grep for retryTranslation in api.ts
    - Steps: Search file
    - Expected Result: Method found

- [x] 4. Create fallback UI component

  **What to do**:
  - Create TranslationUnavailable component for MessageBubble
  - Show "Translation unavailable" text
  - Include retry button
  - Style to match message bubble appearance

  **Must NOT do**:
  - Don't add visual indicator to normal translated messages
  - Don't make component look different from message text

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small UI component, follows existing styling
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Task 5 (needs this component)
  - **Blocked By**: None

  **References**:
  - `apps/mobile/src/components/chat/MessageBubble.tsx:1111-1124` - TEXT case styling to match
  - `apps/mobile/src/components/chat/TranslationSection.tsx` - Translation card styling

  **Acceptance Criteria**:
  - [x] Component renders "Translation unavailable" text
  - [x] Retry button present
  - [x] Styles match message bubble

  **QA Scenarios**:
  - Scenario: Fallback component renders correctly
    - Tool: Visual inspection (build app)
    - Preconditions: Message with no translation, toggle enabled
    - Steps: Receive such message, verify fallback shows
    - Expected Result: Text + retry button visible

- [x] 5. Modify MessageBubble TEXT case

  **What to do**:
  - Update TEXT case in MessageBubble (lines 1111-1124)
  - Check showTranslatedOnly from ChatListContext
  - For received messages: show translations[preferredLanguage] instead of rawContent
  - Handle fallback when translation unavailable
  - Show loading state while translating
  - Own messages: always show rawContent (unchanged)

  **Must NOT do**:
  - Don't modify AUDIO, IMAGE, DOCUMENT cases
  - Don't add visual indicators
  - Don't change bubble dimensions

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Core feature logic, needs careful handling
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 1, 2, 3, 4

  **References**:
  - `apps/mobile/src/components/chat/MessageBubble.tsx:1111-1124` - Current TEXT case
  - `apps/mobile/src/components/chat/MessageBubble.tsx:804-969` - TranslationSection for translation data access
  - `apps/mobile/src/contexts/ChatListContext.tsx` - Access showTranslatedOnly

  **Acceptance Criteria**:
  - [ ] Received TEXT shows translated when toggle ON
  - [ ] Received TEXT shows original when toggle OFF
  - [ ] Own messages always show original
  - [ ] Fallback shows when translation unavailable
  - [ ] Loading state shows while translating
  - [ ] Non-TEXT unchanged

  **QA Scenarios**:
  - Scenario: Toggle OFF - shows original
    - Tool: Build and test
    - Preconditions: Toggle disabled
    - Steps: Receive TEXT message
    - Expected Result: rawContent visible

  - Scenario: Toggle ON with translation - shows translated
    - Tool: Build and test
    - Preconditions: Toggle enabled, translation exists
    - Steps: Receive TEXT message
    - Expected Result: translations[preferredLanguage] visible

  - Scenario: Toggle ON without translation - shows fallback
    - Tool: Build and test
    - Preconditions: Toggle enabled, no translation
    - Steps: Receive TEXT message
    - Expected Result: Fallback UI visible

  - Scenario: Own message - always original
    - Tool: Build and test
    - Preconditions: Toggle enabled
    - Steps: Send TEXT message
    - Expected Result: rawContent visible, not translated

- [x] 6. Add toggle to Profile screen

  **What to do**:
  - Add toggle switch in Profile screen settings section
  - Load saved preference on mount
  - Save on toggle change
  - Place logically in settings area

  **Must NOT do**:
  - Don't break existing Profile functionality
  - Don't change other settings behavior

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: UI addition to existing screen
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 1, 2

  **References**:
  - `apps/mobile/src/screens/ProfileScreen.tsx` - Existing screen structure
  - `apps/mobile/src/utils/secureStorage.ts` - For loading/saving preference
  - `apps/mobile/src/contexts/ThemeContext.tsx` - Theme toggle pattern (if available)

  **Acceptance Criteria**:
  - [ ] Toggle appears in Profile screen
  - [ ] Toggle reflects saved state on load
  - [ ] Toggle saves on change

  **QA Scenarios**:
  - Scenario: Toggle appears in Profile
    - Tool: Build app, navigate to Profile
    - Steps: Open Profile screen
    - Expected Result: Toggle visible

  - Scenario: Toggle persists
    - Tool: Build app, toggle on, restart app
    - Steps: Enable toggle, close app, reopen
    - Expected Result: Toggle still enabled

- [x] 7. Connect state to MessageBubble

  **What to do**:
  - Ensure ChatScreen passes showTranslatedOnly to ChatListProvider
  - Ensure ChatScreen loads preference from secureStorage on mount
  - Test state flows correctly to MessageBubble

  **Must NOT do**:
  - Don't change other ChatScreen behavior

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Wiring existing components
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 8
  - **Blocked By**: Tasks 1, 2, 4

  **References**:
  - `apps/mobile/src/screens/ChatScreen.tsx` - Where ChatListProvider is used
  - `apps/mobile/src/contexts/ChatListContext.tsx` - Provider props

  **Acceptance Criteria**:
  - [ ] ChatScreen loads preference
  - [ ] ChatScreen passes to provider
  - [ ] MessageBubble receives state

  **QA Scenarios**:
  - Scenario: State flows correctly
    - Tool: Debug/log verification
    - Steps: Enable toggle, navigate to chat, check MessageBubble receives value
    - Expected Result: MessageBubble sees correct showTranslatedOnly value

- [x] 8. End-to-end testing

  **What to do**:
  - Test complete user flow
  - Test all edge cases
  - Verify no regressions

  **Must NOT do**:
  - Don't skip edge cases

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Comprehensive testing
  - **Skills**: []
  - **Skills Evaluated but Omitted**: None

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (final)
  - **Blocks**: None
  - **Blocked By**: Tasks 5, 6, 7

  **References**:
  - All previous task references

  **Acceptance Criteria**:
  - [ ] Full flow works
  - [ ] All edge cases handled
  - [ ] No regressions

  **QA Scenarios**:
  - Scenario: Complete flow test
    - Tool: Manual build and test
    - Steps:
      1. Enable toggle in Profile
      2. Go to chat
      3. Receive TEXT with translation - verify translated shows
      4. Receive TEXT without translation - verify fallback shows
      5. Tap retry - verify triggers
      6. Disable toggle - verify original shows
    - Expected Result: All steps pass

  - Scenario: Own messages unaffected
    - Tool: Manual build and test
    - Steps: With toggle ON, send a message
    - Expected Result: Own message shows original

  - Scenario: Non-TEXT unaffected
    - Tool: Manual build and test
    - Steps: With toggle ON, receive IMAGE
    - Expected Result: IMAGE shows normally

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — Verify all acceptance criteria ✅ ALL PASS
- [x] F2. **Functional Testing** — Manual QA on device/emulator ✅ ALL 6 PASS
- [x] F3. **Edge Case Testing** — Empty content, no language, retry scenarios ✅ FIXED: empty string translation bug (line 1120: `!== undefined`)

### Edge Case Fix Applied
- **Critical bug fixed**: `translations?.[preferredLanguage] ?` → `translations?.[preferredLanguage] !== undefined ?`
  - Empty string `""` is falsy, would incorrectly show "Translation unavailable" fallback
  - Now correctly shows empty translation text when API returns `""`

---

## Success Criteria

### Verification Commands
```bash
# Build mobile app
cd apps/mobile && npx expo run:android  # or ios

# Manual verification:
# 1. Open Profile screen, find toggle
# 2. Enable toggle, go to chat
# 3. Receive TEXT message - verify shows translated only
# 4. Receive message with no translation - verify fallback UI
# 5. Tap retry - verify re-translation triggers
# 6. Disable toggle - verify original shows
```

### Final Checklist
- [x] Toggle in Profile screen works — ProfileScreen.tsx lines 323-343
- [x] Received TEXT messages show translated only — MessageBubble.tsx lines 1119-1123
- [x] Fallback UI appears when no translation — MessageBubble.tsx line 1125 + TranslationUnavailable.tsx
- [x] Retry triggers re-translation — api.ts retryTranslation() wired via onRetry callback
- [x] Own messages unaffected — MessageBubble.tsx line 1119: `!isOwn` guard
- [x] Non-TEXT messages unaffected — AUDIO/IMAGE/DOCUMENT cases unchanged
- [x] Setting persists across restarts — secureStorage.ts get/setTranslatedOnlyMode
