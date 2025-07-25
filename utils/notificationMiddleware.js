// utils/notificationMiddleware.js

const sendPushNotification = require('./sendPushNotification');
const User = require('../models/User'); // << QUAN TRỌNG: Phải import User model để có thể xóa token

module.exports = {
  safeNotify: async (token, notificationData) => {
    try {
      if (!token) {
        console.log('[safeNotify] Không có FCM token, bỏ qua gửi thông báo.');
        return { success: false, error: 'Missing token' };
      }
      
      const safeData = {
        ...notificationData,
        title: notificationData.title || 'Thông báo',
        body: notificationData.body || '',
        data: notificationData.data || {}
      };

      // =========================================================
      // THÊM LOG TRƯỚC KHI GỬI
      // =========================================================
      console.log(`[safeNotify] Chuẩn bị gửi thông báo đến token: ${token}`);
      console.log(`[safeNotify] Nội dung: ${JSON.stringify(safeData, null, 2)}`);
      
      // Gửi thông báo
      const result = await sendPushNotification(token, safeData);
      
      // =========================================================
      // THÊM LOG KẾT QUẢ TRẢ VỀ ("BIÊN LAI")
      // =========================================================
      console.log(`[safeNotify] KẾT QUẢ từ sendPushNotification:`, JSON.stringify(result, null, 2));

      // Xử lý token không hợp lệ (logic của bạn vẫn được giữ nguyên và cải tiến)
      if (result && result.error) {
        // Log lỗi cụ thể
        console.error(`[safeNotify] Gửi thông báo thất bại. Chi tiết:`, result.details);
        
        // Kiểm tra lỗi DeviceNotRegistered một cách an toàn hơn
        const isDeviceNotRegistered = result.details?.errorCode === 'DEVICE_NOT_REGISTERED' || 
                                      result.details?.error === 'DeviceNotRegistered';

        if (isDeviceNotRegistered) {
          console.log(`[safeNotify] Token ${token} không hợp lệ. Tiến hành xóa khỏi database.`);
          try {
            const updateResult = await User.updateOne(
              { fcmToken: token },
              { $unset: { fcmToken: "" } } // Dùng "" thay vì 1 để tương thích tốt hơn
            );
            console.log(`[safeNotify] Kết quả xóa token: ${updateResult.modifiedCount} bản ghi được cập nhật.`);
          } catch (dbError) {
            console.error('[safeNotify] Lỗi khi xóa token khỏi database:', dbError);
          }
        }
        return { success: false, error: result.details };
      }
      
      // Log trạng thái thành công
      console.log(`[safeNotify] Gửi thông báo thành công tới token: ${token}`);
      return { success: true };

    } catch (error) {
      console.error('[safeNotify] Lỗi nghiêm trọng trong hàm safeNotify:', error);
      return { success: false, error };
    }
  }
};
