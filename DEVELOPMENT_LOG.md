# Development Log: lee-code Tool Calling Fixes

## Session Date: 2026-05-10

---

## Summary

After successful tool calling implementation, code was refactored (MiniMax M2.5 Free). Multiple critical bugs were introduced that required manual fixing through 12+ commits.

---

## Issues Found & Fixes Applied

### 1. [CRITICAL] Tools Never Registered
- **Bug:** `registerTool()` was defined but never called
- **Impact:** Every tool call failed silently - `getTool(name)` returned `undefined`
- **Fix:** Add tool registration at CLI startup (`12a39dd`)
- **Root Cause:** Post-refactoring, registration was lost/not implemented

### 2. [CRITICAL] Empty String Content Parsing Failed
- **Bug:** `parsed.content && parsed.version` - empty string `""` is falsy!
- **Impact:** Tool calls with `content: ""` were ignored
- **Fix:** `parsed.content !== undefined && parsed.version` (`850f3bf`)
- **Code:**
```typescript
// BROKEN
if (parsed.content && parsed.version)

// FIXED
if (parsed.content !== undefined && parsed.version)
```

### 3. [CRITICAL] Tool Schemas Not Sent to LLM
- **Bug:** Functions registered but no parameter schemas defined
- **Impact:** LLM didn't know correct arguments
- **Fix:** Add schema definitions when registering tools (`46f1bc2`)

### 4. Wrong Message Order
- **Bug:** Tool results added before assistant message
- **Impact:** Message chain order was wrong
- **Fix:** Add assistant message first, then tool results (`d475b00`)

### 5. Duplicate Assistant Messages
- **Bug:** Assistant message pushed inside loop - once per tool
- **Impact:** 3 tools = 3 duplicate messages
- **Fix:** Move outside loop (`0d0177c`)

### 6. Duplicate Code
- **Bug:** Identical tool execution in 2 paths (schema + non-schema)
- **Impact:** Hard to maintain, easy to desync
- **Fix:** Extract `executeToolCalls()` function (`54883f0`)

### 7. Tool Argument Mismatches
- **Bug:** Model sends `path`, tool expects `pattern`
- **Fix:** Accept multiple property names (`b347ca7`)

---

## Commits Made Today

| # | Commit | Description |
|---|--------|-------------|
| 1 | `7162c95` | test: Add comprehensive behavior tests |
| 2 | `d475b00` | fix: Push assistant message first |
| 3 | `54883f0` | refactor: Extract tool execution function |
| 4 | `0d0177c` | fix: Add assistant AFTER processing all tools |
| 5 | `576d3d0` | fix: Send full tool results to LLM, accumulate messages |
| 6 | `a8d7ca8` | test: Add schema parsing tests |
| 7 | `850f3bf` | fix: Schema parsing failed when content is empty string |
| 8 | `fc61d50` | fix: Debug logging to verify tool results |
| 9 | `46f1bc2` | fix: Add proper tool schemas for native tool calling |
| 10 | `bdddf85` | fix: Simplify schema arguments |
| 11 | `b347ca7` | fix: Accept multiple argument names for tool calls |
| 12 | `12a39dd` | fix: Register all 3 tools at CLI startup |

---

## Root Cause Analysis

### Why So Many Bugs?

1. **No verification after refactoring** - The "MiniMax M2.5 Free" refactoring broke core functionality silently

2. **No integration tests** - Unit tests existed but didn't test the actual tool execution flow

3. **Assumed it worked** - No real E2E testing of the agent loop

4. **Trusting the model** - Assumed schema enforcement would work without verification

### What We Should Have Done

1. **Before refactoring:** Run a simple test to verify tools work
2. **After refactoring:** Verify agent loop completes with tool execution
3. **Add logging:** Debug at each step to trace issues
4. **Test edge cases:** Empty strings, undefined, etc.

---

## Test Coverage

- **65 tests total**
- **12 meaningful tests** (~18%) - Test actual system behavior
- **~$17% trivial tests** - Test local variable assignments

### Gaps Identified:
- No E2E message chain verification
- No test for concurrent tool execution
- No test for name aliases (command vs cmd)

---

## Lessons Learned

1. After refactoring, ALWAYS verify core functionality works
2. Add integration tests that test the full agent loop
3. Be explicit with checks: `!== undefined` vs truthy
4. Test edge cases: `""`, `null`, `undefined`
5. Extract reusable code (DRY principle)
6. Log at each step for debugging
7. Don't trust schema enforcement alone - verify it works

---

## Current Status

- Tool calling now works correctly
- Messages accumulate across iterations
- Full tool results sent to LLM
- Truncated results shown to user
- 65 tests passing

---

*End of Development Log*