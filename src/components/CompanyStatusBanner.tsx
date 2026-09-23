import { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { loadMembership } from '../lib/membership';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';

type SuspensionState = {
  companyId: string | null;
  status: string;
  reason: string | null;
};

export function CompanyStatusBanner() {
  const [state, setState] = useState<SuspensionState>({ companyId: null, status: 'active', reason: null });

  useEffect(() => {
    let mounted = true;
    let companyId: string | null = null;

    const loadStatus = async () => {
      try {
        const membership = await loadMembership();
        companyId = membership?.companyId ?? null;
        if (!companyId) return;
        const { data, error } = await supabase
          .from('companies')
          .select('status,suspension_reason')
          .eq('id', companyId)
          .single();
        if (error) throw error;
        if (mounted) setState({ companyId, status: data.status, reason: data.suspension_reason ?? null });
      } catch {
        // Status visibility is additive. Normal app behavior continues if this check fails.
      }
    };

    void loadStatus();

    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') void loadStatus();
    });

    const channel = supabase
      .channel('company-license-status')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'companies' }, (payload) => {
        const row = payload.new as { id?: string; status?: string; suspension_reason?: string | null };
        if (!companyId || row.id !== companyId || !row.status) return;
        if (mounted) setState({ companyId, status: row.status, reason: row.suspension_reason ?? null });
      })
      .subscribe();

    return () => {
      mounted = false;
      appState.remove();
      void supabase.removeChannel(channel);
    };
  }, []);

  if (state.status !== 'suspended') return null;

  return (
    <View pointerEvents="none" style={styles.banner}>
      <Text style={styles.title}>ACCOUNT SUSPENDED — READ-ONLY MODE</Text>
      <Text numberOfLines={2} style={styles.reason}>{state.reason || 'Contact Infinite Chaos Solutions for account service.'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.redDeep,
    borderBottomColor: colors.red,
    borderBottomWidth: 1,
    left: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1000,
  },
  title: { color: colors.text, fontSize: 11, fontWeight: '900', letterSpacing: 0.7, textAlign: 'center' },
  reason: { color: colors.muted, fontSize: 11, marginTop: 2, textAlign: 'center' },
});
