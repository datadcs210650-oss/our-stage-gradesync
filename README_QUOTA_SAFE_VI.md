# GradeSync – Quota Safe Hotfix

## Vì sao xuất hiện “Quota exceeded”
Đây là lỗi Firebase/Cloud Firestore báo project đã chạm hạn mức tài nguyên (thường là read/write quota), không phải lỗi nhập điểm của BGK.

## Bản này giảm mạnh số lượt ghi
- Autosave: 650 ms (thay vì 180 ms).
- Không ghi audit_logs sau từng lần gõ điểm.
- Chỉ ghi 1 audit khi BGK Khóa & Nộp bảng điểm.
- Presence heartbeat: 30 giây.
- Không ghi grader_sessions trước mỗi lần autosave.
- Nếu Firestore báo quota exceeded: giữ điểm tạm trong localStorage trên chính thiết bị BGK, không tiếp tục spam request.
- Sau cooldown/mạng phục hồi, hệ thống thử đồng bộ lại theo nhịp chậm.

## Quan trọng
Nếu quota Firestore của project đã thực sự hết trong ngày, code không thể ép Firebase nhận thêm ghi.
Bạn cần chờ quota reset hoặc bật billing/Blaze. Hotfix này chủ yếu ngăn mất điểm và tránh làm quota cạn nhanh hơn.
