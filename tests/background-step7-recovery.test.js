const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('flows/openai/background/steps/fetch-login-code.js', 'utf8');
const globalScope = {};
const api = new Function('self', `${source}; return self.MultiPageBackgroundStep8;`)(globalScope);

test('step 8 stops on login verification without polling or replaying step 7', async () => {
  const calls = {
    ensureReady: 0,
    ensureReadyOptions: [],
    rerunStep7: 0,
    resolveOptions: null,
    setStates: [],
  };
  const realDateNow = Date.now;
  Date.now = () => 123456;

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async (options) => {
      calls.ensureReady += 1;
      calls.ensureReadyOptions.push(options || null);
      return { state: 'verification_page', displayedEmail: 'display.user@example.com' };
    },
    rerunStep7ForStep8Recovery: async () => {
      calls.rerunStep7 += 1;
    },
    getOAuthFlowRemainingMs: async () => 5000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 5000),
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({ email: 'user@example.com', password: 'secret' }),
    getTabId: async (sourceName) => (sourceName === 'openai-auth' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async (_step, _state, _mail, options) => {
      calls.resolveOptions = options;
    },
    reuseOrCreateTab: async () => {},
    setState: async (payload) => {
      calls.setStates.push(payload);
    },
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  try {
    await assert.rejects(
      () => executor.executeStep8({
        email: 'user@example.com',
        password: 'secret',
        oauthUrl: 'https://oauth.example/latest',
      }),
      /OpenAI 要求登录验证码，已按设置停止，不再获取登录验证码/
    );
  } finally {
    Date.now = realDateNow;
  }

  assert.equal(calls.ensureReady, 1);
  assert.equal(calls.rerunStep7, 0);
  assert.equal(calls.resolveOptions, null);
  assert.deepStrictEqual(calls.setStates, []);
  assert.deepStrictEqual(calls.ensureReadyOptions, [
    {
      visibleStep: 8,
      authLoginStep: 7,
      allowPhoneVerificationPage: true,
      allowAddEmailPage: true,
      allowPasswordPage: true,
      timeoutMs: 5000,
    },
  ]);
});

test('step 8 rejects ordinary email verification page in phone login mode', async () => {
  const calls = {
    getMailConfigCalls: 0,
    helperCalls: [],
    completions: [],
    resolveCalls: 0,
  };

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeNodeFromBackground: async (step, payload) => {
      calls.completions.push({ step, payload });
    },
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async () => ({ state: 'verification_page', displayedEmail: 'phone-user@example.com' }),
    getOAuthFlowRemainingMs: async () => 5000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => defaultTimeoutMs,
    getMailConfig: () => {
      calls.getMailConfigCalls += 1;
      return {
        provider: 'qq',
        label: 'QQ 邮箱',
      };
    },
    getState: async () => ({
      accountIdentifierType: 'phone',
      signupPhoneCompletedActivation: {
        activationId: 'signup-done',
        phoneNumber: '66959916439',
      },
    }),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    phoneVerificationHelpers: {
      completeLoginPhoneVerificationFlow: async (tabId, options) => {
        calls.helperCalls.push({ tabId, visibleStep: options.visibleStep, state: options.state });
        return { code: '654321' };
      },
    },
    resolveSignupMethod: () => 'phone',
    resolveVerificationStep: async () => {
      calls.resolveCalls += 1;
    },
    rerunStep7ForStep8Recovery: async () => {
      throw new Error('phone login branch should not rerun step 7 in this test');
    },
    reuseOrCreateTab: async () => {},
    setState: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeStep8({
      visibleStep: 8,
      accountIdentifierType: 'phone',
      signupPhoneCompletedActivation: {
        activationId: 'signup-done',
        phoneNumber: '66959916439',
      },
      oauthUrl: 'https://oauth.example/latest',
    }),
    /OpenAI 要求登录验证码，已按设置停止，不再获取登录验证码/
  );

  assert.equal(calls.getMailConfigCalls, 0);
  assert.equal(calls.resolveCalls, 0);
  assert.deepStrictEqual(calls.helperCalls, []);
  assert.deepStrictEqual(calls.completions, []);
});

test('step 8 stops on phone verification page without sms helper', async () => {
  const calls = {
    getMailConfigCalls: 0,
    helperCalls: [],
    completions: [],
  };

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeNodeFromBackground: async (step, payload) => {
      calls.completions.push({ step, payload });
    },
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async () => ({ state: 'phone_verification_page' }),
    getOAuthFlowRemainingMs: async () => 5000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => defaultTimeoutMs,
    getMailConfig: () => {
      calls.getMailConfigCalls += 1;
      return {
        provider: 'qq',
        label: 'QQ 邮箱',
      };
    },
    getState: async () => ({}),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    phoneVerificationHelpers: {
      completeLoginPhoneVerificationFlow: async (tabId, options) => {
        calls.helperCalls.push({ tabId, visibleStep: options.visibleStep, state: options.state });
        return { code: '654321' };
      },
    },
    resolveVerificationStep: async () => {
      throw new Error('real phone verification branch should not call email verification flow');
    },
    rerunStep7ForStep8Recovery: async () => {
      throw new Error('real phone verification branch should not rerun step 7 in this test');
    },
    reuseOrCreateTab: async () => {},
    setState: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeStep8({
      visibleStep: 8,
      accountIdentifierType: 'phone',
      oauthUrl: 'https://oauth.example/latest',
    }),
    /OpenAI 要求手机登录验证码，已按设置停止，不再获取登录验证码/
  );

  assert.equal(calls.getMailConfigCalls, 0);
  assert.deepStrictEqual(calls.helperCalls, []);
  assert.deepStrictEqual(calls.completions, []);
});

test('post-login phone verification completes only on phone pages', async () => {
  const calls = {
    helperCalls: [],
    completions: [],
  };

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    completeNodeFromBackground: async (step, payload) => {
      calls.completions.push({ step, payload });
    },
    ensureStep8VerificationPageReady: async () => {
      throw new Error('post-login phone step should inspect auth state directly');
    },
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => defaultTimeoutMs,
    getState: async () => ({}),
    getTabId: async () => 1,
    phoneVerificationHelpers: {
      completePhoneVerificationFlow: async (tabId, pageState, options) => {
        calls.helperCalls.push({ tabId, pageState, options });
        return { code: '112233' };
      },
    },
    reuseOrCreateTab: async () => 1,
    sendToContentScriptResilient: async () => ({
      state: 'add_phone_page',
      url: 'https://auth.openai.com/add-phone',
    }),
    setState: async () => {},
    throwIfStopped: () => {},
  });

  await executor.executePostLoginPhoneVerification({
    visibleStep: 9,
    nodeId: 'post-login-phone-verification',
    phoneVerificationEnabled: true,
    oauthUrl: 'https://oauth.example/latest',
  });

  assert.deepStrictEqual(calls.helperCalls, [
    {
      tabId: 1,
      pageState: {
        state: 'add_phone_page',
        url: 'https://auth.openai.com/add-phone',
      },
      options: {
        step: 9,
        visibleStep: 9,
      },
    },
  ]);
  assert.deepStrictEqual(calls.completions, [
    {
      step: 'post-login-phone-verification',
      payload: {
        phoneVerification: true,
        postLoginPhoneVerification: true,
        code: '112233',
      },
    },
  ]);
});

test('post-login phone verification skips on OAuth consent and errors when disabled', async () => {
  const completions = [];
  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    completeNodeFromBackground: async (step, payload) => {
      completions.push({ step, payload });
    },
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => defaultTimeoutMs,
    getTabId: async () => 1,
    phoneVerificationHelpers: {
      completePhoneVerificationFlow: async () => {
        throw new Error('OAuth consent should not call phone helper');
      },
    },
    reuseOrCreateTab: async () => 1,
    sendToContentScriptResilient: async () => ({ state: 'oauth_consent_page' }),
    setState: async () => {},
    throwIfStopped: () => {},
  });

  await executor.executePostLoginPhoneVerification({
    visibleStep: 9,
    nodeId: 'post-login-phone-verification',
    phoneVerificationEnabled: true,
    oauthUrl: 'https://oauth.example/latest',
  });

  assert.deepStrictEqual(completions, [
    {
      step: 'post-login-phone-verification',
      payload: {
        directOAuthConsentPage: true,
        phoneVerification: false,
      },
    },
  ]);

  const disabledExecutor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => defaultTimeoutMs,
    getTabId: async () => 1,
    phoneVerificationHelpers: {
      completePhoneVerificationFlow: async () => {
        throw new Error('disabled phone verification should not call helper');
      },
    },
    reuseOrCreateTab: async () => 1,
    sendToContentScriptResilient: async () => ({
      state: 'phone_verification_page',
      url: 'https://auth.openai.com/phone-verification',
    }),
    setState: async () => {},
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => disabledExecutor.executePostLoginPhoneVerification({
      visibleStep: 9,
      phoneVerificationEnabled: false,
      oauthUrl: 'https://oauth.example/latest',
    }),
    /手机接码未开启/
  );
});

test('step 8 defers add-email page in phone mode without submitting email', async () => {
  const calls = {
    contentMessages: [],
    completions: [],
    resolvedStates: [],
    setStates: [],
    mailStates: [],
    persistCalls: [],
  };

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeNodeFromBackground: async (step, payload) => {
      calls.completions.push({ step, payload });
    },
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async () => ({ state: 'add_email_page', url: 'https://auth.openai.com/add-email' }),
    getOAuthFlowRemainingMs: async () => 5000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => defaultTimeoutMs,
    getMailConfig: (state) => {
      calls.mailStates.push(state);
      return {
        provider: 'qq',
        label: 'QQ 邮箱',
        source: 'mail-qq',
        url: 'https://mail.qq.com',
        navigateOnReuse: false,
      };
    },
    getState: async () => ({
      email: '',
      password: 'secret',
      oauthUrl: 'https://oauth.example/latest',
    }),
    getTabId: async (sourceName) => (sourceName === 'openai-auth' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    persistRegistrationEmailState: async (state, email, options) => {
      calls.persistCalls.push({ state, email, options });
    },
    resolveSignupEmailForFlow: async (state, options = {}) => {
      calls.resolvedStates.push(state);
      calls.resolveOptions = options;
      return 'new.user@example.com';
    },
    resolveVerificationStep: async (_step, state, _mail, options) => {
      calls.resolvedVerification = { state, options };
    },
    rerunStep7ForStep8Recovery: async () => {},
    reuseOrCreateTab: async () => {},
    sendToContentScriptResilient: async (_source, message) => {
      calls.contentMessages.push(message);
      assert.equal(message.type, 'SUBMIT_ADD_EMAIL');
      assert.equal(message.payload.email, 'new.user@example.com');
      return {
        submitted: true,
        displayedEmail: 'new.user@example.com',
        url: 'https://auth.openai.com/email-verification',
      };
    },
    setState: async (payload) => {
      calls.setStates.push(payload);
    },
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await executor.executeStep8({
    visibleStep: 8,
    accountIdentifierType: 'phone',
    signupPhoneNumber: '+447780579093',
    oauthUrl: 'https://oauth.example/latest',
  });

  assert.equal(calls.contentMessages.length, 0);
  assert.equal(calls.resolvedStates.length, 0);
  assert.equal(calls.persistCalls.length, 0);
  assert.equal(calls.mailStates.length, 0);
  assert.deepStrictEqual(calls.setStates, [
    {
      step8VerificationTargetEmail: '',
      loginVerificationRequestedAt: null,
    },
  ]);
  assert.deepStrictEqual(calls.completions, [
    {
      step: 'fetch-login-code',
      payload: {
        loginVerificationRequestedAt: null,
        skipLoginVerificationStep: true,
        addEmailPage: true,
      },
    },
  ]);
});

test('bind-email submits add-email and requires an email verification page', async () => {
  const calls = {
    contentMessages: [],
    completions: [],
    persistCalls: [],
    setStates: [],
  };
  let runtimeState = {
    email: '',
    password: 'secret',
    oauthUrl: 'https://oauth.example/latest',
  };

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    completeNodeFromBackground: async (step, payload) => {
      calls.completions.push({ step, payload });
    },
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => defaultTimeoutMs,
    getState: async () => ({ ...runtimeState }),
    getTabId: async () => 1,
    persistRegistrationEmailState: async (state, email, options) => {
      calls.persistCalls.push({ state, email, options });
      runtimeState = {
        ...runtimeState,
        email,
      };
    },
    resolveSignupEmailForFlow: async (_state, options = {}) => {
      assert.equal(options.preserveAccountIdentity, true);
      return 'bind.user@example.com';
    },
    reuseOrCreateTab: async () => 1,
    sendToContentScriptResilient: async (_source, message) => {
      if (message.type === 'GET_LOGIN_AUTH_STATE') {
        return { state: 'add_email_page', url: 'https://auth.openai.com/add-email' };
      }
      calls.contentMessages.push(message);
      assert.equal(message.type, 'SUBMIT_ADD_EMAIL');
      assert.equal(message.payload.email, 'bind.user@example.com');
      return {
        submitted: true,
        displayedEmail: 'bind.user@example.com',
        url: 'https://auth.openai.com/email-verification',
      };
    },
    setState: async (payload) => {
      calls.setStates.push(payload);
      runtimeState = {
        ...runtimeState,
        ...payload,
      };
    },
    throwIfStopped: () => {},
  });

  await executor.executeBindEmail({
    visibleStep: 9,
    nodeId: 'bind-email',
    oauthUrl: 'https://oauth.example/latest',
  });

  assert.equal(calls.contentMessages.length, 1);
  assert.equal(calls.persistCalls.length, 1);
  assert.equal(calls.persistCalls[0].options.source, 'bind_email');
  assert.deepStrictEqual(calls.completions, [
    {
      step: 'bind-email',
      payload: {
        bindEmailSubmitted: true,
        email: 'bind.user@example.com',
        step8VerificationTargetEmail: 'bind.user@example.com',
      },
    },
  ]);
});

test('bind-email skips on OAuth consent and rejects direct OAuth after submit', async () => {
  const completions = [];
  const skipExecutor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    completeNodeFromBackground: async (step, payload) => {
      completions.push({ step, payload });
    },
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => defaultTimeoutMs,
    getTabId: async () => 1,
    reuseOrCreateTab: async () => 1,
    sendToContentScriptResilient: async () => ({ state: 'oauth_consent_page' }),
    setState: async () => {},
    throwIfStopped: () => {},
  });

  await skipExecutor.executeBindEmail({
    visibleStep: 9,
    nodeId: 'bind-email',
    oauthUrl: 'https://oauth.example/latest',
  });
  assert.deepStrictEqual(completions, [
    {
      step: 'bind-email',
      payload: {
        directOAuthConsentPage: true,
        bindEmailSubmitted: false,
      },
    },
  ]);

  const directOauthExecutor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => defaultTimeoutMs,
    getState: async () => ({ email: '', oauthUrl: 'https://oauth.example/latest' }),
    getTabId: async () => 1,
    resolveSignupEmailForFlow: async () => 'bind.user@example.com',
    reuseOrCreateTab: async () => 1,
    sendToContentScriptResilient: async (_source, message) => {
      if (message.type === 'GET_LOGIN_AUTH_STATE') {
        return { state: 'add_email_page', url: 'https://auth.openai.com/add-email' };
      }
      return {
        submitted: true,
        directOAuthConsentPage: true,
        url: 'https://auth.openai.com/authorize',
      };
    },
    setState: async () => {},
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => directOauthExecutor.executeBindEmail({
      visibleStep: 9,
      oauthUrl: 'https://oauth.example/latest',
    }),
    /绑定邮箱提交后必须进入邮箱验证码页/
  );
});

test('fetch-bind-email-code polls only after bind-email submitted', async () => {
  const calls = {
    resolveOptions: null,
    setStates: [],
  };
  const realDateNow = Date.now;
  Date.now = () => 222000;

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    confirmCustomVerificationStepBypass: async () => {},
    getOAuthFlowRemainingMs: async () => 9000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => defaultTimeoutMs,
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async (_step, _state, _mail, options) => {
      calls.resolveOptions = options;
    },
    reuseOrCreateTab: async () => 1,
    sendToContentScriptResilient: async () => ({
      state: 'verification_page',
      displayedEmail: 'bind.user@example.com',
      url: 'https://auth.openai.com/email-verification',
    }),
    setState: async (payload) => {
      calls.setStates.push(payload);
    },
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    throwIfStopped: () => {},
  });

  try {
    await executor.executeFetchBindEmailCode({
      visibleStep: 10,
      nodeId: 'fetch-bind-email-code',
      bindEmailSubmitted: true,
      email: 'bind.user@example.com',
      oauthUrl: 'https://oauth.example/latest',
    });
  } finally {
    Date.now = realDateNow;
  }

  assert.equal(calls.resolveOptions.completionStep, 10);
  assert.equal(calls.resolveOptions.sessionKey, '10:222000');
  assert.equal(calls.resolveOptions.targetEmail, 'bind.user@example.com');
  assert.deepStrictEqual(calls.setStates, [
    {
      step8VerificationTargetEmail: 'bind.user@example.com',
    },
  ]);
});

test('fetch-bind-email-code rejects unexpected pages after bind-email submitted', async () => {
  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => defaultTimeoutMs,
    getTabId: async () => 1,
    reuseOrCreateTab: async () => 1,
    sendToContentScriptResilient: async () => ({
      state: 'oauth_consent_page',
      url: 'https://auth.openai.com/authorize',
    }),
    setState: async () => {},
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeFetchBindEmailCode({
      visibleStep: 10,
      bindEmailSubmitted: true,
      oauthUrl: 'https://oauth.example/latest',
    }),
    /绑定邮箱提交后不应直接进入 OAuth 授权页/
  );

  const notSubmittedCompletions = [];
  const skipExecutor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    completeNodeFromBackground: async (step, payload) => {
      notSubmittedCompletions.push({ step, payload });
    },
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => defaultTimeoutMs,
    getTabId: async () => 1,
    reuseOrCreateTab: async () => 1,
    sendToContentScriptResilient: async () => ({ state: 'oauth_consent_page' }),
    setState: async () => {},
    throwIfStopped: () => {},
  });

  await skipExecutor.executeFetchBindEmailCode({
    visibleStep: 10,
    nodeId: 'fetch-bind-email-code',
    bindEmailSubmitted: false,
    oauthUrl: 'https://oauth.example/latest',
  });
  assert.deepStrictEqual(notSubmittedCompletions, [
    {
      step: 'fetch-bind-email-code',
      payload: {
        directOAuthConsentPage: true,
        bindEmailCodeSkipped: true,
      },
    },
  ]);
});

test('fetch-bound-email-login-code uses bound email identity and does not allow add-email', async () => {
  const calls = {
    ensureOptions: null,
    resolveState: null,
    resolveOptions: null,
    setStates: [],
  };
  const realDateNow = Date.now;
  Date.now = () => 333000;

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async (options) => {
      calls.ensureOptions = options;
      return {
        state: 'verification_page',
        displayedEmail: 'bind.user@example.com',
        url: 'https://auth.openai.com/email-verification',
      };
    },
    getOAuthFlowRemainingMs: async () => 9000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => defaultTimeoutMs,
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async (_step, state, _mail, options) => {
      calls.resolveState = state;
      calls.resolveOptions = options;
    },
    reuseOrCreateTab: async () => 1,
    setState: async (payload) => {
      calls.setStates.push(payload);
    },
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    throwIfStopped: () => {},
  });

  try {
    await executor.executeBoundEmailLoginCode({
      visibleStep: 11,
      nodeId: 'fetch-bound-email-login-code',
      signupMethod: 'phone',
      resolvedSignupMethod: 'phone',
      accountIdentifierType: 'phone',
      accountIdentifier: '+447780579093',
      signupPhoneNumber: '+447780579093',
      email: 'bind.user@example.com',
      step8VerificationTargetEmail: 'bind.user@example.com',
      oauthUrl: 'https://oauth.example/latest',
    });
  } finally {
    Date.now = realDateNow;
  }

  assert.equal(calls.ensureOptions.allowAddEmailPage, false);
  assert.equal(calls.ensureOptions.allowPhoneVerificationPage, true);
  assert.equal(calls.resolveState.signupMethod, 'email');
  assert.equal(calls.resolveState.resolvedSignupMethod, 'email');
  assert.equal(calls.resolveState.accountIdentifierType, 'email');
  assert.equal(calls.resolveState.accountIdentifier, 'bind.user@example.com');
  assert.equal(calls.resolveOptions.completionStep, 11);
  assert.equal(calls.resolveOptions.sessionKey, '11:333000');
  assert.equal(calls.resolveOptions.targetEmail, 'bind.user@example.com');
  assert.deepStrictEqual(calls.setStates, [
    {
      step8VerificationTargetEmail: 'bind.user@example.com',
    },
  ]);
});

test('fetch-bound-email-login-code defers phone pages to bound-email phone verification step', async () => {
  const completions = [];
  const setStates = [];
  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    completeNodeFromBackground: async (step, payload) => {
      completions.push({ step, payload });
    },
    ensureStep8VerificationPageReady: async () => ({
      state: 'add_phone_page',
      addPhonePage: true,
      url: 'https://auth.openai.com/add-phone',
    }),
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => defaultTimeoutMs,
    getTabId: async () => 1,
    reuseOrCreateTab: async () => 1,
    setState: async (payload) => {
      setStates.push(payload);
    },
    throwIfStopped: () => {},
  });

  await executor.executeBoundEmailLoginCode({
    visibleStep: 11,
    nodeId: 'fetch-bound-email-login-code',
    email: 'bind.user@example.com',
    step8VerificationTargetEmail: 'bind.user@example.com',
    oauthUrl: 'https://oauth.example/latest',
  });

  assert.deepStrictEqual(setStates, [
    {
      step8VerificationTargetEmail: '',
      loginVerificationRequestedAt: null,
    },
  ]);
  assert.deepStrictEqual(completions, [
    {
      step: 'fetch-bound-email-login-code',
      payload: {
        loginVerificationRequestedAt: null,
        skipLoginVerificationStep: true,
        addPhonePage: true,
        phoneVerificationPage: false,
      },
    },
  ]);
});

test('step 8 defers add-email page to bind-email node', async () => {
  const calls = {
    ensureCalls: 0,
    resolveCalls: 0,
    rerunStates: [],
    contentMessages: [],
    completions: [],
    setStates: [],
  };
  let runtimeState = {
    visibleStep: 8,
    email: '',
    password: 'secret',
    oauthUrl: 'https://oauth.example/latest',
    accountIdentifierType: 'phone',
    accountIdentifier: '+447780579093',
    signupMethod: 'phone',
    resolvedSignupMethod: 'phone',
    phoneVerificationEnabled: true,
    signupPhoneNumber: '+447780579093',
    signupPhoneCompletedActivation: {
      activationId: 'signup-done',
      phoneNumber: '+447780579093',
    },
  };

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeNodeFromBackground: async (step, payload) => {
      calls.completions.push({ step, payload });
    },
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async () => {
      calls.ensureCalls += 1;
      if (calls.ensureCalls === 1) {
        return { state: 'add_email_page', url: 'https://auth.openai.com/add-email' };
      }
      return { state: 'verification_page', displayedEmail: 'new.user@example.com' };
    },
    getOAuthFlowRemainingMs: async () => 8000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 8000),
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 閭',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({ ...runtimeState }),
    getTabId: async (sourceName) => (sourceName === 'openai-auth' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    persistRegistrationEmailState: async (_state, email, options) => {
      assert.equal(email, 'new.user@example.com');
      assert.equal(options.preserveAccountIdentity, true);
      runtimeState = {
        ...runtimeState,
        email,
      };
    },
    resolveSignupEmailForFlow: async (_state, options = {}) => {
      assert.equal(options.preserveAccountIdentity, true);
      runtimeState = {
        ...runtimeState,
        email: 'new.user@example.com',
        accountIdentifierType: 'phone',
        accountIdentifier: '+447780579093',
        signupPhoneNumber: '+447780579093',
      };
      return 'new.user@example.com';
    },
    resolveVerificationStep: async () => {
      calls.resolveCalls += 1;
      if (calls.resolveCalls === 1) {
        throw new Error('STEP8_RESTART_STEP7::step 8 verification page fell into login timeout retry state');
      }
    },
    rerunStep7ForStep8Recovery: async () => {
      calls.rerunStates.push({ ...runtimeState });
    },
    reuseOrCreateTab: async () => {},
    sendToContentScriptResilient: async (_source, message) => {
      calls.contentMessages.push(message);
      return {
        submitted: true,
        displayedEmail: 'new.user@example.com',
        url: 'https://auth.openai.com/email-verification',
      };
    },
    setState: async (payload) => {
      calls.setStates.push(payload);
      runtimeState = {
        ...runtimeState,
        ...payload,
      };
    },
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await executor.executeStep8({ ...runtimeState });

  assert.equal(calls.ensureCalls, 1);
  assert.equal(calls.contentMessages.length, 0);
  assert.equal(calls.resolveCalls, 0);
  assert.equal(calls.rerunStates.length, 0);
  assert.deepStrictEqual(calls.setStates, [
    {
      step8VerificationTargetEmail: '',
      loginVerificationRequestedAt: null,
    },
  ]);
  assert.deepStrictEqual(calls.completions, [
    {
      step: 'fetch-login-code',
      payload: {
        loginVerificationRequestedAt: null,
        skipLoginVerificationStep: true,
        addEmailPage: true,
      },
    },
  ]);
});

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
    passwordOnly: true,
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

test('step 8 preserves raw custom password value when submitting password login', async () => {
  const events = {
    contentMessages: [],
  };

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    completeNodeFromBackground: async () => {},
    ensureStep8VerificationPageReady: async () => ({
      state: 'password_page',
      url: 'https://auth.openai.com/log-in/password',
    }),
    getOAuthFlowStepTimeoutMs: async (fallback) => fallback,
    getState: async () => ({ password: '', customPassword: '  Secret123!  ' }),
    getTabId: async () => 88,
    isVerificationMailPollingError: () => false,
    reuseOrCreateTab: async () => 88,
    sendToContentScriptResilient: async (_source, message) => {
      events.contentMessages.push(message);
      return {
        directOAuthConsentPage: true,
        skipLoginVerificationStep: true,
        state: 'oauth_consent_page',
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
    password: '',
    customPassword: '  Secret123!  ',
    oauthUrl: 'https://auth.openai.com/oauth',
  });

  assert.equal(events.contentMessages.length, 1);
  assert.equal(events.contentMessages[0].payload.password, '  Secret123!  ');
});

test('step 8 prefers raw custom password value when both passwords are set', async () => {
  const events = {
    contentMessages: [],
  };

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    completeNodeFromBackground: async () => {},
    ensureStep8VerificationPageReady: async () => ({
      state: 'password_page',
      url: 'https://auth.openai.com/log-in/password',
    }),
    getOAuthFlowStepTimeoutMs: async (fallback) => fallback,
    getState: async () => ({ password: '  PrimarySecret123!  ', customPassword: '  CustomSecret123!  ' }),
    getTabId: async () => 88,
    isVerificationMailPollingError: () => false,
    reuseOrCreateTab: async () => 88,
    sendToContentScriptResilient: async (_source, message) => {
      events.contentMessages.push(message);
      return {
        directOAuthConsentPage: true,
        skipLoginVerificationStep: true,
        state: 'oauth_consent_page',
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
    password: '  PrimarySecret123!  ',
    customPassword: '  CustomSecret123!  ',
    oauthUrl: 'https://auth.openai.com/oauth',
  });

  assert.equal(events.contentMessages.length, 1);
  assert.equal(events.contentMessages[0].payload.password, '  CustomSecret123!  ');
  assert.equal(events.contentMessages[0].payload.passwordOnly, true);
});

test('step 8 preserves raw primary password value when custom password is absent', async () => {
  const events = {
    contentMessages: [],
  };

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: { tabs: { update: async () => {} } },
    completeNodeFromBackground: async () => {},
    ensureStep8VerificationPageReady: async () => ({
      state: 'password_page',
      url: 'https://auth.openai.com/log-in/password',
    }),
    getOAuthFlowStepTimeoutMs: async (fallback) => fallback,
    getState: async () => ({ password: '  PrimarySecret123!  ' }),
    getTabId: async () => 88,
    isVerificationMailPollingError: () => false,
    reuseOrCreateTab: async () => 88,
    sendToContentScriptResilient: async (_source, message) => {
      events.contentMessages.push(message);
      return {
        directOAuthConsentPage: true,
        skipLoginVerificationStep: true,
        state: 'oauth_consent_page',
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
    password: '  PrimarySecret123!  ',
    oauthUrl: 'https://auth.openai.com/oauth',
  });

  assert.equal(events.contentMessages.length, 1);
  assert.equal(events.contentMessages[0].payload.password, '  PrimarySecret123!  ');
  assert.equal(events.contentMessages[0].payload.passwordOnly, true);
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

test('step 8 rejects add-email page in email login mode', async () => {
  const calls = {
    resolveCalls: 0,
    rerunStates: [],
  };
  let runtimeState = {
    visibleStep: 8,
    email: '',
    password: 'secret',
    oauthUrl: 'https://oauth.example/latest',
    accountIdentifierType: 'email',
    accountIdentifier: 'stale@example.com',
    signupMethod: 'phone',
    resolvedSignupMethod: 'phone',
    phoneVerificationEnabled: true,
    signupPhoneNumber: '',
  };

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async () => ({ state: 'add_email_page', url: 'https://auth.openai.com/add-email' }),
    getOAuthFlowRemainingMs: async () => 8000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 8000),
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({ ...runtimeState }),
    getTabId: async (sourceName) => (sourceName === 'openai-auth' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    persistRegistrationEmailState: async (_state, email, options) => {
      assert.equal(email, 'new.user@example.com');
      assert.equal(options.preserveAccountIdentity, true);
      runtimeState = {
        ...runtimeState,
        email,
        accountIdentifierType: 'phone',
        accountIdentifier: '+447780579093',
        signupPhoneNumber: '+447780579093',
        signupPhoneCompletedActivation: {
          activationId: 'signup-done',
          phoneNumber: '+447780579093',
        },
      };
    },
    resolveSignupEmailForFlow: async (_state, options = {}) => {
      assert.equal(options.preserveAccountIdentity, true);
      return 'new.user@example.com';
    },
    resolveVerificationStep: async (_step, state) => {
      calls.resolveCalls += 1;
      assert.equal(state.accountIdentifierType, 'phone');
      assert.equal(state.signupPhoneNumber, '+447780579093');
      throw new Error('STEP8_RESTART_STEP7::step 8 verification page fell into login timeout retry state');
    },
    rerunStep7ForStep8Recovery: async () => {
      calls.rerunStates.push({ ...runtimeState });
    },
    reuseOrCreateTab: async () => {},
    sendToContentScriptResilient: async () => ({
      submitted: true,
      displayedEmail: 'new.user@example.com',
      url: 'https://auth.openai.com/email-verification',
    }),
    setState: async (payload) => {
      runtimeState = {
        ...runtimeState,
        ...payload,
      };
    },
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 2,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeStep8({ ...runtimeState }),
    /Step 8 只改用密码登录，不处理添加邮箱页/
  );

  assert.equal(calls.resolveCalls, 0);
  assert.equal(calls.rerunStates.length, 0);
});

test('step 8 does not run add-email email_in_use recovery in email login mode', async () => {
  const calls = {
    contentCalls: 0,
    setStates: [],
    updatedUrls: [],
  };

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async (_tabId, payload) => {
          calls.updatedUrls.push(payload.url);
        },
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async () => ({
      state: 'add_email_page',
      url: 'https://auth.openai.com/add-email',
    }),
    getOAuthFlowRemainingMs: async () => 5000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => defaultTimeoutMs,
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 閭',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({
      email: '',
      registrationEmailState: {
        current: '',
        previous: 'old.user@example.com',
        source: 'step8_recovery',
        updatedAt: 123,
      },
      oauthUrl: 'https://auth.openai.com/add-email',
      password: 'secret',
    }),
    getTabId: async () => 1,
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveSignupEmailForFlow: async () => 'new.user@example.com',
    resolveVerificationStep: async () => {},
    rerunStep7ForStep8Recovery: async () => {},
    reuseOrCreateTab: async () => {},
    sendToContentScriptResilient: async () => {
      calls.contentCalls += 1;
      if (calls.contentCalls === 1) {
        throw new Error('STEP8_EMAIL_IN_USE::old.user@example.com');
      }
      return {
        submitted: true,
        displayedEmail: 'new.user@example.com',
        url: 'https://auth.openai.com/email-verification',
      };
    },
    setState: async (payload) => {
      calls.setStates.push(payload);
    },
    shouldUseCustomRegistrationEmail: () => false,
    sleepWithStop: async () => {},
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 3,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeStep8({
      email: 'old.user@example.com',
      registrationEmailState: {
        current: 'old.user@example.com',
        previous: 'old.user@example.com',
        source: 'generated:duck',
        updatedAt: 1,
      },
      oauthUrl: 'https://auth.openai.com/add-email',
      password: 'secret',
      visibleStep: 8,
    }),
    /Step 8 只改用密码登录，不处理添加邮箱页/
  );

  assert.equal(calls.contentCalls, 0);
  assert.deepStrictEqual(calls.setStates, []);
});

test('Plus login-code step stops on login verification with visible step 11', async () => {
  let resolvedStep = null;
  let resolvedOptions = null;
  let readyOptions = null;
  const remainingStepCalls = [];

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async (options) => {
      readyOptions = options;
      return { state: 'verification_page', displayedEmail: 'plus.user@example.com' };
    },
    rerunStep7ForStep8Recovery: async () => {},
    getOAuthFlowRemainingMs: async (details) => {
      remainingStepCalls.push(details.step);
      return 9000;
    },
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs, details) => {
      remainingStepCalls.push(details.step);
      return Math.min(defaultTimeoutMs, 9000);
    },
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({ email: 'user@example.com', password: 'secret', plusModeEnabled: true }),
    getTabId: async (sourceName) => (sourceName === 'openai-auth' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async (step, _state, _mail, options) => {
      resolvedStep = step;
      resolvedOptions = options;
      await options.getRemainingTimeMs({ actionLabel: '登录验证码流程' });
    },
    reuseOrCreateTab: async () => {},
    setState: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeStep8({
      visibleStep: 11,
      plusModeEnabled: true,
      email: 'user@example.com',
      password: 'secret',
      oauthUrl: 'https://oauth.example/latest',
    }),
    /步骤 11：OpenAI 要求登录验证码，已按设置停止，不再获取登录验证码/
  );

  assert.equal(resolvedStep, null);
  assert.equal(resolvedOptions, null);
  assert.deepStrictEqual(readyOptions, {
    visibleStep: 11,
    authLoginStep: 10,
    allowPhoneVerificationPage: true,
    allowAddEmailPage: true,
    allowPasswordPage: true,
    timeoutMs: 9000,
  });
  assert.deepStrictEqual(remainingStepCalls, [11]);
});

test('bound-email relogin code step points recovery to the relogin step in Plus mode', async () => {
  let resolvedStep = null;
  let resolvedOptions = null;
  let readyOptions = null;
  const remainingStepCalls = [];

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async (options) => {
      readyOptions = options;
      return { state: 'verification_page', displayedEmail: 'bound.user@example.com' };
    },
    rerunStep7ForStep8Recovery: async () => {},
    getOAuthFlowRemainingMs: async (details) => {
      remainingStepCalls.push(details.step);
      return 9000;
    },
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs, details) => {
      remainingStepCalls.push(details.step);
      return Math.min(defaultTimeoutMs, 9000);
    },
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({
      email: 'bound.user@example.com',
      password: 'secret',
      plusModeEnabled: true,
      signupMethod: 'phone',
      phoneSignupReloginAfterBindEmailEnabled: true,
    }),
    getTabId: async (sourceName) => (sourceName === 'openai-auth' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async (step, _state, _mail, options) => {
      resolvedStep = step;
      resolvedOptions = options;
      await options.getRemainingTimeMs({ actionLabel: '绑定邮箱后登录验证码流程' });
    },
    reuseOrCreateTab: async () => {},
    setState: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await executor.executeBoundEmailLoginCode({
    visibleStep: 14,
    plusModeEnabled: true,
    signupMethod: 'phone',
    phoneSignupReloginAfterBindEmailEnabled: true,
    email: 'bound.user@example.com',
    password: 'secret',
    oauthUrl: 'https://oauth.example/latest',
    step8VerificationTargetEmail: 'bound.user@example.com',
  });

  assert.equal(resolvedStep, 8);
  assert.equal(resolvedOptions.completionStep, 14);
  assert.equal(resolvedOptions.targetEmail, 'bound.user@example.com');
  assert.deepStrictEqual(readyOptions, {
    visibleStep: 14,
    authLoginStep: 13,
    allowPhoneVerificationPage: true,
    allowAddEmailPage: false,
    timeoutMs: 9000,
  });
  assert.deepStrictEqual(remainingStepCalls, [14, 14]);
});

test('step 8 completes directly when auth page is already on OAuth consent page', async () => {
  const events = {
    resolveCalls: 0,
    completeCalls: [],
    setStates: [],
    rerunStep7: 0,
  };

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeNodeFromBackground: async (step, payload) => {
      events.completeCalls.push({ step, payload });
    },
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async () => ({
      state: 'oauth_consent_page',
    }),
    rerunStep7ForStep8Recovery: async () => {
      events.rerunStep7 += 1;
    },
    getOAuthFlowRemainingMs: async () => 9000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 9000),
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({ email: 'user@example.com', password: 'secret' }),
    getTabId: async (sourceName) => (sourceName === 'openai-auth' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async () => {
      events.resolveCalls += 1;
    },
    reuseOrCreateTab: async () => {},
    setState: async (payload) => {
      events.setStates.push(payload);
    },
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await executor.executeStep8({
    email: 'user@example.com',
    password: 'secret',
    oauthUrl: 'https://oauth.example/latest',
  });

  assert.equal(events.resolveCalls, 0);
  assert.equal(events.rerunStep7, 0);
  assert.deepStrictEqual(events.setStates, [
    {
      step8VerificationTargetEmail: '',
      loginVerificationRequestedAt: null,
    },
  ]);
  assert.deepStrictEqual(events.completeCalls, [
    {
      step: 'fetch-login-code',
      payload: {
        loginVerificationRequestedAt: null,
        skipLoginVerificationStep: true,
        directOAuthConsentPage: true,
      },
    },
  ]);
});

test('step 8 does not retry in-place when auth page stays on verification page', async () => {
  const events = {
    ensureCalls: 0,
    resolveCalls: 0,
    rerunStep7: 0,
  };
  const pageStates = [
    { state: 'verification_page', displayedEmail: 'user@example.com' },
    { state: 'verification_page', displayedEmail: 'user@example.com' },
    { state: 'verification_page', displayedEmail: 'user@example.com' },
  ];

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeNodeFromBackground: async () => {},
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async () => {
      events.ensureCalls += 1;
      return pageStates[Math.min(events.ensureCalls - 1, pageStates.length - 1)];
    },
    rerunStep7ForStep8Recovery: async () => {
      events.rerunStep7 += 1;
    },
    getOAuthFlowRemainingMs: async () => 9000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 9000),
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({ email: 'user@example.com', password: 'secret' }),
    getTabId: async (sourceName) => (sourceName === 'openai-auth' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: (error) => /页面通信异常|did not respond/i.test(String(error?.message || error || '')),
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async () => {
      events.resolveCalls += 1;
      if (events.resolveCalls === 1) {
        throw new Error('步骤 8：页面通信异常 did not respond in 30s');
      }
    },
    reuseOrCreateTab: async () => {},
    setState: async () => {},
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeStep8({
      email: 'user@example.com',
      password: 'secret',
      oauthUrl: 'https://oauth.example/latest',
    }),
    /OpenAI 要求登录验证码，已按设置停止，不再获取登录验证码/
  );

  assert.equal(events.resolveCalls, 0);
  assert.equal(events.rerunStep7, 0);
  assert.equal(events.ensureCalls, 1);
});

test('step 8 does not maintain resend cooldown because default path no longer polls', async () => {
  const events = {
    resolveCalls: 0,
    resolveLastResendAts: [],
    sleepMs: [],
  };
  const realDateNow = Date.now;
  Date.now = () => 230000;

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeNodeFromBackground: async () => {},
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async () => ({ state: 'verification_page', displayedEmail: 'user@example.com' }),
    rerunStep7ForStep8Recovery: async () => {},
    getOAuthFlowRemainingMs: async () => 9000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 9000),
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({ email: 'user@example.com', password: 'secret', loginVerificationRequestedAt: null }),
    getTabId: async (sourceName) => (sourceName === 'openai-auth' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: (error) => /页面通信异常|did not respond/i.test(String(error?.message || error || '')),
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async (_step, _state, _mail, options) => {
      events.resolveCalls += 1;
      events.resolveLastResendAts.push(Number(options?.lastResendAt) || 0);
      if (events.resolveCalls === 1) {
        await options.onResendRequestedAt(222000);
        throw new Error('步骤 8：页面通信异常 did not respond in 1s');
      }
    },
    reuseOrCreateTab: async () => {},
    setState: async () => {},
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    sleepWithStop: async (ms) => {
      events.sleepMs.push(ms);
    },
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  try {
    await assert.rejects(
      () => executor.executeStep8({
        email: 'user@example.com',
        password: 'secret',
        oauthUrl: 'https://oauth.example/latest',
      }),
      /OpenAI 要求登录验证码，已按设置停止，不再获取登录验证码/
    );
  } finally {
    Date.now = realDateNow;
  }

  assert.equal(events.resolveCalls, 0);
  assert.deepStrictEqual(events.resolveLastResendAts, []);
  assert.deepStrictEqual(events.sleepMs, []);
});

test('step 8 stops on verification page without polling recovery probe', async () => {
  const events = {
    ensureCalls: 0,
    resolveCalls: 0,
    rerunStep7: 0,
    completeCalls: [],
  };
  const pageStates = [
    { state: 'verification_page', displayedEmail: 'user@example.com' },
    { state: 'oauth_consent_page' },
  ];

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    completeNodeFromBackground: async (step, payload) => {
      events.completeCalls.push({ step, payload });
    },
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async () => {
      events.ensureCalls += 1;
      return pageStates[Math.min(events.ensureCalls - 1, pageStates.length - 1)];
    },
    rerunStep7ForStep8Recovery: async () => {
      events.rerunStep7 += 1;
    },
    getOAuthFlowRemainingMs: async () => 9000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 9000),
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({ email: 'user@example.com', password: 'secret' }),
    getTabId: async (sourceName) => (sourceName === 'openai-auth' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: (error) => /页面通信异常|did not respond/i.test(String(error?.message || error || '')),
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async () => {
      events.resolveCalls += 1;
      throw new Error('步骤 8：页面通信异常 did not respond in 30s');
    },
    reuseOrCreateTab: async () => {},
    setState: async () => {},
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeStep8({
      email: 'user@example.com',
      password: 'secret',
      oauthUrl: 'https://oauth.example/latest',
    }),
    /OpenAI 要求登录验证码，已按设置停止，不再获取登录验证码/
  );

  assert.equal(events.resolveCalls, 0);
  assert.equal(events.rerunStep7, 0);
  assert.equal(events.ensureCalls, 1);
  assert.deepStrictEqual(events.completeCalls, []);
});

test('step 8 does not prepare 2925 polling on default verification page', async () => {
  let capturedOptions = null;
  let ensureCalls = 0;
  let ensureOptions = null;
  const tabUpdates = [];
  const tabReuses = [];
  const realDateNow = Date.now;
  Date.now = () => 900000;

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async (tabId, payload) => {
          tabUpdates.push({ tabId, payload });
        },
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    confirmCustomVerificationStepBypass: async () => {},
    ensureMail2925MailboxSession: async (options) => {
      ensureCalls += 1;
      ensureOptions = options;
    },
    ensureStep8VerificationPageReady: async () => ({ state: 'verification_page' }),
    rerunStep7ForStep8Recovery: async () => {},
    getOAuthFlowRemainingMs: async () => 8000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 8000),
    getMailConfig: () => ({
      provider: '2925',
      label: '2925 邮箱',
      source: 'mail-2925',
      url: 'https://2925.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({
      email: 'user@example.com',
      password: 'secret',
      mail2925UseAccountPool: true,
      currentMail2925AccountId: 'acc-1',
      mail2925Accounts: [
        { id: 'acc-1', email: 'pool-user@2925.com' },
      ],
    }),
    getTabId: async (sourceName) => (sourceName === 'openai-auth' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async (_step, _state, _mail, options) => {
      capturedOptions = options;
    },
    reuseOrCreateTab: async (source, url) => {
      tabReuses.push({ source, url });
    },
    setState: async () => {},
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  try {
    await assert.rejects(
      () => executor.executeStep8({
        email: 'user@example.com',
        password: 'secret',
        oauthUrl: 'https://oauth.example/latest',
        mail2925UseAccountPool: true,
        currentMail2925AccountId: 'acc-1',
        mail2925Accounts: [
          { id: 'acc-1', email: 'pool-user@2925.com' },
        ],
      }),
      /OpenAI 要求登录验证码，已按设置停止，不再获取登录验证码/
    );
  } finally {
    Date.now = realDateNow;
  }

  assert.equal(ensureCalls, 0);
  assert.equal(ensureOptions, null);
  assert.deepStrictEqual(tabReuses, []);
  assert.deepStrictEqual(tabUpdates, [
    { tabId: 1, payload: { active: true } },
  ]);
  assert.equal(capturedOptions, null);
});

test('step 8 stops on verification page without falling back to run email polling target', async () => {
  let capturedOptions = null;

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async () => ({ state: 'verification_page', displayedEmail: '' }),
    rerunStep7ForStep8Recovery: async () => {},
    getOAuthFlowRemainingMs: async () => 8000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 8000),
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({ email: 'user@example.com', password: 'secret' }),
    getTabId: async (sourceName) => (sourceName === 'openai-auth' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async (_step, _state, _mail, options) => {
      capturedOptions = options;
    },
    reuseOrCreateTab: async () => {},
    setState: async () => {},
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeStep8({
      email: 'user@example.com',
      password: 'secret',
      oauthUrl: 'https://oauth.example/latest',
    }),
    /OpenAI 要求登录验证码，已按设置停止，不再获取登录验证码/
  );

  assert.equal(capturedOptions, null);
});

test('step 8 stops before verification submit can land on add-phone', async () => {
  const calls = {
    rerunStep7: 0,
    logs: [],
  };

  const executor = api.createStep8Executor({
    addLog: async (message, level = 'info') => {
      calls.logs.push({ message, level });
    },
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    confirmCustomVerificationStepBypass: async () => {},
    ensureStep8VerificationPageReady: async () => ({ state: 'verification_page' }),
    rerunStep7ForStep8Recovery: async () => {
      calls.rerunStep7 += 1;
    },
    getOAuthFlowRemainingMs: async () => 8000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 8000),
    getMailConfig: () => ({
      provider: 'qq',
      label: 'QQ 邮箱',
      source: 'mail-qq',
      url: 'https://mail.qq.com',
      navigateOnReuse: false,
    }),
    getState: async () => ({ email: 'user@example.com', password: 'secret' }),
    getTabId: async (sourceName) => (sourceName === 'openai-auth' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async () => {
      throw new Error('步骤 8：验证码提交后页面进入手机号页面，当前流程无法继续自动授权。 URL: https://auth.openai.com/add-phone');
    },
    reuseOrCreateTab: async () => {},
    setState: async () => {},
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeStep8({
      email: 'user@example.com',
      password: 'secret',
      oauthUrl: 'https://oauth.example/latest',
    }),
    /OpenAI 要求登录验证码，已按设置停止，不再获取登录验证码/
  );

  assert.equal(calls.rerunStep7, 0);
  assert.ok(!calls.logs.some(({ message }) => /准备从步骤 7 重新开始/.test(message)));
});

test('step 8 does not check iCloud session before default verification page stop', async () => {
  let icloudChecks = 0;
  let resolved = false;

  const executor = api.createStep8Executor({
    addLog: async () => {},
    chrome: {
      tabs: {
        update: async () => {},
      },
    },
    CLOUDFLARE_TEMP_EMAIL_PROVIDER: 'cloudflare-temp-email',
    confirmCustomVerificationStepBypass: async () => {},
    ensureIcloudMailSession: async () => {
      icloudChecks += 1;
    },
    ensureStep8VerificationPageReady: async () => ({ state: 'verification_page', displayedEmail: '' }),
    rerunStep7ForStep8Recovery: async () => {},
    getOAuthFlowRemainingMs: async () => 8000,
    getOAuthFlowStepTimeoutMs: async (defaultTimeoutMs) => Math.min(defaultTimeoutMs, 8000),
    getMailConfig: () => ({
      source: 'icloud-mail',
      url: 'https://www.icloud.com/mail/',
      label: 'iCloud 邮箱',
      navigateOnReuse: true,
    }),
    getState: async () => ({ email: 'user@example.com', password: 'secret' }),
    getTabId: async (sourceName) => (sourceName === 'openai-auth' ? 1 : 2),
    HOTMAIL_PROVIDER: 'hotmail-api',
    isTabAlive: async () => true,
    isVerificationMailPollingError: () => false,
    LUCKMAIL_PROVIDER: 'luckmail-api',
    resolveVerificationStep: async () => {
      resolved = true;
    },
    reuseOrCreateTab: async () => {},
    setState: async () => {},
    setStepStatus: async () => {},
    shouldUseCustomRegistrationEmail: () => false,
    STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS: 25000,
    STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS: 8,
    throwIfStopped: () => {},
  });

  await assert.rejects(
    () => executor.executeStep8({
      email: 'user@example.com',
      password: 'secret',
      oauthUrl: 'https://oauth.example/latest',
    }),
    /OpenAI 要求登录验证码，已按设置停止，不再获取登录验证码/
  );

  assert.equal(icloudChecks, 0);
  assert.equal(resolved, false);
});
