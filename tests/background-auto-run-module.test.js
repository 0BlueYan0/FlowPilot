const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background imports auto-run controller module', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /background\/auto-run-controller\.js/);
  assert.match(source, /buildFreshAutoRunKeepState/);
});

test('auto-run controller module exposes a factory', () => {
  const source = fs.readFileSync('background/auto-run-controller.js', 'utf8');
  const globalScope = {};

  const api = new Function('self', `${source}; return self.MultiPageBackgroundAutoRunController;`)(globalScope);

  assert.equal(typeof api?.createAutoRunController, 'function');
});

test('auto-run account record status preserves the real failed node instead of parsing guidance text', () => {
  const source = fs.readFileSync('background/auto-run-controller.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundAutoRunController;`)(globalScope);
  const controller = api.createAutoRunController({});

  const state = {
    currentNodeId: 'fetch-login-code',
    nodeStatuses: {
      'submit-signup-email': 'completed',
      'oauth-login': 'completed',
      'fetch-login-code': 'failed',
    },
  };
  const error = new Error('缺少登录账号：请先完成步骤 2，或在侧栏填写账号后再执行当前步骤。');

  assert.equal(
    controller.resolveAutoRunAccountRecordStatus('failed', state, error),
    'node:fetch-login-code:failed'
  );

  error.failedNodeId = 'platform-verify';
  assert.equal(
    controller.resolveAutoRunAccountRecordStatus('failed', state, error),
    'node:platform-verify:failed'
  );
});

test('auto-run clears generated identity state after a successful round', async () => {
  const source = fs.readFileSync('background/auto-run-controller.js', 'utf8');
  const globalScope = {};
  const api = new Function('self', `${source}; return self.MultiPageBackgroundAutoRunController;`)(globalScope);

  const cleanupCalls = [];
  let state = {
    currentNodeId: '',
    nodeStatuses: { final: 'pending' },
    stepStatuses: {},
    email: 'round-user@example.com',
    signupPhoneNumber: '+441111111111',
  };
  const runtimeState = {
    autoRunActive: false,
    autoRunCurrentRun: 0,
    autoRunTotalRuns: 0,
    autoRunAttemptRun: 0,
    autoRunSessionId: 0,
  };

  const controller = api.createAutoRunController({
    addLog: async () => {},
    appendAccountRunRecord: async () => null,
    AUTO_RUN_MAX_RETRIES_PER_ROUND: 0,
    AUTO_RUN_RETRY_DELAY_MS: 0,
    AUTO_RUN_TIMER_KIND_BEFORE_RETRY: 'before_retry',
    AUTO_RUN_TIMER_KIND_BETWEEN_ROUNDS: 'between_rounds',
    broadcastAutoRunStatus: async () => {},
    broadcastStopToContentScripts: async () => {},
    buildFreshAutoRunKeepState: (currentState) => ({ ...currentState }),
    cancelPendingCommands: () => {},
    clearCompletedFlowGeneratedIdentity: async (payload) => {
      cleanupCalls.push(payload);
      state = {
        ...state,
        email: null,
        signupPhoneNumber: '',
      };
    },
    clearStopRequest: () => {},
    createAutoRunSessionId: () => 123,
    getAutoRunStatusPayload: (phase, payload) => ({ autoRunPhase: phase, ...payload }),
    getErrorMessage: (error) => error?.message || String(error || ''),
    getFirstUnfinishedNodeId: (statuses = {}) => Object.keys(statuses).find((nodeId) => statuses[nodeId] !== 'completed') || null,
    getRunningNodeIds: () => [],
    getStopRequested: () => false,
    getState: async () => state,
    hasSavedNodeProgress: () => false,
    isAddPhoneAuthFailure: () => false,
    isGpcTaskEndedFailure: () => false,
    isKiroProxyFailure: () => false,
    isPhoneSmsPlatformRateLimitFailure: () => false,
    isPlusCheckoutNonFreeTrialFailure: () => false,
    isRestartCurrentAttemptError: () => false,
    isStep4Route405RecoveryLimitFailure: () => false,
    isSignupUserAlreadyExistsFailure: () => false,
    isStopError: () => false,
    launchAutoRunTimerPlan: async () => {},
    normalizeAutoRunFallbackThreadIntervalMinutes: () => 0,
    persistAutoRunTimerPlan: async () => {},
    resetState: async () => {
      state = {};
    },
    runAutoSequenceFromNode: async () => {
      state = {
        ...state,
        nodeStatuses: { final: 'completed' },
      };
    },
    runtime: {
      get: () => ({ ...runtimeState }),
      set: (updates = {}) => Object.assign(runtimeState, updates),
    },
    setState: async (updates) => {
      state = { ...state, ...updates };
    },
    sleepWithStop: async () => {},
    throwIfAutoRunSessionStopped: () => {},
    waitForRunningNodesToFinish: async () => state,
    chrome: { runtime: { sendMessage: () => ({ catch: () => {} }) } },
  });

  await controller.autoRunLoop(1, { autoRunSkipFailures: true });

  assert.equal(cleanupCalls.length, 1);
  assert.equal(cleanupCalls[0].targetRun, 1);
  assert.equal(cleanupCalls[0].totalRuns, 1);
  assert.equal(cleanupCalls[0].attemptRun, 1);
  assert.equal(state.email, null);
  assert.equal(state.signupPhoneNumber, '');
});
