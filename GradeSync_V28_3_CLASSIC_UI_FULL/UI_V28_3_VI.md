# GradeSync V28.3 – Classic UI

Bản V28.3 chỉ thay lớp giao diện và trải nghiệm thao tác, không thay kiến trúc dữ liệu/realtime của V28.

## Giao diện
- Khôi phục tông đỏ đô/trắng gần phong cách V27.
- Sidebar gọn hơn, có icon, có thu gọn/mở rộng và hỗ trợ mobile.
- Topbar hiển thị Trực tuyến/Mất kết nối và số bản ghi chờ đồng bộ.
- Toàn bộ menu chính bằng tiếng Việt.
- Login tách rõ Quản trị viên/Giám khảo.
- Bảng chấm có Xem bảng/Xem cá nhân; Xem cá nhân hiển thị hồ sơ thí sinh, trường phụ, điểm, kết quả, hàng đợi và nhận xét.
- Hàng đợi và Giám sát trực tiếp được Việt hóa và sắp xếp lại.

## Logic được giữ nguyên
- Firebase Auth riêng cho BGK.
- Realtime nhóm/thí sinh/điểm/quyền/presence.
- Offline score queue và tự sync khi có mạng.
- Transaction + revision chống ghi đè.
- Validation trước khi nộp.
- Analytics, Reports, Backup/Restore, Audit, Emergency Lock.

## Kiểm tra
- npm test: 5/5 PASS.
- npm run check: PASS.
