# GradeSync V29 - V27 Restored Core

Bản này dùng trực tiếp V27 System Hardened Realtime làm nền tảng ổn định.
Mục tiêu: khôi phục đầy đủ cách vận hành/giao diện V27 và loại bỏ runtime V28 modular đang gây lỗi giao diện/reset.

## Cài đặt
1. Upload `index.html` và `vercel.json` vào root repo GitHub.
2. Vercel tự deploy. Domain cũ không đổi.
3. Copy `firestore.rules` vào Firebase > Firestore Database > Rules > Publish.
4. Đăng xuất rồi đăng nhập lại Admin/BGK.

## Nút Đặt lại phiên
Trong sidebar có nút **Đặt lại phiên / tải lại sạch**. Nút này chỉ xóa cache/phiên trên trình duyệt, KHÔNG xóa Firestore, thí sinh hay điểm đã lưu.

## Ghi chú
- Đây là runtime V27 ổn định, không dùng module V28.
- Các file V28 cũ có thể để trong repo nhưng `index.html` này không gọi tới chúng.
- Sau khi chạy ổn có thể xóa các file V28 thừa để repo gọn hơn.
