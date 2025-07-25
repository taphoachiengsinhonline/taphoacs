// utils/getPushToken.js
import messaging from '@react-native-firebase/messaging';
import { PermissionsAndroid, Platform } from 'react-native';

export async function registerForPushNotifications() {
  if (Platform.OS === 'android') {
    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    if (enabled) {
      console.log('Authorization status:', authStatus);
      try {
        const token = await messaging().getToken();
        console.log("FCM TOKEN GỐC:", token);
        return token;
      } catch (error) {
        console.error("Lỗi khi lấy FCM token:", error);
        return null;
      }
    } else {
        console.log("Người dùng từ chối quyền thông báo.");
        return null;
    }
  }
  // (Thêm logic cho iOS nếu cần sau)
  return null;
}
