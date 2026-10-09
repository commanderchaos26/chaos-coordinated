# Chaos Coordinated — iPhone QA Build and Tester Onboarding

**Status:** iOS test source prepared; **not an installed or signed iOS app**. No Apple signing certificate, App Store Connect API key, TestFlight invitation, .ipa, or working tester account is supplied here.

**Prepared source branch:** `commanderchaos26/chaos-coordinated` → `ios/apple-device-qa-current-20261009`

**IMPORTANT:** This is an isolated *branch*, **not a fork**. Complete Step 1 to create a separate GitHub repository before building or inviting testers. No changes in this branch are intended for `main` or the Android release workflow.

## 0. What this test app is

- Display name: **Chaos Coordinated QA**.
- Apple bundle identifier: `com.digitaldivide.chaoscoordinated.qa`.
- Custom URL scheme: `chaoscoordinatedqa://`.
- App version: `0.2.0`; initial iOS build number: `1`.
- Three ready EAS profiles: `ios-qa-device` (signed iPhone ad hoc install), `ios-qa-simulator` (Mac simulator), and `ios-qa-testflight` (App Store Connect TestFlight).
- The production Expo `projectId`, `owner`, and hard-coded Supabase keys have deliberately been removed from the QA branch configuration.
- The QA Supabase client refuses either of the two already connected operational Supabase project URLs. Do not remove this safety check just to make a test install log in.

This configuration is intended to install *beside* the normal Chaos Coordinated app and use **a different Expo project, Apple identifier, and Supabase project**. Source isolation alone does not isolate data: do not connect QA to any operational backend.

## 1. Create the actual GitHub fork before building

The connected GitHub tools can create branches and files but cannot create a GitHub fork/repository. No true fork has yet been created.

On GitHub (using desktop view in a mobile browser if necessary):

1. Open `https://github.com/commanderchaos26/chaos-coordinated`.
2. Choose **Fork**. Set **Owner** to a GitHub organization or a different account you control (a personal account cannot fork its own repo into itself). Name it `chaos-coordinated-ios-qa`.
3. If GitHub offers **Copy the main branch only**, **uncheck it**, so the prepared `ios/apple-device-qa-current-20261009` branch is included.
4. Confirm the new repository address differs from `commanderchaos26/chaos-coordinated`. Switch to branch `ios/apple-device-qa-current-20261009`.
5. If that branch was not copied, copy it using Git in a Codespace or a computer:
   ```bash
   git remote add upstream https://github.com/commanderchaos26/chaos-coordinated.git
   git fetch upstream ios/apple-device-qa-current-20261009
   git checkout -b ios/apple-device-qa-current-20261009 FETCH_HEAD
   git push -u origin ios/apple-device-qa-current-20261009
   ```
6. Do **not** create a PR against or merge into the original repository. In the fork, use the QA branch for all future iOS testing.

If you cannot fork to another GitHub owner, create an independent *copy* repository under your account using GitHub Import/clone-and-push, then copy the QA branch. An independent copy offers code isolation but is technically not a GitHub fork.

## 2. Prepare a separate, non-production Supabase project

**Blocking prerequisite for operational testing:** create an empty QA project or a development database branch with its own URL and publishable key. Copy required **schema, policies, storage buckets and approved Edge Functions**, not real customer data. Test with fictional properties, units and employees.

Use the repository's own Supabase migration files to build QA, after reviewing them. Do not blindly run migrations or `db reset` against an operational project. Verify the QA reference before every database operation.

At a minimum, verify in QA:

- Authentication, account admission/invitations, memberships and role-based policies.
- Properties, turnovers, work orders, assignments, completion evidence, and storage buckets.
- Required Edge Functions (including admission/invite and AI walkthrough functionality) and their **QA-only** secrets, provider quotas and logging.
- Supabase **Authentication → URL Configuration → Redirect URLs** includes `chaoscoordinatedqa://set-password` (and any other actual QA callback used by invitations).
- Publishable/anon client key only. **Never** put a secret key, service-role key, Apple private key or admin password in the mobile source or GitHub Actions variables intended for public builds.

**Current QA source intentionally blocks these operational project refs:**
`twmjnbktebpaqwlsrgiy` and `ogvpexsnhyywmhqwstai`.

## 3. Set up the separate Expo project

On your PC/Mac, or in a GitHub Codespace opened on the new QA repository (a Mac is not required for *cloud* EAS builds):

```bash
git clone https://github.com/<YOUR-FORK-OWNER>/chaos-coordinated-ios-qa.git
cd chaos-coordinated-ios-qa
git checkout ios/apple-device-qa-current-20261009
npm ci
node scripts/verify-ios-qa.cjs
npm run typecheck
npx expo config --type public
npx eas-cli@latest login
npx eas-cli@latest project:init
```

When EAS asks to link/create a project, **create a NEW project** called `chaos-coordinated-ios-qa`. It must **not** reuse the operational EAS project ID. Confirm the new EAS project ID in `app.json` and commit that generated change **only to the QA fork**.

In that new Expo project, set the EAS **preview** environment variables:

```bash
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value "https://<QA_PROJECT_REF>.supabase.co" --visibility plaintext
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value "<QA_PUBLISHABLE_KEY>" --visibility plaintext
```

The publishable key is a client key, **not** an Apple signing/API key. Do not substitute a Supabase service-role/secret key. All three QA build profiles use the Expo **preview** environment—even TestFlight—to avoid accidentally selecting production variables.

For local development, place the same QA values in a private `.env` file (not committed), or pull preview environment values using the current EAS CLI's `env:pull` flow.

## 4. iPhone installation — choose one distribution method

### A. Ad hoc device testing (direct installer URL)

**Requires a paid Apple Developer Program membership** with permission to sign builds and an iPhone whose device UDID is registered to the Apple team. An App Store Connect API key is *optional* for interactive first-time setup; EAS can request Apple login.

```bash
npx eas-cli@latest device:create
npx eas-cli@latest build --platform ios --profile ios-qa-device
```

Open the device-registration URL from the **physical iPhone**, complete Apple's registration profile instructions, and make sure it belongs to the correct Apple team. If a phone was added *after* an earlier build, create a new build or re-sign with an updated provisioning profile: old builds will not automatically include new UDIDs. The finished EAS build details page contains an **Install** link for eligible registered devices. Open it in Safari on the iPhone. An ad hoc build is not a TestFlight build. Developer Mode may be required for development-signing scenarios.

### B. TestFlight (recommended for recurring iPhone beta testing)

**Requires:** active Apple Developer Program membership, App Store Connect team permissions, a QA app record/bundle ID, Apple-managed signing credentials and TestFlight on the tester's iPhone. **No arbitrary working App Store Connect key can be generated from the repository**; if using an API key, create it in your own authorized App Store Connect account and store the private `.p8` securely in EAS/approved secret storage, never GitHub.

```bash
npx eas-cli@latest build --platform ios --profile ios-qa-testflight
npx eas-cli@latest submit --platform ios --latest
```

Follow EAS prompts to authenticate to Apple and create/select the **QA** App Store Connect record. After Apple processes the submission, add internal testers in **App Store Connect → QA app → TestFlight** and send their invitation. External testing may require Apple beta review. The tester's actual invite/redeem link is issued by Apple; it cannot be fabricated ahead of submission.

### C. iOS Simulator (Mac only)

```bash
npx eas-cli@latest build --platform ios --profile ios-qa-simulator
```

This builds a **simulator** artifact, not an installable iPhone `.ipa`. It does not require Apple Developer Program signing, but an iOS simulator on a Mac is needed to run it. It does not validate real-device location, camera, push or performance behavior.

## 5. Tester onboarding (send after a signed build is ready)

1. Open the private **QA TestFlight invitation** or the authorized **QA ad hoc Install link**. Confirm app name is **Chaos Coordinated QA** before installing.
2. Use only the **QA account/invitation** supplied by the test coordinator. Production company logins, customers and operational assignments are out of scope.
3. After launch, check the splash screen, sign-in and home navigation. No shared production data should appear.
4. On an invite or forgotten password flow, open the email on the iPhone and verify its link opens **Chaos Coordinated QA** and the **Set your password** screen, not the production app. If not, check Supabase redirect allowlists and `chaoscoordinatedqa://` registration.
5. Grant location **While Using the App** when a job action requires it. Grant camera/photos only when attaching fictional work evidence. Deny a permission once and verify the app explains recovery rather than hanging.
6. Run the QA acceptance sequence below, collect screenshots with test-only data, and record build number and device iOS version.
7. If the app unexpectedly shows *actual* production employees, jobs, or locations, **STOP** and report the configuration issue. Do not make further assignments or edits.

## 6. Acceptance test script — pass/fail evidence

| Test | Expected result |
| --- | --- |
| Install/launch | QA app installs beside operational app and opens without crashing. |
| Sign in | Valid QA employee can sign in; invalid credential shows an understandable error. |
| Password recovery | QA email link returns to QA Set Password screen and changes password. |
| Walkthrough | A fictional 15-unit property walkthrough uploads test media, generates the intended work orders, and reports recoverable failures. |
| Assignment | Authorized manager assigns/bulk-assigns QA work; unauthorized employee cannot see management-only controls. |
| Employee lifecycle | Assigned employee accepts/completes work with required test photos, comments, location checkpoints and saved evidence. |
| Management retrieval | Manager can locate completed QA records, status, evidence and history; employee cannot retrieve restricted management records. |
| Offline/interruption | A lost connection gives clear retry guidance, does not duplicate work orders, and never claims unsaved work is complete. |
| Permissions | Camera/photo/location prompts happen only when relevant; denial does not cause a permanent dead end. |
| Isolation | Every resulting record appears in QA Supabase only; original app/Android releases and original repository main remain unchanged. |

Mark **not tested** if a backend function, Apple credential or device is unavailable. Do not claim end-to-end success from a TypeScript check alone.

## 7. Troubleshooting

- **No App Store Connect/Apple key:** EAS can collect Apple signing authentication interactively from an authorized Apple Developer team member. The `.p8` key, if used, must originate in App Store Connect. A GitHub token, Expo token or Supabase key does not sign iOS apps.
- **`No devices registered` / won't install:** register the actual iPhone UDID, confirm the correct Apple team, then rebuild or re-sign the ad hoc profile.
- **EAS found an existing project ID:** stop; do not continue using the operational `a8e01e90-c96c-4d01-a926-f0a830921b36` Expo project. Ensure the fork's QA branch has no production EAS ID, then initialize a fresh project.
- **Missing Supabase URL/key:** create the `preview` environment variables in the new QA Expo project, confirm the names match the code, and rebuild.
- **QA refuses backend connection:** the URL points to an already deployed operational project; supply a real new QA project rather than removing the guard.
- **Password reset email opens normal app or web:** confirm QA `scheme` and `redirectTo` match and Supabase Auth redirect allowlist has the QA link.
- **Edge Function returned non-2xx:** read the **QA** function logs and request IDs. Verify QA function deployment, input, JWT, secrets and storage/RLS. Do not deploy fixes directly to the operational project.
- **TestFlight build not installable from EAS link:** store-signed builds must be distributed by TestFlight/App Store, not direct ad hoc installation.

## 8. Release guardrails and ownership

- No automated App Store submission and no Apple credentials are stored in this QA branch.
- The iOS QA validation workflow performs *static* checks only and cannot sign or install the app.
- Never merge QA test code to `main` or use the production Android preview workflow for iPhone testing.
- Separate fork and build account permissions, EAS project identity, backend project and Apple bundle ID.
- Keep a record of QA build ID, Expo project ID, Apple bundle ID, Supabase QA ref, source commit, devices and sign-off.
- A green static check is **not** proof of a functioning IPA or working backend; the user acceptance script must pass on a real iPhone before any demonstration.

### Official references

- GitHub forks: https://docs.github.com/en/pull-requests/reference/forks
- Expo internal iOS distribution: https://docs.expo.dev/build/internal-distribution/
- Expo EAS environments: https://docs.expo.dev/eas/environment-variables/usage/
- Expo TestFlight: https://docs.expo.dev/submit/testflight/
- Expo iOS development device build: https://docs.expo.dev/tutorial/eas/ios-development-build-for-devices/
- Apple device registration: https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices
