import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { DEMO, supabase } from './lib/supabase';

const TOKEN_KEY = 'push-token';
const enabled = !DEMO && Platform.OS !== 'web';

if (enabled) {
  // Mostra o aviso mesmo com o app aberto.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
    }),
  });
}

// Pede permissão, pega o código do celular e guarda no servidor para o usuário logado.
export async function registerForPush() {
  if (!enabled || !Device.isDevice) return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Avisos', importance: Notifications.AndroidImportance.DEFAULT, lightColor: '#672A82',
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const { error } = await supabase.rpc('register_push_token', { p_token: token });
    if (!error) await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Sem projeto EAS, no Expo Go ou sem internet: o app segue normalmente, só sem avisos.
  }
}

// Ao sair, este celular deixa de receber os avisos desse usuário.
export async function unregisterPush() {
  if (!enabled) return;
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token) return;
    await supabase.rpc('unregister_push_token', { p_token: token });
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignora
  }
}
