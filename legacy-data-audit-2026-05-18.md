# Báo cáo kiểm kê dữ liệu legacy

Ngày kiểm kê: 18/05/2026  
Nguồn dữ liệu: `k-host-002-default-rtdb-export.json` xuất từ Firebase Realtime Database ngày 17/05/2026

## Kết luận nhanh

- Vấn đề lớn nhất nằm ở `tenant_demo`, đặc biệt là collection `rooms`.
- `tenant_demo/rooms` có `209` bản ghi vật lý nhưng chỉ có `70` phòng logic duy nhất.
- Có `47` `room id` bị trùng, tạo ra `139` dòng dư thừa; cả `47/47` nhóm trùng này đều có dữ liệu khác nhau giữa các bản ghi.
- Đây là nguyên nhân nền có thể gây ra các lỗi kiểu:
  - xoá xong rồi F5 lại thấy sống lại;
  - màn này thấy phòng, màn khác không thấy;
  - cùng một phòng nhưng đôi lúc hiện số phòng hoặc hạng phòng khác nhau.
- Ngoài ra còn có một tenant khác đang chứa phòng mồ côi tham chiếu tới chi nhánh/hạng phòng không còn tồn tại.

## 1. Dữ liệu legacy còn nằm ở gốc database

Ngoài cấu trúc `tenants/...`, database vẫn còn `70` bản ghi cũ ở root:

| Collection | Số bản ghi |
| --- | ---: |
| `properties` | 5 |
| `roomTypes` | 6 |
| `rooms` | 13 |
| `bookings` | 33 |
| `users` | 9 |
| `customers` | 2 |
| `tags` | 2 |

Toàn bộ nhóm này dùng key số kiểu `0`, `1`, `2`... và `key != id`.

Đánh giá:
- Đây là dữ liệu tiền-tenant còn sót lại.
- Hiện app mới không nên dùng trực tiếp nhóm này nữa, nhưng nó làm database khó đọc và dễ gây nhầm khi thao tác thủ công.

## 2. Tình trạng theo từng tenant

### `tenant_1765962103076`

| Collection | Tổng | Key số | `key != id` | Trùng `id` |
| --- | ---: | ---: | ---: | ---: |
| `properties` | 2 | 2 | 2 | 0 |
| `roomTypes` | 3 | 3 | 3 | 0 |
| `rooms` | 7 | 7 | 7 | 0 |
| `bookings` | 2 | 2 | 2 | 0 |

Đánh giá:
- Dữ liệu legacy, nhưng chưa thấy trùng `id`.
- Cần chuẩn hoá về `key = id` nếu tenant này còn sử dụng.

### `tenant_1765963221399`

| Collection | Tổng | Key số | `key != id` | Trùng `id` |
| --- | ---: | ---: | ---: | ---: |
| `properties` | 2 | 2 | 2 | 0 |
| `roomTypes` | 3 | 3 | 3 | 0 |
| `rooms` | 7 | 7 | 7 | 0 |
| `bookings` | 2 | 2 | 2 | 0 |

Đánh giá:
- Tương tự tenant trên: legacy nhưng chưa thấy bản ghi trùng.

### `tenant_1777400052490`

| Collection | Tổng bản ghi logic | Ghi chú |
| --- | ---: | --- |
| `properties` | 2 | Chuẩn |
| `roomTypes` | 7 | Chuẩn |
| `rooms` | 16 | Có `7` phòng mồ côi |
| `bookings` | 105 | Không thấy booking mồ côi |

Phát hiện:
- Có `7` phòng đang tham chiếu tới `propertyId = p1/p2` và `typeId = rt1/rt2/rt3`, nhưng các chi nhánh/hạng phòng đó không còn tồn tại trong tenant này.
- Ví dụ:
  - `r101`, `r102`, `r103` vẫn trỏ tới `p1`
  - `r101`, `r102`, `r103` vẫn trỏ tới `rt1/rt2`

Đánh giá:
- Đây là lỗi dữ liệu thật, không chỉ là legacy-key.
- Nếu tenant này còn dùng, các phòng đó có thể hiện mà thiếu tên chi nhánh/hạng phòng.

### `tenant_demo`

| Collection | Tổng bản ghi vật lý | Bản ghi logic duy nhất | Nhóm trùng `id` | Dòng dư thừa | Nhóm trùng có dữ liệu khác nhau |
| --- | ---: | ---: | ---: | ---: | ---: |
| `properties` | 15 | 9 | 6 | 6 | 2 |
| `roomTypes` | 57 | 31 | 26 | 26 | 4 |
| `rooms` | 209 | 70 | 47 | 139 | 47 |
| `users` | 17 | 14 | 3 | 3 | 3 |

Đánh giá:
- Đây là vùng rủi ro cao nhất của toàn bộ export.
- `rooms` là nghiêm trọng nhất vì toàn bộ bản ghi trùng đều có khác biệt dữ liệu, không phải copy y hệt.

Ví dụ điển hình:

| `id` phòng | Các key cùng tồn tại | Dấu hiệu lệch |
| --- | --- | --- |
| `r1767112228632` | `2`, `6`, `110`, `r1767112228632` | số phòng từng là `P101`, sau đó thành `203`; `typeId` cũng đổi |
| `r1767112246414` | `3`, `7`, `126`, `r1767112246414` | số phòng từng là `P101`, sau đó thành `101`; `typeId` đổi |
| `r1767112256056` | `4`, `8`, `135`, `r1767112256056` | số phòng từng là `P101`, sau đó thành `301`; `typeId` đổi |

Ý nghĩa:
- Cùng một `id` nhưng nhiều phiên bản khác nhau vẫn đang cùng tồn tại.
- Khi app hoặc người thao tác lấy dữ liệu theo cách khác nhau, có thể rơi vào các bản khác nhau của cùng một phòng.

## 3. Kiểm tra dữ liệu mồ côi

| Khu vực | Phòng thiếu chi nhánh | Phòng thiếu hạng | Booking thiếu phòng | Booking lệch chi nhánh so với phòng |
| --- | ---: | ---: | ---: | ---: |
| Root legacy | 0 | 0 | 0 | 0 |
| `tenant_1765962103076` | 0 | 0 | 0 | 0 |
| `tenant_1765963221399` | 0 | 0 | 0 | 0 |
| `tenant_1777400052490` | 7 | 7 | 0 | 0 |
| `tenant_demo` | 0 | 0 | 0 | 0 |

Đánh giá:
- `tenant_demo` hiện chưa thấy dữ liệu mồ côi sau khi gộp theo `id`, nhưng vẫn có nhiều bản sao xung đột.
- `tenant_1777400052490` có dữ liệu mồ côi thực sự và nên xử lý riêng.

## 4. Mức độ ưu tiên xử lý

### Ưu tiên 1 - Cần xử lý sớm

1. Chuẩn hoá `tenant_demo/rooms`
   - `47` phòng trùng `id`
   - `139` dòng dư thừa
   - tất cả nhóm trùng đều xung đột dữ liệu
2. Chuẩn hoá tiếp `tenant_demo/properties`, `roomTypes`, `users`
3. Dọn `7` phòng mồ côi trong `tenant_1777400052490`

### Ưu tiên 2 - Nên làm sau khi phần chính ổn

1. Dọn các node legacy ở root database
2. Chuẩn hoá hai tenant cũ `tenant_1765962103076` và `tenant_1765963221399` từ key số sang `key = id`

## 5. Hướng xử lý đề xuất tiếp theo

1. Backup toàn bộ Firebase thêm một lần trước migration.
2. Tạo script dry-run chỉ đọc:
   - đề xuất bản ghi nào giữ lại;
   - bản ghi nào sẽ bỏ;
   - bản nào có xung đột cần con người duyệt.
3. Với `tenant_demo/rooms`, ưu tiên không xoá tự động mù quáng vì có nhiều bản sao khác nhau thật.
4. Sau khi duyệt mapping canonical:
   - ghi bản chuẩn về `key = id`;
   - xoá các key legacy dư;
   - chạy kiểm tra lại orphan/trùng `id`.
5. Regression lại các màn:
   - Cài đặt hệ thống
   - Sơ đồ phòng
   - Buồng phòng
   - Danh sách đơn
   - Báo cáo

## 6. Kết luận

Hai bản sửa code gần đây đã giúp app xử lý tốt hơn khi database còn dữ liệu legacy, nhưng dữ liệu nền vẫn chưa sạch. Nếu muốn app ổn định lâu dài và giảm các lỗi khó đoán về sau, bước kế tiếp hợp lý nhất là:

1. làm dry-run migration;
2. duyệt bản ghi chuẩn cần giữ;
3. chuẩn hoá dữ liệu legacy về một bản ghi duy nhất cho mỗi `id`.
