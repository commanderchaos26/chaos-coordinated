import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from './FieldUI';
import { colors, spacing } from '../theme';

export type PickerMode = 'date' | 'time' | 'datetime';

type Props = {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  mode: PickerMode;
  placeholder?: string;
  optional?: boolean;
  disabled?: boolean;
};

const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthLabels = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (value: number) => String(value).padStart(2, '0');

function localDateValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTimeValue(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localDateTimeValue(date: Date) {
  return `${localDateValue(date)}T${localTimeValue(date)}:00`;
}

function parseValue(value: string, mode: PickerMode) {
  const now = new Date();
  now.setSeconds(0, 0);
  if (!value) return now;

  if (mode === 'date') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  }

  if (mode === 'time') {
    const match = /^(\d{1,2}):(\d{2})/.exec(value);
    if (match) {
      const date = new Date();
      date.setHours(Number(match[1]), Number(match[2]), 0, 0);
      return date;
    }
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? now : parsed;
}

function formatDisplay(value: string, mode: PickerMode) {
  if (!value) return '';
  const date = parseValue(value, mode);
  if (mode === 'date') return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (mode === 'time') return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function serialize(date: Date, mode: PickerMode) {
  if (mode === 'date') return localDateValue(date);
  if (mode === 'time') return localTimeValue(date);
  return localDateTimeValue(date);
}

export function DateTimePickerField({ label, value, onChange, mode, placeholder, optional = false, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => parseValue(value, mode));
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const date = parseValue(value, mode);
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const [stage, setStage] = useState<'date' | 'time'>(mode === 'time' ? 'time' : 'date');

  const openPicker = () => {
    const parsed = parseValue(value, mode);
    setDraft(parsed);
    setVisibleMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
    setStage(mode === 'time' ? 'time' : 'date');
    setOpen(true);
  };

  const calendarCells = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - firstDay + 1;
      return day >= 1 && day <= daysInMonth ? day : null;
    });
  }, [visibleMonth]);

  const chooseDay = (day: number) => {
    const next = new Date(draft);
    next.setFullYear(visibleMonth.getFullYear(), visibleMonth.getMonth(), day);
    setDraft(next);
    if (mode === 'date') {
      onChange(serialize(next, mode));
      setOpen(false);
    } else if (mode === 'datetime') {
      setStage('time');
    }
  };

  const setHour = (hour12: number) => {
    const next = new Date(draft);
    const isPm = next.getHours() >= 12;
    const hour24 = hour12 === 12 ? (isPm ? 12 : 0) : hour12 + (isPm ? 12 : 0);
    next.setHours(hour24);
    setDraft(next);
  };

  const setMinute = (minute: number) => {
    const next = new Date(draft);
    next.setMinutes(minute, 0, 0);
    setDraft(next);
  };

  const setAmPm = (pm: boolean) => {
    const next = new Date(draft);
    const hour = next.getHours();
    if (pm && hour < 12) next.setHours(hour + 12);
    if (!pm && hour >= 12) next.setHours(hour - 12);
    setDraft(next);
  };

  const commit = () => {
    onChange(serialize(draft, mode));
    setOpen(false);
  };

  const display = formatDisplay(value, mode);
  const icon = mode === 'date' ? 'calendar-outline' : mode === 'time' ? 'time-outline' : 'calendar-outline';
  const hour12 = draft.getHours() % 12 || 12;
  const minute = Math.round(draft.getMinutes() / 5) * 5 % 60;
  const isPm = draft.getHours() >= 12;

  return <View style={styles.wrap}>
    {label ? <Text style={styles.label}>{label}</Text> : null}
    <Pressable disabled={disabled} onPress={openPicker} style={({ pressed }) => [styles.field, pressed && !disabled && styles.pressed, disabled && styles.disabled]}>
      <Icon name={icon} color={value ? colors.teal : colors.subtle} size={20} />
      <Text style={[styles.value, !display && styles.placeholder]}>{display || placeholder || (mode === 'time' ? 'Choose time' : 'Choose date')}</Text>
      <Icon name="chevron-forward" color={colors.subtle} size={18} />
    </Pressable>

    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.backdrop}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <View style={styles.headerCopy}>
              <Text style={styles.modalTitle}>{mode === 'date' ? 'Choose date' : mode === 'time' ? 'Choose time' : 'Choose date & time'}</Text>
              <Text style={styles.summary}>{formatDisplay(serialize(draft, mode), mode)}</Text>
            </View>
            <Pressable onPress={() => setOpen(false)} hitSlop={10}><Icon name="close" color={colors.muted} size={24} /></Pressable>
          </View>

          {mode === 'datetime' ? <View style={styles.tabs}>
            <Pressable onPress={() => setStage('date')} style={[styles.tab, stage === 'date' && styles.tabActive]}><Icon name="calendar-outline" color={stage === 'date' ? colors.teal : colors.muted} size={17} /><Text style={[styles.tabText, stage === 'date' && styles.tabTextActive]}>Date</Text></Pressable>
            <Pressable onPress={() => setStage('time')} style={[styles.tab, stage === 'time' && styles.tabActive]}><Icon name="time-outline" color={stage === 'time' ? colors.teal : colors.muted} size={17} /><Text style={[styles.tabText, stage === 'time' && styles.tabTextActive]}>Clock</Text></Pressable>
          </View> : null}

          {stage === 'date' && mode !== 'time' ? <View>
            <View style={styles.monthHeader}>
              <Pressable onPress={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))} style={styles.monthButton}><Icon name="chevron-back" color={colors.text} size={20} /></Pressable>
              <Text style={styles.monthTitle}>{monthLabels[visibleMonth.getMonth()]} {visibleMonth.getFullYear()}</Text>
              <Pressable onPress={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))} style={styles.monthButton}><Icon name="chevron-forward" color={colors.text} size={20} /></Pressable>
            </View>
            <View style={styles.weekRow}>{weekdayLabels.map((day) => <Text key={day} style={styles.weekLabel}>{day}</Text>)}</View>
            <View style={styles.calendarGrid}>{calendarCells.map((day, index) => {
              const selected = day !== null && draft.getFullYear() === visibleMonth.getFullYear() && draft.getMonth() === visibleMonth.getMonth() && draft.getDate() === day;
              return <View key={index} style={styles.dayCell}>{day ? <Pressable onPress={() => chooseDay(day)} style={[styles.dayButton, selected && styles.daySelected]}><Text style={[styles.dayText, selected && styles.dayTextSelected]}>{day}</Text></Pressable> : null}</View>;
            })}</View>
            {mode === 'datetime' ? <Text style={styles.hint}>Tap a day. The clock opens next.</Text> : null}
          </View> : null}

          {stage === 'time' || mode === 'time' ? <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.clockContent}>
            <Text style={styles.clockReadout}>{draft.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</Text>
            <Text style={styles.clockLabel}>Hour</Text>
            <View style={styles.choiceGrid}>{Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => <Pressable key={hour} onPress={() => setHour(hour)} style={[styles.timeChoice, hour12 === hour && styles.timeChoiceActive]}><Text style={[styles.timeChoiceText, hour12 === hour && styles.timeChoiceTextActive]}>{hour}</Text></Pressable>)}</View>
            <Text style={styles.clockLabel}>Minute</Text>
            <View style={styles.choiceGrid}>{Array.from({ length: 12 }, (_, index) => index * 5).map((item) => <Pressable key={item} onPress={() => setMinute(item)} style={[styles.timeChoice, minute === item && styles.timeChoiceActive]}><Text style={[styles.timeChoiceText, minute === item && styles.timeChoiceTextActive]}>{pad(item)}</Text></Pressable>)}</View>
            <View style={styles.ampmRow}><Pressable onPress={() => setAmPm(false)} style={[styles.ampm, !isPm && styles.timeChoiceActive]}><Text style={[styles.ampmText, !isPm && styles.timeChoiceTextActive]}>AM</Text></Pressable><Pressable onPress={() => setAmPm(true)} style={[styles.ampm, isPm && styles.timeChoiceActive]}><Text style={[styles.ampmText, isPm && styles.timeChoiceTextActive]}>PM</Text></Pressable></View>
          </ScrollView> : null}

          <View style={styles.actions}>
            {optional && value ? <Pressable onPress={() => { onChange(''); setOpen(false); }} style={styles.clearButton}><Text style={styles.clearText}>Clear</Text></Pressable> : <View style={styles.flex} />}
            {(stage === 'time' || mode === 'time') ? <Pressable onPress={commit} style={styles.doneButton}><Text style={styles.doneText}>Done</Text></Pressable> : null}
          </View>
        </View>
      </View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  label: { color: colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 0.7, textTransform: 'uppercase' },
  field: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 54, paddingHorizontal: spacing.md },
  pressed: { borderColor: colors.teal },
  disabled: { opacity: 0.45 },
  value: { color: colors.text, flex: 1, fontSize: 15, fontWeight: '700' },
  placeholder: { color: colors.subtle, fontWeight: '500' },
  backdrop: { alignItems: 'center', backgroundColor: '#000000AA', flex: 1, justifyContent: 'center', padding: spacing.lg },
  modal: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 20, borderWidth: 1, maxHeight: '90%', padding: spacing.lg, width: '100%' },
  modalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  headerCopy: { flex: 1, minWidth: 0 },
  modalTitle: { color: colors.text, fontSize: 19, fontWeight: '900' },
  summary: { color: colors.teal, fontSize: 13, fontWeight: '800', marginTop: 4 },
  tabs: { backgroundColor: colors.surfaceSoft, borderRadius: 12, flexDirection: 'row', marginTop: spacing.md, padding: 4 },
  tab: { alignItems: 'center', borderRadius: 9, flex: 1, flexDirection: 'row', gap: spacing.xs, justifyContent: 'center', minHeight: 42 },
  tabActive: { backgroundColor: colors.tealDeep },
  tabText: { color: colors.muted, fontSize: 13, fontWeight: '800' },
  tabTextActive: { color: colors.teal },
  monthHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  monthButton: { alignItems: 'center', backgroundColor: colors.surfaceSoft, borderRadius: 10, height: 40, justifyContent: 'center', width: 40 },
  monthTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  weekRow: { flexDirection: 'row', marginTop: spacing.md },
  weekLabel: { color: colors.subtle, flex: 1, fontSize: 10, fontWeight: '800', textAlign: 'center' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
  dayCell: { alignItems: 'center', height: 44, justifyContent: 'center', width: '14.2857%' },
  dayButton: { alignItems: 'center', borderRadius: 999, height: 38, justifyContent: 'center', width: 38 },
  daySelected: { backgroundColor: colors.teal },
  dayText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  dayTextSelected: { color: colors.background, fontWeight: '900' },
  hint: { color: colors.subtle, fontSize: 11, marginTop: spacing.sm, textAlign: 'center' },
  clockContent: { paddingBottom: spacing.sm, paddingTop: spacing.md },
  clockReadout: { color: colors.teal, fontSize: 34, fontWeight: '900', textAlign: 'center' },
  clockLabel: { color: colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 0.7, marginBottom: spacing.sm, marginTop: spacing.md, textTransform: 'uppercase' },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  timeChoice: { alignItems: 'center', backgroundColor: colors.surfaceSoft, borderColor: colors.border, borderRadius: 10, borderWidth: 1, justifyContent: 'center', minHeight: 42, width: '23%' },
  timeChoiceActive: { backgroundColor: colors.tealDeep, borderColor: colors.teal },
  timeChoiceText: { color: colors.muted, fontSize: 14, fontWeight: '800' },
  timeChoiceTextActive: { color: colors.teal },
  ampmRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  ampm: { alignItems: 'center', backgroundColor: colors.surfaceSoft, borderColor: colors.border, borderRadius: 11, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 46 },
  ampmText: { color: colors.muted, fontSize: 14, fontWeight: '900' },
  actions: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  flex: { flex: 1 },
  clearButton: { alignItems: 'center', borderColor: colors.border, borderRadius: 11, borderWidth: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: spacing.lg },
  clearText: { color: colors.muted, fontWeight: '800' },
  doneButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 11, justifyContent: 'center', minHeight: 46, minWidth: 110, paddingHorizontal: spacing.lg },
  doneText: { color: colors.background, fontWeight: '900' },
});
