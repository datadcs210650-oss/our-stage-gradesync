# GradeSync V28.4 – Giao diện V27 trên kiến trúc module V28

Bản này giữ nguyên kiến trúc module, Firebase Auth riêng cho BGK, realtime, offline queue, báo cáo, analytics, backup/restore của V28; đồng thời phục hồi các thành phần giao diện và dữ liệu quan trọng từ V27.

## Phần chấm điểm
- Hai chế độ Xem bảng / Xem cá nhân.
- Danh sách thí sinh bên trái, hồ sơ đầy đủ bên phải.
- Hiển thị Mã số/SBD, họ tên và các trường thông tin bổ sung được Admin cho phép BGK xem.
- Điểm tổng, kết quả, điểm đạt, hàng đợi, trạng thái điểm danh, khóa thí sinh, nổi bật.
- Nhận xét từng tiêu chí và nhận xét chung.
- Admin có thể chọn giám khảo để xem bảng điểm riêng.
- Admin có thể điểm danh trực tiếp ở chế độ bảng.
- Giữ vị trí cuộn khi realtime cập nhật.

## Quản lý nhóm
- Khôi phục cấu hình Trường thông tin bổ sung.
- Mỗi trường có tùy chọn Hiện BGK.
- Quản lý tiêu chí, trọng số, điểm đạt, thời gian, điểm danh và nội dung chấm.

## Quản lý thí sinh
- Hiển thị thông tin bổ sung ngay trong danh sách.
- Thêm / chỉnh sửa thí sinh với trường động theo từng nhóm.
- File mẫu Excel theo cấu hình nhóm.
- Import preview có trường phụ và kiểm tra trùng SBD.
- Xuất danh sách đầy đủ.

## Realtime
- Admin theo dõi danh sách BGK bằng subscription users(role=Grader).
- Phân quyền, nhóm, thí sinh, điểm, điểm danh và trạng thái nộp vẫn dùng realtime hiện tại.
- Không thay Firestore Rules so với V28.3.
