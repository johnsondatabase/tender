
import { sb, showToast, showLoading, showConfirm, currentUser } from './app.js';
import { translations, getCurrentLanguage } from './lang.js';
import { logHistory } from './lichsu.js';

let currentFiles = [];
let currentMaterials = [];
let originalMaThau = null;
let isReadOnlyMode = false;
let initialFormState = null;
let provinceData = []; // Store province/area mapping
let productCodes = []; // Store available product codes

// Danh sách NPP giới hạn
const PREDEFINED_NPP = ["Harphaco Hà Nội", "Harpharco Hồ Chí Minh", "Sakae", "Long Giang"];

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
        khoa: document.getElementById('l-khoa')?.value || '',
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
    const totalFooter = document.getElementById('material-total-header'); // Changed ID to header
    
    if(!container) return;
    container.innerHTML = '';
    
    if (currentMaterials.length === 0) {
        if(emptyMsg) emptyMsg.classList.remove('hidden');
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
        tr.className = 'bg-white dark:bg-gray-800 border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 relative';
        
        // Cấu trúc Dropdown cho Mã VT
        tr.innerHTML = `
            <td class="px-2 py-2 relative">
                <div class="relative group">
                    <input type="text" id="mat-input-${index}" class="w-full px-2 py-1 border rounded text-xs focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white bg-white dark:bg-gray-700" 
                        value="${item.ma_vt || ''}" 
                        placeholder="Mã VT" 
                        autocomplete="off"
                        ${readOnly ? 'disabled' : ''}>
                    <ul id="mat-list-${index}" class="custom-dropdown-list custom-scrollbar"></ul>
                </div>
            </td>
            <td class="px-1 py-2">
                <input type="number" class="w-full px-2 py-1 border rounded text-xs focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white no-spinner appearance-none m-0 text-center" value="${item.quota || ''}" placeholder="0" onchange="window.updateMaterial(${index}, 'quota', this.value)" ${readOnly ? 'disabled' : ''}>
            </td>
            <td class="px-1 py-2">
                <input type="number" class="w-full px-2 py-1 border rounded text-xs focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white no-spinner appearance-none m-0 text-center" value="${item.sl_trung || ''}" placeholder="0" onchange="window.updateMaterial(${index}, 'sl_trung', this.value)" ${readOnly ? 'disabled' : ''}>
            </td>
            <td class="px-1 py-2 text-right">
                ${!readOnly ? `<button type="button" onclick="window.removeMaterial(${index})" class="text-red-500 hover:text-red-700 p-1"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>` : ''}
            </td>
        `;
        container.appendChild(tr);

        // Khởi tạo Autocomplete cho dòng này ngay lập tức
        setupSingleAutocomplete(`mat-input-${index}`, `mat-list-${index}`, productCodes, (val) => {
            window.updateMaterial(index, 'ma_vt', val);
        });
        
        const inputEl = document.getElementById(`mat-input-${index}`);
        if(inputEl) {
            inputEl.onchange = (e) => window.updateMaterial(index, 'ma_vt', e.target.value);
        }
    });

    // Update Total Header (Now at top)
    if (totalFooter) {
        totalFooter.innerHTML = `
            <div class="flex-1 text-left pl-2 text-gray-600 dark:text-gray-300 text-xs flex items-center">
                <span class="font-bold mr-1">SL:</span> ${currentMaterials.length}
            </div>
            <div class="flex items-center">
                <div class="text-right px-2 text-gray-600 dark:text-gray-300 font-bold text-xs mr-2">Tổng:</div>
                <div class="w-20 text-center px-1 font-bold text-blue-600 dark:text-blue-400 border-l dark:border-gray-600 bg-white dark:bg-gray-800 rounded-sm">${totalQuota.toLocaleString('vi-VN')}</div>
                <div class="w-20 text-center px-1 font-bold text-green-600 dark:text-green-400 border-l dark:border-gray-600 bg-white dark:bg-gray-800 rounded-sm">${totalWon.toLocaleString('vi-VN')}</div>
                <div class="w-8"></div>
            </div>
        `;
    }
}

export function addMaterialRow() {
    currentMaterials.push({ ma_vt: '', quota: '', sl_trung: '' });
    renderMaterialList(isReadOnlyMode);
}

window.updateMaterial = function(index, field, value) {
    if(currentMaterials[index]) {
        // --- VALIDATION: Mã VT ---
        // Chỉ chấp nhận nếu có trong productCodes
        if (field === 'ma_vt' && value && value.trim() !== '') {
            if (productCodes.length > 0 && !productCodes.includes(value)) {
                showToast(`Mã vật tư "${value}" không hợp lệ (không tồn tại).`, 'error');
                
                // Clear input UI
                const inputEl = document.getElementById(`mat-input-${index}`);
                if (inputEl) inputEl.value = '';
                
                // Don't update state with invalid value, treat as empty
                value = ''; 
            }
        }
        // -------------------------

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

// --- Autocomplete & Data Fetching ---

async function fetchAuxiliaryData() {
    // Fetch Provinces
    if (provinceData.length === 0) {
        const { data } = await sb.from('tinh_thanh').select('tinh, khu_vuc');
        if (data) provinceData = data;
    }
    
    // Fetch Products for Autocomplete
    if (productCodes.length === 0) {
        const { data } = await sb.from('product').select('ma_vt');
        if (data) productCodes = data.map(p => p.ma_vt);
    }
}

function setupAutocompletes(data) {
    // Exclude 'nha_phan_phoi' from automatic data extraction, we use PREDEFINED_NPP
    const fields = [
        { key: 'benh_vien', inputId: 'l-benh-vien', listId: 'list-benh-vien' },
        { key: 'loai', inputId: 'l-loai', listId: 'list-loai' },
        { key: 'nganh', inputId: 'l-nganh', listId: 'list-nganh' },
        { key: 'psr', inputId: 'l-psr', listId: 'list-psr' },
        { key: 'quan_ly', inputId: 'l-quan-ly', listId: 'list-quan-ly' }
    ];

    fields.forEach(field => {
        const uniqueValues = [...new Set(data.map(item => item[field.key]).filter(v => v && v.trim() !== ''))].sort();
        setupSingleAutocomplete(field.inputId, field.listId, uniqueValues);
    });
    
    // Setup Province Autocomplete manually from provinceData
    const provinces = [...new Set(provinceData.map(p => p.tinh))].sort();
    setupSingleAutocomplete('l-tinh', 'list-tinh', provinces);

    // Setup NPP Autocomplete with PREDEFINED list
    setupSingleAutocomplete('l-npp', 'list-npp', PREDEFINED_NPP);
}

// Updated Helper: Added optional onSelect callback and isSelectionEvent logic
function setupSingleAutocomplete(inputId, listId, values, onSelect = null) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    if (!input || !list) return;

    let isSelectionEvent = false; // Flag to prevent re-opening on selection
    // Move dropdown list element to document.body to avoid clipping inside modal
    if (!list.dataset.moved) {
        list.dataset.moved = '1';
        document.body.appendChild(list);
        list.style.position = 'absolute';
        list.style.zIndex = 12000;
    }

    const renderList = (filterText = '') => {
        if(isReadOnlyMode) return;
        const lowerFilter = filterText.toLowerCase();
        
        // Filter and limit to 100 items for performance
        const filtered = values.filter(v => v.toLowerCase().includes(lowerFilter));
        
        if (filtered.length === 0) {
            list.classList.remove('show');
            return;
        }
        
        const safeLimit = 100;
        const itemsToRender = filtered.slice(0, safeLimit);

        list.innerHTML = itemsToRender.map(val => `<li class="custom-dropdown-item">${val}</li>`).join('');
        list.classList.add('show');
        // Position dropdown relative to input (absolute on body)
        const rect = input.getBoundingClientRect();
        const estimatedItemHeight = 32;
        const maxVisible = Math.min(filtered.length, 6);
        const listHeight = Math.min(filtered.length * estimatedItemHeight, maxVisible * estimatedItemHeight);
        const spaceBelow = window.innerHeight - rect.bottom;
        let top;
        if (spaceBelow < listHeight + 8) {
            // show above input
            top = rect.top - listHeight - 6;
        } else {
            // show below input
            top = rect.bottom + 6;
        }
        list.style.left = (rect.left + window.scrollX) + 'px';
        list.style.top = (top + window.scrollY) + 'px';
        list.style.minWidth = rect.width + 'px';
        list.style.boxSizing = 'border-box';
        // Constrain width to listing modal content if present to avoid overflow
        const modalEl = document.getElementById('listing-modal-content') || document.getElementById('listing-modal') || document.querySelector('.modal');
        let maxAvailable = window.innerWidth - 24 - rect.left; // default available to viewport right edge
        if (modalEl) {
            const modalRect = modalEl.getBoundingClientRect();
            // available space within modal to the right of input
            maxAvailable = Math.max(100, Math.min(maxAvailable, modalRect.right - rect.left - 16));
        }
        // Ensure dropdown width does not exceed modal bounds
        list.style.maxWidth = Math.max(rect.width, maxAvailable) + 'px';
        // If the computed right edge would overflow modal, shift left to fit
        const computedRight = rect.left + parseFloat(list.style.maxWidth);
        if (modalEl) {
            const modalRect = modalEl.getBoundingClientRect();
            if (computedRight > modalRect.right - 8) {
                const shiftLeft = computedRight - (modalRect.right - 8);
                const newLeft = (rect.left - shiftLeft);
                list.style.left = (newLeft + window.scrollX) + 'px';
            }
        } else {
            // ensure not off-screen
            const vpRight = window.innerWidth - 8;
            const computedRightVp = rect.left + parseFloat(list.style.maxWidth);
            if (computedRightVp > vpRight) {
                const newLeft = rect.left - (computedRightVp - vpRight);
                list.style.left = (newLeft + window.scrollX) + 'px';
            }
        }
        
        list.querySelectorAll('li').forEach(li => {
            li.addEventListener('mousedown', (e) => {
                e.preventDefault(); // Prevent input blur before click is registered
                
                isSelectionEvent = true; // Set flag
                
                input.value = li.textContent;
                list.classList.remove('show'); // Force hide
                
                input.dispatchEvent(new Event('input')); // Trigger data binding
                
                if(onSelect) onSelect(input.value);
                
                // Reset flag after a minimal delay to allow event propagation to finish
                setTimeout(() => { isSelectionEvent = false; }, 100);
            });
        });
    };

    input.onfocus = () => {
        // Only show if not just selected
        if (!isSelectionEvent) renderList(input.value);
    };
    
    input.oninput = () => {
        // If this input event was triggered by selection code, DO NOT re-render list
        if (!isSelectionEvent) {
            renderList(input.value);
        }
    };
    
    input.onblur = () => { setTimeout(() => list.classList.remove('show'), 150); };
    
    // Logic auto-fill Khu vuc based on Tinh (Only for Main Form)
    if (inputId === 'l-tinh') {
        input.addEventListener('input', () => {
            const val = input.value;
            const found = provinceData.find(p => p.tinh === val);
            if (found) {
                document.getElementById('l-khu-vuc').value = found.khu_vuc || '';
            }
        });
    }
    
    if (inputId === 'l-benh-vien') {
        input.addEventListener('input', generateMaThau);
    }
}

// --- Main Modal Functions ---

export async function openListingModal(item = null, readOnly = false, isPreFill = false) {
    const modal = document.getElementById('listing-modal');
    
    // Updated HTML Structure: 
    // 1. Mobile view: main container overflows y, inner parts height auto.
    // 2. Desktop view: main container overflow hidden, inner parts scroll independently.
    // 3. Total Header moved to top of material section.
    // 4. Modal Header has ID for dragging.
    
    document.getElementById('listing-modal-content').innerHTML = `
        <div id="listing-modal-header" class="p-3 md:p-4 border-b dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-700 rounded-t-xl cursor-move select-none flex-shrink-0">
            <h3 id="listing-modal-title" class="text-base md:text-lg font-bold text-gray-800 dark:text-white" data-i18n="modal_add_title">Thêm Mới Thầu</h3>
            <div class="flex items-center gap-2">
                <button onclick="window.viewListingHistory()" class="text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 p-1" title="Xem lịch sử">
                     <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                </button>
                <button onclick="window.closeListingModal()" class="text-gray-500 hover:text-gray-700 dark:text-gray-400 p-1">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        </div>
        <form id="listing-form" onsubmit="window.saveListing(event)" class="flex-1 flex flex-col overflow-hidden text-xs md:text-sm">
             <input type="hidden" id="listing-id">
             <input type="hidden" id="l-status" value="Listing">
             
             <div class="hidden">
                 <input type="number" id="l-nam">
                 <input type="date" id="l-ngay">
                 <input type="text" id="l-ma-thau">
             </div>

             <!-- MOBILE LAYOUT FIX: Parent scrolls on mobile, Children scroll on Desktop -->
             <div class="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden bg-white dark:bg-gray-800">
                 
                 <!-- SECTION 1: INPUTS -->
                 <!-- Mobile: h-auto (expand), no internal scroll. Desktop: h-full, scrollable -->
                 <div class="w-full md:w-2/3 p-4 md:p-6 md:overflow-y-auto custom-scrollbar border-b md:border-b-0 md:border-r dark:border-gray-700 flex flex-col gap-4 flex-shrink-0 md:flex-shrink h-auto md:h-full">
                     <div class="grid grid-cols-6 gap-3 md:gap-4">
                        <div class="col-span-4 relative group input-wrapper">
                             <label class="block font-medium text-gray-700 dark:text-gray-300 mb-1"><span data-i18n="lbl_hospital">Bệnh Viện</span> <span class="text-red-500">*</span></label>
                             <input type="text" id="l-benh-vien" required class="w-full px-2 py-1.5 md:px-3 md:py-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white bg-white dark:bg-gray-700" autocomplete="off">
                             <ul id="list-benh-vien" class="custom-dropdown-list custom-scrollbar"></ul>
                        </div>
                        <div class="col-span-2 relative group input-wrapper">
                             <label class="block font-medium text-gray-700 dark:text-gray-300 mb-1" data-i18n="lbl_department">Khoa</label>
                             <input type="text" id="l-khoa" class="w-full px-2 py-1.5 md:px-3 md:py-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white bg-white dark:bg-gray-700" autocomplete="off">
                        </div>
                        <div class="col-span-3 relative group input-wrapper">
                            <label class="block font-medium text-gray-700 dark:text-gray-300 mb-1"><span data-i18n="lbl_province">Tỉnh</span> <span class="text-red-500">*</span></label>
                            <input type="text" id="l-tinh" required class="w-full px-2 py-1.5 md:px-3 md:py-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white bg-white dark:bg-gray-700" autocomplete="off">
                            <ul id="list-tinh" class="custom-dropdown-list custom-scrollbar"></ul>
                        </div>
                        <div class="col-span-3 relative group input-wrapper">
                             <label class="block font-medium text-gray-700 dark:text-gray-300 mb-1"><span data-i18n="lbl_area">Khu Vực</span> <span class="text-red-500">*</span></label>
                             <input type="text" id="l-khu-vuc" required readonly class="w-full px-2 py-1.5 md:px-3 md:py-2 border rounded bg-gray-100 dark:bg-gray-600 dark:border-gray-600 dark:text-white cursor-not-allowed">
                        </div>
                        <div class="col-span-3 relative group input-wrapper">
                            <label class="block font-medium text-gray-700 dark:text-gray-300 mb-1"><span data-i18n="lbl_type">Loại</span> <span class="text-red-500">*</span></label>
                            <input type="text" id="l-loai" required class="w-full px-2 py-1.5 md:px-3 md:py-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white bg-white dark:bg-gray-700" autocomplete="off">
                            <ul id="list-loai" class="custom-dropdown-list custom-scrollbar"></ul>
                        </div>
                        
                        <!-- Nhà Phân Phối với nút Add -->
                         <div class="col-span-3 relative group input-wrapper">
                            <label class="block font-medium text-gray-700 dark:text-gray-300 mb-1"><span data-i18n="lbl_distributor">Nhà Phân Phối</span> <span class="text-red-500">*</span></label>
                            <div class="flex gap-1">
                                <div class="relative flex-1">
                                    <input type="text" id="l-npp" required class="w-full px-2 py-1.5 md:px-3 md:py-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white bg-white dark:bg-gray-700" autocomplete="off">
                                    <ul id="list-npp" class="custom-dropdown-list custom-scrollbar"></ul>
                                </div>
                                <button type="button" id="btn-add-npp" class="px-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-600 dark:hover:bg-gray-500 border border-gray-300 dark:border-gray-500 rounded text-gray-600 dark:text-gray-200" title="Thêm NPP khác">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                                </button>
                            </div>
                        </div>

                        <div class="col-span-3">
                            <label class="block font-medium text-gray-700 dark:text-gray-300 mb-1" data-i18n="lbl_signed_date">Ngày Ký</label>
                            <input type="date" id="l-ngay-ky" class="w-full px-2 py-1.5 md:px-3 md:py-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                        </div>
                        <div class="col-span-3">
                            <label class="block font-medium text-gray-700 dark:text-gray-300 mb-1" data-i18n="lbl_end_date">Ngày Kết Thúc</label>
                            <input type="date" id="l-ngay-kt" class="w-full px-2 py-1.5 md:px-3 md:py-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                        </div>
                        <div class="col-span-3 relative group input-wrapper">
                            <label class="block font-medium text-gray-700 dark:text-gray-300 mb-1" data-i18n="lbl_sector">Ngành</label>
                            <input type="text" id="l-nganh" class="w-full px-2 py-1.5 md:px-3 md:py-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white bg-white dark:bg-gray-700" autocomplete="off">
                            <ul id="list-nganh" class="custom-dropdown-list custom-scrollbar"></ul>
                        </div>
                        
                        <div id="psr-container" class="col-span-3 relative group input-wrapper">
                             <label class="block font-medium text-gray-700 dark:text-gray-300 mb-1" data-i18n="lbl_psr">PSR</label>
                             <input type="text" id="l-psr" class="w-full px-2 py-1.5 md:px-3 md:py-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white bg-white dark:bg-gray-700" autocomplete="off">
                             <ul id="list-psr" class="custom-dropdown-list custom-scrollbar"></ul>
                        </div>
                        
                        <div class="col-span-3 relative group input-wrapper">
                            <label class="block font-medium text-gray-700 dark:text-gray-300 mb-1" data-i18n="lbl_manager">Quản Lý</label>
                            <input type="text" id="l-quan-ly" class="w-full px-2 py-1.5 md:px-3 md:py-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white bg-white dark:bg-gray-700" autocomplete="off">
                            <ul id="list-quan-ly" class="custom-dropdown-list custom-scrollbar"></ul>
                        </div>
                        <div class="col-span-3 relative group input-wrapper">
                            <label class="block font-medium text-gray-700 dark:text-gray-300 mb-1">Đính kèm tệp</label>
                            <label id="btn-upload-label" class="cursor-pointer w-full bg-white dark:bg-gray-700 border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-300 hover:text-primary hover:border-primary hover:bg-blue-50 dark:hover:bg-gray-600 px-3 py-2 rounded flex items-center justify-center shadow-sm transition-all gap-2 h-[38px] md:h-[42px]" title="Tải tệp lên">
                                 <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg>
                                 <span class="text-sm">Chọn tệp...</span>
                                 <input type="file" id="file-upload-input" multiple class="hidden">
                            </label>
                        </div>
                     </div>
                     <div id="file-list-container" class="space-y-2 mt-4"></div>
                 </div>
                 
                 <!-- SECTION 2: MATERIALS -->
                 <!-- Mobile: h-auto (expand). Desktop: h-full, scrollable independently -->
                 <div class="w-full md:w-1/3 bg-gray-50 dark:bg-gray-900/50 p-4 md:p-6 flex flex-col h-auto md:h-full border-t md:border-t-0 flex-shrink-0">
                    <div class="flex justify-between items-center mb-3 flex-shrink-0">
                        <h4 class="font-bold text-gray-700 dark:text-gray-200">Danh sách vật tư</h4>
                        <button type="button" id="btn-add-material" class="text-xs px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600 transition-colors flex items-center">
                            <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg> Thêm
                        </button>
                    </div>
                    
                    <div class="bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 flex-1 flex flex-col overflow-hidden relative h-auto md:h-full">
                        
                        <!-- TOTAL HEADER (Moved to top) -->
                        <div id="material-total-header" class="bg-gray-100 dark:bg-gray-800 border-b dark:border-gray-700 p-2 flex justify-between items-center shadow-sm z-20">
                            <!-- Injected by JS -->
                        </div>

                        <!-- SCROLLABLE PART -->
                        <!-- Mobile: No internal scroll (expand). Desktop: Scroll internal -->
                        <div class="md:flex-1 md:overflow-y-auto custom-scrollbar">
                             <table class="w-full text-sm text-left">
                                <thead class="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 uppercase text-[10px] sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th class="px-2 py-2 pl-3">Mã VT</th>
                                        <th class="px-1 py-2 w-20 text-center">Quota</th>
                                        <th class="px-1 py-2 w-20 text-center">Trúng</th>
                                        <th class="px-1 py-2 w-8"></th>
                                    </tr>
                                </thead>
                                <tbody id="material-list-body" class="divide-y divide-gray-200 dark:divide-gray-700">
                                </tbody>
                            </table>
                            <div id="empty-material-msg" class="p-4 text-center text-gray-400 text-xs italic hidden">Chưa có vật tư nào.</div>
                        </div>
                    </div>
                 </div>
             </div>
             
             <!-- Footer -->
             <div class="flex-none border-t dark:border-gray-700 bg-white dark:bg-gray-800 p-3 md:p-4 flex justify-end gap-3 z-20">
                <button type="button" onclick="window.closeListingModal()" class="px-3 py-1.5 md:px-4 md:py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 font-medium" data-i18n="btn_cancel">Hủy</button>
                <button type="submit" id="btn-save-listing" class="px-4 py-1.5 md:px-6 md:py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-md font-medium" data-i18n="btn_save">Lưu</button>
            </div>
        </form>
        <div id="modal-resize-handle" class="resizer hidden md:block"></div>
    `;

    // Re-initialize internal listeners since HTML was replaced
    const btnAddMaterial = document.getElementById('btn-add-material');
    if (btnAddMaterial) btnAddMaterial.addEventListener('click', addMaterialRow);
    const fileInput = document.getElementById('file-upload-input');
    if(fileInput) fileInput.addEventListener('change', (e) => handleFileUpload(e.target.files));
    const hospitalInput = document.getElementById('l-benh-vien');
    if (hospitalInput) hospitalInput.addEventListener('input', generateMaThau);
    
    // Add NPP "+" button listener
    const btnAddNpp = document.getElementById('btn-add-npp');
    if (btnAddNpp) {
        btnAddNpp.onclick = () => {
            const input = document.getElementById('l-npp');
            input.value = '';
            input.focus();
            // Close dropdown if open
            const list = document.getElementById('list-npp');
            if(list) list.classList.remove('show');
        };
    }

    // Initialize Draggable Logic
    initDraggableModal();

    // --- Data Fetching ---
    await fetchAuxiliaryData();

    // --- Init Variables ---
    const form = document.getElementById('listing-form');
    const title = document.getElementById('listing-modal-title');
    const btnSave = document.getElementById('btn-save-listing');
    const btnUploadLabel = document.getElementById('btn-upload-label');
    
    isReadOnlyMode = readOnly;
    form.reset();
    document.getElementById('file-list-container').innerHTML = '';
    currentFiles = [];
    currentMaterials = [];
    originalMaThau = null;
    
    // Setup Autocompletes
    if (window.getListingsCache) {
        setupAutocompletes(window.getListingsCache());
    }

    // --- Populate Data ---
    if (item) {
        title.textContent = readOnly ? t('nav_detail') : (isPreFill ? t('modal_add_title') : t('modal_edit_title'));
        
        if (!isPreFill) {
            document.getElementById('listing-id').value = item.id || item.ma_thau;
            originalMaThau = item.ma_thau; 
        } else {
            document.getElementById('listing-id').value = '';
            originalMaThau = null;
        }
        
        document.getElementById('l-ma-thau').value = item.ma_thau || '';
        document.getElementById('l-nam').value = item.nam || new Date().getFullYear();
        document.getElementById('l-benh-vien').value = item.benh_vien || '';
        document.getElementById('l-khoa').value = item.khoa || ''; 
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
        document.getElementById('l-status').value = item.tinh_trang || 'Listing';
        
        try {
             if(item.files && !isPreFill) {
                 const files = typeof item.files === 'string' ? JSON.parse(item.files) : (item.files || []);
                 currentFiles = Array.isArray(files) ? files : [];
                 renderFileList(readOnly);
             }
        } catch(e) { console.error(e); }

        if (!isPreFill && item.ma_thau) {
            showLoading(true);
            const { data, error } = await sb.from('detail').select('ma_vt, quota, sl_trung').eq('ma_thau', item.ma_thau);
            showLoading(false);
            if (!error && data) {
                currentMaterials = data;
            }
        } else if (isPreFill && item.details) {
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
        document.getElementById('l-status').value = 'Listing'; // Default status Listing
        
        const now = new Date();
        document.getElementById('l-nam').value = now.getFullYear();
        document.getElementById('l-ngay').value = now.toISOString().split('T')[0];
    }

    // --- PSR Logic Handling ---
    const psrInput = document.getElementById('l-psr');
    const psrContainer = document.getElementById('psr-container');

    if (currentUser.phan_quyen === 'View') {
        // Nếu là View: Auto fill tên và ẩn container
        psrInput.value = currentUser.ho_ten;
        if(psrContainer) psrContainer.classList.add('hidden');
    } else {
        // Admin hoặc User
        if (!item && !isPreFill) { 
            // Nếu là form Thêm mới tinh: Auto fill tên
            psrInput.value = currentUser.ho_ten;
        }
        // Hiển thị để sửa
        if(psrContainer) psrContainer.classList.remove('hidden');
    }
    // ---------------------------

    renderMaterialList(readOnly);

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
        document.getElementById('l-khu-vuc').disabled = true; // Khu vuc always readonly as it auto-fills
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
        khoa: document.getElementById('l-khoa').value,
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

    if (originalMaThau) {
        actionType = "Cập nhật";
        
        const { data: listingData } = await sb.from('listing').select('*').eq('ma_thau', originalMaThau).single();
        const { data: detailData } = await sb.from('detail').select('ma_vt, quota, sl_trung').eq('ma_thau', originalMaThau);
        
        oldListing = listingData;
        oldDetails = detailData || [];

        const fields = {
            benh_vien: t('lbl_hospital'),
            khoa: t('lbl_department'),
            tinh: t('lbl_province'),
            khu_vuc: t('lbl_area'),
            nha_phan_phoi: t('lbl_distributor'),
            loai: t('lbl_type'),
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

    let error;

    if (originalMaThau) {
        const { error: err } = await sb.from('listing').update(formData).eq('ma_thau', originalMaThau); 
        error = err;
    } else {
        const { error: err } = await sb.from('listing').insert(formData);
        error = err;
    }

    if (error) {
        showLoading(false);
        showToast('Lỗi lưu dữ liệu Listing: ' + error.message, 'error');
        return;
    }

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
                khoa: formData.khoa,
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
    
    if (changeLog.length > 0) {
        await logHistory(formData.ma_thau, actionType, changeLog.join('\n'));
    }
    
    if (!originalMaThau && window.notifyAdmins) {
         await window.notifyAdmins(
            'Hồ sơ mới (Thủ công)', 
            `User ${currentUser.ho_ten} đã tạo mới hồ sơ thầu ${formData.ma_thau} (${formData.benh_vien}).`,
            { view: 'view-ton-kho' }
        );
    }

    showLoading(false);
    showToast(t('msg_update_success'), 'success');
    closeListingModal(true); 
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

// Function to make modal draggable and resizable
function initDraggableModal() {
    const modal = document.getElementById('listing-modal-content');
    const header = document.getElementById('listing-modal-header');
    
    if(!modal || !header) return;

    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    header.onmousedown = (e) => {
        if(window.innerWidth < 768) return; // Disable drag on mobile
        // Only allow left mouse button
        if (e.button !== 0) return;
        
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        const rect = modal.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        
        // Reset styles to allow absolute positioning drag
        modal.style.margin = '0';
        modal.style.transform = 'none';
        modal.style.left = initialLeft + 'px';
        modal.style.top = initialTop + 'px';
        modal.style.position = 'absolute';
        
        document.onmousemove = (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            modal.style.left = (initialLeft + dx) + 'px';
            modal.style.top = (initialTop + dy) + 'px';
        };

        document.onmouseup = () => {
            isDragging = false;
            document.onmousemove = null;
            document.onmouseup = null;
        };
    };
    
    // Resizable Logic
    const resizer = document.getElementById('modal-resize-handle');
    if(resizer) {
        resizer.onmousedown = (e) => {
            e.stopPropagation();
            let startW = modal.offsetWidth;
            let startH = modal.offsetHeight;
            let startX = e.clientX;
            let startY = e.clientY;

            document.onmousemove = (e) => {
                const newW = startW + e.clientX - startX;
                const newH = startH + e.clientY - startY;
                if(newW > 300) modal.style.width = newW + 'px';
                if(newH > 300) modal.style.height = newH + 'px';
            };

            document.onmouseup = () => {
                document.onmousemove = null;
                document.onmouseup = null;
            };
        };
    }
}
