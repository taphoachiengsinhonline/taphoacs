// utils/getPushToken.js
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, Alert } from 'react-native';

// Hàm đăng ký và lấy push token
export async function registerForPushNotificationsAsync() {
  try {
    if (!Device.isDevice) {
      Alert.alert('Thông báo', 'Chỉ thiết bị thật mới nhận được thông báo đẩy');
      return null;
    }

    // Kiểm tra quyền hiện tại
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Nếu chưa cấp quyền thì yêu cầu người dùng cấp
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    // Nếu vẫn không được cấp quyền thì thông báo lỗi
    if (finalStatus !== 'granted') {
      Alert.alert('Thông báo', 'Bạn cần cấp quyền để nhận thông báo');
      return null;
    }

    // Lấy push token từ Expo
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: 'YOUR_PROJECT_ID_HERE' // nếu dùng EAS hoặc SDK 48+ thì nên thêm dòng này
    });

    console.log('Expo Push Token:', tokenData.data);
    return tokenData.data;
  } catch (error) {
    console.error('Lỗi lấy push token:', error);
    return null;
  }
}

