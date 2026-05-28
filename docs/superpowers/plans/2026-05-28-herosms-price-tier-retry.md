# HeroSMS Price Tier Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HeroSMS exhaust the configured no-number retry rounds at one platform price tier before raising to the next tier within the configured price limit.

**Architecture:** Keep the existing HeroSMS provider flow in `background/phone-verification-flow.js`. Reorder the HeroSMS acquisition loop so price tiers advance only after `heroSmsActivationRetryRounds` no-number rounds, while preserving country ordering, price bounds, `getNumber`/`getNumberV2`, and `WRONG_MAX_PRICE` handling.

**Tech Stack:** JavaScript, Chrome extension background helpers, Node `node:test`.

---

### Task 1: Add Regression Test

**Files:**
- Modify: `tests/phone-verification-flow.test.js`

- [x] **Step 1: Write the failing test**

Add a test where HeroSMS exposes `0.08` and `0.12`, both `getNumber` and `getNumberV2` return `NO_NUMBERS` at `0.08`, `heroSmsActivationRetryRounds` is `3`, and `0.12` succeeds.

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/phone-verification-flow.test.js --test-name-pattern "exhausts configured HeroSMS retry rounds"`

Expected: FAIL because current code tries `0.12` immediately after one `0.08` `getNumber`/`getNumberV2` pair.

### Task 2: Implement Tier-Round Ordering

**Files:**
- Modify: `background/phone-verification-flow.js`

- [ ] **Step 1: Change HeroSMS acquisition ordering**

Keep country candidate resolution unchanged. For each country, build the filtered price list once, then attempt each price tier across the configured acquisition rounds before moving to the next tier.

- [ ] **Step 2: Preserve error behavior**

Keep terminal errors immediate, keep `WRONG_MAX_PRICE` bounded by user limits, and only report no-supply after all eligible tiers are exhausted.

### Task 3: Verify

**Files:**
- Test: `tests/phone-verification-flow.test.js`

- [ ] **Step 1: Run focused test**

Run: `node --test tests/phone-verification-flow.test.js --test-name-pattern "exhausts configured HeroSMS retry rounds"`

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: PASS with all tests green.
