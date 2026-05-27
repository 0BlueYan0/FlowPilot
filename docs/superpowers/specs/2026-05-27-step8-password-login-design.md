# Step 8 Password Login Design

## Goal

Change OpenAI Step 8 from fetching and submitting a login verification code to submitting the account password again. The password must be the same value used by Step 3: `state.password || state.customPassword`.

## Behavior

- Step 8 must not poll email providers for a login verification code.
- Step 8 must not submit an email login verification code.
- If the OpenAI auth page is already on OAuth consent, Step 8 completes immediately.
- If the OpenAI auth page is on a password page, Step 8 fills the saved password and submits it.
- If password submission reaches OAuth consent, Step 8 completes.
- If Step 8 starts on an email verification page, it stops with an explicit error.
- If Step 8 reaches an email verification page after password submission, it stops with an explicit error.
- If Step 8 starts on or reaches a phone verification page, it stops with an explicit error.
- If no saved password is available, Step 8 stops with an explicit error.

## Scope

- Keep Step 3 signup password behavior unchanged.
- Keep Step 7 OAuth refresh/login behavior unchanged except for any state it already passes to Step 8.
- Keep OAuth consent confirmation behavior unchanged.
- Do not expand bind-email or add-email flows unless tests show they are directly coupled to the old Step 8 email-code polling path.

## Implementation Notes

- Update the Step 8 background executor in `flows/openai/background/steps/fetch-login-code.js` so the default `executeStep8` path prepares or resumes the auth tab, then requires password login rather than calling `pollEmailVerificationCode`.
- Reuse the existing content-side login password handler through the OpenAI auth content script instead of duplicating DOM-fill logic in the background.
- Treat `verification_page`, `phone_verification_page`, and `add_phone_page` as terminal errors for Step 8.
- Preserve existing direct-OAuth handling so flows that already reach OAuth consent continue.

## Testing

- Add or update tests proving Step 8 password-page handling sends a password login request and does not call mail polling.
- Add or update tests proving Step 8 on `verification_page` fails without calling verification polling.
- Add or update tests proving Step 8 fails when password is missing.
- Run the targeted Step 8 tests and the full `npm test` suite.
