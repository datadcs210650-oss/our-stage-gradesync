# GradeSync V28 - Feature Matrix

| Yêu cầu | Trạng thái | Vị trí |
|---|---|---|
| Refactor thành module | ✅ | `src/*`, `api/*` |
| Nhận xét từng thí sinh | ✅ | `src/views/grading.js` |
| Đánh dấu thí sinh nổi bật | ✅ | `src/views/grading.js` |
| Cảnh báo/validation thiếu tiêu chí | ✅ | `src/services/scoring.js` |
| TB Hội đồng realtime | ✅ | `src/views/analytics.js` |
| Khóa từng thí sinh | ✅ | `src/views/candidates.js` + Rules |
| Phát hiện SBD trùng | ✅ | `src/utils/importValidation.js` |
| Preview Excel trước import | ✅ | `src/views/candidates.js` |
| Hàng đợi realtime | ✅ | `src/views/queue.js` |
| Offline scoring | ✅ | `src/offline/scoreQueue.js` |
| Auto sync khi có mạng | ✅ | `src/app.js` + `src/services/scoring.js` |
| Admin thấy BGK đang chấm ai | ✅ | `src/views/liveMonitor.js` |
| Khóa khẩn cấp toàn hệ thống | ✅ | `src/views/liveMonitor.js` + Rules |
| Phân bố điểm | ✅ | `src/views/analytics.js` |
| Tiêu chí thấp nhất | ✅ | `src/views/analytics.js` |
| Hiệu suất BGK | ✅ | `src/views/analytics.js` |
| Độ lệch điểm BGK | ✅ | `src/views/analytics.js` |
| PDF logo tùy chỉnh | ✅ | `src/views/reports.js` |
| Mã biên bản duy nhất | ✅ | `src/services/reports.js` |
| Số trang PDF | ✅ | `src/services/reports.js` |
| ZIP toàn bộ biên bản BGK | ✅ | `src/services/reports.js` |
| Firebase Auth riêng từng BGK | ✅ | `api/admin/*` + `src/auth/auth.js` |
| Live Monitor nâng cao | ✅ | `src/views/liveMonitor.js` |
| Backup / Restore | ✅ | `src/services/backup.js` |
| Automated tests | ✅ | `tests/*`, GitHub Actions |
| Staging workflow | ✅ | `docs/STAGING.md` |
| Session BGK tự hết hạn 2 giờ | ✅ | `src/app.js` |
| Cascade delete thí sinh | ✅ | `src/views/candidates.js` |
| Cascade delete nhóm | ✅ | `src/views/groups.js` |
| Realtime tối ưu theo route | ✅ | `src/state/store.js`, `src/app.js` |
