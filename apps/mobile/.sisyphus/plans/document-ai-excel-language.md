# Document AI: Excel Support + Language Enforcement

## TL;DR

> **Quick Summary**: Add Excel (.xlsx/.xls) file support to Document Q&A via SheetJS CSV preprocessing, fix language switching bugs with stronger system prompts, and add explicit guardrails for spreadsheet edge cases (summary, retranslate, corrupt files).
>
> **Deliverables**:
> - Excel files uploadable via `/media/upload` and processable in Q&A
> - CSV conversion pipeline in `DocumentAiService.askQuestion()`
> - Strict language enforcement: output language always matches user selection
> - Guards: `getSummary()` rejects Excel clearly; corrupt/password-protected Excel returns descriptive 400
> - Tests for document-ai service
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: T1 → T2 → T4 → T8

---

## Context

### Original Request
User wants to:
1. Build a pipeline to support Excel files (.xlsx/.xls) in Document Q&A by preprocessing them into a Gemini-compatible format
2. Fix language switching bug: when user changes language mid-Q&A chat, model continues replying in old language
3. Enforce strict language: when user selects "singlish" but types in "tanglish", model must output in singlish

### Interview Summary
**Key Discussions**:
- Excel conversion: CSV only via SheetJS (`xlsx` package) — lightweight, zero system deps. **No** LibreOffice/PDF.
- Conversion timing: At Q&A time (lazy), not at upload. Saves storage.
- Language fix: Stronger system prompt only — no post-response re-detection. "Output ONLY in ${language} regardless of input."
- Test strategy: Tests after implementation, agent-executed QA (curl-based)
- Upload filter: Include multer/upload-constants updates for Excel MIME types

**Research Findings**:
- Gemini does NOT natively support .xlsx/.xls — sends raw bytes, loses structure
- Current `guessMime()` has no Excel entries; upload filter blocks Excel MIME types
- No file conversion layer exists in codebase; no OCR library (all via Gemini)
- `preferredLanguage` is per-request in Q&A DTO — correctly passed but prompt too weak
- `chat.controller.ts` retranslate MIME mapping defaults Excel to `image/jpeg` (silent bug)
- `getSummary()` requires `message.transcription` which Excel files won't have
- Package manager is Bun 1.3.11; tsconfig uses `module: "nodenext"`

### Metis Review
**Identified Gaps** (addressed):
- `getSummary()` on Excel: would fail with misleading "No text content" → Added T6 guard with descriptive 400
- Retranslate on Excel: would send as `image/jpeg` silently → Added T7 guard with explicit rejection
- Large Excel memory/context: Added 10-sheet cap, 50K warn / 100K truncate on CSV
- Password-protected/corrupt Excel: Added try/catch with descriptive errors
- Module import style: Verified `import * as XLSX from 'xlsx'` for `nodenext` compatibility

---

## Work Objectives

### Core Objective
Add Excel file processing support to Document Q&A, fix language enforcement in the system prompt, and add defensive guards for spreadsheet edge cases — all with tests and agent-executable QA.

### Concrete Deliverables
- [ ] `upload.constants.ts` updated with Excel MIME types (`.xlsx`, `.xls`)
- [ ] `document-ai.service.ts` `guessMime()` updated with Excel extensions
- [ ] `document-ai.service.ts` `askQuestion()` integrated with SheetJS Excel→CSV conversion
- [ ] `document-ai.service.ts` `getSummary()` guarded against Excel files (400 with clear message)
- [ ] `document-ai.service.ts` system prompt strengthened for strict language enforcement
- [ ] `chat.controller.ts` retranslate path guarded against Excel files (400)
- [ ] `package.json` updated with `xlsx` dependency
- [ ] `document-ai.service.spec.ts` test file with Excel-specific and language-enforcement tests

### Definition of Done
- [x] `bun test` passes all document-ai tests
- [x] `POST /media/upload` accepts `.xlsx` files (201)
- [x] `POST /document-ai/:id/qa` with Excel returns 200 with valid answer
- [x] `GET /document-ai/:id/summary` on Excel returns 400 with "spreadsheet" message
- [x] Language enforcement: singlish output regardless of tanglish input
- [x] All QA scenarios execute and pass

### Must Have
- SheetJS `xlsx` package installed
- Excel→CSV conversion in `DocumentAiService.askQuestion()`
- Upload filter accepts Excel MIME types
- `getSummary()` rejects Excel with descriptive 400
- Retranslate rejects Excel with descriptive 400
- System prompt enforces strict language output

### Must NOT Have (Guardrails)
- No LibreOffice, no PDF conversion, no image rendering
- No Excel support in `getSummary()` (summary rejection guard only)
- No Excel support in retranslate endpoint
- No `.ods`, `.csv`, `.xlsm` upload support
- No upload-time file validation or preprocessing
- No mobile app changes
- No changes to `MessageContentType` enum or `QAChatTurn` interface
- No post-response language re-detection

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (Jest)
- **Automated tests**: Tests-after
- **Framework**: Jest (via `bun test`)
- **File**: `src/modules/document-ai/document-ai.service.spec.ts`

### QA Policy
Every task includes agent-executed QA scenarios using curl against the running API.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.json`.

- **API endpoints**: Use Bash (curl) — Send requests, assert status codes + response shape
- **Test runner**: Use Bash (bun test) — Run test suite, verify pass/fail counts

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation + dependency):
├── Task 1: Install xlsx + update upload constants [quick]
├── Task 2: Update guessMime() for Excel [quick]
└── Task 3: Build Excel→CSV conversion utility [quick]

Wave 2 (After Wave 1 — core feature, MAX PARALLEL):
├── Task 4: Integrate CSV conversion into askQuestion() [deep]
├── Task 5: Add getSummary() Excel rejection guard [quick]
├── Task 6: Add retranslate Excel rejection guard [quick]
└── Task 7: Strengthen system prompt for language enforcement [quick]

Wave 3 (After Wave 2 — tests):
└── Task 8: Write document-ai.service.spec.ts tests [deep]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── Task F1: Plan Compliance Audit (oracle)
├── Task F2: Code Quality Review (unspecified-high)
├── Task F3: Real Manual QA (unspecified-high)
└── Task F4: Scope Fidelity Check (deep)

Critical Path: T1 → T4 → T8
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 4 (Wave 2)
```

### Dependency Matrix
- **1-3**: None — can start immediately, all parallel
- **4**: 2, 3 — needs MIME detection + conversion utility
- **5**: 2 — needs MIME detection for guard
- **6**: None — independent (guards against extension in URL)
- **7**: None — independent (prompt change only)
- **8**: 4, 5, 7 — needs full feature + guards + prompt

### Agent Dispatch Summary
- **Wave 1**: T1 → `quick`, T2 → `quick`, T3 → `quick`
- **Wave 2**: T4 → `deep`, T5 → `quick`, T6 → `quick`, T7 → `quick`
- **Wave 3**: T8 → `deep`
- **Final**: F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Install `xlsx` dependency and update upload constants

  **What to do**:
  - Run `bun add xlsx` to install the SheetJS package
  - Open `src/core/common/upload/upload.constants.ts`
  - Add `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (.xlsx) and `application/vnd.ms-excel` (.xls) to `ALLOWED_MEDIA_MIMES` array
  - Add entries to `MIME_TO_EXT` map:
    - `'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'` → `'.xlsx'`
    - `'application/vnd.ms-excel'` → `'.xls'`

  **Must NOT do**:
  - Do NOT add `.csv`, `.ods`, `.xlsm`, or any other spreadsheet format
  - Do NOT change file size limits or other upload settings
  - Do NOT modify `multer-config.ts` beyond what's needed for Excel MIME filtering

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single package install + two array/map additions in a constants file
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**: All — trivial file edits

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Task 4 (depends on upload allowing Excel files)
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/core/common/upload/upload.constants.ts` — ALLOWED_MEDIA_MIMES array and MIME_TO_EXT map to modify
    - Current pattern: `'application/pdf'` entry shows exact syntax to replicate
  - `package.json` — verify `xlsx` was added to dependencies after `bun add`

  **Acceptance Criteria**:
  - [ ] `bun add xlsx` succeeds, package.json has `"xlsx": "^0.18.5"` (or latest)
  - [ ] `ALLOWED_MEDIA_MIMES` includes both Excel MIME types
  - [ ] `MIME_TO_EXT` maps both Excel MIME types to correct extensions

  **QA Scenarios**:
  ```
  Scenario: Upload .xlsx file succeeds
    Tool: Bash (curl)
    Preconditions: API running on localhost:3000, valid JWT token
    Steps:
      1. curl -s -X POST http://localhost:3000/media/upload \
           -H "Authorization: Bearer $TOKEN" \
           -F "file=@test.xlsx" -w "\n%{http_code}"
      2. Assert: HTTP status is 201
      3. Assert: response body contains "url" field (S3 URL)
    Expected Result: 201 Created, JSON response with valid S3 URL
    Failure Indicators: 400 (rejected by multer filter), 415 (unsupported type)
    Evidence: .sisyphus/evidence/task-1-upload-xlsx.json

  Scenario: Upload .xls file succeeds
    Tool: Bash (curl)
    Preconditions: Same as above, test.xls file available
    Steps:
      1. curl -s -X POST http://localhost:3000/media/upload \
           -H "Authorization: Bearer $TOKEN" \
           -F "file=@test.xls" -w "\n%{http_code}"
      2. Assert: HTTP status is 201
    Expected Result: 201 Created
    Evidence: .sisyphus/evidence/task-1-upload-xls.json
  ```

  **Commit**: YES
  - Message: `chore(deps): add xlsx and enable Excel MIME types in upload filter`
  - Files: `package.json`, `bun.lock`, `src/core/common/upload/upload.constants.ts`

- [x] 2. Update `guessMime()` to recognize Excel file extensions

  **What to do**:
  - Open `src/modules/document-ai/document-ai.service.ts`
  - In the `guessMime()` method (lines 125-148), add entries for Excel extensions to the `map` object:
    - `'.xlsx'` → `'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'`
    - `'.xls'` → `'application/vnd.ms-excel'`

  **Must NOT do**:
  - Do NOT remove or modify existing MIME mappings
  - Do NOT add `.csv`, `.ods`, `.xlsm`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Two-line addition to an existing map object
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Tasks 4, 5 (both depend on detecting Excel files)
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/modules/document-ai/document-ai.service.ts:125-148` — `guessMime()` method with existing MIME map
    - Pattern: `'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'` — exact format to replicate

  **Acceptance Criteria**:
  - [ ] `guessMime('report.xlsx')` returns `'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'`
  - [ ] `guessMime('data.xls')` returns `'application/vnd.ms-excel'`
  - [ ] Existing mappings (pdf, png, jpg, docx, etc.) still work unchanged

  **QA Scenarios**:
  ```
  Scenario: guessMime returns correct MIME for .xlsx
    Tool: Bash (bun repl)
    Preconditions: Service imported in REPL context
    Steps:
      1. Call: service.guessMime("https://s3.amazonaws.com/bucket/report.xlsx")
      2. Assert: returns "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    Expected Result: Correct MIME string
    Evidence: .sisyphus/evidence/task-2-guessmime-xlsx.txt
  ```

  **Commit**: YES (groups with T3)
  - Message: `feat(document-ai): add Excel MIME type detection in guessMime()`
  - Files: `src/modules/document-ai/document-ai.service.ts`

- [x] 3. Build Excel→CSV conversion utility function

  **What to do**:
  - Open `src/modules/document-ai/document-ai.service.ts`
  - Add a new private method `convertExcelToCsv(fileBuffer: Buffer): string` that:
    1. Calls `XLSX.read(fileBuffer, { type: 'buffer' })` wrapped in try/catch
    2. Maps each sheet name to CSV text using `XLSX.utils.sheet_to_csv(sheet)`
    3. Prepends each sheet's CSV with `## Sheet: {sheetName}\n` header
    4. Caps processing at **10 sheets** — if more exist, log a warning and skip remainder
    5. Joins all sheet CSVs with `\n\n` separator
    6. Returns the complete CSV text
  - Handle errors:
    - Password-protected: catch SheetJS error → throw `BadRequestException('This Excel file is password-protected and cannot be processed.')`
    - Corrupted/invalid: catch any parse error → throw `BadRequestException('Unable to read this Excel file. The file may be corrupted or in an unsupported format.')`
  - Import at top of file: `import * as XLSX from 'xlsx';`

  **Must NOT do**:
  - Do NOT cache or store the CSV anywhere (stateless conversion)
  - Do NOT convert formulas (SheetJS returns formula results or formula text — use as-is)
  - Do NOT handle cell formatting, styling, or charts

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Self-contained pure function, well-defined inputs/outputs, no complex integration
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 4 (integrates this utility into askQuestion)
  - **Blocked By**: None (imports are available after T1)

  **References**:
  - `src/modules/document-ai/document-ai.service.ts:208-211` — `downloadBufferFromUrl()` call pattern in `askQuestion()` — shows where buffer comes from
  - `src/modules/translation/translation.service.ts:490-494` — existing `normalizeTanglishLexicon()` private helper — pattern for private utility methods in services
  - SheetJS docs: `XLSX.read()` with `{ type: 'buffer' }` for Buffer input
  - SheetJS docs: `XLSX.utils.sheet_to_csv()` for CSV conversion
  - Package: `xlsx` (SheetJS Community Edition) — installed in T1

  **Acceptance Criteria**:
  - [ ] Single-sheet Excel: returns CSV with `## Sheet: Sheet1\n` header + CSV data
  - [ ] Multi-sheet Excel: returns concatenated CSVs, each with `## Sheet: {name}` header
  - [ ] 10+ sheet workbook: processes first 10, logs warning about remaining sheets
  - [ ] Password-protected Excel: throws `BadRequestException` with message "password-protected"
  - [ ] Corrupted binary: throws `BadRequestException` with message "corrupted or unsupported format"

  **QA Scenarios** (Note: tested as part of Task 4 integration):
  ```
  Evidence captured in Task 4 QA scenarios.
  ```

  **Commit**: YES (groups with T2)
  - Message: `feat(document-ai): add Excel-to-CSV conversion utility`
  - Files: `src/modules/document-ai/document-ai.service.ts`

- [x] 4. Integrate CSV conversion into `askQuestion()` for Excel files

  **What to do**:
  - Open `src/modules/document-ai/document-ai.service.ts`
  - In the `askQuestion()` method, AFTER downloading the file buffer (line 210-211) but BEFORE the base64/media block creation:
  - Detect Excel files using `guessMime(documentUrl)` — check if MIME is one of the Excel types
  - If Excel: call `this.convertExcelToCsv(fileBuffer)` to get CSV text
  - Apply CSV length guard:
    - If CSV text > 100,000 characters: truncate to 100K, append `"\n\n[Note: CSV truncated at 100,000 characters. Ask about specific sections if needed.]"`
    - If CSV text > 50,000 characters: log a warning (but proceed)
  - Send CSV text to Gemini as a **text content block** alongside the user question (NOT as media/base64):
    ```typescript
    const finalHumanMessage = new HumanMessage({
      content: [
        { type: 'text', text: `Document CSV content:\n\n${csvText}\n\nUser question: ${userQuestion}` },
      ],
    });
    ```
  - If NOT Excel: keep existing behavior (send as base64 media — lines 236-241 unchanged)
  - The CSV text should be prepended to the prompt so Gemini sees structured tabular data

  **Must NOT do**:
  - Do NOT send CSV as media/base64 — send as plain text in the prompt
  - Do NOT remove the original file buffer handling for non-Excel files
  - Do NOT change the `QAChatTurn[]` interface or how chat history is built
  - Do NOT modify how citations work (existing ZSchema remains unchanged)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Core integration point, multiple branches (Excel vs non-Excel), token length guards, careful positioning of conversion in the existing flow
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 7 — these are parallel with each other)
  - **Blocks**: Task 8 (tests depend on full Q&A flow)
  - **Blocked By**: Tasks 2, 3 (needs MIME detection + conversion utility)

  **References**:
  - `src/modules/document-ai/document-ai.service.ts:196-248` — full `askQuestion()` method — understand existing flow before inserting Excel branch
  - `src/modules/document-ai/document-ai.service.ts:208-211` — `downloadBufferFromUrl()` and `base64String` creation — Excel branch goes BETWEEN these lines
  - `src/modules/document-ai/document-ai.service.ts:236-241` — existing `HumanMessage` with media block — reference for non-Excel path
  - `src/modules/document-ai/document-ai.service.ts:125-148` — `guessMime()` method — understand how to detect Excel MIME
  - `src/modules/document-ai/document-ai.service.ts:56-73` — `resolvePreferredQALanguage()` — language resolution (unchanged, just context)

  **Acceptance Criteria**:
  - [ ] Excel Q&A: sends CSV as text prompt to Gemini (NOT as base64 media)
  - [ ] Non-Excel Q&A: continues sending as base64 media (no regression)
  - [ ] CSV over 100K chars: truncated with appended note
  - [ ] CSV over 50K chars: warning logged but not truncated
  - [ ] Multi-sheet CSV: all sheets (up to 10) included in prompt
  - [ ] Citations still work: schema unchanged, page numbers replaced with sheet names

  **QA Scenarios**:
  ```
  Scenario: Q&A on Excel file returns data-based answer
    Tool: Bash (curl)
    Preconditions:
      - Excel file uploaded to S3 via /media/upload (T1 QA)
      - DOCUMENT message created in chat with S3 URL as rawContent
      - Valid JWT token
    Steps:
      1. curl -s -X POST http://localhost:3000/document-ai/$EXCEL_MESSAGE_ID/qa \
           -H "Authorization: Bearer $TOKEN" \
           -H "Content-Type: application/json" \
           -d '{"userQuestion":"What is the total in column B?","preferredLanguage":"english","chatHistory":[]}'
      2. Assert: HTTP status is 200
      3. Assert: response has "answer" field (non-empty string)
      4. Assert: response has "citations" array
      5. Assert: answer contains a number (the column total) or states data not found
    Expected Result: 200 with coherent answer about Excel data
    Failure Indicators: 400 (Excel parsing failed), 500 (unexpected error), empty answer
    Evidence: .sisyphus/evidence/task-4-qa-excel-success.json

  Scenario: Q&A with multi-sheet Excel
    Tool: Bash (curl)
    Preconditions: Multi-sheet Excel (3 sheets) uploaded
    Steps:
      1. curl -s -X POST http://localhost:3000/document-ai/$MULTISHEET_MESSAGE_ID/qa \
           -H "Authorization: Bearer $TOKEN" \
           -H "Content-Type: application/json" \
           -d '{"userQuestion":"What is on Sheet2?","preferredLanguage":"english","chatHistory":[]}'
      2. Assert: 200
      3. Assert: answer references Sheet2 data (not just Sheet1)
    Expected Result: Model can answer about specific sheets
    Evidence: .sisyphus/evidence/task-4-qa-multisheet.json

  Scenario: Corrupt Excel file returns clear error
    Tool: Bash (curl)
    Preconditions: Corrupt binary file uploaded as .xlsx, DOCUMENT message created
    Steps:
      1. curl -s -X POST http://localhost:3000/document-ai/$CORRUPT_MESSAGE_ID/qa \
           -H "Authorization: Bearer $TOKEN" \
           -H "Content-Type: application/json" \
           -d '{"userQuestion":"test","chatHistory":[]}' -w "\n%{http_code}"
      2. Assert: HTTP status is 400
      3. Assert: response message contains "corrupted" or "unable to read"
    Expected Result: 400 Bad Request with descriptive error
    Evidence: .sisyphus/evidence/task-4-qa-corrupt-excel.json
  ```

  **Commit**: YES
  - Message: `feat(document-ai): integrate Excel CSV conversion into Document Q&A`
  - Files: `src/modules/document-ai/document-ai.service.ts`

- [x] 5. Add `getSummary()` guard to reject Excel files with clear error

  **What to do**:
  - Open `src/modules/document-ai/document-ai.service.ts`
  - In the `getSummary()` method (line 152), AFTER `getDocumentMessage()` but BEFORE checking `message.transcription`:
  - Add a check: if `message.contentType === MessageContentType.DOCUMENT`, resolve the URL, call `guessMime(url)`, and if it's an Excel MIME type, throw `BadRequestException('Summaries are not available for spreadsheet files. Use Q&A to ask questions about specific data.')`

  **Must NOT do**:
  - Do NOT attempt to generate a summary from CSV (explicitly out of scope)
  - Do NOT change the summary generation logic for non-Excel files

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single guard check with clear condition and error message
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 6, 7)
  - **Blocks**: Task 8 (tests need this guard)
  - **Blocked By**: Task 2 (needs MIME detection)

  **References**:
  - `src/modules/document-ai/document-ai.service.ts:152-192` — `getSummary()` method — insert guard here
  - `src/modules/document-ai/document-ai.service.ts:95-106` — `getDocumentMessage()` method — confirms contentType=DOCUMENT check pattern
  - `src/modules/document-ai/document-ai.service.ts:109-122` — `resolveDocumentUrl()` — extracting URL from rawContent

  **Acceptance Criteria**:
  - [ ] `GET /document-ai/:excelMessageId/summary` returns 400
  - [ ] Error message: "Summaries are not available for spreadsheet files"
  - [ ] `GET /document-ai/:pdfMessageId/summary` still works normally (no regression)

  **QA Scenarios**:
  ```
  Scenario: Summary on Excel returns clear error
    Tool: Bash (curl)
    Preconditions: Excel DOCUMENT message exists in DB
    Steps:
      1. curl -s -X GET http://localhost:3000/document-ai/$EXCEL_MESSAGE_ID/summary \
           -H "Authorization: Bearer $TOKEN" -w "\n%{http_code}"
      2. Assert: HTTP status is 400
      3. Assert: response.message contains "Summaries are not available for spreadsheet"
    Expected Result: 400 with descriptive message
    Evidence: .sisyphus/evidence/task-5-excel-summary-rejected.json

  Scenario: Summary on PDF still works (regression check)
    Tool: Bash (curl)
    Preconditions: PDF DOCUMENT message exists with transcription populated
    Steps:
      1. curl -s -X GET http://localhost:3000/document-ai/$PDF_MESSAGE_ID/summary \
           -H "Authorization: Bearer $TOKEN" -w "\n%{http_code}"
      2. Assert: HTTP status is 200
      3. Assert: response has "bullets" array
    Expected Result: 200 with summary bullets
    Evidence: .sisyphus/evidence/task-5-pdf-summary-still-works.json
  ```

  **Commit**: YES (groups with T6)
  - Message: `feat(document-ai): reject Excel files in summary endpoint`
  - Files: `src/modules/document-ai/document-ai.service.ts`

- [x] 6. Add retranslate guard to reject Excel DOCUMENT messages in `chat.controller.ts`

  **What to do**:
  - Open `src/modules/chat/chat.controller.ts`
  - In the `retranslateMessage()` method (line 108), in the else branch (lines 177-196) that handles non-text, non-audio messages:
  - BEFORE calling `resolveStoredMediaReference()`, add a check on the file extension:
    - Extract extension from `rawContent` URL using `path.extname()`
    - If extension is `.xlsx` or `.xls`, throw `BadRequestException('Spreadsheet files cannot be retranslated. Use Document Q&A to ask questions about this file.')`
  - Place this guard BEFORE the S3 download to avoid unnecessary S3 access

  **Must NOT do**:
  - Do NOT change the retranslate logic for other file types (PDF, images)
  - Do NOT modify the TEXT or AUDIO branches
  - Do NOT download the Excel file from S3 before rejecting

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single guard with extension check in existing else branch
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5, 7)
  - **Blocks**: None (no downstream tasks depend on retranslate guard)
  - **Blocked By**: None (extension check is independent of T2)

  **References**:
  - `src/modules/chat/chat.controller.ts:177-196` — else branch handling DOCUMENT/IMAGE retranslate — insert guard at line 178
  - `src/modules/chat/chat.controller.ts:314-347` — `resolveStoredMediaReference()` — understand how URL is structured (S3 URL with extension in pathname)
  - `src/modules/chat/chat.controller.ts:180-188` — existing ext→MIME mapping (pdf, png, gif, jpg fallback) — context for why guard is needed (Excel would silently map to `image/jpeg`)

  **Acceptance Criteria**:
  - [ ] `POST /chat/messages/:excelMessageId/retranslate` returns 400
  - [ ] Error message mentions "spreadsheet" and "cannot be retranslated"
  - [ ] `POST /chat/messages/:pdfMessageId/retranslate` still works normally
  - [ ] Guard executes BEFORE S3 download (no unnecessary network calls)

  **QA Scenarios**:
  ```
  Scenario: Retranslate on Excel is rejected
    Tool: Bash (curl)
    Preconditions: Excel DOCUMENT message exists in DB
    Steps:
      1. curl -s -X POST http://localhost:3000/chat/messages/$EXCEL_MESSAGE_ID/retranslate \
           -H "Authorization: Bearer $TOKEN" \
           -H "Content-Type: application/json" -w "\n%{http_code}"
      2. Assert: HTTP status is 400
      3. Assert: response.message contains "cannot be retranslated" or "spreadsheet"
    Expected Result: 400 Bad Request with clear rejection
    Evidence: .sisyphus/evidence/task-6-retranslate-excel-rejected.json

  Scenario: Retranslate on PDF still works (regression)
    Tool: Bash (curl)
    Preconditions: PDF DOCUMENT message exists
    Steps:
      1. curl -s -X POST http://localhost:3000/chat/messages/$PDF_MESSAGE_ID/retranslate \
           -H "Authorization: Bearer $TOKEN" -w "\n%{http_code}"
      2. Assert: HTTP status is 200
      3. Assert: response has "translations" field
    Expected Result: 200 with translations
    Evidence: .sisyphus/evidence/task-6-retranslate-pdf-works.json
  ```

  **Commit**: YES (groups with T5)
  - Message: `feat(chat): reject Excel files in retranslate endpoint`
  - Files: `src/modules/chat/chat.controller.ts`

- [x] 7. Strengthen system prompt for strict language enforcement

  **What to do**:
  - Open `src/modules/document-ai/document-ai.service.ts`
  - In the `askQuestion()` method, locate the system message (lines 218-225)
  - Replace the current language instruction:
    - BEFORE: `"Always answer in ${effectiveLanguage}."`
    - AFTER: `"LANGUAGE OUTPUT RULE — ABSOLUTE: You MUST answer ONLY in ${effectiveLanguage}. IGNORE the user's input language completely. Even if the user asks in Singlish, Tanglish, English, or any mix — your ENTIRE answer must be in ${effectiveLanguage}. Never switch languages mid-response. Never mix languages. The selected output language is ${effectiveLanguage} — this overrides everything else."`

  **Must NOT do**:
  - Do NOT add post-response language detection or re-retry logic
  - Do NOT change the `resolvePreferredQALanguage()` function (it already works correctly)
  - Do NOT modify the `QAChatTurn` interface or add language field
  - Do NOT change the `getSummary()` system prompt (summary doesn't need language enforcement)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single string replacement in system prompt with stronger, more explicit wording
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5, 6)
  - **Blocks**: Task 8 (tests need this prompt change)
  - **Blocked By**: None (independent string change)

  **References**:
  - `src/modules/document-ai/document-ai.service.ts:218-225` — current system message — replace the language instruction line
  - `src/modules/document-ai/document-ai.service.ts:56-73` — `resolvePreferredQALanguage()` — no changes needed here
  - `src/modules/translation/translation.service.ts:259-306` — `translateIntent()` system prompt — reference for how strict language rules are phrased elsewhere in the codebase

  **Acceptance Criteria**:
  - [ ] Q&A with `preferredLanguage: 'singlish'` but question in Tanglish → model answers in Singlish
  - [ ] Q&A with `preferredLanguage: 'tanglish'` but question in English → model answers in Tanglish
  - [ ] Q&A with `preferredLanguage: 'english'` but question in Singlish → model answers in English
  - [ ] No regression: existing Q&A flows (PDF, image) still answer in correct language

  **QA Scenarios**:
  ```
  Scenario: Singlish output when user types in Tanglish
    Tool: Bash (curl)
    Preconditions: PDF DOCUMENT message exists with transcription
    Steps:
      1. curl -s -X POST http://localhost:3000/document-ai/$MESSAGE_ID/qa \
           -H "Authorization: Bearer $TOKEN" \
           -H "Content-Type: application/json" \
           -d '{"userQuestion":"Machan enna da ithu?","preferredLanguage":"singlish","chatHistory":[]}'
           NOTE: "enna da" is Tanglish, but preferredLanguage is "singlish"
      2. Assert: HTTP status is 200
      3. Assert: response.answer does NOT contain Tanglish markers like "enna", "vaa", "poda"
      4. Assert: response.answer contains Singlish-like patterns OR is in neutral/academic style
    Expected Result: Answer is in Singlish (or neutral), NOT Tanglish
    Failure Indicators: Answer contains Tanglish terms/dialect
    Evidence: .sisyphus/evidence/task-7-language-singlish-override.json

  Scenario: English output when user types in Singlish
    Tool: Bash (curl)
    Steps:
      1. curl -s -X POST http://localhost:3000/document-ai/$MESSAGE_ID/qa \
           -H "Authorization: Bearer $TOKEN" \
           -H "Content-Type: application/json" \
           -d '{"userQuestion":"Machan mokada meke thiyenne?","preferredLanguage":"english","chatHistory":[]}'
      2. Assert: 200
      3. Assert: answer is in standard English (no "machan", "hari", "kiyala")
    Expected Result: Answer is in clean English
    Evidence: .sisyphus/evidence/task-7-language-english-override.json

  Scenario: Language sticks across chat history
    Tool: Bash (curl)
    Preconditions: Previous Q&A turns in Tanglish
    Steps:
      1. Send first Q&A with preferredLanguage: "singlish"
      2. Send second Q&A with preferredLanguage: "tanglish" (switched!)
      3. Assert second answer is in Tanglish (NOT sticking to old Singlish)
    Expected Result: Language respects the CURRENT request, not history
    Evidence: .sisyphus/evidence/task-7-language-switching.json
  ```

  **Commit**: YES
  - Message: `fix(document-ai): enforce strict language output in Q&A system prompt`
  - Files: `src/modules/document-ai/document-ai.service.ts`

- [x] 8. Write `document-ai.service.spec.ts` tests

  **What to do**:
  - Create file `src/modules/document-ai/document-ai.service.spec.ts`
  - Follow existing test patterns from `translation.service.spec.ts` (mock-based approach)
  - Mock external dependencies: `S3StorageService`, `ConfigService`, `Message` repository
  - Mock `ChatGoogleGenerativeAI` and `withStructuredOutput` (same pattern as translation spec)
  - Mock `XLSX.read()` and `XLSX.utils.sheet_to_csv()` for controlled test data
  - Test cases to cover:

    **Excel conversion (unit):**
    - `convertExcelToCsv()` returns CSV with sheet headers for single-sheet workbook
    - `convertExcelToCsv()` returns concatenated CSVs for multi-sheet workbook
    - `convertExcelToCsv()` throws BadRequestException for password-protected file
    - `convertExcelToCsv()` throws BadRequestException for corrupt binary
    - `convertExcelToCsv()` caps at 10 sheets, warns for remainder

    **Excel Q&A integration:**
    - `askQuestion()` with Excel file sends CSV text to Gemini (not base64 media)
    - `askQuestion()` with Excel file truncates CSV at 100K chars, appends note
    - `askQuestion()` with Excel file logs warning at 50K chars (doesn't truncate)
    - `askQuestion()` with non-Excel file sends base64 media (unchanged)

    **Summary guard:**
    - `getSummary()` on Excel file throws `BadRequestException` with "spreadsheet" message
    - `getSummary()` on PDF file proceeds normally (doesn't throw)

    **Language enforcement:**
    - System prompt contains strong language enforcement text with `${effectiveLanguage}`
    - `resolvePreferredQALanguage()` returns `preferredLanguage` when provided
    - `resolvePreferredQALanguage()` falls back to `detectedLanguage` when no preference

  **Must NOT do**:
  - Do NOT test Gemini API calls end-to-end (mock them)
  - Do NOT test S3 uploads (mock S3StorageService)
  - Do NOT test the chat gateway or controller (those are separate modules)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Multiple test scenarios across 3 methods, mock setup, following existing test conventions, Jest mocking patterns
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Wave 2 completes)
  - **Blocks**: Final Verification Wave
  - **Blocked By**: Tasks 4, 5, 7 (test the built features and guards)

  **References**:
  - `src/modules/translation/translation.service.spec.ts` — PATTERN REFERENCE: mock setup style, `jest.mock('@langchain/google-genai')`, `beforeEach`/`afterEach`, `jest.spyOn` for private methods
    - Lines 1-50: Mock setup and `createService()` factory pattern
    - Lines 51-100: Test structure with `describe`/`it` blocks
    - Lines 200-290: `mockRejectedValueOnce` for error scenarios
  - `src/modules/dialect/dialect.service.spec.ts` — PATTERN REFERENCE: simpler spec with error handling tests
  - `src/modules/document-ai/document-ai.service.ts` — SOURCE: all methods to test
  - `package.json:83-99` — Jest config (testRegex, transform with ts-jest)

  **Acceptance Criteria**:
  - [ ] `bun test src/modules/document-ai/document-ai.service.spec.ts` passes all tests
  - [ ] At least 12 test cases (covering the scenarios listed above)
  - [ ] Mock-based tests only (no real Gemini or S3 calls)
  - [ ] Follows existing test patterns (jest.mock, describe/it, beforeEach)

  **QA Scenarios**:
  ```
  Scenario: Run all document-ai tests
    Tool: Bash (bun test)
    Preconditions: Tests written, dependencies installed
    Steps:
      1. bun test src/modules/document-ai/document-ai.service.spec.ts
      2. Assert: exit code 0
      3. Assert: all tests pass, no failures
    Expected Result: "Tests: N passed, N total"
    Evidence: .sisyphus/evidence/task-8-test-run.txt
  ```

  **Commit**: YES
  - Message: `test(document-ai): add Excel conversion and language enforcement tests`
  - Files: `src/modules/document-ai/document-ai.service.spec.ts`

---

## Final Verification Wave

> 4 review agents run in PARALLEL after ALL implementation tasks. ALL must APPROVE.
> Get explicit user "okay" before marking complete.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration. Test edge cases: empty Excel, corrupt Excel, language switching mid-chat, 10+ sheet workbook.
  Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1**: `chore(deps): add xlsx for Excel file support` — `package.json`, `bun.lock`
- **2**: `feat(upload): allow Excel MIME types in media upload filter` — `upload.constants.ts`
- **3**: `feat(document-ai): add Excel MIME detection in guessMime()` — `document-ai.service.ts`
- **4-7**: `feat(document-ai): Excel CSV conversion and language enforcement` — `document-ai.service.ts`, `chat.controller.ts`
- **8**: `test(document-ai): add Excel and language enforcement tests` — `document-ai.service.spec.ts`

---

## Success Criteria

### Verification Commands
```bash
# Unit tests pass
bun test src/modules/document-ai/document-ai.service.spec.ts

# Excel upload accepted
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:3000/media/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@test.xlsx"
# Expected: 201

# Excel Q&A succeeds
curl -s -X POST http://localhost:3000/document-ai/$MESSAGE_ID/qa \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userQuestion":"What is the total in column B?","preferredLanguage":"english","chatHistory":[]}'
# Expected: 200, body has { answer, citations }

# Excel summary rejected
curl -s -X GET http://localhost:3000/document-ai/$EXCEL_MESSAGE_ID/summary \
  -H "Authorization: Bearer $TOKEN" \
  -w "%{http_code}"
# Expected: 400, message mentions "spreadsheet" or "summary not available"
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass (`bun test`)
- [ ] TypeScript compiles (`tsc --noEmit`)
- [ ] All QA scenarios pass
- [ ] Evidence files exist in `.sisyphus/evidence/`
