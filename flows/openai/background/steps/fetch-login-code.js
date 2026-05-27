(function attachBackgroundStep8(root, factory) {
  root.MultiPageBackgroundStep8 = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundStep8Module() {
  const MAIL_2925_FILTER_LOOKBACK_MS = 10 * 60 * 1000;

  function createStep8Executor(deps = {}) {
    const {
      addLog: rawAddLog = async () => {},
      chrome,
      CLOUDFLARE_TEMP_EMAIL_PROVIDER,
      CLOUD_MAIL_PROVIDER = 'cloudmail',
      completeNodeFromBackground,
      confirmCustomVerificationStepBypass,
      ensureMail2925MailboxSession,
      ensureIcloudMailSession,
      ensureStep8VerificationPageReady,
      getOAuthFlowRemainingMs,
      getOAuthFlowStepTimeoutMs,
      getMailConfig,
      getState,
      getTabId,
      HOTMAIL_PROVIDER,
      isTabAlive,
      isVerificationMailPollingError,
      LUCKMAIL_PROVIDER,
      resolveSignupEmailForFlow,
      resolveVerificationStep,
      rerunStep7ForStep8Recovery,
      reuseOrCreateTab,
      sendToContentScriptResilient,
      persistRegistrationEmailState = null,
      phoneVerificationHelpers = null,
      setState,
      shouldUseCustomRegistrationEmail,
      sleepWithStop,
      STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS,
      STEP7_MAIL_POLLING_RECOVERY_MAX_ATTEMPTS,
      throwIfStopped,
      getStepIdByKeyForState = null,
    } = deps;
    let activeFetchLoginCodeStep = null;
    let activeFetchLoginCodeStepKey = 'fetch-login-code';

    function normalizeLogStep(value) {
      const step = Math.floor(Number(value) || 0);
      return step > 0 ? step : null;
    }

    function normalizeStepLogMessage(message) {
      return String(message || '')
        .replace(/^步骤\s*\d+\s*[:：]\s*/, '')
        .replace(/^Step\s+\d+\s*[:：]\s*/i, '')
        .trim();
    }

    function addLog(message, level = 'info', options = {}) {
      const normalizedOptions = options && typeof options === 'object' ? { ...options } : {};
      const step = normalizeLogStep(normalizedOptions.step || normalizedOptions.visibleStep)
        || normalizeLogStep(activeFetchLoginCodeStep);
      if (step) {
        normalizedOptions.step = step;
        if (!normalizedOptions.stepKey) {
          normalizedOptions.stepKey = activeFetchLoginCodeStepKey || 'fetch-login-code';
        }
      }
      delete normalizedOptions.visibleStep;
      return rawAddLog(normalizeStepLogMessage(message), level, normalizedOptions);
    }

    function getVisibleStep(state, fallback = 8) {
      const visibleStep = Math.floor(Number(state?.visibleStep) || 0);
      return visibleStep > 0 ? visibleStep : fallback;
    }

    function normalizeSignupMethod(value = '') {
      return String(value || '').trim().toLowerCase() === 'phone' ? 'phone' : 'email';
    }

    function normalizeIdentifierType(value = '') {
      const normalized = String(value || '').trim().toLowerCase();
      return normalized === 'phone' || normalized === 'email' ? normalized : '';
    }

    function isPhoneLoginCodeMode(state = {}) {
      if (normalizeIdentifierType(state?.accountIdentifierType) === 'phone') {
        return true;
      }
      return normalizeSignupMethod(state?.resolvedSignupMethod || state?.signupMethod) === 'phone'
        && Boolean(
          String(state?.signupPhoneNumber || '').trim()
          || String(state?.signupPhoneCompletedActivation?.phoneNumber || '').trim()
          || String(state?.signupPhoneActivation?.phoneNumber || '').trim()
        );
    }

    function getAuthLoginStepForVisibleStep(visibleStep) {
      return visibleStep >= 11 ? Math.max(1, visibleStep - 1) : 7;
    }

    function getAuthLoginStepForState(state = {}, visibleStep = 8) {
      const authStep = typeof getStepIdByKeyForState === 'function'
        ? Number(getStepIdByKeyForState('oauth-login', state))
        : 0;
      if (Number.isInteger(authStep) && authStep > 0) {
        return authStep;
      }
      return getAuthLoginStepForVisibleStep(visibleStep);
    }

    async function getStep8ReadyTimeoutMs(actionLabel, expectedOauthUrl = '', visibleStep = 8) {
      if (typeof getOAuthFlowStepTimeoutMs !== 'function') {
        return 15000;
      }

      return getOAuthFlowStepTimeoutMs(15000, {
        step: visibleStep,
        actionLabel,
        oauthUrl: expectedOauthUrl,
      });
    }

    function getStep8RemainingTimeResolver(expectedOauthUrl = '', visibleStep = 8) {
      if (typeof getOAuthFlowRemainingMs !== 'function') {
        return undefined;
      }

      return async (details = {}) => getOAuthFlowRemainingMs({
        step: visibleStep,
        actionLabel: details.actionLabel || '登录验证码流程',
        oauthUrl: expectedOauthUrl,
      });
    }

    function normalizeStep8VerificationTargetEmail(value) {
      return String(value || '').trim().toLowerCase();
    }

    function resolveBoundEmailLoginTarget(state = {}, visibleStep = 0) {
      const email = String(
        state?.step8VerificationTargetEmail
        || state?.email
        || state?.registrationEmailState?.current
        || ''
      ).trim();
      if (!email) {
        throw new Error(`步骤 ${visibleStep || 0}：缺少绑定邮箱，无法使用邮箱模式重新发起 OAuth 登录。`);
      }
      return email;
    }

    function buildBoundEmailLoginState(state = {}, visibleStep = 0) {
      const email = resolveBoundEmailLoginTarget(state, visibleStep);
      return {
        ...state,
        forceLoginIdentifierType: 'email',
        forceEmailLogin: true,
        signupMethod: 'email',
        resolvedSignupMethod: 'email',
        accountIdentifierType: 'email',
        accountIdentifier: email,
        email,
        step8VerificationTargetEmail: normalizeStep8VerificationTargetEmail(email),
      };
    }

    async function getLoginAuthStateFromContent(visibleStep, options = {}) {
      if (typeof sendToContentScriptResilient !== 'function') {
        return {};
      }
      const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 15000);
      const result = await sendToContentScriptResilient(
        'openai-auth',
        {
          type: 'GET_LOGIN_AUTH_STATE',
          source: 'background',
          payload: {},
        },
        {
          timeoutMs,
          responseTimeoutMs: timeoutMs,
          retryDelayMs: 600,
          logMessage: options.logMessage || `步骤 ${visibleStep}：认证页正在切换，等待页面重新就绪...`,
          logStep: visibleStep,
          logStepKey: options.logStepKey || activeFetchLoginCodeStepKey || 'fetch-login-code',
        }
      );
      if (result?.error) {
        throw new Error(result.error);
      }
      return result || {};
    }

    async function submitAddEmailIfNeeded(state, visibleStep, initialPageState = null) {
      if (typeof resolveSignupEmailForFlow !== 'function' || typeof sendToContentScriptResilient !== 'function') {
        return { state, pageState: initialPageState };
      }

      const pageState = initialPageState?.state
        ? initialPageState
        : await getLoginAuthStateFromContent(visibleStep, {
          timeoutMs: 15000,
          logMessage: `步骤 ${visibleStep}：正在确认是否已进入添加邮箱页...`,
        });
      if (pageState?.state !== 'add_email_page') {
        return { state, pageState };
      }

      const latestState = typeof getState === 'function' ? await getState() : state;
      const resolvedEmail = await resolveSignupEmailForFlow(latestState, {
        preserveAccountIdentity: true,
      });
      await addLog(`步骤 ${visibleStep}：检测到添加邮箱页，正在添加邮箱 ${resolvedEmail} 并进入邮箱验证码页...`);

      const timeoutMs = typeof getOAuthFlowStepTimeoutMs === 'function'
        ? await getOAuthFlowStepTimeoutMs(60000, {
          step: visibleStep,
          actionLabel: '添加邮箱并进入验证码页',
          oauthUrl: latestState?.oauthUrl || state?.oauthUrl || '',
        })
        : 60000;
      const result = await sendToContentScriptResilient(
        'openai-auth',
        {
          type: 'SUBMIT_ADD_EMAIL',
          source: 'background',
          payload: {
            email: resolvedEmail,
            nodeId: state?.nodeId || activeFetchLoginCodeStepKey || 'fetch-login-code',
          },
        },
        {
          timeoutMs,
          responseTimeoutMs: timeoutMs,
          retryDelayMs: 700,
          logMessage: `步骤 ${visibleStep}：添加邮箱页面正在切换，等待邮箱验证码页就绪...`,
          logStep: visibleStep,
          logStepKey: activeFetchLoginCodeStepKey || 'fetch-login-code',
        }
      );

      if (result?.error) {
        throw new Error(result.error);
      }

      const displayedEmail = normalizeStep8VerificationTargetEmail(result?.displayedEmail || resolvedEmail);
      let persistedState = latestState;
      if (typeof persistRegistrationEmailState === 'function') {
        await persistRegistrationEmailState(latestState, resolvedEmail, {
          source: activeFetchLoginCodeStepKey === 'bind-email' ? 'bind_email' : 'step8_add_email',
          preserveAccountIdentity: true,
        });
        persistedState = typeof getState === 'function' ? await getState() : latestState;
      } else {
        await setState({
          email: resolvedEmail,
          step8VerificationTargetEmail: displayedEmail,
        });
        persistedState = {
          ...latestState,
          email: resolvedEmail,
          step8VerificationTargetEmail: displayedEmail,
        };
      }

      return {
        state: {
          ...persistedState,
          email: resolvedEmail,
          step8VerificationTargetEmail: displayedEmail,
        },
        pageState: {
          state: result?.directOAuthConsentPage ? 'oauth_consent_page' : 'verification_page',
          displayedEmail,
          url: result?.url || pageState?.url || '',
        },
      };
    }

    async function completeStep8WhenAuthAlreadyOnOauthConsent(visibleStep, options = {}) {
      await setState({
        step8VerificationTargetEmail: '',
        loginVerificationRequestedAt: null,
      });
      const fromRecovery = Boolean(options.fromRecovery);
      const stepKey = options.stepKey || activeFetchLoginCodeStepKey || 'fetch-login-code';
      await addLog(
        `步骤 ${visibleStep}：当前认证页已进入 OAuth 授权页${fromRecovery ? '（轮询失败后复核）' : ''}，跳过登录验证码拉取并继续后续流程。`,
        'warn',
        { step: visibleStep, stepKey }
      );
      if (typeof completeNodeFromBackground === 'function') {
        await completeNodeFromBackground(options.nodeId || 'fetch-login-code', {
          loginVerificationRequestedAt: null,
          skipLoginVerificationStep: true,
          directOAuthConsentPage: true,
        });
      }
    }

    async function completeStep8WhenDeferredToPostLoginPhone(visibleStep, pageState = {}, options = {}) {
      await setState({
        step8VerificationTargetEmail: '',
        loginVerificationRequestedAt: null,
      });
      const stepKey = options.stepKey || activeFetchLoginCodeStepKey || 'fetch-login-code';
      await addLog(
        `步骤 ${visibleStep}：当前认证页已进入手机号验证流程，跳过登录邮箱验证码，交给后续“手机号验证”步骤处理。`,
        'warn',
        { step: visibleStep, stepKey }
      );
      if (typeof completeNodeFromBackground === 'function') {
        await completeNodeFromBackground(options.nodeId || 'fetch-login-code', {
          loginVerificationRequestedAt: null,
          skipLoginVerificationStep: true,
          addPhonePage: pageState?.state === 'add_phone_page' || Boolean(pageState?.addPhonePage),
          phoneVerificationPage: pageState?.state === 'phone_verification_page' || Boolean(pageState?.phoneVerificationPage),
        });
      }
    }

    async function completeStep8WhenDeferredToBindEmail(visibleStep, options = {}) {
      await setState({
        step8VerificationTargetEmail: '',
        loginVerificationRequestedAt: null,
      });
      await addLog(
        `步骤 ${visibleStep}：当前认证页已进入添加邮箱页，跳过登录短信验证码，交给后续“绑定邮箱”步骤处理。`,
        'warn'
      );
      if (typeof completeNodeFromBackground === 'function') {
        await completeNodeFromBackground(options.nodeId || 'fetch-login-code', {
          loginVerificationRequestedAt: null,
          skipLoginVerificationStep: true,
          addEmailPage: true,
        });
      }
    }

    function getExpectedMail2925MailboxEmail(state = {}) {
      if (Boolean(state?.mail2925UseAccountPool)) {
        const currentAccountId = String(state?.currentMail2925AccountId || '').trim();
        const accounts = Array.isArray(state?.mail2925Accounts) ? state.mail2925Accounts : [];
        const currentAccount = accounts.find((account) => String(account?.id || '') === currentAccountId) || null;
        const accountEmail = String(currentAccount?.email || '').trim().toLowerCase();
        if (accountEmail) {
          return accountEmail;
        }
      }

      return String(state?.mail2925BaseEmail || '').trim().toLowerCase();
    }

    async function focusOrOpenMailTab(mail) {
      const alive = await isTabAlive(mail.source);
      if (alive) {
        if (mail.navigateOnReuse) {
          await reuseOrCreateTab(mail.source, mail.url, {
            inject: mail.inject,
            injectSource: mail.injectSource,
          });
          return;
        }

        const tabId = await getTabId(mail.source);
        await chrome.tabs.update(tabId, { active: true });
        return;
      }

      await reuseOrCreateTab(mail.source, mail.url, {
        inject: mail.inject,
        injectSource: mail.injectSource,
      });
    }

    async function ensureAuthTabForPostLoginStep(state, visibleStep) {
      const authTabId = await getTabId('openai-auth');
      if (authTabId) {
        await chrome.tabs.update(authTabId, { active: true });
        return authTabId;
      }
      if (!state?.oauthUrl) {
        throw new Error(`步骤 ${visibleStep}：缺少登录用 OAuth 链接，请先完成刷新 OAuth 并登录。`);
      }
      return reuseOrCreateTab('openai-auth', state.oauthUrl);
    }

    async function completePostLoginPhoneVerificationSkippedOnOauth(visibleStep, options = {}) {
      const stepKey = options.stepKey || 'post-login-phone-verification';
      await addLog(`步骤 ${visibleStep}：当前认证页已进入 OAuth 授权页，跳过手机号验证步骤。`, 'warn', {
        step: visibleStep,
        stepKey,
      });
      if (typeof completeNodeFromBackground === 'function') {
        await completeNodeFromBackground(options.nodeId || 'post-login-phone-verification', {
          directOAuthConsentPage: true,
          phoneVerification: false,
        });
      }
    }

    async function executePostLoginPhoneVerification(state, runtime = {}) {
      const visibleStep = getVisibleStep(state, 9);
      activeFetchLoginCodeStep = visibleStep;
      activeFetchLoginCodeStepKey = runtime.stepKey || 'post-login-phone-verification';
      const authTabId = await ensureAuthTabForPostLoginStep(state, visibleStep);
      const pageState = await getLoginAuthStateFromContent(visibleStep, {
        timeoutMs: await getStep8ReadyTimeoutMs('确认手机号验证页或 OAuth 授权页已就绪', state?.oauthUrl || '', visibleStep),
        logMessage: `步骤 ${visibleStep}：正在确认是否需要手机号验证...`,
        logStepKey: activeFetchLoginCodeStepKey,
      });

      if (pageState?.state === 'oauth_consent_page') {
        await completePostLoginPhoneVerificationSkippedOnOauth(visibleStep, {
          nodeId: state?.nodeId || runtime.fallbackNodeId,
          stepKey: activeFetchLoginCodeStepKey,
        });
        return;
      }
      if (pageState?.state !== 'add_phone_page' && pageState?.state !== 'phone_verification_page') {
        throw new Error(`步骤 ${visibleStep}：手机号验证步骤只处理添加手机号页或手机验证码页，当前状态：${pageState?.state || 'unknown'}。URL: ${pageState?.url || ''}`.trim());
      }
      if (!state?.phoneVerificationEnabled) {
        throw new Error(`步骤 ${visibleStep}：检测到需要手机号验证，但手机接码未开启。URL: ${pageState?.url || ''}`.trim());
      }
      if (typeof phoneVerificationHelpers?.completePhoneVerificationFlow !== 'function') {
        throw new Error(`步骤 ${visibleStep}：手机号验证流程不可用，接码模块尚未初始化。`);
      }

      const result = await phoneVerificationHelpers.completePhoneVerificationFlow(authTabId, pageState, {
        step: visibleStep,
        visibleStep,
      });
      if (typeof completeNodeFromBackground === 'function') {
        await completeNodeFromBackground(state?.nodeId || runtime.fallbackNodeId || 'post-login-phone-verification', {
          phoneVerification: true,
          postLoginPhoneVerification: true,
          code: result?.code || '',
        });
      }
      return result || {};
    }

    async function executeBindEmail(state) {
      const visibleStep = getVisibleStep(state, 9);
      activeFetchLoginCodeStep = visibleStep;
      activeFetchLoginCodeStepKey = 'bind-email';
      await ensureAuthTabForPostLoginStep(state, visibleStep);
      const pageState = await getLoginAuthStateFromContent(visibleStep, {
        timeoutMs: await getStep8ReadyTimeoutMs('确认添加邮箱页或 OAuth 授权页已就绪', state?.oauthUrl || '', visibleStep),
        logMessage: `步骤 ${visibleStep}：正在确认是否需要绑定邮箱...`,
      });

      if (pageState?.state === 'oauth_consent_page') {
        await addLog(`步骤 ${visibleStep}：当前认证页已进入 OAuth 授权页，跳过绑定邮箱步骤。`, 'warn', {
          step: visibleStep,
          stepKey: 'bind-email',
        });
        if (typeof completeNodeFromBackground === 'function') {
          await completeNodeFromBackground(state?.nodeId || 'bind-email', {
            directOAuthConsentPage: true,
            bindEmailSubmitted: false,
          });
        }
        return;
      }

      if (pageState?.state !== 'add_email_page') {
        throw new Error(`步骤 ${visibleStep}：绑定邮箱步骤只处理添加邮箱页，当前状态：${pageState?.state || 'unknown'}。URL: ${pageState?.url || ''}`.trim());
      }

      const addEmailPreparation = await submitAddEmailIfNeeded(state, visibleStep, pageState);
      const preparedState = addEmailPreparation?.state || state;
      const nextPageState = addEmailPreparation?.pageState || pageState;
      if (nextPageState?.state !== 'verification_page') {
        throw new Error(`步骤 ${visibleStep}：绑定邮箱提交后必须进入邮箱验证码页，当前状态：${nextPageState?.state || 'unknown'}。URL: ${nextPageState?.url || ''}`.trim());
      }

      if (typeof completeNodeFromBackground === 'function') {
        await completeNodeFromBackground(state?.nodeId || 'bind-email', {
          bindEmailSubmitted: true,
          email: preparedState?.email || '',
          step8VerificationTargetEmail: preparedState?.step8VerificationTargetEmail || nextPageState?.displayedEmail || '',
        });
      }
    }

    async function pollEmailVerificationCode(preparedState, pageState, visibleStep, runtime = {}) {
      let latestResendAt = Math.max(
        0,
        Number(runtime?.stickyLastResendAt) || 0,
        Number(preparedState?.loginVerificationRequestedAt) || 0
      );
      const notifyResendRequestedAt = typeof runtime?.onResendRequestedAt === 'function'
        ? runtime.onResendRequestedAt
        : null;
      const mail = getMailConfig(preparedState);
      if (mail.error) throw new Error(mail.error);
      const stepStartedAt = Date.now();
      const verificationFilterAfterTimestamp = mail.provider === '2925'
        ? Math.max(0, stepStartedAt - MAIL_2925_FILTER_LOOKBACK_MS)
        : stepStartedAt;
      const verificationSessionKey = `${visibleStep}:${stepStartedAt}`;
      const shouldCompareVerificationEmail = mail.provider !== '2925';
      const displayedVerificationEmail = shouldCompareVerificationEmail
        ? normalizeStep8VerificationTargetEmail(pageState?.displayedEmail)
        : '';
      const fixedTargetEmail = shouldCompareVerificationEmail
        ? (displayedVerificationEmail || normalizeStep8VerificationTargetEmail(preparedState?.step8VerificationTargetEmail || preparedState?.email))
        : '';

      await setState({
        step8VerificationTargetEmail: displayedVerificationEmail || '',
      });

      await addLog(`步骤 ${visibleStep}：邮箱验证码页面已就绪，开始获取验证码。`, 'info');
      if (shouldCompareVerificationEmail && displayedVerificationEmail) {
        await addLog(`步骤 ${visibleStep}：已固定当前验证码页显示邮箱 ${displayedVerificationEmail} 作为后续匹配目标。`, 'info');
      }

      if (shouldUseCustomRegistrationEmail(preparedState)) {
        await confirmCustomVerificationStepBypass(8, {
          completionStep: visibleStep,
          promptStep: visibleStep,
        });
        return { lastResendAt: latestResendAt };
      }

      if (mail.source === 'icloud-mail' && typeof ensureIcloudMailSession === 'function') {
        await addLog(`步骤 ${visibleStep}：正在确认 iCloud 邮箱登录态...`, 'info');
        await ensureIcloudMailSession({
          state: preparedState,
          step: 8,
          actionLabel: `步骤 ${visibleStep}：确认 iCloud 邮箱登录态`,
        });
      }

      throwIfStopped();
      if (
        mail.provider === HOTMAIL_PROVIDER
        || mail.provider === LUCKMAIL_PROVIDER
        || mail.provider === CLOUDFLARE_TEMP_EMAIL_PROVIDER
        || mail.provider === CLOUD_MAIL_PROVIDER
      ) {
        await addLog(`步骤 ${visibleStep}：正在通过 ${mail.label} 轮询验证码...`);
      } else {
        await addLog(`步骤 ${visibleStep}：正在打开${mail.label}...`);
        if (mail.provider === '2925' && typeof ensureMail2925MailboxSession === 'function') {
          await ensureMail2925MailboxSession({
            accountId: preparedState.currentMail2925AccountId || null,
            forceRelogin: false,
            allowLoginWhenOnLoginPage: Boolean(preparedState?.mail2925UseAccountPool),
            expectedMailboxEmail: getExpectedMail2925MailboxEmail(preparedState),
            actionLabel: `Step ${visibleStep}: ensure 2925 mailbox session`,
          });
        } else {
          await focusOrOpenMailTab(mail);
        }
        if (mail.provider === '2925') {
          await addLog(`步骤 ${visibleStep}：将直接使用当前已登录的 ${mail.label} 轮询验证码。`, 'info');
        }
      }

      await resolveVerificationStep(8, {
        ...preparedState,
        step8VerificationTargetEmail: displayedVerificationEmail || '',
      }, mail, {
        completionStep: visibleStep,
        filterAfterTimestamp: verificationFilterAfterTimestamp,
        sessionKey: verificationSessionKey,
        disableTimeBudgetCap: mail.provider === '2925',
        getRemainingTimeMs: getStep8RemainingTimeResolver(preparedState?.oauthUrl || '', visibleStep),
        requestFreshCodeFirst: false,
        lastResendAt: latestResendAt,
        onResendRequestedAt: async (requestedAt) => {
          const numericRequestedAt = Number(requestedAt) || 0;
          if (numericRequestedAt > 0) {
            latestResendAt = Math.max(latestResendAt, numericRequestedAt);
          }
          if (notifyResendRequestedAt) {
            await notifyResendRequestedAt(latestResendAt);
          }
        },
        targetEmail: fixedTargetEmail,
        maxResendRequests: mail.provider === '2925' ? 2 : undefined,
        initialPollMaxAttempts: mail.provider === '2925' ? 5 : undefined,
        pollAttemptPlan: mail.provider === '2925' ? [2, 3, 15] : undefined,
        resendIntervalMs: mail.provider === LUCKMAIL_PROVIDER
          ? 15000
          : ((mail.provider === HOTMAIL_PROVIDER || mail.provider === '2925')
            ? 0
            : STANDARD_MAIL_VERIFICATION_RESEND_INTERVAL_MS),
      });
      return {
        lastResendAt: latestResendAt,
      };
    }

    async function completeFetchBindEmailCodeSkippedOnOauth(visibleStep, options = {}) {
      await addLog(`步骤 ${visibleStep}：当前认证页已进入 OAuth 授权页，跳过绑定邮箱验证码步骤。`, 'warn', {
        step: visibleStep,
        stepKey: 'fetch-bind-email-code',
      });
      if (typeof completeNodeFromBackground === 'function') {
        await completeNodeFromBackground(options.nodeId || 'fetch-bind-email-code', {
          directOAuthConsentPage: true,
          bindEmailCodeSkipped: true,
        });
      }
    }

    async function executeFetchBindEmailCode(state) {
      const visibleStep = getVisibleStep(state, 10);
      activeFetchLoginCodeStep = visibleStep;
      activeFetchLoginCodeStepKey = 'fetch-bind-email-code';
      await ensureAuthTabForPostLoginStep(state, visibleStep);
      const pageState = await getLoginAuthStateFromContent(visibleStep, {
        timeoutMs: await getStep8ReadyTimeoutMs('确认绑定邮箱验证码页已就绪', state?.oauthUrl || '', visibleStep),
        logMessage: `步骤 ${visibleStep}：正在确认绑定邮箱验证码页...`,
      });

      if (pageState?.state === 'oauth_consent_page') {
        if (state?.bindEmailSubmitted) {
          throw new Error(`步骤 ${visibleStep}：绑定邮箱提交后不应直接进入 OAuth 授权页，必须先完成邮箱验证码。URL: ${pageState?.url || ''}`.trim());
        }
        await completeFetchBindEmailCodeSkippedOnOauth(visibleStep, { nodeId: state?.nodeId });
        return;
      }
      if (pageState?.state !== 'verification_page') {
        throw new Error(`步骤 ${visibleStep}：获取绑定邮箱验证码步骤只处理邮箱验证码页，当前状态：${pageState?.state || 'unknown'}。URL: ${pageState?.url || ''}`.trim());
      }
      if (!state?.bindEmailSubmitted) {
        throw new Error(`步骤 ${visibleStep}：尚未完成绑定邮箱提交，不能直接获取绑定邮箱验证码。`);
      }

      return pollEmailVerificationCode(state, pageState, visibleStep, {
        stickyLastResendAt: Number(state?.loginVerificationRequestedAt) || 0,
      });
    }

    async function executeBoundEmailLoginCode(state) {
      const visibleStep = getVisibleStep(state, 11);
      activeFetchLoginCodeStep = visibleStep;
      activeFetchLoginCodeStepKey = 'fetch-bound-email-login-code';
      const preparedState = buildBoundEmailLoginState(state, visibleStep);
      const authTabId = await getTabId('openai-auth');

      if (authTabId) {
        await chrome.tabs.update(authTabId, { active: true });
      } else {
        if (!preparedState.oauthUrl) {
          throw new Error(`步骤 ${visibleStep}：缺少登录用 OAuth 链接，请先完成绑定邮箱后刷新 OAuth 并登录。`);
        }
        await reuseOrCreateTab('openai-auth', preparedState.oauthUrl);
      }

      throwIfStopped();
      const pageState = await ensureStep8VerificationPageReady({
        visibleStep,
        authLoginStep: Math.max(1, visibleStep - 1),
        allowPhoneVerificationPage: true,
        allowAddEmailPage: false,
        timeoutMs: await getStep8ReadyTimeoutMs('确认绑定邮箱登录验证码页已就绪', preparedState?.oauthUrl || '', visibleStep),
      });

      if (pageState?.state === 'oauth_consent_page') {
        await completeStep8WhenAuthAlreadyOnOauthConsent(visibleStep, {
          nodeId: state?.nodeId || 'fetch-bound-email-login-code',
          stepKey: 'fetch-bound-email-login-code',
        });
        return;
      }
      if (pageState?.state === 'add_phone_page' || pageState?.state === 'phone_verification_page') {
        await completeStep8WhenDeferredToPostLoginPhone(visibleStep, pageState, {
          nodeId: state?.nodeId || 'fetch-bound-email-login-code',
          stepKey: 'fetch-bound-email-login-code',
        });
        return;
      }
      if (pageState?.state === 'add_email_page') {
        throw new Error(`步骤 ${visibleStep}：绑定邮箱后邮箱模式登录不应再进入添加邮箱页。URL: ${pageState?.url || ''}`.trim());
      }
      if (pageState?.state !== 'verification_page') {
        throw new Error(`步骤 ${visibleStep}：绑定邮箱后获取登录验证码只处理邮箱登录验证码页，当前状态：${pageState?.state || 'unknown'}。URL: ${pageState?.url || ''}`.trim());
      }

      return pollEmailVerificationCode(preparedState, pageState, visibleStep, {
        stickyLastResendAt: Number(preparedState?.loginVerificationRequestedAt) || 0,
      });
    }

    async function executeBoundEmailPostLoginPhoneVerification(state) {
      return executePostLoginPhoneVerification(state, {
        stepKey: 'post-bound-email-phone-verification',
        fallbackNodeId: 'post-bound-email-phone-verification',
      });
    }

    function resolveStep8Password(state = {}) {
      return String(state?.customPassword || state?.password || '');
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
      if (!password.trim()) {
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
            passwordOnly: true,
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

    async function runStep8Attempt(state) {
      const visibleStep = getVisibleStep(state, 8);
      activeFetchLoginCodeStep = visibleStep;
      activeFetchLoginCodeStepKey = 'fetch-login-code';
      const authTabId = await getTabId('openai-auth');

      if (authTabId) {
        await chrome.tabs.update(authTabId, { active: true });
      } else {
        if (!state.oauthUrl) {
          throw new Error(`缺少登录用 OAuth 链接，请先完成步骤 ${getAuthLoginStepForState(state, visibleStep)}。`);
        }
        await reuseOrCreateTab('openai-auth', state.oauthUrl);
      }

      throwIfStopped();
      let pageState = await ensureStep8VerificationPageReady({
        visibleStep,
        authLoginStep: getAuthLoginStepForState(state, visibleStep),
        allowPhoneVerificationPage: true,
        allowAddEmailPage: true,
        allowPasswordPage: true,
        timeoutMs: await getStep8ReadyTimeoutMs('确认登录验证码页已就绪', state?.oauthUrl || '', visibleStep),
      });
      if (pageState?.state === 'oauth_consent_page') {
        await completeStep8WhenAuthAlreadyOnOauthConsent(visibleStep, { nodeId: state?.nodeId });
        return;
      }
      throwStep8VerificationStopped(pageState, visibleStep);
      if (pageState?.state === 'add_email_page') {
        if (isPhoneLoginCodeMode(state)) {
          await completeStep8WhenDeferredToBindEmail(visibleStep, { nodeId: state?.nodeId });
          return;
        }
        throw new Error(`步骤 ${visibleStep}：Step 8 只改用密码登录，不处理添加邮箱页。URL: ${pageState?.url || ''}`.trim());
      }
      if (pageState?.state !== 'password_page') {
        throw new Error(`步骤 ${visibleStep}：Step 8 只改用密码登录，当前状态不是密码页：${pageState?.state || 'unknown'}。URL: ${pageState?.url || ''}`.trim());
      }

      return submitStep8PasswordLogin(state, visibleStep);
    }

    function isStep8RestartStep7Error(error) {
      const message = String(error?.message || error || '');
      return /STEP8_RESTART_STEP7::/i.test(message);
    }

    async function executeStep8(state) {
      try {
        await runStep8Attempt(state);
      } catch (err) {
        throwIfStopped(err);
        throw err;
      }
    }

    return {
      executeStep8,
      executePostLoginPhoneVerification,
      executeBindEmail,
      executeFetchBindEmailCode,
      executeBoundEmailLoginCode,
      executeBoundEmailPostLoginPhoneVerification,
    };
  }

  return { createStep8Executor };
});
