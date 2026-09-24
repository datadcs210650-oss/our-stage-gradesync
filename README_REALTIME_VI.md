# GradeSync – Realtime Stable

Bản này giữ nguyên giao diện/tính năng hiện tại và tập trung sửa đồng bộ realtime cho nhiều BGK chấm đồng thời.

## Thay đổi chính
- Bỏ số phiên bản khỏi tên hiển thị của website.
- Không ghi `grader_sessions` trước từng lần lưu điểm nữa; score transaction đi thẳng tới Firestore.
- Autosave điểm giảm debounce xuống 180 ms.
- Heartbeat BGK 12 giây; Admin kiểm tra mất kết nối mỗi 5 giây.
- Listener BGK dùng `docChanges()` để chỉ xử lý document thay đổi.
- Listener điểm/candidate của Admin chỉ nghe nhóm đang xem, không dựng lại toàn bộ dữ liệu của mọi nhóm.
- Render Admin/BGK được gom trong khoảng 16–20 ms để 10 thay đổi đồng thời không render DOM 10 lần liên tiếp.
- Admin Live Monitor chuyển sang realtime cho nhóm, BGK, điểm, trạng thái nộp và tiến độ.
- Khi tab/mobile trở lại foreground hoặc mạng reconnect, BGK tự phục hồi listener.
- Vercel được cấu hình không cache `index.html`.

## Triển khai
1. Upload `index.html` và `vercel.json` vào root GitHub.
2. Giữ `firestore.rules` hiện tại; file trong gói này là bản tương ứng để đối chiếu.
3. Chờ Vercel Deployment = Ready.
4. Trên các máy BGK, tải lại trang một lần trước buổi chấm.

## Khuyến nghị trước buổi casting
Mở 10 thiết bị/tab bằng 10 mã BGK, cho cùng nhóm chấm, nhập điểm ở 10 thiết bị trong khoảng 5–10 giây rồi quan sát Admin Live Monitor và Bảng Điểm Live.
