# Chaos Coordinated Mobile

Initial Expo/React Native foundation for Digital Divide LLC's Chaos Coordinated operations app.

## What is already wired

- Supabase email/password authentication
- Custom deep-link scheme: `chaoscoordinated://`
- Invite/recovery deep-link handling
- First-login admission completion via the deployed `complete-admission` Edge Function
- Owner/Operations Manager employee invitation via the deployed `invite-employee` Edge Function
- Role-aware Management Center entry point
- Work Orders and Turnovers starter screens backed by the existing RLS-protected Supabase tables
- Foreground-only location permission language (no continuous background tracking)

## Local setup

1. Install Node.js 22.13 or newer compatible with Expo SDK 57.
2. Copy `.env.example` to `.env`.
3. Put your Supabase publishable key in `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
4. Run:

```bash
npm install
npx expo start
```

For a native development build:

```bash
npx expo run:android
# or
npx expo run:ios
```

## Important

Do not put a Supabase secret key or service-role key in this project. The mobile app only uses the publishable key. Privileged actions are performed in authenticated Supabase Edge Functions.

## Next implementation milestones

1. Work-order detail/action commands with location challenge snapshots
2. Turnover walkthrough templates and evidence upload
3. Dispatch and crew scheduling
4. Chat and operational channels
5. Full Management Center (people, roles, skills, credentials, properties, geofences)
6. Notifications/outbox processing
7. Offline queue and reconciliation UX
