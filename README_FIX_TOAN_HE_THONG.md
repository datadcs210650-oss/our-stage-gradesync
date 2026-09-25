# GradeSync – System Fixed

Bản này hợp nhất các hotfix hiện tại và tập trung vào lỗi Khóa Nộp / Chấm theo phiên.

## Sửa quan trọng
- Trước khi Khóa Nộp, BGK tự refresh user + grader_sessions.
- Query danh sách thí sinh hiện tại của nhóm và loại local draft của thí sinh đã bị xóa/chuyển nhóm.
- Chỉ gửi score khác với server; nếu score đã upload nhưng verification từng lỗi thì lần retry chỉ tạo verification.
- Score được gửi theo batch nhỏ; verification ghi riêng sau cùng.
- Audit + submission notification là best-effort, không còn làm hỏng lần nộp.
- Admin có thể sửa giờ ký; nếu score đã tồn tại nhưng verification bị thiếu, Admin có thể khôi phục trạng thái Khóa Nộp.
- Firestore Rules cho phép session submit sau giờ đóng, audit/notification/attendance cũng đồng nhất với chế độ phiên.
- Admin được phép tạo verification khi cần khôi phục lỗi hệ thống.
- Tự refresh phiên BGK khi tab quay lại hoặc mạng được nối lại.

## Triển khai bắt buộc
1. Upload `index.html` và `vercel.json` vào root GitHub.
2. Firebase Console → Firestore Database → Rules.
3. Dán toàn bộ `firestore.rules` trong gói này → Publish.
4. BGK đăng xuất và đăng nhập lại một lần.
