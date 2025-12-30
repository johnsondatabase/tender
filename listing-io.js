


import { sb, showToast, showLoading, showConfirm, currentUser } from './app.js';
import { translations, getCurrentLanguage } from './lang.js';

const t = (key) => {
    const lang = getCurrentLanguage();
    return translations[lang][key] || key;
};

// Removed import { notifyAdmins, fetchListings } from './listing.js' to fix circular dependency.
// Use window.notifyAdmins and window.fetchListings instead.

export function downloadImportTemplate() {
    const headers = [
        'Năm', 'Bệnh Viện', 'Khoa', 'Tỉnh', 'Khu Vực', 'Nhà Phân Phối', 'Ngày', 'Loại', 
        'Mã VT', 'Quota', 'SL Trúng', 'Tình Trạng', 'Ngày Ký', 'Ngày Kết Thúc', 
        'Ngành', 'PSR', 'Quản Lý', 'Nhóm Sản Phẩm'
    ];
    const exampleData = [
        [2024, 'BV Chợ Rẫy', 'Khoa Dược', 'Hồ Chí Minh', 'HCM', 'Công ty A', '2024-01-15', 'Thầu tập trung', 'VT-001', 1000, 0, 'Waiting', '', '', 'Tim mạch', 'Nguyen Van A', 'Tran Van B', 'G1'],
        [2024, 'BV Chợ Rẫy', '', 'Hồ Chí Minh', 'HCM', 'Công ty A', '2024-01-15', 'Thầu tập trung', 'VT-002', 500, 0, 'Waiting', '', '', 'Tim mạch', 'Nguyen Van A', 'Tran Van B', 'G2'],
        [2024, 'BV Bạch Mai', 'Hồi sức tích cực', 'Hà Nội', 'Hà Nội', 'Công ty B', '2024-02-01', 'Mua sắm trực tiếp', 'VT-003', 200, 0, 'Waiting', '', '', 'Hô hấp', 'Le Van C', 'Pham Van D', 'G1']
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleData]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "Mau_Import_Listing.xlsx");
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

    const keyMap = {
        'Năm': 'nam', 'Bệnh Viện': 'benh_vien', 'Khoa': 'khoa', 'Tỉnh': 'tinh', 'Khu Vực': 'khu_vuc', 
        'Nhà Phân Phối': 'nha_phan_phoi', 'Ngày': 'ngay', 'Loại': 'loai', 
        'Mã VT': 'ma_vt', 'Quota': 'quota', 'SL Trúng': 'sl_trung', 'Tình Trạng': 'tinh_trang', 
        'Ngày Ký': 'ngay_ky', 'Ngày Kết Thúc': 'ngay_ket_thuc', 
        'Ngành': 'nganh', 'PSR': 'psr', 'Quản Lý': 'quan_ly', 'Nhóm Sản Phẩm': 'group_product'
    };

    const groups = {};
    
    // Normalize Data
    data.forEach(row => {
        const normalizedRow = {};
        Object.keys(row).forEach(k => {
            const trimmedKey = k.trim();
            const mappedKey = keyMap[trimmedKey] || trimmedKey.toLowerCase().replace(/\s+/g, '_');
            normalizedRow[mappedKey] = row[k];
        });

        const benh_vien = normalizedRow.benh_vien;
        let ngay = normalizedRow.ngay;

        if (!benh_vien) return;

        if (typeof ngay === 'number') {
            const dateObj = new Date(Math.round((ngay - 25569) * 86400 * 1000));
            ngay = dateObj.toISOString().split('T')[0];
        } else if (!ngay) {
            ngay = new Date().toISOString().split('T')[0];
        } else if (typeof ngay === 'string') {
             const d = new Date(ngay);
             if(!isNaN(d.getTime())) ngay = d.toISOString().split('T')[0];
        }

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
        }
    });

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

        // Insert
        await sb.from('listing').insert(listingInserts);
        if (detailInserts.length > 0) {
            const chunkSize = 1000;
            for (let i = 0; i < detailInserts.length; i += chunkSize) {
                const chunk = detailInserts.slice(i, i + chunkSize);
                await sb.from('detail').insert(chunk);
            }
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