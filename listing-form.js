
import { sb, showToast, showLoading, showConfirm, currentUser } from './app.js';
import { translations, getCurrentLanguage } from './lang.js';
import { logHistory } from './lichsu.js';
// Removed 'listing.js' import to fix circular dependency. 
// Using window.notifyAdmins, window.fetchListings, window.getListingsCache instead.

let currentFiles = [];
let currentMaterials = [];
let originalMaThau = null;
let isReadOnlyMode = false;
let initialFormState = null;

const t = (key) => {
    const lang = getCurrentLanguage();
    return translations[lang][key] || key;
};

// --- Form State Helpers ---

function getFormState() {
    return JSON.stringify({
        ma_thau: document.getElementById('l-ma-thau').value,
        nam: document.getElementById('l-nam').value,
        benh_vien: document.getElementById('l-benh-vien').value,
        tinh: document.getElementById('l-tinh').value,
        khu_vuc: document.getElementById('l-khu-vuc').value,
        loai: document.getElementById('l-loai').value,
        nha_phan_phoi: document.getElementById('l-npp').value,
        ngay: document.getElementById('l-ngay').value,
        ngay_ky: document.getElementById('l-ngay-ky').value,
        ngay_ket_thuc: document.getElementById('l-ngay-kt').value,
        nganh: document.getElementById('l-nganh').value,
        psr: document.getElementById('l-psr').value,
        quan_ly: document.getElementById('l-quan-ly').value,
        tinh_trang: document.getElementById('l-status').value,
        files: currentFiles.length,
        materials: currentMaterials
    });
}

// --- Material List Logic ---

function renderMaterialList(readOnly) {
    const container = document.getElementById('material-list-body');
    const emptyMsg = document.getElementById('empty-material-msg');
    
    if(!container) return;
    container.innerHTML = '';
    
    if (currentMaterials.length === 0) {
        if(emptyMsg) emptyMsg.classList.remove('hidden');
        return;
    } else {
        if(emptyMsg) emptyMsg.classList.add('hidden');
    }

    let totalQuota = 0;
    let totalWon = 0;

    currentMaterials.forEach((item, index) => {
        const quotaVal = parseFloat(item.quota) || 0;
        const wonVal = parseFloat(item.sl_trung) || 0;
        totalQuota += quotaVal;
        totalWon += wonVal;

        const tr = document.createElement('tr');
        tr.className = 'bg-white dark:bg-gray-800 border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700';
        tr.innerHTML = `
            <td class="px-3 py-2">
                <input type="text" class="w-full px-2 py-1 border rounded text-xs focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${item.ma_vt || ''}" placeholder="Mã VT" onchange="window.updateMaterial(${index}, 'ma_vt', this.value)" ${readOnly ? 'disabled' : ''}>
            </td>
            <td class="px-3 py-2">
                <input type="number" class="w-full px-2 py-1 border rounded text-xs focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white no-spinner appearance-none m-0" value="${item.quota || ''}" placeholder="0" onchange="window.updateMaterial(${index}, 'quota', this.value)" ${readOnly ? 'disabled' : ''}>
            </td>
            <td class="px-3 py-2">
                <input type="number" class="w-full px-2 py-1 border rounded text-xs focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white no-spinner appearance-none m-0" value="${item.sl_trung || ''}" placeholder="0" onchange="window.updateMaterial(${index}, 'sl_trung', this.value)" ${readOnly ? 'disabled' : ''}>
            </td>
            <td class="px-3 py-2 text-right">
                ${!readOnly ? `<button type="button" onclick="window.removeMaterial(${index})" class="text-red-500 hover:text-red-700"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>` : ''}
            </td>
        `;
        container.appendChild(tr);
    });

    // Add Total Row
    const totalRow = document.createElement('tr');
    totalRow.className = 'bg-gray-100 dark:bg-gray-700 font-bold text-xs sticky bottom-0 z-10 border-t-2 border-gray-200 dark:border-gray-600 shadow-sm';
    totalRow.innerHTML = `
        <td class="px-3 py-2 text-right">Tổng:</td>
        <td class="px-3 py-2 text-left pl-4">${totalQuota.toLocaleString('vi-VN')}</td>
        <td class="px-3 py-2 text-left pl-4">${totalWon.toLocaleString('vi-VN')}</td>
        <td class="px-3 py-2"></td>
    `;
    container.appendChild(totalRow);
}

export function addMaterialRow() {
    currentMaterials.push({ ma_vt: '', quota: '', sl_trung: '' });
    renderMaterialList(isReadOnlyMode);
}

window.updateMaterial = function(index, field, value) {
    if(currentMaterials[index]) {
        currentMaterials[index][field] = value;
        // Auto-fill SL Trung when Quota changes
        if (field === 'quota') {
             currentMaterials[index]['sl_trung'] = value;
             renderMaterialList(isReadOnlyMode); // Re-render to calculate sums
        } else if (field === 'sl_trung') {
             renderMaterialList(isReadOnlyMode); // Re-render for total
        }
    }
};

window.removeMaterial = function(index) {
    currentMaterials.splice(index, 1);
    renderMaterialList(isReadOnlyMode);
};

// --- Autocomplete Logic ---

function setupAutocompletes(data) {
    const fields = [
        { key: 'benh_vien', inputId: 'l-benh-vien', listId: 'list-benh-vien' },
        { key: 'tinh', inputId: 'l-tinh', listId: 'list-tinh' },
        { key: 'khu_vuc', inputId: 'l-khu-vuc', listId: 'list-khu-vuc' },
        { key: 'loai', inputId: 'l-loai', listId: 'list-loai' },
        { key: 'nha_phan_phoi', inputId: 'l-npp', listId: 'list-npp' },
        { key: 'nganh', inputId: 'l-nganh', listId: 'list-nganh' },
        { key: 'psr', inputId: 'l-psr', listId: 'list-psr' },
        { key: 'quan_ly', inputId: 'l-quan-ly', listId: 'list-quan-ly' }
    ];

    fields.forEach(field => {
        const uniqueValues = [...new Set(data.map(item => item[field.key]).filter(v => v && v.trim() !== ''))].sort();
        setupSingleAutocomplete(field.inputId, field.listId, uniqueValues);
    });
}

function setupSingleAutocomplete(inputId, listId, values) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    if (!input || !list) return;

    const renderList = (filterText = '') => {
        if(isReadOnlyMode) return;
        const lowerFilter = filterText.toLowerCase();
        const filtered = values.filter(v => v.toLowerCase().includes(lowerFilter));
        if (filtered.length === 0) {
            list.classList.remove('show');
            return;
        }
        list.innerHTML = filtered.map(val => `<li class="custom-dropdown-item">${val}</li>`).join('');
        list.classList.add('show');
        list.querySelectorAll('li').forEach(li => {
            li.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = li.textContent;
                list.classList.remove('show');
                input.dispatchEvent(new Event('input'));
                if(inputId === 'l-benh-vien') generateMaThau(); // Trigger generation on selection
            });
        });
    };

    input.onfocus = () => renderList(input.value);
    input.oninput = () => renderList(input.value);
    input.onblur = () => { setTimeout(() => list.classList.remove('show'), 150); };
}

// --- Main Modal Functions ---

export async function openListingModal(item = null, readOnly = false, isPreFill = false) {
    const modal = document.getElementById('listing-modal');
    const form = document.getElementById('listing-form');
    const title = document.getElementById('listing-modal-title');
    const btnSave = document.getElementById('btn-save-listing');
    const fileContainer = document.getElementById('file-list-container');
    const btnUploadLabel = document.getElementById('btn-upload-label');
    const btnAddMaterial = document.getElementById('btn-add-material');
    
    isReadOnlyMode = readOnly;
    form.reset();
    fileContainer.innerHTML = '';
    currentFiles = [];
    currentMaterials = [];
    originalMaThau = null;
    
    // Load latest data for autocompletes from window cache
    if (window.getListingsCache) {
        setupAutocompletes(window.getListingsCache());
    }

    if (item) {
        title.textContent = readOnly ? t('nav_detail') : (isPreFill ? t('modal_add_title') : t('modal_edit_title'));
        
        // ID Handling
        if (!isPreFill) {
            document.getElementById('listing-id').value = item.id || item.ma_thau;
            originalMaThau = item.ma_thau; 
        } else {
            document.getElementById('listing-id').value = '';
            originalMaThau = null;
        }
        
        // Fill Fields
        document.getElementById('l-ma-thau').value = item.ma_thau || '';
        document.getElementById('l-nam').value = item.nam || new Date().getFullYear();
        document.getElementById('l-benh-vien').value = item.benh_vien || '';
        document.getElementById('l-tinh').value = item.tinh || '';
        document.getElementById('l-khu-vuc').value = item.khu_vuc || '';
        document.getElementById('l-loai').value = item.loai || '';
        document.getElementById('l-npp').value = item.nha_phan_phoi || '';
        document.getElementById('l-ngay').value = item.ngay || new Date().toISOString().split('T')[0];
        document.getElementById('l-ngay-ky').value = item.ngay_ky || '';
        document.getElementById('l-ngay-kt').value = item.ngay_ket_thuc || '';
        document.getElementById('l-nganh').value = item.nganh || '';
        document.getElementById('l-psr').value = item.psr || '';
        document.getElementById('l-quan-ly').value = item.quan_ly || '';
        document.getElementById('l-status').value = item.tinh_trang || 'Waiting';
        
        // Files (Only for existing items)
        try {
             if(item.files && !isPreFill) {
                 const files = typeof item.files === 'string' ? JSON.parse(item.files) : (item.files || []);
                 currentFiles = Array.isArray(files) ? files : [];
                 renderFileList(readOnly);
             }
        } catch(e) { console.error(e); }

        // Materials Logic
        if (!isPreFill && item.ma_thau) {
            showLoading(true);
            const { data, error } = await sb.from('detail').select('ma_vt, quota, sl_trung').eq('ma_thau', item.ma_thau);
            showLoading(false);
            if (!error && data) {
                currentMaterials = data;
            }
        } else if (isPreFill && item.details) {
            // AI returns details array
            currentMaterials = item.details.map(d => ({
                ma_vt: d.ma_vt || '',
                quota: d.quota || 0,
                sl_trung: d.sl_trung || d.quota || 0 
            }));
        }

    } else {
        // Fresh Add
        title.textContent = t('modal_add_title');
        document.getElementById('listing-id').value = '';
        const status = document.querySelector('.mobile-tab-btn.bg-blue-100')?.dataset.status || 'Waiting';
        document.getElementById('l-status').value = status; 
        
        const now = new Date();
        document.getElementById('l-nam').value = now.getFullYear();
        document.getElementById('l-ngay').value = now.toISOString().split('T')[0];
    }

    renderMaterialList(readOnly);

    // UI State (ReadOnly vs Edit)
    if (readOnly) {
        Array.from(form.elements).forEach(el => el.disabled = true);
        btnSave.classList.add('hidden');
        btnUploadLabel.classList.add('hidden');
        if(btnAddMaterial) btnAddMaterial.classList.add('hidden');
    } else {
        Array.from(form.elements).forEach(el => el.disabled = false);
        btnSave.classList.remove('hidden');
        btnUploadLabel.classList.remove('hidden');
        if(btnAddMaterial) btnAddMaterial.classList.remove('hidden');
    }

    initialFormState = getFormState();
    modal.classList.remove('hidden');
}

export async function closeListingModal(force = false) {
    if (!force && !isReadOnlyMode) {
        const currentState = getFormState();
        if (initialFormState !== currentState) {
            const confirmed = await showConfirm("Bạn có thay đổi chưa lưu. Bạn có chắc chắn muốn đóng?", "Xác nhận");
            if (!confirmed) return;
        }
    }
    
    document.getElementById('listing-modal').classList.add('hidden');
    document.getElementById('history-modal').classList.add('hidden');
}

export async function saveListing(e) {
    e.preventDefault();
    showLoading(true);

    const formData = {
        ma_thau: document.getElementById('l-ma-thau').value,
        nam: document.getElementById('l-nam').value || null,
        benh_vien: document.getElementById('l-benh-vien').value,
        tinh: document.getElementById('l-tinh').value,
        khu_vuc: document.getElementById('l-khu-vuc').value,
        loai: document.getElementById('l-loai').value,
        nha_phan_phoi: document.getElementById('l-npp').value,
        ngay: document.getElementById('l-ngay').value || null,
        ngay_ky: document.getElementById('l-ngay-ky').value || null,
        ngay_ket_thuc: document.getElementById('l-ngay-kt').value || null,
        nganh: document.getElementById('l-nganh').value,
        psr: document.getElementById('l-psr').value,
        quan_ly: document.getElementById('l-quan-ly').value,
        tinh_trang: document.getElementById('l-status').value,
        files: currentFiles
    };

    let changeLog = [];
    let actionType = "Tạo mới";
    let oldListing = null;
    let oldDetails = [];

    // --- History Tracking ---
    if (originalMaThau) {
        actionType = "Cập nhật";
        
        // Fetch OLD data
        const { data: listingData } = await sb.from('listing').select('*').eq('ma_thau', originalMaThau).single();
        const { data: detailData } = await sb.from('detail').select('ma_vt, quota, sl_trung').eq('ma_thau', originalMaThau);
        
        oldListing = listingData;
        oldDetails = detailData || [];

        // Compare Basic Fields
        const fields = {
            benh_vien: t('lbl_hospital'),
            tinh: t('lbl_province'),
            khu_vuc: t('lbl_area'),
            nha_phan_phoi: t('lbl_distributor'),
            loai: t('lbl_type'),
            ngay: t('lbl_date_created'),
            ngay_ky: t('lbl_signed_date'),
            ngay_ket_thuc: t('lbl_end_date'),
            nganh: t('lbl_sector'),
            psr: t('lbl_psr'),
            quan_ly: t('lbl_manager'),
            tinh_trang: 'Trạng thái'
        };

        for (const [key, label] of Object.entries(fields)) {
            let oldVal = oldListing ? oldListing[key] : '';
            let newVal = formData[key];
            if (oldVal === null) oldVal = '';
            if (newVal === null) newVal = '';
            
            if (String(oldVal) !== String(newVal)) {
                changeLog.push(`${label}: ${oldVal || '(Trống)'} -> ${newVal || '(Trống)'}`);
            }
        }

        // Compare Materials
        const oldMatMap = new Map();
        oldDetails.forEach(d => oldMatMap.set(d.ma_vt, d));

        const newMatMap = new Map();
        currentMaterials.forEach(d => {
            if (d.ma_vt && d.ma_vt.trim() !== '') {
                newMatMap.set(d.ma_vt, d);
            }
        });

        for (const [maVt, newMat] of newMatMap.entries()) {
            if (oldMatMap.has(maVt)) {
                const oldMat = oldMatMap.get(maVt);
                let matChanges = [];
                if (Number(oldMat.quota) !== Number(newMat.quota)) matChanges.push(`Quota: ${oldMat.quota} -> ${newMat.quota}`);
                if (Number(oldMat.sl_trung) !== Number(newMat.sl_trung)) matChanges.push(`Trúng: ${oldMat.sl_trung} -> ${newMat.sl_trung}`);
                if (matChanges.length > 0) changeLog.push(`Cập nhật VT [${maVt}]: ${matChanges.join(', ')}`);
            } else {
                changeLog.push(`Thêm VT mới [${maVt}]: Quota ${newMat.quota}`);
            }
        }

        for (const [maVt, oldMat] of oldMatMap.entries()) {
            if (!newMatMap.has(maVt)) changeLog.push(`Xóa VT [${maVt}]`);
        }
    } else {
        changeLog.push(`Tạo mới thầu với ${currentMaterials.length} mã vật tư.`);
    }

    // --- Save Logic ---
    let error;

    if (originalMaThau) {
        // Update
        const { error: err } = await sb.from('listing').update(formData).eq('ma_thau', originalMaThau); 
        error = err;
    } else {
        // Insert
        const { error: err } = await sb.from('listing').insert(formData);
        error = err;
    }

    if (error) {
        showLoading(false);
        showToast('Lỗi lưu dữ liệu Listing: ' + error.message, 'error');
        return;
    }

    // Sync Details: Delete all old, Insert new
    const targetMaThauToDelete = originalMaThau || formData.ma_thau;
    const { error: delError } = await sb.from('detail').delete().eq('ma_thau', targetMaThauToDelete);
    
    if (delError) console.error('Error clearing old details', delError);

    if (currentMaterials.length > 0) {
        const validMaterials = currentMaterials.filter(m => m.ma_vt && m.ma_vt.trim() !== '');
        
        if (validMaterials.length > 0) {
            const detailRows = validMaterials.map(m => ({
                id: Math.floor(Math.random() * 2000000000), 
                ma_thau: formData.ma_thau,
                nam: formData.nam,
                benh_vien: formData.benh_vien,
                tinh: formData.tinh,
                khu_vuc: formData.khu_vuc,
                nha_phan_phoi: formData.nha_phan_phoi,
                ngay: formData.ngay,
                loai: formData.loai,
                tinh_trang: formData.tinh_trang,
                ngay_ky: formData.ngay_ky,
                ngay_ket_thuc: formData.ngay_ket_thuc,
                nganh: formData.nganh,
                psr: formData.psr,
                quan_ly: formData.quan_ly,
                ma_vt: m.ma_vt,
                quota: m.quota || null,
                sl_trung: m.sl_trung || null
            }));

            const { error: insertError } = await sb.from('detail').insert(detailRows);
            if (insertError) {
                showToast('Cảnh báo: Lưu chi tiết thất bại: ' + insertError.message, 'error');
            }
        }
    }
    
    // Log History
    if (changeLog.length > 0) {
        await logHistory(formData.ma_thau, actionType, changeLog.join('\n'));
    }
    
    // Notification for Manual Creation - Use window global instead of imported function
    if (!originalMaThau && window.notifyAdmins) {
         await window.notifyAdmins(
            'Hồ sơ mới (Thủ công)', 
            `User ${currentUser.ho_ten} đã tạo mới hồ sơ thầu ${formData.ma_thau} (${formData.benh_vien}).`,
            { view: 'view-ton-kho' }
        );
    }

    showLoading(false);
    showToast(t('msg_update_success'), 'success');
    closeListingModal(true); // Close without confirmation
    // Refresh parent view via global
    if (window.fetchListings) await window.fetchListings();
}

// --- Utils ---

export function handleFileUpload(files) {
    if (!files || files.length === 0) return;
    
    Array.from(files).forEach(file => {
        const mockUrl = URL.createObjectURL(file);
        currentFiles.push({
            name: file.name,
            url: mockUrl, 
            type: file.type,
            size: file.size
        });
    });
    renderFileList(isReadOnlyMode);
}

export function handlePaste(e) {
    if(isReadOnlyMode) return;
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let files = [];
    for (let index in items) {
        const item = items[index];
        if (item.kind === 'file') {
            files.push(item.getAsFile());
        }
    }
    if (files.length > 0) handleFileUpload(files);
}

export function renderFileList(readOnly) {
    const container = document.getElementById('file-list-container');
    container.innerHTML = '';
    
    currentFiles.forEach((file, index) => {
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600';
        
        let icon = '<svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>';
        if (file.type && file.type.startsWith('image/')) {
            icon = `<img src="${file.url}" class="w-8 h-8 object-cover rounded">`;
        }

        div.innerHTML = `
            <div class="flex items-center gap-2 overflow-hidden">
                ${icon}
                <a href="${file.url}" target="_blank" class="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate">${file.name}</a>
            </div>
            ${!readOnly ? `
            <button type="button" class="text-red-500 hover:text-red-700 p-1" onclick="window.removeFile(${index})">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>` : ''}
        `;
        container.appendChild(div);
    });
}

window.removeFile = function(index) {
    currentFiles.splice(index, 1);
    renderFileList(isReadOnlyMode);
};

export function generateMaThau() {
    if(isReadOnlyMode) return;
    const dateVal = document.getElementById('l-ngay').value;
    const hospitalVal = document.getElementById('l-benh-vien').value;
    const maThauInput = document.getElementById('l-ma-thau');
    if (dateVal && hospitalVal) {
        const [year, month, day] = dateVal.split('-');
        const dateStr = `${day}${month}${year}`;
        const getAcronym = (str) => {
            return str.trim().replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(word => word.length > 0).map(word => word.charAt(0)).join('').toUpperCase();
        };
        const hospitalCode = getAcronym(hospitalVal);
        if (dateStr && hospitalCode) maThauInput.value = `${dateStr}-${hospitalCode}`;
    }
}
