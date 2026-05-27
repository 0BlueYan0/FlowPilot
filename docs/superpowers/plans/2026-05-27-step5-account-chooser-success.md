# Step 5 Account Chooser Success Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Treat `https://auth.openai.com/choose-an-account` with at least one selectable account as a successful Step 5 registration boundary.

**Architecture:** Keep the behavior localized to existing Step 5 submit-state detection. Content code classifies the account chooser as `account_chooser_available`; background Step 5 validation accepts that state as completed without clicking an account.

**Tech Stack:** Chrome extension JavaScript, Node.js built-in test runner.

---

### Task 1: Content Step 5 Success State

**Files:**
- Modify: `flows/openai/content/openai-auth.js`
- Test: `tests/step5-direct-complete.test.js`

- [ ] **Step 1: Write the failing test**

Add a test that evaluates Step 5 submit-state helpers on `https://auth.openai.com/choose-an-account` with one visible account button. Assert `successState === 'account_chooser_available'` and `unknownAuthPage === false`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/step5-direct-complete.test.js`

Expected: FAIL because the chooser page is currently treated as unknown auth page.

- [ ] **Step 3: Write minimal implementation**

Add helper functions in `openai-auth.js`:

```js
function isStep5AccountChooserPageUrl(rawUrl = location.href) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    return String(parsed.hostname || '').toLowerCase() === 'auth.openai.com'
      && /^\/choose-an-account(?:[/?#]|$)/i.test(String(parsed.pathname || ''));
  } catch {
    return false;
  }
}

function hasStep5SelectableAccountChoice() {
  const candidates = document.querySelectorAll('button, a, [role="button"], [role="link"]');
  return Array.from(candidates).some((el) => isVisibleElement(el) && isActionEnabled(el));
}

function isStep5AccountChooserAvailable() {
  return isStep5AccountChooserPageUrl() && hasStep5SelectableAccountChoice();
}
```

Update `getStep5PostSubmitSuccessState()` to return `{ state: 'account_chooser_available', url: location.href }` before returning `null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/step5-direct-complete.test.js`

Expected: PASS.

### Task 2: Background Completion Acceptance

**Files:**
- Modify: `background.js`
- Test: `tests/background-step5-post-completion-validation.test.js`

- [ ] **Step 1: Write the failing test**

Add a test where `GET_STEP5_SUBMIT_STATE` returns `successState: 'account_chooser_available'` and `url: 'https://auth.openai.com/choose-an-account'`. Assert `validateStep5PostCompletion()` returns that state instead of throwing the non-chatgpt success error.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/background-step5-post-completion-validation.test.js`

Expected: FAIL with the existing non-chatgpt success candidate rejection.

- [ ] **Step 3: Write minimal implementation**

Update `validateStep5PostCompletion()` so `pageState.successState === 'account_chooser_available'` returns success after logging, without requiring `chatgpt.com`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/background-step5-post-completion-validation.test.js`

Expected: PASS.

### Task 3: Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run focused tests**

Run: `node --test tests/step5-direct-complete.test.js tests/background-step5-post-completion-validation.test.js`

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: PASS.

---

Self-review: This plan covers the approved scope only. There are no placeholders, no automatic account clicking, and no changes outside Step 5 success classification and validation.
