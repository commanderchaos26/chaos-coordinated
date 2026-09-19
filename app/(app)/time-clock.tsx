import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, Icon } from '../../src/components/FieldUI';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { loadMembership } from '../../src/lib/membership';
import { supabase } from '../../src/lib/supabase';
import { punchTimeClock } from '../../src/lib/timeClockCommands';
import { colors, spacing, typography } from '../../src/theme';
import type { Membership } from '../../src/types/app';

type AttendanceEvent = {
  id: string;
  action: 'check_in' | 'check_out' | 'break_start' | 'break_end' | 'manual_adjustment';
  occurred_at: string;
  source: string | null;
};

type DaySummary = {
  key: string;
  label: string;
  dateLabel: string;
  clockIn: string | null;
  clockOut: string | null;
  hours: number;
  open: boolean;
};

const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function startOfWeek(date = new Date()) {
  const copy = new Date(date);
  const day = copy.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + delta);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function dateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function TimeClockScreen() {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [events, setEvents] = useState<AttendanceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [punching, setPunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await loadMembership();
      setMembership(current);
      if (!current) return;

      const since = new Date();
      since.setDate(since.getDate() - 21);
      since.setHours(0, 0, 0, 0);

      const { data, error: attendanceError } = await supabase
        .from('attendance_events')
        .select('id,action,occurred_at,source')
        .eq('company_id', current.companyId)
        .eq('employee_id', current.employeeId)
        .gte('occurred_at', since.toISOString())
        .in('action', ['check_in', 'check_out'])
        .order('occurred_at', { ascending: true });

      if (attendanceError) throw attendanceError;
      setEvents((data ?? []) as AttendanceEvent[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your time clock.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const lastPunch = events.length ? events[events.length - 1] : null;
  const clockedIn = lastPunch?.action === 'check_in';

  const days = useMemo(() => {
    const monday = startOfWeek();
    const map = new Map<string, DaySummary>();

    for (let offset = 0; offset < 5; offset += 1) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + offset);
      const key = dateKey(date);
      map.set(key, {
        key,
        label: dayNames[date.getDay()],
        dateLabel: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        clockIn: null,
        clockOut: null,
        hours: 0,
        open: false,
      });
    }

    let openIn: AttendanceEvent | null = null;
    for (const event of events) {
      if (event.action === 'check_in') {
        openIn = event;
        const key = dateKey(new Date(event.occurred_at));
        const day = map.get(key);
        if (day && !day.clockIn) day.clockIn = event.occurred_at;
        if (day) day.open = true;
        continue;
      }

      if (event.action === 'check_out' && openIn) {
        const inDate = new Date(openIn.occurred_at);
        const outDate = new Date(event.occurred_at);
        const key = dateKey(inDate);
        const day = map.get(key);
        if (day) {
          day.clockIn = day.clockIn ?? openIn.occurred_at;
          day.clockOut = event.occurred_at;
          day.hours += Math.max(0, (outDate.getTime() - inDate.getTime()) / 3600000);
          day.open = false;
        }
        openIn = null;
      }
    }

    return Array.from(map.values());
  }, [events]);

  const weekHours = days.reduce((sum, day) => sum + day.hours, 0);

  const punch = async () => {
    if (!membership || punching) return;
    setPunching(true);
    try {
      await punchTimeClock(membership.companyId, clockedIn ? 'check_out' : 'check_in');
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not update your time clock.';
      Alert.alert('Time clock', message.includes('already_clocked_in') ? 'You are already clocked in.' : message.includes('not_clocked_in') ? 'You are not currently clocked in.' : message);
    } finally {
      setPunching(false);
    }
  };

  if (loading && !membership) return <LoadingScreen label="Loading time clock..." />;

  return (
    <ScrollView contentContainerStyle={styles.root} showsVerticalScrollIndicator={false}>
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()} style={styles.back}><Icon name="arrow-back" color={colors.text} size={21} /></Pressable>
        <View style={styles.titleWrap}><Text style={styles.eyebrow}>EMPLOYEE TIME CLOCK</Text><Text style={styles.title}>Clock in / Clock out</Text></View>
      </View>

      {error ? <Card style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></Card> : null}

      <Card style={styles.clockCard}>
        <View style={[styles.statusDot, clockedIn && styles.statusDotLive]} />
        <Text style={styles.statusLabel}>{clockedIn ? 'CLOCKED IN' : 'CLOCKED OUT'}</Text>
        <Text style={styles.stampLabel}>{clockedIn ? 'Clock-in timestamp' : 'Last clock-out timestamp'}</Text>
        <Text style={styles.stamp}>{lastPunch ? new Date(lastPunch.occurred_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No punches yet'}</Text>

        <Pressable disabled={punching} onPress={() => void punch()} style={[styles.punchButton, clockedIn && styles.punchOutButton, punching && styles.disabled]}>
          <Icon name={clockedIn ? 'log-out-outline' : 'log-in-outline'} color={colors.background} size={22} />
          <Text style={styles.punchText}>{punching ? 'Saving…' : clockedIn ? 'Clock Out' : 'Clock In'}</Text>
        </Pressable>
      </Card>

      <View style={styles.weekHeader}>
        <View><Text style={styles.weekEyebrow}>THIS WEEK</Text><Text style={styles.weekTitle}>Monday through Friday</Text></View>
        <View style={styles.totalBadge}><Text style={styles.totalValue}>{weekHours.toFixed(2)}</Text><Text style={styles.totalLabel}>HOURS</Text></View>
      </View>

      {days.map((day) => (
        <Card key={day.key} style={styles.dayCard}>
          <View style={styles.dayTop}><View><Text style={styles.dayName}>{day.label}</Text><Text style={styles.dayDate}>{day.dateLabel}</Text></View><Text style={styles.dayHours}>{day.hours.toFixed(2)} hrs</Text></View>
          <View style={styles.punchRow}>
            <View style={styles.punchCell}><Text style={styles.cellLabel}>CLOCK IN</Text><Text style={styles.cellValue}>{formatTime(day.clockIn)}</Text></View>
            <View style={styles.divider} />
            <View style={styles.punchCell}><Text style={styles.cellLabel}>CLOCK OUT</Text><Text style={styles.cellValue}>{day.open ? 'Working' : formatTime(day.clockOut)}</Text></View>
          </View>
        </Card>
      ))}

      <Text style={styles.footerNote}>Your payroll file uses completed Monday–Friday punches. Management receives the previous completed workweek export every Thursday.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background, flexGrow: 1, gap: spacing.md, padding: spacing.lg, paddingBottom: 110 },
  topbar: { alignItems: 'center', flexDirection: 'row', paddingTop: spacing.sm },
  back: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  titleWrap: { flex: 1, marginLeft: spacing.md },
  eyebrow: { color: colors.teal, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: colors.text, ...typography.title, marginTop: 3 },
  errorCard: { backgroundColor: colors.redDeep, padding: spacing.md },
  errorText: { color: colors.text },
  clockCard: { alignItems: 'center', padding: spacing.xl },
  statusDot: { backgroundColor: colors.subtle, borderRadius: 999, height: 12, width: 12 },
  statusDotLive: { backgroundColor: colors.teal },
  statusLabel: { color: colors.teal, fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginTop: spacing.sm },
  stampLabel: { color: colors.muted, fontSize: 12, marginTop: spacing.lg },
  stamp: { color: colors.text, fontSize: 19, fontWeight: '900', marginTop: 5, textAlign: 'center' },
  punchButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 16, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.xl, minHeight: 58, width: '100%' },
  punchOutButton: { backgroundColor: colors.amber },
  punchText: { color: colors.background, fontSize: 17, fontWeight: '900' },
  disabled: { opacity: 0.55 },
  weekHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  weekEyebrow: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  weekTitle: { color: colors.text, fontSize: 18, fontWeight: '900', marginTop: 2 },
  totalBadge: { alignItems: 'flex-end' },
  totalValue: { color: colors.teal, fontSize: 24, fontWeight: '900' },
  totalLabel: { color: colors.subtle, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  dayCard: { padding: spacing.md },
  dayTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  dayName: { color: colors.text, fontSize: 16, fontWeight: '900' },
  dayDate: { color: colors.muted, fontSize: 12, marginTop: 2 },
  dayHours: { color: colors.teal, fontSize: 15, fontWeight: '900' },
  punchRow: { alignItems: 'center', backgroundColor: colors.surfaceSoft, borderRadius: 12, flexDirection: 'row', marginTop: spacing.md, padding: spacing.md },
  punchCell: { flex: 1 },
  cellLabel: { color: colors.subtle, fontSize: 9, fontWeight: '900', letterSpacing: 0.9 },
  cellValue: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 4 },
  divider: { backgroundColor: colors.border, height: 34, marginHorizontal: spacing.md, width: 1 },
  footerNote: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: spacing.sm, textAlign: 'center' },
});
