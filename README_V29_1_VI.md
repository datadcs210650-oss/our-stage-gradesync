# GradeSync V29.1 Stable Hotfix

Bản này dùng lõi V27/V29 và sửa 3 lỗi triển khai gấp:

1. Quản lý nhóm không còn crash `Invalid time value`: hỗ trợ ISO string, Date, Firestore Timestamp và dữ liệu ngày cũ không hợp lệ. Dữ liệu lỗi được hiển thị trống thay vì làm sập màn hình.
2. PDF dùng A4 ngang, bảng fixed-layout, 8 hàng mỗi trang, lặp header mỗi trang, tránh cắt hàng và giữ chữ ký nguyên khối.
3. Khi BGK xóa một ô điểm, trường đó bị xóa khỏi map `scores`, tổng điểm tính lại và realtime cập nhật Admin/BGK. Khi xóa hết các ô, giao diện trở về CHỜ và total 0; document cũ được giữ với `scores:{}` để không cần nới quyền delete cho BGK.

## Deploy
Upload `index.html` và `vercel.json` vào ROOT GitHub (ngang hàng). `firestore.rules` không đổi logic so với V29; chỉ Publish lại nếu Firebase đang dùng rules cũ hơn.
