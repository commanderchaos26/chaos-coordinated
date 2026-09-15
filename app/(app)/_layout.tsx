import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '../../src/context/AuthProvider';
import { colors } from '../../src/theme';

export default function AppLayout() {
  const { session, loading } = useAuth();
  if (!loading && !session) return <Redirect href="/sign-in" />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.teal, tabBarInactiveTintColor: colors.subtle, tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 76, paddingBottom: 12, paddingTop: 8 }, tabBarLabelStyle: { fontSize: 11, fontWeight: '700' }, sceneStyle: { backgroundColor: colors.background } }}>
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="work-orders" options={{ title: 'Work Orders', tabBarIcon: ({ color, size }) => <Ionicons name="construct-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="turnovers" options={{ title: 'Turnovers', tabBarIcon: ({ color, size }) => <Ionicons name="sync-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="management" options={{ title: 'Management', tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" color={color} size={size} /> }} />
      <Tabs.Screen name="invite-employee" options={{ href: null, title: 'Invite Employee' }} />
      <Tabs.Screen name="employees" options={{ href: null, title: 'Employees' }} />
      <Tabs.Screen name="employee-detail" options={{ href: null, title: 'Employee Detail' }} />
      <Tabs.Screen name="skills" options={{ href: null, title: 'Skills' }} />
    </Tabs>
  );
}
