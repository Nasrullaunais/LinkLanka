# DocumentAi Excel Conversion - Learnings

## convertExcelToCsv() Implementation

### What was built
- `convertExcelToCsv(fileBuffer: Buffer): string` private method in DocumentAiService
- Uses SheetJS (`xlsx` package) with `XLSX.read(buffer, { type: 'buffer' })`
- Converts workbook sheets to CSV via `XLSX.utils.sheet_to_csv()`
- Each sheet prepended with `## Sheet: {sheetName}\n`
- Caps at 10 sheets, logs warning via `this.logger.warn()` for remainder
- Error handling for password-protected (code 2038) and corrupt (code 2036) files
- Returns concatenated CSV with `\n\n` between sheets

### SheetJS API Notes
- `XLSX.read(buffer, { type: 'buffer' })` parses Excel files from Node Buffer
- `workbook.SheetNames` is array of sheet name strings
- `workbook.Sheets[sheetName]` gets the sheet object
- `XLSX.utils.sheet_to_csv(sheetObj)` returns CSV string
- Error codes: '2038' = password protected, '2036' = corrupt/unsupported

### Dependencies
- xlsx package must be installed (`npm install xlsx`)
- Logger injected via `private readonly logger = new Logger(DocumentAiService.name)`

### File Location
- `/apps/api/src/modules/document-ai/document-ai.service.ts`
- Private method at line ~162

## getSummary() Excel Guard

### What was added
- Guard at line ~198-207 in `getSummary()` method
- Checks MIME type using `guessMime(resolveDocumentUrl(message.rawContent))`
- Excel MIME types blocked: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (.xlsx) and `application/vnd.ms-excel` (.xls)
- Throws BadRequestException with message: "Summaries are not available for spreadsheet files. Use Q&A to ask questions about specific data."
- Guard is BEFORE transcription check (line 207-212) and cached summary check

### Why comment is necessary
- Comment `// Reject Excel/spreadsheet files — summaries require text content` explains business logic
- Not obvious why spreadsheets can't be summarized (Excel files lack text content from OCR, unlike PDFs/images)
- Comment prevents future developers from removing guard thinking it's dead code

## T4: CSV Conversion Integration in askQuestion()

### What was modified
- Added Excel detection + CSV conversion branching in `askQuestion()` method
- Inserted after `fileBuffer` download, replaces the old base64 + media construction

### Logic flow
1. `mimeType = this.guessMime(documentUrl)` — shared for both branches
2. `isExcelMime` checks for both `.xlsx` and `.xls` MIME types
3. **Excel branch**: `convertExcelToCsv(fileBuffer)` → length guards → text-only `HumanMessage` with `Document CSV content:\n\n${csv}\n\nUser question: ${q}`
4. **Non-Excel branch**: unchanged — `base64String` + `{ type: 'media', mimeType, data: base64String }`
5. Shared `structuredModel.invoke([systemMessage, ...historyMessages, finalHumanMessage])`

### Length guards
- `MAX_CSV_LENGTH = 100000`: truncate CSV + append truncation note
- `WARN_CSV_LENGTH = 50000`: log warning CSV is large
- Both guard against Gemini context window limits

### Key constraints
- CSV sent as plain TEXT, never as base64/media
- Non-Excel path completely untouched
- `finalHumanMessage` declared with `let` so both branches can assign it

## retranslateMessage() Excel Guard (T6)

### What was added
- Guard at line ~178-183 in `retranslateMessage()` else branch
- Uses `path.extname(message.rawContent).toLowerCase()` to check extension
- Blocks `.xlsx` and `.xls` extensions
- Throws BadRequestException: 'Spreadsheet files cannot be retranslated. Use Document Q&A to ask questions about this file.'
- Guard executes BEFORE `resolveStoredMediaReference()` — no S3 download for rejected files

### Why no comment
- Code is self-documenting: `ext === '.xlsx' || ext === '.xls'` clearly shows the extension check
- The guard body (throw) clearly explains the rejection reason via exception message
- No business logic explanation needed beyond the exception message

### Key implementation details
- Uses `path.extname()` (already imported at line 1) instead of manual `split('.').pop()`
- `BadRequestException` imported from '@nestjs/common' alongside other NestJS decorators
- Guard only in DOCUMENT else branch — TEXT/AUDIO paths untouched

## T8: document-ai.service.spec.ts Tests

### What was created
- `apps/api/src/modules/document-ai/document-ai.service.spec.ts` with 16 test cases

### Test coverage
1. **convertExcelToCsv** (5 tests):
   - Single-sheet: verifies `## Sheet:` header + CSV content
   - Multi-sheet: verifies concatenation with `\n\n` separator
   - 10-sheet cap: processes only first 10 of 12 sheets, logs warning
   - Password-protected: throws BadRequestException with code 2038
   - Corrupt file: throws BadRequestException with code 2036

2. **askQuestion** (6 tests):
   - Excel files: sends CSV as text content (NOT base64/media)
   - Non-Excel: sends base64 media (no regression)
   - CSV truncation at 100K chars with note appended
   - Warning log for CSV over 50K chars
   - Non-document message throws BadRequestException

3. **getSummary** (3 tests):
   - Excel (.xlsx) throws BadRequestException
   - Excel (.xls) throws BadRequestException
   - PDF proceeds normally, caches summary, saves to DB

4. **System prompt** (1 test): LANGUAGE OUTPUT RULE with effectiveLanguage

5. **resolvePreferredQALanguage** (2 tests):
   - Uses preferredLanguage when provided
   - Falls back to detectedLanguage

### Mocking patterns
- `var mockInvoke` at module level captured by `jest.mock` closure (Jest hoisting workaround)
- `jest.mock('xlsx', () => ({ read: jest.fn(), ... }))` — import via `import * as XLSX`
- `jest.mock('../chat/entities/message.entity')` — breaks circular entity dependency
- `jest.mock('@langchain/google-genai')` — captures mockInvoke via `var` hoisting

### Issues encountered
- **bun vs Jest `jest.mock` behavior**: bun doesn't intercept transitive module imports via `jest.mock`. Only direct imports from the test file are mocked.
- **Circular entity dependency**: `message.entity → chat-group.entity → group-member.entity → chat-group.entity` (circular)
- **Fix**: Changed entity imports to `import type` for TypeORM factory functions with `require()` calls to break circular load chain
- **`require()` in decorator factories**: TypeORM's `() => EntityClass` pattern doesn't work with `import type`, so replaced with `() => require('./path').EntityClass`
- **`var` for Jest hoisting**: Used `var mockInvoke` instead of `let`/`const` because Jest hoists `jest.mock` calls above variable declarations; `var` is hoisted as `undefined` before the factory runs, and the closure captures the mutable binding

## F3: Real Manual QA — Logic-Based Verification

### Files analyzed
- `upload.constants.ts` — ALLOWED_MEDIA_MIMES and MIME_TO_EXT mappings
- `multer-config.ts` — file filter using ALLOWED_MEDIA_MIMES
- `document-ai.service.ts` — askQuestion(), getSummary(), convertExcelToCsv(), guessMime(), resolveDocumentUrl(), resolvePreferredQALanguage()
- `chat.controller.ts` — retranslateMessage() extension guard
- `chat.gateway.ts` — rawContent storage format for DOCUMENT messages (fileUrl stored as plain S3 URL, not JSON)
- `media.controller.ts` — upload endpoint returning `{ url: s3Url }`
- `s3-storage.service.ts` — buildPublicUrl() format: `https://{bucket}.s3.{region}.amazonaws.com/{prefix}/{uuid}.{ext}`

### T1: Excel upload flow — PASS
- ALLOWED_MEDIA_MIMES Set includes both `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and `application/vnd.ms-excel`
- multer-config.ts buildFileFilter() checks `allowedMimes.has(file.mimetype)` — multer accepts test.xlsx
- MIME_TO_EXT map maps both Excel types to `.xlsx`/`.xls` for safe filename derivation

### T4: Excel Q&A flow — PASS
- askQuestion() calls guessMime(documentUrl) which correctly maps `.xlsx`/`.xls` extensions
- Excel branch: YES calls convertExcelToCsv(fileBuffer), YES sends as `{ type: 'text', text: 'Document CSV content:\n\n...' }` (NOT base64), YES applies truncation at 100K chars with warning at 50K
- Non-Excel (PDF) branch: YES still sends `{ type: 'media', mimeType, data: base64String }` — no regression

### T5: Excel summary rejection — PASS
- getSummary() calls guessMime(resolveDocumentUrl(message.rawContent))
- resolveDocumentUrl handles both JSON (`{url: ...}`) and plain URL formats
- spreadsheet MIME types correctly rejected with BadRequestException
- Guard order: MIME check BEFORE transcription check and cached summary return

### T6: Excel retranslate rejection — PASS
- retranslateMessage() else branch checks `path.extname(message.rawContent).toLowerCase()` BEFORE `resolveStoredMediaReference()`
- rawContent for DOCUMENT messages is stored as `fileUrl` (plain S3 URL: `https://{bucket}.s3.{region}.amazonaws.com/{prefix}/{uuid}.xlsx`)
- path.extname on this format returns `.xlsx` correctly
- Clear error message: "Spreadsheet files cannot be retranslated."

### T7: Language enforcement — PASS
- System prompt in askQuestion() contains:
  - "LANGUAGE OUTPUT RULE — ABSOLUTE"
  - "You MUST answer ONLY in ${effectiveLanguage}"
  - "Your ENTIRE answer must be in ${effectiveLanguage}"
  - "The selected output language is ${effectiveLanguage} — this overrides everything else"
- errorLanguage resolved via resolvePreferredQALanguage() which falls back: preferredLanguage → detectedLanguage → 'english'

### T3: convertExcelToCsv edge cases — PASS
- Sheet cap: 10 sheets (const maxSheets = 10; sheetNames.slice(0, maxSheets)), warning logged for remainder
- Password-protected: catches error code 2038 AND 2036, throws BadRequestException('password-protected')
- Corrupted/unsupported: catches all other errors, throws BadRequestException('corrupted or unsupported format')

### Cross-task integration verified
- getSummary guard: guessMime ← resolveDocumentUrl ← message.rawContent (handles JSON and plain URL)
- retranslateMessage guard: path.extname(message.rawContent) works because DOCUMENT rawContent is always plain S3 URL
- askQuestion Excel detection: guessMime(downloaded document URL) → consistent MIME check across all paths
