# Staging GradeSync V28

1. Tạo branch `staging` từ `main`.
2. Push thay đổi mới vào `staging` trước.
3. GitHub Actions chạy unit test + syntax check.
4. Vercel tự tạo Preview Deployment cho branch `staging`.
5. Dùng Firebase project staging riêng nếu có thể. Nếu chưa có, tuyệt đối không test xóa/restore trên dữ liệu production.
6. Sau khi test Admin + BGK + offline + xuất file đạt, mở Pull Request `staging -> main`.
7. Merge vào `main` để Vercel Production deploy.

Khuyến nghị tạo Firebase project riêng: `gradesync-staging`, dùng config staging trong file `src/config/firebase.js` của branch staging hoặc chuyển config sang biến môi trường khi nâng cấp tiếp.
