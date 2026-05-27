# Step 8 Password Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change OpenAI Step 8 so it submits the saved password instead of fetching or submitting login verification codes.

**Architecture:** Keep the content-side login password automation as the single DOM implementation. The Step 8 background executor will inspect the current auth page, reject verification-code pages, and call the existing `EXECUTE_NODE` login handler with `visibleStep: 8` when a password page must be submitted.

**Tech Stack:** JavaScript Chrome extension, Node built-in test runner, existing OpenAI background/content modules.

---

## File Structure

- Modify `flows/openai/background/steps/fetch-login-code.js`: replace the default Step 8 mail-code path with password-only handling; keep bind-email and bound-email helper paths intact unless tests require further change.
- Modify `tests/background-step7-recovery.test.js`: add focused Step 8 executor regressions for password submission, verification-page hard failure, phone-verification hard failure, and missing-password hard failure.
- No content-script DOM changes are planned because `flows/openai/content/openai-auth.js` already supports password login through `step6LoginFromPasswordPage()`.

---

### Task 1: Add Step 8 Password-Only Regression Tests

**Files:**
- Modify: `tests/background-step7-recovery.test.js`

- [ ] **Step 1: Add failing tests near the existing Step 8 executor tests**

Append these tests after the existing `step 8 does not submit or recover add-email inside fetch-login-code` test, or near the other `executeStep8` tests in `tests/background-step7-recovery.test.js`:

```js
test('step 8 submits saved password instead of polling login verification mail', async () => {
  const events = {
    contentMessages: [],
    completed: [],
    pollCalls: 0,
  };

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    completeNodeFromBackground: async (nodeId, payload) => {
      events.completed.push({ nodeId, payload });
    },
    ensureStep8VerificationPageReady: async () => ({
      state: 'password_page',
      url: 'https://auth.openai.com/log-in/password',
    }),
    getOAuthFlowStepTimeoutMs: async (fallback) => fallback,
    getState: async () => ({ password: 'Secret123!' }),
    getTabId: async () => 88,
    isVerificationMailPollingError: () => false,
    resolveVerificationStep: async () => {
      events.pollCalls += 1;
      throw new Error('resolveVerificationStep should not be called');
    },
    reuseOrCreateTab: async () => 88,
    sendToContentScriptResilient: async (_source, message) => {
      events.contentMessages.push(message);
      return {
        step6Outcome: 'success',
        directOAuthConsentPage: true,
        skipLoginVerificationStep: true,
        state: 'oauth_consent_page',
        url: 'https://auth.openai.com/sign-in-with-chatgpt/codex/consent',
      };
    },
    setState: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 1,
    throwIfStopped: () => {},
  });

  await executor.executeStep8({
    nodeId: 'fetch-login-code',
    email: 'user@example.com',
    password: 'Secret123!',
    oauthUrl: 'https://auth.openai.com/oauth',
  });

  assert.equal(events.pollCalls, 0);
  assert.equal(events.contentMessages.length, 1);
  assert.equal(events.contentMessages[0].type, 'EXECUTE_NODE');
  assert.equal(events.contentMessages[0].nodeId, 'oauth-login');
  assert.equal(events.contentMessages[0].step, 7);
  assert.deepStrictEqual(events.contentMessages[0].payload, {
    email: 'user@example.com',
    phoneNumber: '',
    accountIdentifier: 'user@example.com',
    loginIdentifierType: 'email',
    password: 'Secret123!',
    visibleStep: 8,
  });
  assert.deepStrictEqual(events.completed, [
    {
      nodeId: 'fetch-login-code',
      payload: {
        loginVerificationRequestedAt: null,
        skipLoginVerificationStep: true,
        directOAuthConsentPage: true,
      },
    },
  ]);
});

test('step 8 stops on login verification page without polling mail', async () => {
  let pollCalls = 0;
  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    completeNodeFromBackground: async () => {},
    ensureStep8VerificationPageReady: async () => ({
      state: 'verification_page',
      url: 'https://auth.openai.com/log-in/email-verification',
    }),
    getOAuthFlowStepTimeoutMs: async (fallback) => fallback,
    getState: async () => ({ password: 'Secret123!' }),
    getTabId: async () => 88,
    isVerificationMailPollingError: () => false,
    resolveVerificationStep: async () => {
      pollCalls += 1;
      throw new Error('resolveVerificationStep should not be called');
    },
    reuseOrCreateTab: async () => 88,
    sendToContentScriptResilient: async () => {
      throw new Error('content login should not be called');
    },
    setState: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 1,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeStep8({
      nodeId: 'fetch-login-code',
      email: 'user@example.com',
      password: 'Secret123!',
      oauthUrl: 'https://auth.openai.com/oauth',
    }),
    /步骤 8：OpenAI 要求登录验证码，已按设置停止，不再获取登录验证码/
  );
  assert.equal(pollCalls, 0);
});

test('step 8 stops on phone verification page without phone code handling', async () => {
  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    completeNodeFromBackground: async () => {},
    ensureStep8VerificationPageReady: async () => ({
      state: 'phone_verification_page',
      url: 'https://auth.openai.com/log-in/phone-verification',
    }),
    getOAuthFlowStepTimeoutMs: async (fallback) => fallback,
    getState: async () => ({ password: 'Secret123!' }),
    getTabId: async () => 88,
    isVerificationMailPollingError: () => false,
    phoneVerificationHelpers: {
      completeLoginPhoneVerificationFlow: async () => {
        throw new Error('phone verification should not be called');
      },
    },
    reuseOrCreateTab: async () => 88,
    sendToContentScriptResilient: async () => {
      throw new Error('content login should not be called');
    },
    setState: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 1,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeStep8({
      nodeId: 'fetch-login-code',
      email: '',
      signupPhoneNumber: '+441111111111',
      accountIdentifierType: 'phone',
      accountIdentifier: '+441111111111',
      password: 'Secret123!',
      oauthUrl: 'https://auth.openai.com/oauth',
    }),
    /步骤 8：OpenAI 要求手机登录验证码，已按设置停止，不再获取登录验证码/
  );
});

test('step 8 requires saved password before attempting password login', async () => {
  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    completeNodeFromBackground: async () => {},
    ensureStep8VerificationPageReady: async () => ({
      state: 'password_page',
      url: 'https://auth.openai.com/log-in/password',
    }),
    getOAuthFlowStepTimeoutMs: async (fallback) => fallback,
    getState: async () => ({ password: '' }),
    getTabId: async () => 88,
    isVerificationMailPollingError: () => false,
    reuseOrCreateTab: async () => 88,
    sendToContentScriptResilient: async () => {
      throw new Error('content login should not be called');
    },
    setState: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 1,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeStep8({
      nodeId: 'fetch-login-code',
      email: 'user@example.com',
      password: '',
      customPassword: '',
      oauthUrl: 'https://auth.openai.com/oauth',
    }),
    /步骤 8：缺少登录密码，无法改用密码登录/
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/background-step7-recovery.test.js`

Expected: FAIL. At least the new password-page test should fail because current Step 8 calls `pollEmailVerificationCode` on `verification_page` and does not handle `password_page` as the new password-only path.

---

### Task 2: Implement Step 8 Password-Only Background Flow

**Files:**
- Modify: `flows/openai/background/steps/fetch-login-code.js:775-960`

- [ ] **Step 1: Add helper functions above `runStep8Attempt`**

Insert this code immediately before `async function runStep8Attempt(state, runtime = {}) {`:

```js
    function resolveStep8Password(state = {}) {
      return String(state?.password || state?.customPassword || '').trim();
    }

    function resolveStep8LoginIdentifier(state = {}) {
      const identifierType = isPhoneLoginCodeMode(state) ? 'phone' : 'email';
      if (identifierType === 'phone') {
        const phoneNumber = String(
          state?.signupPhoneNumber
          || (normalizeIdentifierType(state?.accountIdentifierType) === 'phone' ? state?.accountIdentifier : '')
          || state?.signupPhoneCompletedActivation?.phoneNumber
          || state?.signupPhoneActivation?.phoneNumber
          || ''
        ).trim();
        return {
          loginIdentifierType: 'phone',
          phoneNumber,
          email: '',
          accountIdentifier: phoneNumber,
        };
      }

      const email = String(
        state?.email
        || (normalizeIdentifierType(state?.accountIdentifierType) === 'email' ? state?.accountIdentifier : '')
        || ''
      ).trim();
      return {
        loginIdentifierType: 'email',
        phoneNumber: '',
        email,
        accountIdentifier: email,
      };
    }

    function throwStep8VerificationStopped(pageState = {}, visibleStep = 8) {
      const state = pageState?.state || 'unknown';
      const url = pageState?.url || '';
      if (state === 'phone_verification_page') {
        throw new Error(`步骤 ${visibleStep}：OpenAI 要求手机登录验证码，已按设置停止，不再获取登录验证码。URL: ${url}`.trim());
      }
      if (state === 'verification_page') {
        throw new Error(`步骤 ${visibleStep}：OpenAI 要求登录验证码，已按设置停止，不再获取登录验证码。URL: ${url}`.trim());
      }
      if (state === 'add_phone_page') {
        throw new Error(`步骤 ${visibleStep}：OpenAI 要求手机号页面，已按设置停止，不再继续登录验证码流程。URL: ${url}`.trim());
      }
    }

    async function submitStep8PasswordLogin(state, visibleStep) {
      if (typeof sendToContentScriptResilient !== 'function') {
        throw new Error(`步骤 ${visibleStep}：认证页通信模块不可用，无法改用密码登录。`);
      }
      const password = resolveStep8Password(state);
      if (!password) {
        throw new Error(`步骤 ${visibleStep}：缺少登录密码，无法改用密码登录。`);
      }
      const identifier = resolveStep8LoginIdentifier(state);
      if (!identifier.email && !identifier.phoneNumber) {
        throw new Error(`步骤 ${visibleStep}：缺少登录账号，无法改用密码登录。`);
      }

      await addLog(`步骤 ${visibleStep}：当前为密码页，改为填写已保存密码，不再获取登录验证码。`, 'info', {
        step: visibleStep,
        stepKey: activeFetchLoginCodeStepKey || 'fetch-login-code',
      });

      const timeoutMs = await getStep8ReadyTimeoutMs('填写登录密码并确认 OAuth 授权页', state?.oauthUrl || '', visibleStep);
      const result = await sendToContentScriptResilient(
        'openai-auth',
        {
          type: 'EXECUTE_NODE',
          nodeId: 'oauth-login',
          step: 7,
          source: 'background',
          payload: {
            email: identifier.email,
            phoneNumber: identifier.phoneNumber,
            accountIdentifier: identifier.accountIdentifier,
            loginIdentifierType: identifier.loginIdentifierType,
            password,
            visibleStep,
          },
        },
        {
          timeoutMs,
          responseTimeoutMs: timeoutMs,
          retryDelayMs: 700,
          logMessage: `步骤 ${visibleStep}：认证页正在提交密码，等待 OAuth 授权页就绪...`,
          logStep: visibleStep,
          logStepKey: activeFetchLoginCodeStepKey || 'fetch-login-code',
        }
      );

      if (result?.error) {
        throw new Error(result.error);
      }
      if (result?.directOAuthConsentPage || result?.skipLoginVerificationStep || result?.state === 'oauth_consent_page') {
        await completeStep8WhenAuthAlreadyOnOauthConsent(visibleStep, { nodeId: state?.nodeId });
        return result;
      }
      if (result?.state === 'verification_page' || result?.state === 'phone_verification_page' || result?.state === 'add_phone_page') {
        throwStep8VerificationStopped(result, visibleStep);
      }

      throw new Error(`步骤 ${visibleStep}：提交密码后未进入 OAuth 授权页，当前状态：${result?.state || 'unknown'}。URL: ${result?.url || ''}`.trim());
    }
```

- [ ] **Step 2: Replace the body of `runStep8Attempt` after `ensureStep8VerificationPageReady`**

Keep the auth tab setup and the `ensureStep8VerificationPageReady` call. Replace lines from `if (pageState?.state === 'oauth_consent_page') {` through `return pollEmailVerificationCode(state, pageState, visibleStep, runtime);` with:

```js
      if (pageState?.state === 'oauth_consent_page') {
        await completeStep8WhenAuthAlreadyOnOauthConsent(visibleStep, { nodeId: state?.nodeId });
        return;
      }
      throwStep8VerificationStopped(pageState, visibleStep);
      if (pageState?.state === 'add_email_page') {
        throw new Error(`步骤 ${visibleStep}：Step 8 只改用密码登录，不处理添加邮箱页。URL: ${pageState?.url || ''}`.trim());
      }
      if (pageState?.state !== 'password_page') {
        throw new Error(`步骤 ${visibleStep}：Step 8 只改用密码登录，当前状态不是密码页：${pageState?.state || 'unknown'}。URL: ${pageState?.url || ''}`.trim());
      }

      return submitStep8PasswordLogin(state, visibleStep);
```

- [ ] **Step 3: Simplify `executeStep8` to remove mail-polling recovery**

Replace the full `async function executeStep8(state) { ... }` implementation with:

```js
    async function executeStep8(state) {
      try {
        await runStep8Attempt(state);
      } catch (err) {
        throwIfStopped(err);
        throw err;
      }
    }
```

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `node --test tests/background-step7-recovery.test.js`

Expected: PASS for `tests/background-step7-recovery.test.js`.

---

### Task 3: Update Tests That Expected Old Step 8 Mail Polling

**Files:**
- Modify: `tests/background-step7-recovery.test.js`
- Possibly modify: other `tests/*step8*.test.js` only if the focused run reports failures tied to removed Step 8 mail polling.

- [ ] **Step 1: Run Step 8-related tests**

Run: `node --test tests/background-step7-recovery.test.js tests/step8-retry-page-recovery.test.js tests/step8-state-timeout-retry.test.js tests/step8-restart-step7-error.test.js tests/step8-callback-handling.test.js tests/step8-debugger-stop.test.js tests/step8-stop-cleanup.test.js`

Expected: Existing tests that assert email-code polling inside default `executeStep8` may fail. Tests for OAuth consent, retry page helpers, callback, debugger stop, and cleanup should still pass.

- [ ] **Step 2: For any default `executeStep8` test expecting mail polling, update it to expect a hard error or password submit**

Use this rule for edits:

```js
// Old expectation: executeStep8 calls resolveVerificationStep or recovers mail polling.
// New expectation: executeStep8 rejects on verification_page and resolveVerificationStep is not called.
await assert.rejects(
  () => executor.executeStep8(runtimeState),
  /OpenAI 要求登录验证码，已按设置停止，不再获取登录验证码/
);
assert.equal(resolveVerificationStepCalls.length, 0);
```

Use this rule when the old test starts from a password page:

```js
// New expectation: executeStep8 sends the existing oauth-login content command with visibleStep 8.
assert.equal(messages[0].nodeId, 'oauth-login');
assert.equal(messages[0].payload.password, runtimeState.password || runtimeState.customPassword);
assert.equal(messages[0].payload.visibleStep, 8);
```

- [ ] **Step 3: Re-run Step 8-related tests**

Run: `node --test tests/background-step7-recovery.test.js tests/step8-retry-page-recovery.test.js tests/step8-state-timeout-retry.test.js tests/step8-restart-step7-error.test.js tests/step8-callback-handling.test.js tests/step8-debugger-stop.test.js tests/step8-stop-cleanup.test.js`

Expected: PASS.

---

### Task 4: Full Verification

**Files:**
- No planned file changes unless verification exposes regressions.

- [ ] **Step 1: Run the full suite**

Run: `npm test`

Expected: PASS with `# fail 0`.

- [ ] **Step 2: Inspect changed files**

Run: `git diff -- flows/openai/background/steps/fetch-login-code.js tests/background-step7-recovery.test.js docs/superpowers/specs/2026-05-27-step8-password-login-design.md docs/superpowers/plans/2026-05-27-step8-password-login.md`

Expected: Diff only includes the Step 8 password-only implementation, regression tests, and the spec/plan docs.

- [ ] **Step 3: Do not commit unless the user explicitly asks**

This workspace currently appears to have all files untracked. Report verification evidence and remind the user to reload the unpacked Chrome extension after code changes.

---

## Self-Review

- Spec coverage: password-only Step 8 is covered by Task 2; verification-page and phone-verification hard failures are covered by Task 1; no-mail-polling behavior is covered by Task 1 and Task 3; full verification is covered by Task 4.
- Placeholder scan: no placeholders or TODO steps remain.
- Type consistency: helper names and payload fields match existing `sendToContentScriptResilient` and `step6_login` payload conventions.
