import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge, Card, EmptyState, Icon, SectionHeader } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { loadMembership } from '../../src/lib/membership';
import { generatePreviousWeekPayroll, getPayrollDownload } from '../../src/lib/timeClockCommands';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type PayrollExport = {
  id: string;
  employee_id: string;
  week_start: string;
  week_end: string;
  file_name: string;
  content: string;
  daily_hours: Record<string, number>;
  total_hours: number;
  generated_at: string;
  generated_by: string;
  employee_name?: string;
};

const dayOrder = ['monday','tuesday','wednesday','thursday','friday'];

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}


export default function PayrollScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [rows, setRows] = useState<PayrollExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<PayrollExport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await loadMembership();
      setMembership(current);
      if (!current) return;

      const canManage = current.roles.some((role) => ['owner','operations_manager'].includes(role));
      if (!canManage) return;

      const { data: exportsData, error: exportsError } = await supabase
        .from('payroll_exports')
        .select('id,employee_id,week_start,week_end,file_name,content,daily_hours,total_hours,generated_at,generated_by')
        .eq('company_id', current.companyId)
        .order('week_start', { ascending: false })
        .order('file_name', { ascending: true });

      if (exportsError) throw exportsError;

      const exports = (exportsData ?? []) as PayrollExport[];
      const exportEmployeeIds = [...new Set(exports.map((item) => item.employee_id))];
      const activeLinked = new Set<string>();

      if (exportEmployeeIds.length) {
        const { data: links, error: linksError } = await supabase
          .from('employee_account_links')
          .select('employee_id')
          .eq('company_id', current.companyId)
          .eq('status', 'active')
          .in('employee_id', exportEmployeeIds);
        if (linksError) throw linksError;
        for (const link of links ?? []) activeLinked.add(link.employee_id);
      }

      const visibleExports = exports.filter((item) => activeLinked.has(item.employee_id));
      const employeeIds = [...new Set(visibleExports.map((item) => item.employee_id))];
      const employeeMap = new Map<string,string>();

      if (employeeIds.length) {
        const { data: employees, error: employeesError } = await supabase
          .from('employees')
          .select('id,display_name')
          .in('id', employeeIds);
        if (employeesError) throw employeesError;
        for (const employee of employees ?? []) employeeMap.set(employee.id, employee.display_name);
      }

      setRows(visibleExports.map((item) => ({ ...item, employee_name: employeeMap.get(item.employee_id) ?? item.file_name.replace(/\.txt$/i, '') })));
    } catch (cause) {
      setError(getErrorMessage(cause, 'Could not load payroll exports.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const canManage = Boolean(membership?.roles.some((role) => ['owner','operations_manager'].includes(role)));

  const grouped = useMemo(() => {
    const map = new Map<string, PayrollExport[]>();
    for (const row of rows) {
      const key = `${row.week_start}|${row.week_end}`;
      const current = map.get(key) ?? [];
      current.push(row);
      map.set(key, current);
    }
    return Array.from(map.entries());
  }, [rows]);

  const generateNow = async () => {
    if (!membership || busy) return;
    setBusy('generate');
    try {
      const result = await generatePreviousWeekPayroll(membership.companyId);
      await load();
      Alert.alert('Payroll exports refreshed', 'The previous completed Monday–Friday payroll files were regenerated.');
    } catch (cause) {
      Alert.alert('Payroll generation failed', getErrorMessage(cause, 'Could not generate payroll exports.'));
    } finally {
      setBusy(null);
    }
  };

  const download = async (item: PayrollExport) => {
    setBusy(item.id);
    try {
      const file = await getPayrollDownload(item.id);
      const supported = await Linking.canOpenURL(file.signed_url);
      if (!supported) throw new Error('This device could not open the payroll file link.');
      await Linking.openURL(file.signed_url);
    } catch (cause) {
      Alert.alert('Could not open payroll file', getErrorMessage(cause, 'Try again.'));
    } finally {
      setBusy(null);
    }
  };

  if (loading && !membership) return <LoadingScreen label="Loading payroll..." />;

  if (!canManage) {
    return <View style={styles.denied}><Icon name="lock-closed-outline" color={colors.amber} size={28}/><Text style={styles.deniedTitle}>Payroll access required</Text><Text style={styles.deniedText}>Only the Owner and Operations Manager can open payroll exports.</Text><Pressable onPress={() => router.back()} style={styles.backButton}><Text style={styles.backText}>Back</Text></Pressable></View>;
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
        <View style={styles.topbar}>
          <Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21}/></Pressable>
          <View style={styles.titleWrap}><Text style={styles.eyebrow}>MANAGEMENT PAYROLL</Text><Text style={styles.title}>Payroll & timecards</Text></View>
        </View>

        <Card style={styles.hero}>
          <View style={styles.heroIcon}><Icon name="document-text-outline" color={colors.teal} size={26}/></View>
          <Text style={styles.heroTitle}>Thursday payroll files</Text>
          <Text style={styles.heroText}>Every Thursday the system generates one text export per employee for the most recently completed Monday–Friday week. Each file contains daily hours and the weekly total.</Text>
          <Pressable disabled={busy === 'generate'} onPress={() => void generateNow()} style={[styles.generateButton, busy === 'generate' && styles.disabled]}>
            <Icon name="refresh-outline" color={colors.background} size={18}/>
            <Text style={styles.generateText}>{busy === 'generate' ? 'Generating…' : 'Generate previous week now'}</Text>
          </Pressable>
        </Card>

        {error ? <Card style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></Card> : null}

        <SectionHeader title="Payroll files" />
        {grouped.length ? grouped.map(([key, exports]) => {
          const [start,end] = key.split('|');
          return (
            <View key={key} style={styles.weekBlock}>
              <View style={styles.weekHeader}>
                <View><Text style={styles.weekLabel}>PAYROLL WEEK</Text><Text style={styles.weekDates}>{new Date(start + 'T12:00:00').toLocaleDateString()} – {new Date(end + 'T12:00:00').toLocaleDateString()}</Text></View>
                <Badge label={`${exports.length} files`} tone="blue"/>
              </View>

              {exports.map((item) => (
                <Card key={item.id} style={styles.fileCard}>
                  <View style={styles.fileTop}>
                    <View style={styles.fileIcon}><Icon name="document-text" color={colors.teal} size={22}/></View>
                    <View style={styles.fileCopy}><Text style={styles.fileName}>{item.file_name}</Text><Text style={styles.employeeName}>{item.employee_name}</Text></View>
                    <View style={styles.hoursBox}><Text style={styles.hoursValue}>{Number(item.total_hours).toFixed(2)}</Text><Text style={styles.hoursLabel}>HOURS</Text></View>
                  </View>

                  <View style={styles.dayStrip}>
                    {dayOrder.map((day) => <View key={day} style={styles.dayCell}><Text style={styles.dayLabel}>{day.slice(0,3).toUpperCase()}</Text><Text style={styles.dayValue}>{Number(item.daily_hours?.[day] ?? 0).toFixed(2)}</Text></View>)}
                  </View>

                  <View style={styles.actions}>
                    <Pressable onPress={() => setPreview(item)} style={styles.secondary}><Icon name="eye-outline" color={colors.teal} size={17}/><Text style={styles.secondaryText}>Preview</Text></Pressable>
                    <Pressable disabled={busy === item.id} onPress={() => void download(item)} style={[styles.primary, busy === item.id && styles.disabled]}><Icon name="download-outline" color={colors.background} size={17}/><Text style={styles.primaryText}>{busy === item.id ? 'Opening…' : 'Open .txt'}</Text></Pressable>
                  </View>
                </Card>
              ))}
            </View>
          );
        }) : <EmptyState icon="document-text-outline" title="No payroll files yet" message="The Thursday job will create the previous completed Monday–Friday payroll files. You can also generate them now for testing."/>}
      </ScrollView>

      <Modal visible={Boolean(preview)} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <View style={styles.modalShade}>
          <View style={styles.previewModal}>
            <View style={styles.modalHeader}><View><Text style={styles.modalEyebrow}>TEXT FILE PREVIEW</Text><Text style={styles.modalTitle}>{preview?.file_name}</Text></View><Pressable onPress={() => setPreview(null)} style={styles.close}><Icon name="close" color={colors.text} size={22}/></Pressable></View>
            <ScrollView style={styles.previewScroll}><Text style={styles.previewText}>{preview?.content}</Text></ScrollView>
            {preview ? <Pressable onPress={() => void download(preview)} style={styles.primary}><Icon name="download-outline" color={colors.background} size={18}/><Text style={styles.primaryText}>Open .txt file</Text></Pressable> : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flexGrow: 1, gap: spacing.md, padding: spacing.lg, paddingBottom: 110 },
  topbar: { alignItems: 'center', flexDirection: 'row', paddingTop: spacing.sm },
  back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  titleWrap: { flex: 1, marginLeft: spacing.md },
  eyebrow: { color: colors.teal, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: colors.text, ...typography.title, marginTop: 3 },
  hero: { padding: spacing.lg },
  heroIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 999, height: 52, justifyContent: 'center', width: 52 },
  heroTitle: { color: colors.text, fontSize: 19, fontWeight: '900', marginTop: spacing.md },
  heroText: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: spacing.sm },
  generateButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 13, flexDirection: 'row', gap: 7, justifyContent: 'center', marginTop: spacing.lg, minHeight: 48 },
  generateText: { color: colors.background, fontSize: 13, fontWeight: '900' },
  errorCard: { backgroundColor: colors.redDeep, padding: spacing.md },
  errorText: { color: colors.text },
  weekBlock: { gap: spacing.sm, marginBottom: spacing.lg },
  weekHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  weekLabel: { color: colors.subtle, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  weekDates: { color: colors.text, fontSize: 15, fontWeight: '900', marginTop: 3 },
  fileCard: { padding: spacing.md },
  fileTop: { alignItems: 'center', flexDirection: 'row' },
  fileIcon: { alignItems: 'center', backgroundColor: colors.tealDeep, borderRadius: 12, height: 44, justifyContent: 'center', width: 44 },
  fileCopy: { flex: 1, marginLeft: spacing.md },
  fileName: { color: colors.text, fontSize: 15, fontWeight: '900' },
  employeeName: { color: colors.muted, fontSize: 11, marginTop: 3 },
  hoursBox: { alignItems: 'flex-end' },
  hoursValue: { color: colors.teal, fontSize: 21, fontWeight: '900' },
  hoursLabel: { color: colors.subtle, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  dayStrip: { backgroundColor: colors.surfaceSoft, borderRadius: 12, flexDirection: 'row', marginTop: spacing.md, paddingVertical: spacing.sm },
  dayCell: { alignItems: 'center', flex: 1 },
  dayLabel: { color: colors.subtle, fontSize: 8, fontWeight: '900' },
  dayValue: { color: colors.text, fontSize: 12, fontWeight: '800', marginTop: 3 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  primary: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 12, flex: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 46 },
  primaryText: { color: colors.background, fontSize: 12, fontWeight: '900' },
  secondary: { alignItems: 'center', backgroundColor: colors.tealDeep, borderColor: colors.teal, borderRadius: 12, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 46 },
  secondaryText: { color: colors.teal, fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.55 },
  modalShade: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.72)', flex: 1, justifyContent: 'center', padding: spacing.lg },
  previewModal: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 20, borderWidth: 1, maxHeight: '82%', padding: spacing.lg, width: '100%' },
  modalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  modalEyebrow: { color: colors.teal, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '900', marginTop: 3 },
  close: { alignItems: 'center', backgroundColor: colors.surfaceSoft, borderRadius: 999, height: 40, justifyContent: 'center', width: 40 },
  previewScroll: { backgroundColor: colors.background, borderRadius: 12, marginVertical: spacing.md, maxHeight: 360, padding: spacing.md },
  previewText: { color: colors.text, fontFamily: 'monospace', fontSize: 13, lineHeight: 21 },
  denied: { alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center', padding: spacing.xl },
  deniedTitle: { color: colors.text, fontSize: 19, fontWeight: '900', marginTop: spacing.md },
  deniedText: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.sm, textAlign: 'center' },
  backButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 12, marginTop: spacing.lg, minHeight: 46, paddingHorizontal: spacing.xl, justifyContent: 'center' },
  backText: { color: colors.background, fontWeight: '900' },
});
