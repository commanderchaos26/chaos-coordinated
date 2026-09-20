import { supabase } from './supabase';

function paramsFromUrl(url: string) {
  const params = new URLSearchParams();
  const queryIndex = url.indexOf('?');
  const hashIndex = url.indexOf('#');

  if (queryIndex >= 0) {
    const queryEnd = hashIndex > queryIndex ? hashIndex : url.length;
    const query = url.slice(queryIndex + 1, queryEnd);
    for (const [key, value] of new URLSearchParams(query)) params.set(key, value);
  }

  if (hashIndex >= 0) {
    const hash = url.slice(hashIndex + 1);
    for (const [key, value] of new URLSearchParams(hash)) params.set(key, value);
  }

  return params;
}

export async function consumeAuthDeepLink(url: string) {
  const params = paramsFromUrl(url);
  const code = params.get('code');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const type = params.get('type');
  const errorDescription = params.get('error_description') ?? params.get('error');

  if (errorDescription) throw new Error(errorDescription);

  let sessionEstablished = false;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    sessionEstablished = Boolean(data.session);
  } else if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    sessionEstablished = Boolean(data.session);
  }

  const target = url.split(/[?#]/, 1)[0].toLowerCase();
  const isPasswordRoute = target === 'chaoscoordinated://set-password' || target.endsWith('/set-password');

  return { type, sessionEstablished, isPasswordRoute };
}
