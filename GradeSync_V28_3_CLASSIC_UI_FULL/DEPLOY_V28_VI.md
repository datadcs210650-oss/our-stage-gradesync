# Cách nâng GradeSync hiện tại lên V28

## 1. Không chỉ thay `index.html`
V28 đã refactor thành nhiều module. Vì vậy phải đưa **toàn bộ nội dung thư mục `GradeSync_V28_MODULAR`** lên repository GitHub.

Repo sau khi cập nhật cần có dạng:

```
index.html
styles/
src/
api/
tests/
.github/
package.json
vercel.json
firestore.rules
```

Domain Vercel cũ không mất vì bạn vẫn dùng repository/project Vercel hiện tại.

## 2. Test trên branch staging trước
- Tạo branch `staging`.
- Upload V28 lên `staging`.
- Chờ GitHub Actions chạy xanh.
- Mở Vercel Preview Deployment của branch staging.
- Test Admin, BGK, lưu điểm, offline, queue, xuất PDF/ZIP.

## 3. Cập nhật Firestore Rules
Firebase Console > Firestore Database > Rules > copy toàn bộ `firestore.rules` > Publish.

## 4. Bật Email/Password Authentication
Firebase Console > Authentication > Sign-in method > Email/Password > Enable.
Admin và BGK V28 đều dùng Firebase Auth email/password. BGK vẫn đăng nhập bằng **Mã BGK + mật khẩu**; hệ thống tự chuyển mã BGK thành email nội bộ.

## 5. Cấu hình Vercel Serverless API để Admin tạo/reset BGK
Vercel > Project > Settings > Environment Variables, thêm:
- FIREBASE_PROJECT_ID
- FIREBASE_CLIENT_EMAIL
- FIREBASE_PRIVATE_KEY

Không đưa private key vào GitHub.
Sau khi thêm biến môi trường, Redeploy Preview/Production.

## 6. Migrate BGK cũ
Admin > Giám khảo.
BGK cũ hiện `Legacy` -> bấm `Kích hoạt Auth` -> đặt mật khẩu tạm.
API sẽ:
- tạo Firebase Auth riêng cho BGK,
- chuyển profile sang UID mới,
- chuyển score cũ sang `graderUid` mới,
- đổi ID score cũ sang `UID_candidateId`,
- chuyển trạng thái nộp cũ.

## 7. Merge production
Khi staging đạt:
- Pull Request `staging -> main`
- Merge
- Vercel Production tự deploy
- Domain cũ giữ nguyên

## 8. Checklist test trước sự kiện
1. Admin đăng nhập.
2. Tạo/migrate 1 BGK thử nghiệm.
3. Phân quyền 1 nhóm.
4. BGK đăng nhập bằng mã + mật khẩu.
5. Nhóm xuất hiện realtime.
6. Admin mở nhóm.
7. BGK thấy thí sinh.
8. Admin tick có mặt / hàng đợi.
9. BGK nhập điểm + nhận xét.
10. Tắt mạng, nhập thêm điểm; bật mạng và kiểm tra auto sync.
11. Khóa 1 thí sinh và xác nhận BGK không sửa được.
12. Bấm Khóa & Nộp khi còn thiếu tiêu chí -> phải bị chặn.
13. Chấm đủ -> nộp thành công.
14. Admin xem Live Monitor / Analytics.
15. Xuất PDF, Excel, ZIP.
16. Tạo Backup JSON.
17. Test khóa khẩn cấp.
