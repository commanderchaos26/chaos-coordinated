import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { registerPushDevice } from './dispatchCommands';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function ensureAndroidChannel() {
  if (Platform.OS !== 'android' || !Device.isDevice) return;
  const channelId = 'assignments';
  const channelName = 'Assignments';
  await Notifications.setNotificationChannelAsync(channelId, {
    name: channelName,
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#29D3B2',
    sound: 'default',
  });
}

export async function requestNotificationPermission() {
  if (!Device.isDevice) return false;
  try {
    const settings = await Notifications.requestPermissionsAsync();
    const status = (settings as any).status;
    return status === 'granted';
  } catch {
    return false;
  }
}

export function getExpoProjectId() {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ||
    Constants.expoConfig?.projectId ||
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    'a8e01e90-c96c-4d01-a926-f0a830921b36'
  );
}

export async function getExpoPushToken() {
  if (!Device.isDevice) return null;
  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId: getExpoProjectId() });
    return token.data || null;
  } catch {
    return null;
  }
}

export async function registerForPushNotifications(companyId: string) {
  if (!companyId) return false;
  try {
    await ensureAndroidChannel();
    const granted = await requestNotificationPermission();
    if (!granted) return false;
    const token = await getExpoPushToken();
    if (!token) return false;
    await registerPushDevice({
      p_company_id: companyId,
      p_expo_push_token: token,
      p_platform: Platform.OS === 'android' ? 'android' : 'ios',
      p_device_label: Device.modelName || Platform.OS,
    });
    return true;
  } catch {
    return false;
  }
}

export function registerNotificationTapHandler() {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as Record<string, unknown> | undefined;
    const assignmentId = typeof data?.assignment_id === 'string' ? data.assignment_id : null;
    const workOrderId = typeof data?.work_order_id === 'string' ? data.work_order_id : null;
    if (assignmentId) {
      router.push({ pathname: '/(app)/task-detail' as never, params: { assignmentId } });
      return;
    }
    if (workOrderId) {
      router.push({ pathname: '/(app)/task-detail' as never, params: { id: workOrderId } });
    }
  });
  return () => subscription.remove();
}
