# GradeSync – Fix quyền Khóa Nộp của BGK

Lỗi `Missing or insufficient permissions` xảy ra vì Rules cũ chỉ cho BGK ghi điểm khi nhóm còn ở trạng thái đang mở.
Trong chế độ **Chấm theo phiên**, BGK thường Khóa Nộp sau khi thời gian/nhóm đã đóng, nên Firestore từ chối batch.

## Đã sửa
- Thêm quyền `graderCanSubmitSession(groupId)`.
- Khi `sessionSubmitMode == true`, BGK đã được phân công vẫn có thể:
  - đọc thí sinh của nhóm;
  - đọc điểm cũ của chính mình;
  - gửi/update score của chính mình;
  - tạo trạng thái Khóa Nộp;
  kể cả nhóm đã hết giờ/đã đóng.
- Sau khi `grader_verifications.isVerified == true`, BGK vẫn không thể sửa tiếp điểm.
- Trước khi gửi, website làm mới users/grader_sessions để tránh session quyền cũ.
- Nếu Rules chưa publish, website báo rõ “Firestore Rules chưa đúng cho Chấm theo phiên”.

## BẮT BUỘC
1. Thay `index.html` ở root GitHub.
2. Firebase Console → Firestore Database → Rules.
3. Dán TOÀN BỘ `firestore.rules` trong gói này.
4. Publish.
5. Cho BGK đăng xuất → đăng nhập lại một lần.
