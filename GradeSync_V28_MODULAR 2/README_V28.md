# GradeSync V28 Modular

V28 là bản refactor từ hệ thống GradeSync V27 theo mô hình ES Modules + Vercel Serverless API.

## Tính năng mới chính
- Refactor module, bỏ mô hình một file HTML khổng lồ và override hàm nhiều lần.
- Firebase Authentication riêng cho từng BGK (mã BGK + mật khẩu).
- Offline scoring + sync queue + chống ghi đè bằng revision.
- Admin Live Monitor nâng cao, presence, BGK đang chấm thí sinh nào.
- Hàng đợi thí sinh realtime.
- Nhận xét từng tiêu chí + nhận xét chung + đánh dấu nổi bật.
- Validation bắt buộc đủ tiêu chí trước khi Khóa & Nộp.
- Điểm TB Hội đồng realtime, phân bố điểm, tiêu chí thấp nhất, độ lệch BGK, hiệu suất BGK.
- Khóa riêng từng thí sinh.
- Import Excel preview + phát hiện SBD trùng.
- Khóa khẩn cấp toàn hệ thống.
- PDF: logo tùy chỉnh, mã biên bản duy nhất, đánh số trang.
- ZIP toàn bộ biên bản BGK.
- Backup/Restore JSON.
- Unit tests + GitHub Actions + staging workflow.

## Cài đặt GitHub / Vercel
Upload toàn bộ thư mục project này vào repo, không chỉ riêng `index.html`.
Vercel nhận `index.html` ở root và `/api/*` là Serverless Functions.

## Firebase Rules
Copy toàn bộ `firestore.rules` vào Firebase Console > Firestore Database > Rules > Publish.

## Firebase Auth BGK riêng
V28 dùng Vercel Serverless API + Firebase Admin SDK để tạo/reset tài khoản BGK an toàn.
Trong Vercel > Project > Settings > Environment Variables, thêm:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

Hoặc dùng một biến `FIREBASE_SERVICE_ACCOUNT_JSON` chứa JSON service account đầy đủ.
Không commit service account/private key lên GitHub.

Sau khi thêm biến môi trường, Redeploy project.

## Migrate BGK cũ
Trong Quản lý Giám khảo, tài khoản cũ sẽ hiện `Legacy`.
Bấm `Kích hoạt Auth`, nhập mật khẩu tạm. Backend tạo Firebase Auth user và chuyển profile sang document UID mới.

## Offline scoring
Nếu mất mạng, điểm được lưu trong queue trên trình duyệt. Khi online lại, V28 tự sync bằng transaction và kiểm tra `baseRevision`. Nếu server đã thay đổi trong lúc offline, V28 không ghi đè mà báo xung đột.

## Staging
Xem `docs/STAGING.md`.
