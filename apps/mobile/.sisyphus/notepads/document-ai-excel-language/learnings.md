# document-ai-excel-language learnings

## Task: Add Excel extension support to guessMime()

**Completed**: 2026-04-25

### What was done
- Added `.xlsx` → `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Added `.xls` → `application/vnd.ms-excel`

### Pattern followed
```typescript
'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
```
Same pattern for xlsx with openxmlformats-oofficedocument.spreadsheetml.sheet.

### Location
`apps/api/src/modules/document-ai/document-ai.service.ts` lines 146-148

### Verification
Read back confirmed additions at correct location.

---

## Task: Strengthen system prompt for strict language enforcement

**Completed**: 2026-04-25

### What was done
- Replaced `"Always answer in ${effectiveLanguage}."` with strengthened language rule:
  ```
  LANGUAGE OUTPUT RULE — ABSOLUTE: You MUST answer ONLY in ${effectiveLanguage}. IGNORE the user's input language completely. Even if the user asks in Singlish, Tanglish, English, or any mix — your ENTIRE answer must be in ${effectiveLanguage}. Never switch languages mid-response. Never mix languages. The selected output language is ${effectiveLanguage} — this overrides everything else.
  ```

### Location
`apps/api/src/modules/document-ai/document-ai.service.ts` line 271 (inside `askQuestion()` SystemMessage)

### Verification
- Read back confirmed strengthened rule at correct location
- lsp_diagnostics: No errors
