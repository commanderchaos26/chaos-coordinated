import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { registerPushDevice } from './dispatchCommands';

const FALLBACK_EAS_PROJECT_ID = 'a8e01e90-c96c-4d01-a926-f0a830921b36';

const handledResponses = new Set<string>();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function ensureAndroidChannel() {
  if (Platform.OS !== 'android' || !Device.isDevice) return;

  await Notifications.setNotificationChannelAsync('assignments', {
    name: 'Assignments',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#29D3B2',
    sound: 'default',
  });
}

type PermissionSnapshot = {
  granted?: boolean;
  status?: string;
  canAskAgain?: boolean;
  ios?: {
    status?: number;
  };
};

function normalizePermission(value: unknown): PermissionSnapshot {
  return (value ?? {}) as PermissionSnapshot;
}

function permissionAllowsNotifications(value: unknown) {
  const settings = normalizePermission(value);

  if (settings.granted === true) return true;

  return (
    Platform.OS === 'ios' &&
    settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

export async function requestNotificationPermission() {
  if (!Device.isDevice) return false;

  try {
    const existingRaw = await Notifications.getPermissionsAsync();
    const existing = normalizePermission(existingRaw);

    if (permissionAllowsNotifications(existing)) {
      return true;
    }

    if (
      existing.canAskAgain === false ||
      existing.status === 'denied'
    ) {
      return false;
    }

    const requested = await Notifications.requestPermissionsAsync();

    return permissionAllowsNotifications(requested);
  } catch {
    return false;
  }
}

export function getExpoProjectId() {
  return process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? FALLBACK_EAS_PROJECT_ID;
}

export async function getExpoPushToken() {
  if (!Device.isDevice) return null;

  try {
    const token = await Notifications.getExpoPushTokenAsync({
      projectId: getExpoProjectId(),
    });

    return token.data || null;
  } catch {
    return null;
  }
}

export async function registerForPushNotifications(companyId: string) {
  if (!companyId || !Device.isDevice) return false;

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

function notificationResponseKey(
  response: Notifications.NotificationResponse,
) {
  return `${response.notification.request.identifier}:${response.actionIdentifier}`;
}

function navigateFromNotificationResponse(
  response: Notifications.NotificationResponse,
) {
  const key = notificationResponseKey(response);

  if (handledResponses.has(key)) {
    return;
  }

  handledResponses.add(key);

  const data = response.notification.request.content.data as
    | Record<string, unknown>
    | undefined;

  const assignmentId =
    typeof data?.assignment_id === 'string' ? data.assignment_id : null;

  const workOrderId =
    typeof data?.work_order_id === 'string' ? data.work_order_id : null;

  if (assignmentId) {
    router.push({
      pathname: '/(app)/task-detail' as never,
      params: { assignmentId },
    });
    return;
  }

  if (workOrderId) {
    router.push({
      pathname: '/(app)/task-detail' as never,
      params: { id: workOrderId },
    });
  }
}

export function registerNotificationTapHandler() {
  let active = true;

  const subscription =
    Notifications.addNotificationResponseReceivedListener((response) => {
      if (!active) return;

      navigateFromNotificationResponse(response);

      void Notifications.clearLastNotificationResponseAsync().catch(
        () => undefined,
      );
    });

  void Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (!active || !response) return;

      navigateFromNotificationResponse(response);

      return Notifications.clearLastNotificationResponseAsync();
    })
    .catch(() => undefined);

  return () => {
    active = false;
    subscription.remove();
  };
}
