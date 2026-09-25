# GradeSync – Chế độ chấm theo phiên

## Chế độ mới
Admin có thể bật **Chấm theo phiên** ngay trên Bảng điểm Live của từng nhóm.

Khi bật:
- BGK nhập điểm nhưng điểm chỉ lưu cục bộ trên thiết bị BGK.
- Không ghi `scores` lên Firestore khi đang nhập.
- Realtime **điểm** giữa BGK → Admin tạm tắt.
- Các realtime khác vẫn hoạt động: quyền nhóm, mở/khóa nhóm, điểm danh, tiêu chí, câu hỏi, trạng thái tài khoản.
- Khi BGK bấm **Khóa Nộp**, toàn bộ điểm trong phiên được gửi một lần lên Firestore và bảng điểm được khóa.
- Admin chỉ nhìn thấy điểm của BGK đã Khóa Nộp trong nhóm đang bật chế độ này.

## Sửa thời gian ký
Trong **Giám sát trực tiếp**, khi BGK đã khóa/nộp, Admin có nút **Sửa giờ ký**.
Admin có thể nhập lại ngày/giờ ký khi hệ thống gặp lỗi hoặc BGK nộp trễ.

## Bắt buộc cập nhật Rules
Bản này cần publish `firestore.rules` đi kèm vì Admin cần quyền cập nhật `grader_verifications.timestamp`.

## Lưu ý
Điểm nháp của chế độ phiên nằm trên đúng trình duyệt/thiết bị BGK. Không xóa dữ liệu trình duyệt trước khi Khóa Nộp.
