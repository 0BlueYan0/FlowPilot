const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadSignupFlowHelpers() {
  const source = fs.readFileSync('background/signup-flow-helpers.js', 'utf8');
  return new Function('self', `${source}; return self.MultiPageSignupFlowHelpers;`)({});
}

test('openSignupEntryTab reloads a reused ChatGPT entry tab', async () => {
  const api = loadSignupFlowHelpers();
  const calls = [];
  const helpers = api.createSignupFlowHelpers({
    addLog: async () => {},
    buildGeneratedAliasEmail: () => '',
    chrome: {},
    ensureContentScriptReadyOnTab: async () => {},
    ensureHotmailAccountForFlow: async () => ({}),
    ensureMail2925AccountForFlow: async () => ({}),
    ensureLuckmailPurchaseForFlow: async () => ({}),
    fetchGeneratedEmail: async () => '',
    isGeneratedAliasProvider: () => false,
    isReusableGeneratedAliasEmail: () => false,
    isHotmailProvider: () => false,
    isRetryableContentScriptTransportError: () => false,
    isLuckmailProvider: () => false,
    isSignupEmailVerificationPageUrl: () => false,
    isSignupPasswordPageUrl: () => false,
    persistRegistrationEmailState: async () => {},
    reuseOrCreateTab: async (source, url, options) => {
      calls.push({ source, url, options });
      return 123;
    },
    sendToContentScriptResilient: async () => ({}),
    setEmailState: async () => {},
    setState: async () => {},
    SIGNUP_ENTRY_URL: 'https://chatgpt.com/',
    OPENAI_AUTH_INJECT_FILES: ['content/utils.js'],
  });

  assert.equal(await helpers.openSignupEntryTab(1), 123);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, 'openai-auth');
  assert.equal(calls[0].url, 'https://chatgpt.com/');
  assert.equal(calls[0].options.reloadIfSameUrl, true);
});

test('background opens the OpenAI auth signup entry instead of ChatGPT home', () => {
  const source = fs.readFileSync('background.js', 'utf8');

  assert.match(
    source,
    /const\s+SIGNUP_ENTRY_URL\s*=\s*'https:\/\/auth\.openai\.com\/create-account';/
  );
});
