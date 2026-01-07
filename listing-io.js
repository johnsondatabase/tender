


import { sb, showToast, showLoading, showConfirm, currentUser } from './app.js';
import { translations, getCurrentLanguage } from './lang.js';

const t = (key) => {
    const lang = getCurrentLanguage();
    return translations[lang][key] || key;
};

// Removed import { notifyAdmins, fetchListings } from './listing.js' to fix circular dependency.
// Use window.notifyAdmins and window.fetchListings instead.

export async function downloadImportTemplate() {
    try {
        // Fetch province-region data for dropdown and VLOOKUP
        const { data: provinceRegionData } = await sb.from('tinh_thanh').select('tinh, khu_vuc');
        if (!provinceRegionData || provinceRegionData.length === 0) {
            showToast("Không thể tải dữ liệu tỉnh/khu vực cho template", "error");
            return;
        }

        // Prepare data for Data sheet (dropdowns and mapping)
        const uniqueProvinces = [...new Set(provinceRegionData.map(p => p.tinh))].sort();
        const uniqueRegions = [...new Set(provinceRegionData.map(p => p.khu_vuc))].sort();
        const provinceRegionMapping = provinceRegionData.map(p => [p.tinh, p.khu_vuc]);

        const headers = [
            'Năm', 'Bệnh Viện', 'Khoa', 'Tỉnh', 'Khu Vực', 'Nhà Phân Phối', 'Ngày', 'Loại',
            'Mã VT', 'Quota', 'SL Trúng', 'Tình Trạng', 'Ngày Ký', 'Ngày Kết Thúc',
            'Ngành', 'PSR', 'Quản Lý', 'Nhóm Sản Phẩm'
        ];

        const exampleData = [
            [2024, 'BV Chợ Rẫy', 'Khoa Dược', 'Hồ Chí Minh', '', 'Harpharco Hồ Chí Minh', '2024-01-15', 'Thầu tập trung', 'VT-001', 1000, 0, 'Waiting', '', '', 'Tim mạch', 'Nguyen Van A', 'Tran Van B', 'G1'],
            [2024, 'BV Chợ Rẫy', '', 'Hồ Chí Minh', '', 'Harpharco Hồ Chí Minh', '2024-01-15', 'Thầu tập trung', 'VT-002', 500, 0, 'Waiting', '', '', 'Tim mạch', 'Nguyen Van A', 'Tran Van B', 'G2'],
            [2024, 'BV Bạch Mai', 'Hồi sức tích cực', 'Hà Nội', '', 'Harphaco Hà Nội', '2024-02-01', 'Mua sắm trực tiếp', 'VT-003', 200, 0, 'Waiting', '', '', 'Hô hấp', 'Le Van C', 'Pham Van D', 'G1'],
            ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
        ];

        // Create main template sheet
        const templateWs = XLSX.utils.aoa_to_sheet([headers, ...exampleData]);

        // Add VLOOKUP formulas to Khu Vực column (column E, index 4)
        const numRows = exampleData.length;
        for (let i = 1; i <= numRows + 1; i++) { // Start from row 1 (after header)
            const cellRef = XLSX.utils.encode_cell({r: i, c: 4}); // Column E (index 4)
            if (i === numRows) { // Last row with instruction
                templateWs[cellRef] = {t: 'str', v: 'Tự động điền'};
            } else {
                // Add VLOOKUP formula: =VLOOKUP(D{row+1}, Data!$A$3:$B${numProvinces+2}, 2, FALSE)
                const formula = `=VLOOKUP(D${i+1}, Data!$A$3:$B$${provinceRegionMapping.length + 2}, 2, FALSE)`;
                templateWs[cellRef] = {t: 'str', f: formula, v: ''};
            }
        }

        // Data sheet headers
        const dataHeaders = ['Danh sách Tỉnh', '', 'Mapping Tỉnh - Khu vực'];
        const dataContent = [
            dataHeaders,
            ['Tỉnh', 'Khu vực'], // Column headers for province list
            ...provinceRegionMapping, // Province-Region mapping data
            [], // Empty row
            ['Danh sách Nhà Phân Phối'], // Distributor list header
            ['Harphaco Hà Nội'],
            ['Harpharco Hồ Chí Minh'],
            ['Sakae'],
            ['Long Giang']
        ];

        const dataWs = XLSX.utils.aoa_to_sheet(dataContent);

        // If ExcelJS is available (better support for DataValidation), use it to create dropdowns
        if (window.ExcelJS) {
            const workbook = new ExcelJS.Workbook();
            const templateSheet = workbook.addWorksheet('Template');
            const dataSheet = workbook.addWorksheet('Data');

            // Set columns on Template
            templateSheet.columns = [
                { header: 'Năm', key: 'nam', width: 6 },
                { header: 'Bệnh Viện', key: 'benh_vien', width: 25 },
                { header: 'Khoa', key: 'khoa', width: 15 },
                { header: 'Tỉnh', key: 'tinh', width: 15 },
                { header: 'Khu Vực', key: 'khu_vuc', width: 12 },
                { header: 'Nhà Phân Phối', key: 'nha_phan_phoi', width: 20 },
                { header: 'Ngày', key: 'ngay', width: 12 },
                { header: 'Loại', key: 'loai', width: 15 },
                { header: 'Mã VT', key: 'ma_vt', width: 10 },
                { header: 'Quota', key: 'quota', width: 8 },
                { header: 'SL Trúng', key: 'sl_trung', width: 8 },
                { header: 'Tình Trạng', key: 'tinh_trang', width: 12 },
                { header: 'Ngày Ký', key: 'ngay_ky', width: 12 },
                { header: 'Ngày Kết Thúc', key: 'ngay_ket_thuc', width: 12 },
                { header: 'Ngành', key: 'nganh', width: 10 },
                { header: 'PSR', key: 'psr', width: 12 },
                { header: 'Quản Lý', key: 'quan_ly', width: 12 },
                { header: 'Nhóm Sản Phẩm', key: 'group_product', width: 15 }
            ];

            // Add header row style
            templateSheet.getRow(1).font = { bold: true };

            // Add sample rows
            exampleData.forEach(row => {
                templateSheet.addRow(row);
            });

            // Populate Data sheet
            dataSheet.getCell('A1').value = 'Tỉnh';
            dataSheet.getCell('B1').value = 'Khu Vực';
            let dataRow = 2;
            provinceRegionMapping.forEach(([prov, reg]) => {
                dataSheet.getCell(`A${dataRow}`).value = prov;
                dataSheet.getCell(`B${dataRow}`).value = reg;
                dataRow++;
            });

            // Add NPP list starting at D2
            const nppStartRow = 2;
            const npps = ['Harphaco Hà Nội', 'Harpharco Hồ Chí Minh', 'Sakae', 'Long Giang'];
            dataSheet.getCell('D1').value = 'Nhà Phân Phối';
            npps.forEach((npp, idx) => {
                dataSheet.getCell(`D${nppStartRow + idx}`).value = npp;
            });

            // Copy province list and NPP list into hidden columns on Template sheet (Excel allows DV to reference same sheet)
            // We'll use columns Z (26) for provinces and AA (27) for NPPs
            const provColLetter = 'Z';
            const nppColLetter = 'AA';
            let provRowIdx = 2;
            uniqueProvinces.forEach(prov => {
                templateSheet.getCell(`${provColLetter}${provRowIdx}`).value = prov;
                provRowIdx++;
            });
            let nppRowIdx = 2;
            npps.forEach(npp => {
                templateSheet.getCell(`${nppColLetter}${nppRowIdx}`).value = npp;
                nppRowIdx++;
            });
            // Hide helper columns
            templateSheet.getColumn(26).hidden = true; // Z
            templateSheet.getColumn(27).hidden = true; // AA

            // Apply data validation for Tỉnh (column D) and Nhà Phân Phối (column F)
            const lastTemplateRow = Math.max(200, templateSheet.rowCount || 200);
            // Try inline CSV list for DataValidation as a fallback (some Excel clients accept it)
            const inlineProvinceList = `"${uniqueProvinces.join(',')}"`;
            const inlineNPPList = `"${npps.join(',')}"`;

            for (let r = 2; r <= lastTemplateRow; r++) {
                // Tỉnh dropdown (col D) using inline CSV string
                templateSheet.getCell(`D${r}`).dataValidation = {
                    type: 'list',
                    allowBlank: true,
                    showInputMessage: true,
                    formula1: inlineProvinceList
                };
                // Nhà Phân Phối dropdown (col F) using inline CSV string
                templateSheet.getCell(`F${r}`).dataValidation = {
                    type: 'list',
                    allowBlank: true,
                    showInputMessage: true,
                    formula1: inlineNPPList
                };
                // Khu Vực formula (col E)
                templateSheet.getCell(`E${r}`).value = { formula: `VLOOKUP(D${r},Data!$A$2:$B$${dataRow - 1},2,FALSE)`, result: null };
            }

            // Generate and download workbook
            const buf = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Mau_Import_Listing.xlsx';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);

            showToast("Đã tải xuống template Excel (có dropdown)!", "success");
            return;
        }

        // Fallback to XLSX when ExcelJS not available
        const wb = XLSX.utils.book_new();
        // Add sheets to workbook
        XLSX.utils.book_append_sheet(wb, templateWs, "Template");
        XLSX.utils.book_append_sheet(wb, dataWs, "Data");

        // Set column widths for better readability
        templateWs['!cols'] = [
            {wch: 6},  // Năm
            {wch: 25}, // Bệnh Viện
            {wch: 15}, // Khoa
            {wch: 15}, // Tỉnh
            {wch: 12}, // Khu Vực
            {wch: 20}, // Nhà Phân Phối
            {wch: 12}, // Ngày
            {wch: 15}, // Loại
            {wch: 10}, // Mã VT
            {wch: 8},  // Quota
            {wch: 8},  // SL Trúng
            {wch: 12}, // Tình Trạng
            {wch: 12}, // Ngày Ký
            {wch: 12}, // Ngày Kết Thúc
            {wch: 10}, // Ngành
            {wch: 12}, // PSR
            {wch: 12}, // Quản Lý
            {wch: 15}  // Nhóm Sản Phẩm
        ];

        // Add instructions as comments or notes
        // Note: XLSX library has limited support for Excel features like data validation
        // We'll add instructions for users to set up dropdowns manually

        const instructions = [
            "🎯 TEMPLATE EXCEL VỚI DROPDOWN TỰ ĐỘNG!",
            "",
            "✅ ĐÃ TỰ ĐỘNG THIẾT LẬP:",
            "   ✓ Sheet 'Data' chứa danh sách 34 tỉnh và mapping",
            "",
            "⚡ CÁC BƯỚC CÒN LẠI CẦN LÀM:",
            "",
            "📍 BƯỚC 1: TẠO DROPDOWN CHO CỘT TỈNH (D)",
            "   1. Mở file Excel vừa tải",
            "   2. Chọn cột D (Tỉnh) từ D2 trở xuống",
            "   3. Vào tab Data > Data Validation",
            "   4. Chọn Allow: List",
            "   5. Source: =Data!$A$3:$A$" + (uniqueProvinces.length + 2),
            "   6. OK để áp dụng",
            "   → Giờ bạn có dropdown 34 tỉnh!",
            "",
            "📍 BƯỚC 2: TẠO DROPDOWN CHO CỘT NHÀ PHÂN PHỐI (F)",
            "   1. Chọn cột F (Nhà Phân Phối) từ F2 trở xuống",
            "   2. Vào tab Data > Data Validation",
            "   3. Chọn Allow: List",
            "   4. Source: =Data!$E$6:$E$9",
            "   5. OK để áp dụng",
            "   → Dropdown 4 nhà phân phối!",
            "",
            "🎉 KẾT QUẢ:",
            "   • Chọn tỉnh → Khu vực tự động điền",
            "   • Dropdown cho tất cả các cột cần thiết",
            "   • Tránh sai sót nhập liệu",
            "",
            "💡 MẸO:",
            "   • Nếu thấy #N/A: Tỉnh chưa được chọn hoặc không có trong danh sách",
            "   • Sheet 'Data' có thể ẩn đi nếu muốn",
            "   • Lưu file sau khi thiết lập dropdown",
            "",
            "🚀 SẴN SÀNG IMPORT:",
            "   1. Điền dữ liệu từ dòng 2 trở đi",
            "   2. Lưu file Excel",
            "   3. Import vào hệ thống"
        ];

        // Add instructions to a separate sheet
        const instructionsWs = XLSX.utils.aoa_to_sheet(instructions.map(line => [line]));
        XLSX.utils.book_append_sheet(wb, instructionsWs, "Hướng dẫn");

        // Hide the Data sheet (optional - users can unhide if needed)
        // Note: XLSX doesn't support hiding sheets directly, but we can add a note

        // Save file
        XLSX.writeFile(wb, "Mau_Import_Listing.xlsx");

        showToast("Đã tải xuống template Excel với dropdown và VLOOKUP!", "success");

    } catch (error) {
        console.error("Error creating template:", error);
        showToast("Lỗi khi tạo template: " + error.message, "error");

        // Fallback to simple template if database fetch fails
        const headers = [
            'Năm', 'Bệnh Viện', 'Khoa', 'Tỉnh', 'Khu Vực', 'Nhà Phân Phối', 'Ngày', 'Loại',
            'Mã VT', 'Quota', 'SL Trúng', 'Tình Trạng', 'Ngày Ký', 'Ngày Kết Thúc',
            'Ngành', 'PSR', 'Quản Lý', 'Nhóm Sản Phẩm'
        ];
        const exampleData = [
            [2024, 'BV Chợ Rẫy', 'Khoa Dược', 'Hồ Chí Minh', '', 'Harpharco Hồ Chí Minh', '2024-01-15', 'Thầu tập trung', 'VT-001', 1000, 0, 'Waiting', '', '', 'Tim mạch', 'Nguyen Van A', 'Tran Van B', 'G1'],
            [2024, 'BV Chợ Rẫy', '', 'Hồ Chí Minh', '', 'Harpharco Hồ Chí Minh', '2024-01-15', 'Thầu tập trung', 'VT-002', 500, 0, 'Waiting', '', '', 'Tim mạch', 'Nguyen Van A', 'Tran Van B', 'G2'],
            [2024, 'BV Bạch Mai', 'Hồi sức tích cực', 'Hà Nội', '', 'Harphaco Hà Nội', '2024-02-01', 'Mua sắm trực tiếp', 'VT-003', 200, 0, 'Waiting', '', '', 'Hô hấp', 'Le Van C', 'Pham Van D', 'G1'],
            ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
        ];

        const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleData]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Template");
        XLSX.writeFile(wb, "Mau_Import_Listing.xlsx");
        showToast("Đã tải xuống template cơ bản (không có dropdown)", "info");
    }
}

export function handleExcelImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    showLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
            
            processImportData(jsonData);
        } catch (error) {
            showLoading(false);
            showToast("Lỗi đọc file Excel: " + error.message, "error");
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

async function processImportData(data) {
    if (!data || data.length === 0) {
        showLoading(false);
        showToast("File Excel không có dữ liệu.", "error");
        return;
    }
    // Keep the raw parsed rows accessible for the error-edit modal
    window.__lastImportedRawData = data;

    // Fetch validation data
    let provinceRegionData = [];
    let existingDistributors = [];

    try {
        // Fetch province and region data from tinh_thanh table
        const { data: provinceData } = await sb.from('tinh_thanh').select('tinh, khu_vuc');
        if (provinceData) provinceRegionData = provinceData;

        // Fetch existing distributors from listing table
        const { data: distributorData } = await sb.from('listing').select('nha_phan_phoi');
        if (distributorData) {
            existingDistributors = [...new Set(distributorData.map(d => d.nha_phan_phoi).filter(v => v && v.trim() !== ''))];
        }
    } catch (error) {
        console.error("Error fetching validation data:", error);
        showLoading(false);
        showToast("Lỗi khi tải dữ liệu validation: " + error.message, "error");
        return;
    }

    const keyMap = {
        'Năm': 'nam', 'Bệnh Viện': 'benh_vien', 'Khoa': 'khoa', 'Tỉnh': 'tinh', 'Khu Vực': 'khu_vuc',
        'Nhà Phân Phối': 'nha_phan_phoi', 'Ngày': 'ngay', 'Loại': 'loai',
        'Mã VT': 'ma_vt', 'Quota': 'quota', 'SL Trúng': 'sl_trung', 'Tình Trạng': 'tinh_trang',
        'Ngày Ký': 'ngay_ky', 'Ngày Kết Thúc': 'ngay_ket_thuc',
        'Ngành': 'nganh', 'PSR': 'psr', 'Quản Lý': 'quan_ly', 'Nhóm Sản Phẩm': 'group_product'
    };

    const groups = {};
    
    // Helper: parse various Excel date representations into ISO yyyy-mm-dd or null
    function parseExcelDate(val) {
        if (val === null || val === undefined || String(val).trim() === '') return null;
        // Excel serial number
        if (typeof val === 'number') {
            const dateObj = new Date(Math.round((val - 25569) * 86400 * 1000));
            return dateObj.toISOString().split('T')[0];
        }
        if (typeof val === 'string') {
            const s = val.trim();
            // If multiple dates concatenated, take first
            const first = s.split(/[,;\n]+/)[0].trim();
            // dd/mm/yyyy or d/m/yyyy
            let m = first.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
            if (m) {
                let d = m[1].padStart(2,'0'), mo = m[2].padStart(2,'0'), y = m[3];
                if (y.length === 2) y = '20' + y;
                return `${y}-${mo}-${d}`;
            }
            // dd/Mon/yyyy where Mon is month name short or full (e.g. 01/Aug/2022)
            m = first.match(/^(\d{1,2})[\/\-]([A-Za-z]+)[\/\-](\d{2,4})$/);
            if (m) {
                const monthNames = {
                    jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
                    apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
                    aug: '08', august: '08', sep: '09', sept: '09', september: '09', oct: '10', october: '10',
                    nov: '11', november: '11', dec: '12', december: '12'
                };
                const d = m[1].padStart(2,'0');
                const mon = m[2].toLowerCase();
                const mo = monthNames[mon];
                let y = m[3];
                if (y.length === 2) y = '20' + y;
                if (mo) return `${y}-${mo}-${d}`;
            }
            // try Date parsing as last resort
            const dObj = new Date(first);
            if (!isNaN(dObj.getTime())) return dObj.toISOString().split('T')[0];
            return null;
        }
        return null;
    }
    // Validation data
    const validProvinces = [...new Set(provinceRegionData.map(p => p.tinh))];
    const validRegions = [...new Set(provinceRegionData.map(p => p.khu_vuc))];
    const provinceToRegionMap = {};
    provinceRegionData.forEach(p => {
        provinceToRegionMap[p.tinh] = p.khu_vuc;
    });
    const predefinedDistributors = ["Harphaco Hà Nội", "Harpharco Hồ Chí Minh", "Sakae", "Long Giang"];

    // Normalize Data and Validate
    const validationErrors = [];
    const importedCodeToLines = {}; // { code: [line1, line2] }
    data.forEach((row, index) => {
        const normalizedRow = {};
        Object.keys(row).forEach(k => {
            const trimmedKey = k.trim();
            const mappedKey = keyMap[trimmedKey] || trimmedKey.toLowerCase().replace(/\s+/g, '_');
            normalizedRow[mappedKey] = row[k];
        });

        const benh_vien = normalizedRow.benh_vien;
        let ngay = normalizedRow.ngay;

        if (!benh_vien) return;

        // Validate Tỉnh (Province)
        if (normalizedRow.tinh && !validProvinces.includes(normalizedRow.tinh.trim())) {
            validationErrors.push({
                type: 'invalid_value',
                field: 'tinh',
                message: `Tỉnh "${normalizedRow.tinh}" không hợp lệ. Chỉ chấp nhận ${validProvinces.length} tỉnh từ danh sách quy định.`,
                lines: [index + 2]
            });
        }

        // Validate Khu vực (Region)
        if (normalizedRow.khu_vuc && !validRegions.includes(normalizedRow.khu_vuc.trim())) {
            validationErrors.push({
                type: 'invalid_value',
                field: 'khu_vuc',
                message: `Khu vực "${normalizedRow.khu_vuc}" không hợp lệ. Chỉ chấp nhận các khu vực từ danh sách quy định.`,
                lines: [index + 2]
            });
        }

        // Validate mapping giữa Tỉnh và Khu vực
        if (normalizedRow.tinh && normalizedRow.khu_vuc) {
            const provinceName = normalizedRow.tinh.trim();
            const regionName = normalizedRow.khu_vuc.trim();
            const expectedRegion = provinceToRegionMap[provinceName];

            if (expectedRegion && expectedRegion !== regionName) {
                validationErrors.push({
                    type: 'mapping_mismatch',
                    field: 'khu_vuc',
                    message: `Khu vực của tỉnh "${provinceName}" chưa chính xác. Tỉnh "${provinceName}" thuộc khu vực "${expectedRegion}", không phải "${regionName}".`,
                    lines: [index + 2]
                });
            }
        }

        // Validate Nhà Phân Phối (Distributor)
        if (normalizedRow.nha_phan_phoi) {
            const distributor = normalizedRow.nha_phan_phoi.trim();
            const isPredefined = predefinedDistributors.includes(distributor);
            const isExisting = existingDistributors.includes(distributor);

            if (!isPredefined && !isExisting) {
                // Count how many new distributors are being added
                const newDistributors = data
                    .slice(0, index + 1)
                    .map(r => {
                        const k = Object.keys(r).find(key => keyMap[key.trim()] === 'nha_phan_phoi');
                        return k ? r[k]?.trim() : null;
                    })
                    .filter(d => d && !predefinedDistributors.includes(d) && !existingDistributors.includes(d));

                const uniqueNewDistributors = [...new Set(newDistributors)];
                if (uniqueNewDistributors.length > 2) {
                    validationErrors.push({
                        type: 'invalid_distributor',
                        field: 'nha_phan_phoi',
                        distributor,
                        message: `Nhà phân phối "${distributor}" không hợp lệ. Chỉ được phép thêm tối đa 2 nhà phân phối mới ngoài 4 nhà phân phối hiện có.`,
                        lines: [index + 2]
                    });
                }
            }
        }

        // Parse main date field with helper (handles dd/mm/yyyy, Excel serials, multiple values)
        const parsedNgay = parseExcelDate(normalizedRow.ngay);
        if (parsedNgay) {
            ngay = parsedNgay;
        } else {
            ngay = new Date().toISOString().split('T')[0];
        }

        // Normalize other date fields (ngay_ky, ngay_ket_thuc) using parser
        ['ngay_ky', 'ngay_ket_thuc'].forEach(field => {
            normalizedRow[field] = parseExcelDate(normalizedRow[field]);
        });

        const groupKey = `${benh_vien.trim().toLowerCase()}_${ngay}`;

        if (!groups[groupKey]) {
            groups[groupKey] = {
                ma_thau: '',
                common: {
                    nam: normalizedRow.nam || new Date().getFullYear(),
                    benh_vien: benh_vien,
                    khoa: normalizedRow.khoa || '',
                    tinh: normalizedRow.tinh || '',
                    khu_vuc: normalizedRow.khu_vuc || '',
                    nha_phan_phoi: normalizedRow.nha_phan_phoi || '',
                    ngay: ngay,
                    loai: normalizedRow.loai || '',
                    tinh_trang: normalizedRow.tinh_trang || 'Waiting',
                    ngay_ky: normalizedRow.ngay_ky || null,
                    ngay_ket_thuc: normalizedRow.ngay_ket_thuc || null,
                    nganh: normalizedRow.nganh || '',
                    psr: normalizedRow.psr || '',
                    quan_ly: normalizedRow.quan_ly || ''
                },
                details: []
            };
        }

        if (normalizedRow.ma_vt) {
            groups[groupKey].details.push({
                ma_vt: normalizedRow.ma_vt,
                quota: normalizedRow.quota || 0,
                sl_trung: normalizedRow.sl_trung || 0,
                group_product: normalizedRow.group_product || ''
            });
            const code = String(normalizedRow.ma_vt).trim();
            if (!importedCodeToLines[code]) importedCodeToLines[code] = [];
            importedCodeToLines[code].push(index + 2); // Excel row number
        }
    });

    // Validate imported ma_vt exist in product table
    const importedCodes = Object.keys(importedCodeToLines);
    if (importedCodes.length > 0) {
        try {
            const codes = importedCodes;
            const { data: existingProducts } = await sb.from('product').select('ma_vt').in('ma_vt', codes);
            const existingSet = new Set((existingProducts || []).map(p => p.ma_vt));
            const missingCodes = codes.filter(c => !existingSet.has(c));
            if (missingCodes.length > 0) {
                // Push structured errors with line numbers
                missingCodes.forEach(code => {
                    validationErrors.push({
                        type: 'missing_code',
                        code,
                        lines: importedCodeToLines[code] || [],
                        message: `Mã "${code}" không tồn tại : dòng ${ (importedCodeToLines[code] || []).join(', ') }`
                    });
                });
            }
        } catch (err) {
            console.error('Error checking product codes:', err);
            // don't block import on lookup failure, but warn (structured)
            validationErrors.push({
                type: 'system',
                message: 'Không thể kiểm tra mã VT trong bảng product: ' + err.message,
                lines: []
            });
        }
    }

    // Check for validation errors
    if (validationErrors.length > 0) {
        showLoading(false);
        showValidationErrorsModal(validationErrors);
        return;
    }

    let listingInserts = [];
    let detailInserts = [];

    for (const key in groups) {
        const group = groups[key];
        const [y, m, d] = group.common.ngay.split('-');
        const dateStr = `${d}${m}${y}`;
        const acronym = group.common.benh_vien.trim().replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(word => word.length > 0).map(word => word.charAt(0)).join('').toUpperCase();
        const maThau = `${dateStr}-${acronym}`;
        
        group.ma_thau = maThau;
        
        listingInserts.push({ ...group.common, ma_thau: maThau });
        group.details.forEach(det => {
            detailInserts.push({ id: Math.floor(Math.random() * 2000000000), ma_thau: maThau, ...group.common, ...det });
        });
    }

    if (listingInserts.length === 0) {
        showLoading(false);
        showToast("Không tìm thấy dữ liệu hợp lệ để nhập.", "info");
        return;
    }

    // Check Duplicates
    const allMaThaus = listingInserts.map(i => i.ma_thau);
    try {
        const { data: duplicates } = await sb.from('listing').select('ma_thau').in('ma_thau', allMaThaus);

        if (duplicates && duplicates.length > 0) {
            const duplicateIds = duplicates.map(d => d.ma_thau);
            
            // Filter listingInserts to find details of duplicated items
            const duplicateItems = listingInserts.filter(i => duplicateIds.includes(i.ma_thau));
            
            // Format detailed list
            const detailList = duplicateItems.slice(0, 15).map(item => {
                // Format date to dd/mm/yyyy if possible
                let displayDate = item.ngay;
                if(item.ngay && item.ngay.includes('-')) {
                    const parts = item.ngay.split('-');
                    if(parts.length === 3) displayDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
                }
                return `- ${displayDate} - ${item.benh_vien}`;
            }).join('\n');

            let msg = `Hệ thống phát hiện ${duplicates.length} hồ sơ trùng:\n${detailList}`;
            if (duplicates.length > 15) {
                msg += `\n... và ${duplicates.length - 15} hồ sơ khác.`;
            }
            msg += `\n\nBạn có muốn bỏ qua các hồ sơ trùng không?`;

            showLoading(false);
            const shouldProceed = await showConfirm(msg, t('dup_detect_title'));
            showLoading(true);

            if (shouldProceed) {
                listingInserts = listingInserts.filter(i => !duplicateIds.includes(i.ma_thau));
                detailInserts = detailInserts.filter(i => !duplicateIds.includes(i.ma_thau));
                if (listingInserts.length === 0) {
                    showLoading(false);
                    showToast("Không còn dữ liệu mới để nhập.", "info");
                    return;
                }
            } else {
                showLoading(false);
                return;
            }
        }

        // Pre-insert checks and logging
        console.log('Preparing to insert listings:', listingInserts.length, 'details:', detailInserts.length);
        // Ensure all listing inserts have ma_thau
        const missingMaThau = listingInserts.filter(i => !i.ma_thau || String(i.ma_thau).trim() === '');
        if (missingMaThau.length > 0) {
            showLoading(false);
            const linesInfo = missingMaThau.map((it, idx) => `Item ${idx + 1}: ${JSON.stringify(it).substring(0,120)}`).join('\n');
            showValidationErrorsModal([{
                type: 'missing_ma_thau',
                field: 'ma_thau',
                message: `Phát hiện ${missingMaThau.length} hồ sơ thiếu 'ma_thau'. Vui lòng kiểm tra công thức tạo mã thầu hoặc dữ liệu.`,
                lines: [],
                detail: linesInfo
            }]);
            return;
        }

        // Ensure detail inserts have id
        detailInserts = detailInserts.map(d => {
            if (!d.id) d.id = Math.floor(Math.random() * 2000000000);
            return d;
        });

        // Insert listings first
        try {
            const resListing = await sb.from('listing').insert(listingInserts);
            if (resListing.error) {
                console.error('Supabase listing insert error:', resListing);
                showLoading(false);
                showToast('Lỗi khi insert listing: ' + (resListing.error.message || JSON.stringify(resListing.error)), 'error');
                return;
            }
            // Insert details in chunks
            if (detailInserts.length > 0) {
                const chunkSize = 1000;
                for (let i = 0; i < detailInserts.length; i += chunkSize) {
                    const chunk = detailInserts.slice(i, i + chunkSize);
                    const resDetail = await sb.from('detail').insert(chunk);
                    if (resDetail.error) {
                        console.error('Supabase detail insert error on chunk', i / chunkSize, resDetail);
                        showLoading(false);
                        showToast('Lỗi khi insert detail: ' + (resDetail.error.message || JSON.stringify(resDetail.error)), 'error');
                        return;
                    }
                }
            }
        } catch (err) {
            console.error('Insert exception:', err);
            showLoading(false);
            showToast('Lỗi khi insert dữ liệu: ' + err.message, 'error');
            return;
        }

        // Notify & Log
        const importedHospitals = [...new Set(listingInserts.map(i => i.benh_vien))].join(', ');
        
        // Use window.notifyAdmins
        if (window.notifyAdmins) {
             await window.notifyAdmins('Import Excel Thành Công', `User ${currentUser.ho_ten} đã import ${listingInserts.length} hồ sơ.\nBV: ${importedHospitals.substring(0, 100)}...`, { view: 'view-ton-kho' }, 'excel_import');
        }

        const historyInserts = listingInserts.map(item => ({
            ma_thau: item.ma_thau,
            nguoi_thuc_hien: currentUser.ho_ten || currentUser.gmail,
            hanh_dong: 'Import Excel',
            noi_dung: `Tự động tạo từ Import Excel. Gồm ${groups[`${item.benh_vien.trim().toLowerCase()}_${item.ngay}`]?.details.length || 0} mã VT.`
        }));
        await sb.from('history').insert(historyInserts);

        showToast("Import dữ liệu thành công!", "success");
        // Use window.fetchListings
        if (window.fetchListings) await window.fetchListings();

    } catch (error) {
        console.error("Import Error:", error);
        showToast("Lỗi khi import dữ liệu: " + error.message, "error");
    } finally {
        showLoading(false);
    }
}

// Function to show validation errors in a clean modal dialog
function showValidationErrorsModal(errors) {
    // Build content HTML grouping structured errors and listing plain messages
    const structuredErrors = (errors || []).filter(e => e && typeof e === 'object' && e.type);
    const plainMessages = (errors || []).filter(e => !(e && typeof e === 'object' && e.type));
    let contentHtml = '';

    if (structuredErrors.length > 0) {
        contentHtml = `
            <div class="w-full overflow-auto max-h-72 custom-scrollbar">
                <table class="min-w-full table-auto text-sm">
                    <thead class="bg-red-50 dark:bg-red-900/20 sticky top-0">
                        <tr>
                            <th class="px-3 py-2 text-left text-xs font-medium text-red-800 dark:text-red-200">#</th>
                            <th class="px-3 py-2 text-left text-xs font-medium text-red-800 dark:text-red-200">Trường</th>
                            <th class="px-3 py-2 text-left text-xs font-medium text-red-800 dark:text-red-200">Dòng</th>
                            <th class="px-3 py-2 text-left text-xs font-medium text-red-800 dark:text-red-200">Chi tiết</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${structuredErrors.map((err, idx) => `
                            <tr class="border-b dark:border-gray-700">
                                <td class="px-3 py-2 align-top text-xs text-red-700 dark:text-red-200">${idx + 1}</td>
                                <td class="px-3 py-2 align-top text-xs font-medium">${err.field || (err.code ? 'Mã VT' : '-')}</td>
                                <td class="px-3 py-2 align-top text-xs">${(err.lines || []).join(', ')}</td>
                                <td class="px-3 py-2 align-top text-xs text-red-800 dark:text-red-200">${err.message || JSON.stringify(err)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        if (plainMessages.length > 0) {
            contentHtml += `<div class="mt-3 text-sm text-gray-700">${plainMessages.map(m => `<div class="mb-1">- ${typeof m === 'string' ? m : JSON.stringify(m)}</div>`).join('')}</div>`;
        }
    } else {
        // Fallback: simple list of messages
        contentHtml = `
            <div class="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
                ${plainMessages.map((error, index) => `
                    <div class="flex items-start gap-3 p-2 md:p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg">
                        <div class="flex-shrink-0 w-6 h-6 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center text-xs font-medium mt-0.5">
                            ${index + 1}
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="text-red-800 dark:text-red-200 font-medium text-xs md:text-sm leading-tight">
                                ${typeof error === 'string' ? error : JSON.stringify(error)}
                            </p>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // Create modal HTML
    const modalHTML = `
        <div id="validation-errors-modal" class="fixed inset-0 z-[10000] flex items-center justify-center modal-backdrop p-4">
            <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
                <div class="p-4 md:p-6 border-b dark:border-gray-700 flex justify-between items-center bg-red-50 dark:bg-red-900/20">
                    <div class="flex items-center gap-3">
                        <svg class="w-5 h-5 md:w-6 md:h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
                        </svg>
                        <div>
                            <h3 class="text-sm md:text-lg font-bold text-red-800 dark:text-red-300">Lỗi Validation Dữ Liệu</h3>
                            <p class="text-[10px] md:text-sm text-red-600 dark:text-red-400 mt-1">Phát hiện ${errors.length} lỗi cần được sửa</p>
                        </div>
                    </div>
                    <button id="close-validation-modal" class="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-200 p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors">
                        <svg class="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>

                <div class="flex-1 overflow-y-auto p-3 md:p-6">
                    <div class="mb-3 md:mb-4">
                        <p class="text-xs md:text-sm text-gray-700 dark:text-gray-300 mb-2">
                           
                        </p>
                    </div>

                    ${contentHtml}
                </div>

                <div class="p-3 md:p-6 border-t dark:border-gray-700 flex flex-col md:flex-row md:justify-end gap-2 md:gap-3 bg-gray-50 dark:bg-gray-800">
                    <div class="flex-1 md:flex-none text-xs md:text-sm text-gray-600 dark:text-gray-300">
                        <span class="font-medium"></span>
                    </div>
                    <div class="flex justify-end gap-2">
                        <button id="fix-errors-btn" class="px-3 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 font-medium shadow-md transition-colors text-xs md:text-sm flex items-center gap-2">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v8m4-4H8"></path></svg>
                            Sửa lỗi
                        </button>
                        <!-- download button removed per user request -->
                        <button id="close-validation-modal-btn" class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium shadow-md transition-colors text-xs md:text-sm">
                            Đóng
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Add modal to DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Add event listeners
    const modal = document.getElementById('validation-errors-modal');
    const closeBtn = document.getElementById('close-validation-modal');
    const closeBtnBottom = document.getElementById('close-validation-modal-btn');

    const closeModal = () => {
        modal.remove();
    };

    closeBtn.addEventListener('click', closeModal);
    closeBtnBottom.addEventListener('click', closeModal);
    // download button removed - no handler
    const fixBtn = document.getElementById('fix-errors-btn');
    if (fixBtn) {
        fixBtn.addEventListener('click', () => {
            closeModal();
            openErrorEditModal(errors);
        });
    }

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', function handleEscape(e) {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', handleEscape);
        }
    });
}

// Open editable Handsontable modal to fix rows inline
function openErrorEditModal(errors) {
    const rawData = window.__lastImportedRawData || [];
    // collect line numbers from structured errors and plain messages
    const linesSet = new Set();
    errors.forEach(err => {
        if (err && typeof err === 'object' && err.lines) {
            (err.lines || []).forEach(l => linesSet.add(l));
        } else if (typeof err === 'string') {
            const m = err.match(/Dòng\\s*(\\d+(?:,\\s*\\d+)*)/i);
            if (m && m[1]) {
                m[1].split(',').map(s => parseInt(s.trim(), 10)).forEach(n => { if (!isNaN(n)) linesSet.add(n); });
            }
        }
    });
    const lines = Array.from(linesSet).sort((a,b)=>a-b);
    if (lines.length === 0) {
        // fallback: show first 100 rows
        for (let i = 0; i < Math.min(100, rawData.length); i++) lines.push(i+2);
    }

    // Columns to display/edit (order)
    const displayCols = ['Năm','Bệnh Viện','Khoa','Tỉnh','Khu Vực','Nhà Phân Phối','Mã VT','Quota','SL Trúng','Tình Trạng','Ngày Ký','Ngày Kết Thúc'];

    const tableData = lines.map(lineNum => {
        const rowObj = rawData[lineNum - 2] || {};
        return displayCols.map(col => rowObj[col] || '');
    });

    // Build modal
    const modalId = 'error-edit-modal';
    const modalHTML = `
        <div id="${modalId}" class="fixed inset-0 z-[11000] flex items-center justify-center modal-backdrop p-3">
            <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
                <div class="p-3 border-b flex justify-between items-center">
                    <h3 class="text-sm md:text-lg font-bold">Sửa lỗi trực tiếp</h3>
                    <button id="close-${modalId}" class="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700">Đóng</button>
                </div>
                <div class="flex-1 overflow-auto p-2">
                    <div id="hot-container" class="w-full" style="height:70vh;"></div>
                </div>
                <div class="p-3 border-t flex justify-between items-center bg-gray-50">
                    <div class="text-xs text-gray-600"></div>
                    <div class="flex gap-2">
                        <button id="apply-error-edits" class="px-3 py-2 bg-green-600 text-white rounded">Áp dụng</button>
                        <button id="cancel-error-edits" class="px-3 py-2 bg-gray-200 rounded">Hủy</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const container = document.getElementById('hot-container');
    const hot = new Handsontable(container, {
        data: tableData,
        colHeaders: displayCols,
        rowHeaders: lines.map(l => 'Row ' + l),
        licenseKey: 'non-commercial-and-evaluation',
        stretchH: 'all',
        columns: displayCols.map((col) => ({ type: 'text' })),
        manualColumnResize: true,
        manualRowResize: true,
        filters: true,
        dropdownMenu: true,
        width: '100%',
        height: '100%'
    });

    // Highlight error cells (collect errors per line and mark corresponding columns)
    const errorPerLine = {}; // { lineNum: [messages...] }
    errors.forEach(err => {
        if (!err) return;
        if (typeof err === 'object' && err.lines) {
            (err.lines || []).forEach(l => {
                if (!errorPerLine[l]) errorPerLine[l] = [];
                errorPerLine[l].push(err.message || JSON.stringify(err));
            });
        } else if (typeof err === 'string') {
            // Try to find line numbers in string like "Dòng 1,2,3" or "dòng 1"
            const m = err.match(/Dòng\\s*([0-9,\\s]+)/i);
            if (m && m[1]) {
                m[1].split(',').map(s => parseInt(s.trim(), 10)).forEach(n => {
                    if (!isNaN(n)) {
                        if (!errorPerLine[n]) errorPerLine[n] = [];
                        errorPerLine[n].push(err);
                    }
                });
            } else {
                // no line specified — attach to first row fallback if exists
                const fallback = lines[0];
                if (fallback) {
                    if (!errorPerLine[fallback]) errorPerLine[fallback] = [];
                    errorPerLine[fallback].push(err);
                }
            }
        }
    });

    // Map keywords to displayCols indexes
    const fieldMap = {
        'Tỉnh': 'Tỉnh',
        'Khu vực': 'Khu Vực',
        'Khu vực của tỉnh': 'Khu Vực',
        'Nhà phân phối': 'Nhà Phân Phối',
        'Nhà Phân Phối': 'Nhà Phân Phối',
        'Mã VT': 'Mã VT',
        'ma_vt': 'Mã VT'
    };

    lines.forEach((lineNum, idx) => {
        const messages = errorPerLine[lineNum] || [];
        if (messages.length === 0) return;
        // For each message, detect which column(s) to mark
        const colsToMark = new Set();
        messages.forEach(msg => {
            // check structured object messages too
            const text = typeof msg === 'string' ? msg : JSON.stringify(msg);
            for (const key in fieldMap) {
                if (text.includes(key)) {
                    const colName = fieldMap[key];
                    const colIndex = displayCols.indexOf(colName);
                    if (colIndex >= 0) colsToMark.add(colIndex);
                }
            }
            // fallback: if message mentions mã (code), mark Mã VT
            if (text.toLowerCase().includes('mã') || text.toLowerCase().includes('vt-')) {
                const colIndex = displayCols.indexOf('Mã VT');
                if (colIndex >= 0) colsToMark.add(colIndex);
            }
        });

        // If nothing detected, mark entire row first data column
        if (colsToMark.size === 0) {
            colsToMark.add(0);
        }

        // Set meta for each column cell in this row
        colsToMark.forEach(colIndex => {
            const existingClass = hot.getCellMeta(idx, colIndex).className || '';
            const newClass = existingClass.split(' ').concat('htInvalid').filter(Boolean).join(' ');
            hot.setCellMeta(idx, colIndex, 'className', newClass);
            // attach tooltip via title meta
            const existingTitle = hot.getCellMeta(idx, colIndex).title || '';
            const combinedTitle = (existingTitle ? existingTitle + '\\n' : '') + messages.join(' | ');
            hot.setCellMeta(idx, colIndex, 'title', combinedTitle);
        });
    });
    hot.render();

    const closeModal = () => document.getElementById(modalId)?.remove();
    document.getElementById(`close-${modalId}`).addEventListener('click', closeModal);
    document.getElementById('cancel-error-edits').addEventListener('click', closeModal);

    document.getElementById('apply-error-edits').addEventListener('click', async () => {
        // Merge edits back into rawData
        const updated = hot.getData();
        updated.forEach((rowArr, idx) => {
            const excelRow = lines[idx];
            const dataIndex = excelRow - 2;
            if (!rawData[dataIndex]) rawData[dataIndex] = {};
            displayCols.forEach((col, cIdx) => {
                rawData[dataIndex][col] = rowArr[cIdx];
            });
        });
        closeModal();
        // Re-run validation/import flow on updated data
        showLoading(true);
        await processImportData(rawData);
    });
}