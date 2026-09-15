import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, spacing } from '../theme';

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  required?: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void | Promise<void>;
};

export function TextEntryModal({
  visible,
  title,
  message,
  placeholder,
  initialValue = '',
  confirmLabel = 'Confirm',
  required = false,
  loading = false,
  onCancel,
  onConfirm,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setValue(initialValue);
      setError('');
    }
  }, [visible, initialValue]);

  const submit = async () => {
    const trimmed = value.trim();

    if (required && !trimmed) {
      setError('This field is required.');
      return;
    }

    setError('');
    await onConfirm(trimmed);
  };

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={() => {
        if (!loading) onCancel();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.backdrop}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <Text style={styles.title}>{title}</Text>

            {message ? <Text style={styles.message}>{message}</Text> : null}

            <TextInput
              autoFocus
              editable={!loading}
              multiline
              onChangeText={(text) => {
                setValue(text);
                if (error) setError('');
              }}
              placeholder={placeholder}
              placeholderTextColor={colors.subtle}
              style={styles.input}
              value={value}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.actions}>
              <Pressable
                disabled={loading}
                onPress={onCancel}
                style={[styles.button, styles.cancel, loading && styles.disabled]}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>

              <Pressable
                disabled={loading}
                onPress={() => void submit()}
                style={[styles.button, styles.confirm, loading && styles.disabled]}
              >
                <Text style={styles.confirmText}>
                  {loading ? 'Working…' : confirmLabel}
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: '#000000AA',
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  message: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    marginTop: spacing.md,
    minHeight: 110,
    padding: spacing.md,
    textAlignVertical: 'top',
  },
  error: {
    color: colors.red,
    fontSize: 12,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  cancel: {
    backgroundColor: colors.surfaceSoft,
  },
  confirm: {
    backgroundColor: colors.teal,
  },
  cancelText: {
    color: colors.text,
    fontWeight: '800',
  },
  confirmText: {
    color: colors.background,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.55,
  },
});
