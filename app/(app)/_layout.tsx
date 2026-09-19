import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '../../src/context/AuthProvider';
import { colors, radius } from '../../src/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

function TabIcon({ name, activeName, focused, color, size }: {
  name: IconName;
  activeName: IconName;
  focused: boolean;
  color: string;
  size: number;
}) {
  return (
    <View style={[styles.iconShell, focused && styles.iconShellActive]}>
      <Ionicons name={focused ? activeName : name} color={color} size={Math.min(size, 22)} />
    </View>
  );
}

export default function AppLayout() {
  const { session, loading } = useAuth();
  if (!loading && !session) return <Redirect href="/sign-in" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.tealBright,
        tabBarInactiveTintColor: colors.subtle,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: colors.nav,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 78,
          paddingBottom: 11,
          paddingTop: 7,
        },
        tabBarItemStyle: { paddingVertical: 1 },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '800', letterSpacing: 0.1 },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: ({ color, size, focused }) => <TabIcon name="home-outline" activeName="home" focused={focused} color={color} size={size} /> }} />
      <Tabs.Screen name="work-orders" options={{ title: 'Work Orders', tabBarIcon: ({ color, size, focused }) => <TabIcon name="construct-outline" activeName="construct" focused={focused} color={color} size={size} /> }} />
      <Tabs.Screen name="turnovers" options={{ title: 'Turnovers', tabBarIcon: ({ color, size, focused }) => <TabIcon name="sync-outline" activeName="sync" focused={focused} color={color} size={size} /> }} />
      <Tabs.Screen name="management" options={{ title: 'Management', tabBarIcon: ({ color, size, focused }) => <TabIcon name="people-outline" activeName="people" focused={focused} color={color} size={size} /> }} />
      <Tabs.Screen name="invite-employee" options={{ href: null, title: 'Invite Employee' }} />
      <Tabs.Screen name="employees" options={{ href: null, title: 'Employees' }} />
      <Tabs.Screen name="employee-detail" options={{ href: null, title: 'Employee Detail' }} />
      <Tabs.Screen name="skills" options={{ href: null, title: 'Skills' }} />
      <Tabs.Screen name="departments" options={{ href: null, title: 'Departments' }} />
      <Tabs.Screen name="crews" options={{ href: null, title: 'Crews' }} />
      <Tabs.Screen name="availability" options={{ href: null, title: 'Schedule & Exceptions' }} />
      <Tabs.Screen name="dispatch" options={{ href: null, title: 'Dispatch' }} />
      <Tabs.Screen name="notifications" options={{ href: null, title: 'Notifications' }} />
      <Tabs.Screen name="task-detail" options={{ href: null, title: 'Task Detail' }} />
      <Tabs.Screen name="properties" options={{ href: null, title: 'Properties & Geofences' }} />
      <Tabs.Screen name="new-work-order" options={{ href: null, title: 'New Work Order' }} />
      <Tabs.Screen name="ai-walkthrough" options={{ href: null, title: 'AI Walkthrough' }} />
      <Tabs.Screen name="ai-access" options={{ href: null, title: 'AI Walkthrough Access' }} />
      <Tabs.Screen name="time-clock" options={{ href: null, title: 'Time Clock' }} />
      <Tabs.Screen name="payroll" options={{ href: null, title: 'Payroll & Timecards' }} />
      <Tabs.Screen name="clients" options={{ href: null, title: 'Client Portal' }} />
      <Tabs.Screen name="new-client" options={{ href: null, title: 'New Client' }} />
      <Tabs.Screen name="client-detail" options={{ href: null, title: 'Client Detail' }} />
      <Tabs.Screen name="turn-list-import" options={{ href: null, title: 'Turn List Import' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconShell: { alignItems: 'center', borderRadius: radius.pill, height: 30, justifyContent: 'center', width: 42 },
  iconShellActive: { backgroundColor: colors.tealDeep, borderColor: '#1D6B60', borderWidth: 1 },
});
