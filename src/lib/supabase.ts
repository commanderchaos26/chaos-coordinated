import 'react-native-url-polyfill/auto';
import 'expo-sqlite/localStorage/install';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
}

// Test builds must not use either of the two already deployed operational backends.
const host = new URL(url).hostname;
if (['twmjnbktebpaqwlsrgiy.supabase.co', 'ogvpexsnhyywmhqwstai.supabase.co'].includes(host)) {
  throw new Error('iOS QA requires an isolated staging Supabase project. See docs/IOS_QA_ONBOARDING.md.');
}

export const supabase = createClient(url, key, {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
