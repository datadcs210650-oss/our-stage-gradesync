# GradeSync V28.2 - UI CORE FIX

- CSS chính vẫn được inline trong `index.html`.
- `src/app.js` có thêm CSS safety-net để giao diện vẫn đúng khi file CSS bên ngoài bị thiếu/cache sai.
- Header hiển thị badge `V28.2` để xác nhận Vercel đã deploy đúng bản.
- Sửa khôi phục phiên Firebase Auth cho BGK sau khi F5/reload.
- Không thay đổi cấu trúc Firestore Rules so với V28.1.

Nếu website vẫn hiện kiểu HTML mặc định và không thấy badge V28.2, Vercel chưa phục vụ `index.html`/`src/app.js` của bản này.
