


import { sb, showToast, showLoading, showConfirm, currentUser, sanitizeFileName, showView } from './app.js';
import { translations, getCurrentLanguage, setLanguage } from './lang.js';

let hot; // Handsontable instance
let allData = []; // Full dataset from DB
let displayedData = []; // Filtered dataset
let currentPage = 1;
let rowsPerPage = 50;
let productRealtimeChannel = null;
let isProductLoaded = false; // Caching flag
let currentManagingProduct = null; // Stores data of product currently being edited in image modal
let addProductFiles = []; // Staging array for Add Product Form files
let savedSearchKeyword = ''; // Persistence

// User Preferences Key
const getStorageKey = () => `crm_user_settings_${currentUser ? currentUser.gmail : 'guest'}_product_view_v3`;

// Helper Translation
const t = (key) => {
    const lang = getCurrentLanguage();
    return translations[lang][key] || key;
};

// Permission Helper
function checkPermission(action) {
    if (!currentUser) return false;
    if (currentUser.phan_quyen === 'Admin') return true;
    try {
        const perms = Array.isArray(currentUser[action]) ? currentUser[action] : JSON.parse(currentUser[action] || '[]');
        return perms.includes('view-san-pham');
    } catch(e) { return false; }
}

// --- Custom Image Renderer (Shows Thumbnail & Count) ---
function imageRenderer(instance, td, row, col, prop, value, cellProperties) {
    // Clear content first
    td.innerHTML = '';
    td.className = 'htCenter htMiddle relative p-0'; 

    let images = [];
    try {
        if (value) {
            if (Array.isArray(value)) {
                images = value;
            } else if (typeof value === 'string') {
                // Try parsing JSON, if fails treat as single URL
                if (value.trim().startsWith('[') || value.trim().startsWith('{')) {
                    try {
                        const parsed = JSON.parse(value);
                        if (Array.isArray(parsed)) images = parsed;
                        else images = [value];
                    } catch(e) { images = [value]; }
                } else {
                    if(value.trim() !== '') images = [value];
                }
            }
        }
    } catch(e) { console.error("Image parse error", e); }

    const container = document.createElement('div');
    container.className = 'flex items-center justify-center w-full h-full cursor-pointer relative hover:bg-gray-100 transition-colors';
    container.style.minHeight = '40px';
    
    // Retrieve the row data to pass to the modal
    const rowData = instance.getSourceDataAtRow(instance.toPhysicalRow(row));

    // Double click handler attached directly to the cell content
    container.ondblclick = (e) => {
        e.stopPropagation(); // Prevent Handsontable from entering edit mode
        openImageManager(rowData);
    };

    if (images.length > 0) {
        const firstUrl = images[0];
        const count = images.length;

        // Thumbnail
        const img = document.createElement('img');
        img.src = firstUrl;
        img.className = 'h-8 w-8 object-cover rounded border border-gray-200 dark:border-gray-600 shadow-sm bg-white dark:bg-gray-700';
        img.onerror = () => { img.src = 'https://via.placeholder.com/32?text=Err'; }; // Fallback
        container.appendChild(img);

        // Count Badge (Only if > 1)
        if (count > 1) {
            const badge = document.createElement('span');
            badge.className = 'absolute -bottom-1 -right-1 bg-blue-600 text-white text-[9px] font-bold h-4 w-4 flex items-center justify-center rounded-full border border-white dark:border-gray-800 shadow-sm z-10';
            badge.innerText = count;
            container.appendChild(badge);
        }
    } else {
        // Empty State Icon (Plus icon to indicate "Add")
        container.innerHTML = '<svg class="w-5 h-5 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>';
    }
    
    td.appendChild(container);
    return td;
}

// Base Column Definitions
const BASE_COLUMNS = [
    { data: 'selected', type: 'checkbox', titleKey: 'prod_select', width: 40, className: 'htCenter' },
    { data: 'url_hinh_anh', type: 'text', titleKey: 'prod_image', width: 80, className: 'htCenter', renderer: imageRenderer, readOnly: true },
    { data: 'ma_vt', type: 'text', titleKey: 'prod_ma_vt', width: 120, readOnly: true }, 
    { data: 'ten_vt', type: 'text', titleKey: 'prod_ten_vt', width: 200 },
    { data: 'waiting', type: 'numeric', titleKey: 'prod_waiting', width: 80, readOnly: true, className: 'htRight text-blue-600 font-bold' },
    { data: 'win', type: 'numeric', titleKey: 'prod_win', width: 80, readOnly: true, className: 'htRight text-green-600 font-bold' },
    { data: 'fail', type: 'numeric', titleKey: 'prod_fail', width: 80, readOnly: true, className: 'htRight text-red-600 font-bold' },
    { data: 'cau_hinh_1', type: 'text', titleKey: 'prod_ch1', width: 150, renderer: 'html' },
    { data: 'cau_hinh_2', type: 'text', titleKey: 'prod_ch2', width: 150, renderer: 'html' },
    { data: 'nganh', type: 'text', titleKey: 'prod_nganh', width: 100 },
    { data: 'group_product', type: 'text', titleKey: 'prod_group', width: 120 }
];

// Current Column State (Order, Visibility)
let columnSettings = [];
let savedSortConfig = undefined; 

// --- ESC Key Handler ---
function handleProductEscKey(e) {
    if (e.key === 'Escape') {
        const addModal = document.getElementById('add-product-modal');
        const imgModal = document.getElementById('image-management-modal');
        const colModal = document.getElementById('column-settings-modal');

        if (addModal && !addModal.classList.contains('hidden')) {
            addModal.classList.add('hidden');
        } else if (imgModal && !imgModal.classList.contains('hidden')) {
            imgModal.classList.add('hidden');
        } else if (colModal && !colModal.classList.contains('hidden')) {
            colModal.classList.add('hidden');
        }
    }
}

export async function onShowProductView(params = null) {
    const container = document.getElementById('view-san-pham');
    
    // Handle Incoming Params (e.g. from Detail View)
    if (params && params.filterCode) {
        savedSearchKeyword = params.filterCode;
    }

    // Optimization: If the view is already built (has the grid container), don't rebuild everything.
    // Just refresh data.
    if (container.querySelector('#hot-product-container')) {
        // Restore/Update search input
        const searchInput = document.getElementById('product-search');
        if(searchInput) searchInput.value = savedSearchKeyword;

        // Refresh translations
        setLanguage(getCurrentLanguage());
        // Update button text states if needed
        updateFilterButtonState();
        
        // If we have a forced filter from params, apply it
        if (params && params.filterCode) {
            filterData(savedSearchKeyword);
        } else {
            // Or just refresh existing view
            fetchProductData(true);
        }
        
        // Re-attach global listener just in case (it's safe to remove then add)
        document.removeEventListener('keydown', handleProductEscKey);
        document.addEventListener('keydown', handleProductEscKey);
        return;
    }

    // Check permissions
    let exportPermissions = [];
    let importPermissions = [];
    if (currentUser.phan_quyen === 'Admin') {
        exportPermissions = ['view-san-pham']; 
        importPermissions = ['view-san-pham'];
    } else {
         try { exportPermissions = Array.isArray(currentUser.xuat) ? currentUser.xuat : JSON.parse(currentUser.xuat || '[]'); } catch(e) {}
         try { importPermissions = Array.isArray(currentUser.nhap) ? currentUser.nhap : JSON.parse(currentUser.nhap || '[]'); } catch(e) {}
    }
    const canExport = exportPermissions.includes('view-san-pham');
    const canImport = importPermissions.includes('view-san-pham');
    const canAdd = checkPermission('them');
    
    // Build Mobile Add Menu Items
    let mobileAddMenuItems = `
        <button id="btn-prod-mobile-manual" class="block w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 border-b border-gray-100 flex items-center gap-2">
            <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
            <span>Thủ Công</span>
        </button>
    `;
    if (canImport) {
        mobileAddMenuItems += `
            <button id="btn-prod-mobile-excel" class="block w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 border-b border-gray-100 flex items-center gap-2">
                <svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                <span>Import Excel</span>
            </button>
            <button id="btn-prod-mobile-template" class="block w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2">
                <svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                <span>Tải Mẫu</span>
            </button>
        `;
    }

    // Inject Structure
    container.innerHTML = `
        <div class="flex flex-col h-full relative">
            <input type="file" id="prod-import-input" accept=".xlsx, .xls" class="hidden" />
            
            <!-- Toolbar -->
            <div class="flex flex-wrap items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700 shadow-sm z-[200]">
                <!-- Search -->
                <div class="relative w-full md:w-64">
                    <span class="absolute inset-y-0 left-0 flex items-center pl-2">
                        <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    </span>
                    <input type="text" id="product-search" class="w-full pl-8 pr-2 py-1.5 text-xs md:text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-1 focus:ring-blue-500 dark:text-white" data-i18n="search_all_cols" placeholder="Tìm kiếm...">
                </div>
                <div class="h-6 w-px bg-gray-300 dark:bg-gray-600 mx-1 hidden md:block"></div>
                
                <!-- Filter Toggle -->
                <button id="btn-toggle-prod-filter" class="flex items-center gap-1 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-xs font-medium text-gray-700 dark:text-gray-200 transition-colors">
                    <!-- Icon injected via JS -->
                </button>

                <!-- Column Settings -->
                <button id="btn-prod-col-settings" class="ml-1 flex items-center gap-1 px-2 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-xs font-medium text-gray-700 dark:text-gray-200 transition-colors">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 00-2 2"></path></svg>
                    <span class="hidden md:inline" data-i18n="btn_col_manager">Cột</span>
                </button>

                <!-- Delete Selected -->
                <button id="btn-delete-selected" class="hidden ml-1 flex items-center gap-1 px-2 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 rounded text-xs font-medium transition-colors">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    <span class="hidden md:inline" data-i18n="btn_delete_selected">Xóa</span>
                </button>

                <!-- Desktop buttons -->
                <button id="btn-prod-template" class="${canImport ? 'hidden md:flex' : 'hidden'} ml-1 items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded transition-colors text-xs font-medium">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                    <span class="hidden md:inline" data-i18n="btn_download_template">Mẫu</span>
                </button>
                <button id="btn-prod-import" class="${canImport ? 'hidden md:flex' : 'hidden'} ml-1 items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 rounded transition-colors text-xs font-medium">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                    <span class="hidden md:inline" data-i18n="btn_import">Import</span>
                </button>
                <div class="relative ml-1 ${canExport ? '' : 'hidden'}">
                    <button id="btn-prod-export" class="flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded text-xs font-medium transition-colors">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                        <span class="hidden md:inline" data-i18n="btn_export">Excel</span>
                    </button>
                    <div id="prod-export-dropdown" class="hidden absolute right-0 mt-1 w-40 bg-white dark:bg-gray-700 rounded-md shadow-lg border border-gray-200 dark:border-gray-600 z-[1000]">
                        <div class="py-1">
                            <button id="btn-prod-export-filtered" class="block w-full text-left px-4 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600" data-i18n="btn_export_filtered">Xuất theo bộ lọc</button>
                            <button id="btn-prod-export-all" class="block w-full text-left px-4 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600" data-i18n="btn_export_all">Xuất tất cả</button>
                        </div>
                    </div>
                </div>
                <button id="btn-add-product" class="${canAdd ? 'hidden md:flex' : 'hidden'} ml-1 items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium transition-colors shadow-sm">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                    <span data-i18n="btn_add_new">Thêm Mới</span>
                </button>
                
                <!-- Mobile Add Button -->
                <div class="${canAdd ? 'md:hidden relative ml-auto' : 'hidden'}">
                    <button id="btn-prod-mobile-add" class="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white rounded shadow-sm transition-colors">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                    </button>
                    <div id="prod-mobile-add-dropdown" class="hidden absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden">${mobileAddMenuItems}</div>
                </div>
            </div>

            <!-- Grid Container -->
            <div id="hot-product-container" class="flex-1 w-full overflow-hidden filters-hidden"></div>

            <!-- Bottom Footer Bar -->
            <div id="product-footer" class="h-10 bg-white dark:bg-gray-800 border-t dark:border-gray-700 flex items-center justify-between px-4 text-xs select-none shadow-[0_-2px_10px_rgba(0,0,0,0.05)] z-[200]">
                <div class="flex items-center gap-4 text-gray-600 dark:text-gray-300 font-medium">
                    <div class="flex items-center gap-1"><span class="text-gray-400">Waiting:</span><span id="prod-footer-waiting" class="text-blue-600 dark:text-blue-400 font-bold">0</span></div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600"></div>
                    <div class="flex items-center gap-1"><span class="text-gray-400">Win:</span><span id="prod-footer-win" class="text-green-600 dark:text-green-400 font-bold">0</span></div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600"></div>
                    <div class="flex items-center gap-1"><span class="text-gray-400">Fail:</span><span id="prod-footer-fail" class="text-red-600 dark:text-red-400 font-bold">0</span></div>
                </div>
                <div id="prod-selection-stats" class="hidden md:flex items-center gap-4 text-gray-500 dark:text-gray-400"></div>
                <div class="flex items-center gap-2">
                    <select id="prod-rows-per-page" class="hidden sm:block bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-xs px-1 py-0.5 outline-none focus:ring-1 focus:ring-blue-500"><option value="50">50</option><option value="100">100</option><option value="200">200</option><option value="-1">Tất cả</option></select>
                    <span id="prod-footer-pagination-text" class="text-gray-500 dark:text-gray-400 hidden sm:inline">0-0 trên 0</span>
                    <span id="prod-footer-page-number" class="hidden sm:inline text-gray-700 dark:text-gray-200 font-medium ml-1">Trang 1/1</span>
                    <div class="flex items-center border border-gray-200 dark:border-gray-600 rounded overflow-hidden ml-1"><button id="btn-prod-prev-page" class="px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-transparent border-r dark:border-gray-600 transition-colors"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg></button><button id="btn-prod-next-page" class="px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg></button></div>
                </div>
            </div>
        </div>
        
        <!-- Add Product Modal -->
        <div id="add-product-modal" class="hidden fixed inset-0 z-[10000] flex items-center justify-center modal-backdrop p-4">
            <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl transform transition-all flex flex-col max-h-[90vh]">
                <div class="p-4 border-b dark:border-gray-700 flex justify-between items-center">
                    <h3 class="text-lg font-bold text-gray-800 dark:text-white" data-i18n="modal_add_title">Thêm Mới</h3>
                    <button id="close-add-prod-btn" class="text-gray-500 hover:text-gray-700 dark:text-gray-400"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                </div>
                <form id="add-product-form" class="p-6 space-y-4 overflow-y-auto custom-scrollbar outline-none" tabindex="0">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div><label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"><span data-i18n="prod_ma_vt">Mã SP</span> <span class="text-red-500">*</span></label><input type="text" id="new-ma-vt" required class="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
                        <div><label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" data-i18n="prod_ten_vt">Tên SP</label><input type="text" id="new-ten-vt" class="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"></div>
                    </div>
                    <div><label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" data-i18n="prod_ch1">Cấu hình 1</label><textarea id="new-ch1" rows="2" class="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white resize-none"></textarea></div>
                    <div><label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" data-i18n="prod_ch2">Cấu hình 2</label><textarea id="new-ch2" rows="2" class="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white resize-none"></textarea></div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="relative group input-wrapper"><label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" data-i18n="prod_nganh">Ngành</label><input type="text" id="new-nganh" class="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white bg-white dark:bg-gray-700" autocomplete="off"><ul id="list-nganh" class="custom-dropdown-list custom-scrollbar"></ul></div>
                        <div class="relative group input-wrapper"><label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" data-i18n="prod_group">Nhóm Sản Phẩm</label><input type="text" id="new-group" class="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white bg-white dark:bg-gray-700" autocomplete="off"><ul id="list-group" class="custom-dropdown-list custom-scrollbar"></ul></div>
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Hình ảnh</label>
                        <div class="text-xs text-gray-500 dark:text-gray-400 mb-2">Chọn file hoặc dán ảnh (Ctrl+V) vào form này.</div>
                        
                        <!-- Preview Container -->
                        <div id="add-prod-img-previews" class="flex flex-wrap gap-2 mb-2 min-h-[40px] border-2 border-dashed border-gray-200 dark:border-gray-700 rounded p-2 bg-gray-50 dark:bg-gray-900/50 items-center">
                            <span class="text-gray-400 text-xs italic w-full text-center pointer-events-none">Khu vực dán ảnh</span>
                        </div>

                        <input type="file" id="prod-images" multiple accept="image/*" class="w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"/>
                    </div>
                    <div class="flex justify-end gap-3 pt-4 border-t dark:border-gray-700 mt-2"><button type="button" id="cancel-add-prod-btn" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300" data-i18n="btn_cancel">Hủy</button><button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-md" data-i18n="btn_save">Lưu</button></div>
                </form>
            </div>
        </div>

        <!-- Image Management Modal -->
        <div id="image-management-modal" class="hidden fixed inset-0 z-[11000] flex items-center justify-center modal-backdrop p-4">
            <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl flex flex-col h-[80vh] md:h-[85vh] relative overflow-hidden">
                <!-- Header -->
                <div class="flex justify-between items-center p-4 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700 flex-shrink-0">
                    <h3 id="img-modal-title" class="font-bold text-lg text-gray-800 dark:text-white truncate">Quản lý hình ảnh</h3>
                    <button id="close-img-modal-btn" class="text-gray-500 hover:text-gray-700 dark:text-gray-400"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                </div>
                
                <!-- Body -->
                <div id="img-modal-body" class="flex-1 p-4 overflow-y-auto bg-gray-100 dark:bg-gray-900 custom-scrollbar outline-none" tabindex="0">
                    <div id="img-grid" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        <!-- Images Injected Here -->
                    </div>
                    <div id="img-empty-state" class="hidden flex flex-col items-center justify-center h-full text-gray-400">
                        <svg class="w-16 h-16 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                        <p>Chưa có hình ảnh. Dán (Ctrl+V) hoặc chọn ảnh để thêm.</p>
                    </div>
                </div>

                <!-- Footer -->
                <div class="p-4 border-t dark:border-gray-700 bg-white dark:bg-gray-800 flex justify-between items-center flex-shrink-0">
                    <div class="text-xs text-gray-500 dark:text-gray-400 hidden md:block">Mẹo: Bạn có thể dán ảnh trực tiếp (Ctrl+V) vào cửa sổ này. Kéo thả để sắp xếp.</div>
                    <div class="flex gap-3">
                        <label class="cursor-pointer bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                            Thêm ảnh
                            <input type="file" id="img-modal-file-input" multiple accept="image/*" class="hidden">
                        </label>
                        <button id="btn-download-all-imgs" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors shadow-sm">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                            Tải xuống tất cả
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    setLanguage(getCurrentLanguage());
    loadUserSettings();

    // --- Initial Setup ---
    
    // Add Global Keydown Listener for ESC (once per view load is fine if handled correctly)
    document.removeEventListener('keydown', handleProductEscKey);
    document.addEventListener('keydown', handleProductEscKey);

    const initCore = async (silent) => {
        await fetchProductData(silent);
        
        // Restore search keyword if provided
        if (savedSearchKeyword) {
            const searchInput = document.getElementById('product-search');
            if (searchInput) searchInput.value = savedSearchKeyword;
            filterData(savedSearchKeyword);
        }

        initHandsontable();
        updateTableData();
        setupToolbarListeners();
        setupExportListeners();
        setupImageModalListeners(); 
        setupAddProductFormListeners(); 
        
        const resizeObserver = new ResizeObserver(() => {
            if(hot) hot.refreshDimensions();
        });
        resizeObserver.observe(document.getElementById('hot-product-container'));
    };

    if(isProductLoaded) {
        initCore(true);
    } else {
        initCore(false);
    }

    if(!productRealtimeChannel) {
        productRealtimeChannel = sb.channel('public:product_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'product' }, () => fetchProductData(true))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'detail' }, () => fetchProductData(true))
            .subscribe();
    }
}

// --- Add Product Form Logic (Enhanced) ---

function setupAddProductFormListeners() {
    const addForm = document.getElementById('add-product-form');
    const imageInput = document.getElementById('prod-images');
    const previewContainer = document.getElementById('add-prod-img-previews');
    const btnAdd = document.getElementById('btn-add-product');
    const addModal = document.getElementById('add-product-modal');
    const closeAddBtn = document.getElementById('close-add-prod-btn');
    const cancelAddBtn = document.getElementById('cancel-add-prod-btn');

    if (!addForm) return;

    // Reset State on Open
    const resetForm = () => {
        addForm.reset();
        addProductFiles = [];
        renderAddProductPreviews();
        addModal.classList.remove('hidden');
        populateAutocompletes();
        addForm.focus(); // Focus for paste
    };

    if(btnAdd) btnAdd.onclick = resetForm;
    const btnMobManual = document.getElementById('btn-prod-mobile-manual');
    if(btnMobManual) btnMobManual.onclick = () => {
        document.getElementById('prod-mobile-add-dropdown').classList.add('hidden');
        resetForm();
    };

    const closeAddModal = () => addModal.classList.add('hidden');
    if(closeAddBtn) closeAddBtn.onclick = closeAddModal;
    if(cancelAddBtn) cancelAddBtn.onclick = closeAddModal;

    // File Input Change
    imageInput.onchange = (e) => {
        if (e.target.files.length > 0) {
            Array.from(e.target.files).forEach(file => {
                addProductFiles.push(file);
            });
            renderAddProductPreviews();
            e.target.value = ''; // Reset input to allow selecting same file again if needed
        }
    };

    // Paste Event
    addForm.addEventListener('paste', (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        let hasImages = false;
        for (let index in items) {
            const item = items[index];
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const blob = item.getAsFile();
                addProductFiles.push(blob);
                hasImages = true;
            }
        }
        if(hasImages) renderAddProductPreviews();
    });

    // Submit Logic
    addForm.onsubmit = async (e) => {
        e.preventDefault();
        const ma_vt = document.getElementById('new-ma-vt').value;
        const ten_vt = document.getElementById('new-ten-vt').value;
        const cau_hinh_1 = document.getElementById('new-ch1').value;
        const cau_hinh_2 = document.getElementById('new-ch2').value;
        const nganh = document.getElementById('new-nganh').value;
        const group_product = document.getElementById('new-group').value;

        if (allData.some(i => i.ma_vt === ma_vt)) {
            showToast('Mã vật tư đã tồn tại.', 'error');
            return;
        }

        showLoading(true);
        let uploadedUrls = [];
        
        // Upload from addProductFiles array
        if (addProductFiles.length > 0) {
            for(const file of addProductFiles) {
                try {
                    // Ensure name exists (pasted blobs might need generic names)
                    const fileName = file.name || `pasted_image_${Date.now()}.png`;
                    const safeName = sanitizeFileName(`${Date.now()}-${fileName}`);
                    const { data: uploadData, error: uploadError } = await sb.storage.from('hinh_anh').upload(`public/${safeName}`, file);
                    if (!uploadError) {
                        const { data: publicUrlData } = sb.storage.from('hinh_anh').getPublicUrl(`public/${safeName}`);
                        if (publicUrlData) uploadedUrls.push(publicUrlData.publicUrl);
                    }
                } catch(err) { console.error("Image upload error", err); }
            }
        }

        const insertData = {
            ma_vt, ten_vt, cau_hinh_1, cau_hinh_2, nganh, group_product,
            url_hinh_anh: JSON.stringify(uploadedUrls) 
        };

        const { error } = await sb.from('product').insert(insertData);
        showLoading(false);

        if (error) {
            showToast('Lỗi thêm mới: ' + error.message, 'error');
        } else {
            showToast('Thêm mới thành công', 'success');
            closeAddModal();
            fetchProductData();
        }
    };
}

function renderAddProductPreviews() {
    const container = document.getElementById('add-prod-img-previews');
    if (!container) return;
    
    container.innerHTML = '';
    if (addProductFiles.length === 0) {
        container.innerHTML = '<span class="text-gray-400 text-xs italic w-full text-center pointer-events-none">Khu vực dán ảnh (Ctrl+V) hoặc chọn bên dưới</span>';
        return;
    }

    addProductFiles.forEach((file, index) => {
        const url = URL.createObjectURL(file);
        const div = document.createElement('div');
        div.className = 'relative w-16 h-16 border border-gray-300 rounded overflow-hidden group';
        div.innerHTML = `
            <img src="${url}" class="w-full h-full object-cover">
            <button type="button" class="absolute top-0 right-0 bg-red-500 text-white p-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded-bl" title="Xóa">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        `;
        div.querySelector('button').onclick = () => {
            addProductFiles.splice(index, 1);
            renderAddProductPreviews();
        };
        container.appendChild(div);
    });
}

// --- Image Modal Logic ---

function setupImageModalListeners() {
    const modal = document.getElementById('image-management-modal');
    const closeBtn = document.getElementById('close-img-modal-btn');
    const fileInput = document.getElementById('img-modal-file-input');
    const downloadBtn = document.getElementById('btn-download-all-imgs');
    const body = document.getElementById('img-modal-body');

    if (!modal) return;

    closeBtn.onclick = () => modal.classList.add('hidden');
    
    fileInput.onchange = async (e) => {
        if (e.target.files.length > 0) {
            await uploadImages(e.target.files);
            e.target.value = ''; // Reset
        }
    };

    downloadBtn.onclick = downloadAllImages;

    // Paste Listener for Body
    body.addEventListener('paste', async (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        const files = [];
        for (let index in items) {
            const item = items[index];
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                files.push(item.getAsFile());
            }
        }
        if (files.length > 0) {
            await uploadImages(files);
        }
    });
}

function openImageManager(rowData) {
    // Check permission first
    if (!checkPermission('sua') && !checkPermission('xem')) return;
    
    currentManagingProduct = rowData;
    const modal = document.getElementById('image-management-modal');
    const title = document.getElementById('img-modal-title');
    
    if (!modal) return;

    title.textContent = `${rowData.ten_vt || 'Sản phẩm'} (${rowData.ma_vt})`;
    renderImageGrid();
    
    modal.classList.remove('hidden');
    document.getElementById('img-modal-body').focus();
}

function renderImageGrid() {
    const container = document.getElementById('img-grid');
    const emptyState = document.getElementById('img-empty-state');
    
    if (!container) return;
    container.innerHTML = '';

    let images = [];
    try {
        if (currentManagingProduct.url_hinh_anh) {
            const raw = currentManagingProduct.url_hinh_anh;
            if (Array.isArray(raw)) {
                images = raw;
            } else if (typeof raw === 'string') {
                if (raw.startsWith('[')) {
                    try { images = JSON.parse(raw); } catch(e) { images = [raw]; }
                } else {
                    images = [raw];
                }
            }
        }
    } catch(e) { images = []; }

    if (images.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    } else {
        emptyState.classList.add('hidden');
    }

    const canEdit = checkPermission('sua');

    images.forEach((url, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'group relative aspect-square bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden border dark:border-gray-600 shadow-sm cursor-grab active:cursor-grabbing';
        wrapper.setAttribute('data-url', url);
        
        wrapper.innerHTML = `
            <img src="${url}" class="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity" onclick="window.open('${url}', '_blank')">
            <div class="absolute top-2 left-2 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded backdrop-blur-sm pointer-events-none">#${index + 1}</div>
            ${canEdit ? `<button class="btn-delete-img absolute top-2 right-2 p-1 bg-red-500 hover:bg-red-600 text-white rounded-full shadow-md transition-transform hover:scale-110" data-index="${index}">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>` : ''}
        `;
        
        if (canEdit) {
            wrapper.querySelector('.btn-delete-img').onclick = (e) => {
                e.stopPropagation();
                deleteImage(index);
            };
        }
        
        container.appendChild(wrapper);
    });

    // Initialize Sortable for Reordering if user has Edit permission
    if (canEdit) {
        new Sortable(container, {
            animation: 150,
            ghostClass: 'opacity-50',
            delay: 100, // Slight delay to prevent accidental drag on touch
            delayOnTouchOnly: true,
            onEnd: async (evt) => {
                if (evt.oldIndex === evt.newIndex) return;
                
                // Reorder array locally
                const movedItem = images.splice(evt.oldIndex, 1)[0];
                images.splice(evt.newIndex, 0, movedItem);
                
                // Update DB
                showLoading(true);
                const { error } = await sb.from('product').update({ url_hinh_anh: JSON.stringify(images) }).eq('ma_vt', currentManagingProduct.ma_vt);
                showLoading(false);
                
                if (error) {
                    showToast("Lỗi cập nhật vị trí: " + error.message, 'error');
                    renderImageGrid(); // Revert visual
                } else {
                    currentManagingProduct.url_hinh_anh = JSON.stringify(images);
                    // Refresh whole grid to update index badges
                    renderImageGrid(); 
                    fetchProductData(true); // Silent refresh main table
                }
            }
        });
    }
}

async function uploadImages(fileList) {
    if (!currentManagingProduct || !checkPermission('sua')) return;
    
    showLoading(true);
    const newUrls = [];
    
    for (const file of fileList) {
        try {
            const safeName = sanitizeFileName(`${currentManagingProduct.ma_vt}-${Date.now()}-${file.name}`);
            const { data: uploadData, error: uploadError } = await sb.storage.from('hinh_anh').upload(`public/${safeName}`, file);
            
            if (!uploadError) {
                const { data: publicUrlData } = sb.storage.from('hinh_anh').getPublicUrl(`public/${safeName}`);
                if (publicUrlData) newUrls.push(publicUrlData.publicUrl);
            }
        } catch (e) {
            console.error("Upload fail:", e);
        }
    }

    if (newUrls.length > 0) {
        let existingImages = [];
        try {
            const raw = currentManagingProduct.url_hinh_anh;
            if (Array.isArray(raw)) existingImages = raw;
            else if (typeof raw === 'string') {
                if (raw.startsWith('[')) existingImages = JSON.parse(raw);
                else if(raw) existingImages = [raw];
            }
        } catch(e) { existingImages = []; }

        const combined = [...existingImages, ...newUrls];
        
        // Use proper upsert or update depending on your logic, here update is safe since we have ma_vt
        const { error } = await sb.from('product').update({ url_hinh_anh: JSON.stringify(combined) }).eq('ma_vt', currentManagingProduct.ma_vt);
        
        if (error) {
            showToast("Lỗi cập nhật: " + error.message, 'error');
        } else {
            currentManagingProduct.url_hinh_anh = JSON.stringify(combined); // Update local ref
            renderImageGrid();
            // Refresh grid silently to show new count badge
            fetchProductData(true);
        }
    }
    showLoading(false);
}

async function deleteImage(index) {
    if (!currentManagingProduct) return;
    const confirmed = await showConfirm("Bạn có chắc muốn xóa ảnh này?");
    if (!confirmed) return;

    let existingImages = [];
    try {
        const raw = currentManagingProduct.url_hinh_anh;
        if (Array.isArray(raw)) existingImages = raw;
        else if (typeof raw === 'string') {
            if (raw.startsWith('[')) existingImages = JSON.parse(raw);
            else if(raw) existingImages = [raw];
        }
    } catch(e) { return; }

    if (index >= 0 && index < existingImages.length) {
        existingImages.splice(index, 1);
        showLoading(true);
        const { error } = await sb.from('product').update({ url_hinh_anh: JSON.stringify(existingImages) }).eq('ma_vt', currentManagingProduct.ma_vt);
        showLoading(false);

        if (error) {
            showToast("Lỗi xóa: " + error.message, 'error');
        } else {
            currentManagingProduct.url_hinh_anh = JSON.stringify(existingImages);
            renderImageGrid();
            fetchProductData(true);
        }
    }
}

async function downloadAllImages() {
    if (!currentManagingProduct) return;
    
    let images = [];
    try {
        const raw = currentManagingProduct.url_hinh_anh;
        if (Array.isArray(raw)) images = raw;
        else if (typeof raw === 'string') {
            if (raw.startsWith('[')) images = JSON.parse(raw);
            else if(raw) images = [raw];
        }
    } catch(e) { return; }

    if (images.length === 0) {
        showToast("Không có ảnh để tải.", 'info');
        return;
    }

    showLoading(true);
    try {
        const zip = new JSZip();
        
        const promises = images.map(async (url, i) => {
            try {
                const response = await fetch(url);
                const blob = await response.blob();
                
                // Determine extension
                let ext = 'jpg';
                const type = blob.type;
                if (type === 'image/png') ext = 'png';
                else if (type === 'image/jpeg') ext = 'jpg';
                else if (type === 'image/webp') ext = 'webp';
                
                // Naming convention: hinh_anh_[ma_vt]_[index].[ext]
                const filename = `hinh_anh_${currentManagingProduct.ma_vt}_${i + 1}.${ext}`;
                zip.file(filename, blob);
            } catch(e) { console.error("Fetch error", e); }
        });

        await Promise.all(promises);
        
        const content = await zip.generateAsync({ type: "blob" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(content);
        link.download = `hinh_anh_${currentManagingProduct.ma_vt}.zip`;
        link.click();
        URL.revokeObjectURL(link.href);
        
        showToast("Tải xuống hoàn tất.", 'success');
    } catch (error) {
        console.error(error);
        showToast("Lỗi khi tạo file zip.", 'error');
    } finally {
        showLoading(false);
    }
}

// ... (Rest of the existing functions: fetchProductData, loadUserSettings, saveUserSettings, etc. UNCHANGED until initHandsontable) ...

async function fetchProductData(silent = false) {
    if(!silent) showLoading(true);
    const { data, error } = await sb.from('product_total').select('*').order('ma_vt', { ascending: true });
    if(!silent) showLoading(false);

    if (error) {
        showToast('Lỗi tải dữ liệu sản phẩm: ' + error.message, 'error');
        return;
    }

    allData = (data || []).map(item => ({ ...item, selected: false }));
    isProductLoaded = true;

    // Apply Filter if keyword exists
    if(savedSearchKeyword) filterData(savedSearchKeyword);
    else displayedData = [...allData];
    
    if(hot) updateTableData();
}

function loadUserSettings() {
    const raw = localStorage.getItem(getStorageKey());
    if (raw) {
        try {
            const settings = JSON.parse(raw);
            savedSortConfig = settings.sortConfig;
            const savedKeys = new Set(settings.columnSettings.map(c => c.data));
            const newCols = BASE_COLUMNS.filter(c => !savedKeys.has(c.data)).map(c => ({
                data: c.data,
                isVisible: true,
                isPinned: false,
                width: c.width || 100,
                className: c.className || ''
            }));
            const mergedSettings = [...settings.columnSettings, ...newCols];
            const currentKeys = new Set(BASE_COLUMNS.map(c => c.data));
            columnSettings = mergedSettings.filter(c => currentKeys.has(c.data));
            return;
        } catch(e) { console.error("Settings load error", e); }
    }
    columnSettings = BASE_COLUMNS.map(c => ({
        data: c.data,
        isVisible: true,
        isPinned: false,
        width: c.width || 100,
        className: c.className || ''
    }));
    savedSortConfig = undefined;
}

function saveUserSettings() {
    if (!hot) return;
    columnSettings.forEach(setting => {
        const visualIndex = hot.propToCol(setting.data);
        if (visualIndex !== null && visualIndex !== undefined && visualIndex >= 0) {
            const cellMeta = hot.getCellMeta(0, visualIndex); 
            if (cellMeta && cellMeta.className) {
                 const classes = cellMeta.className.split(' ');
                 const alignmentClasses = classes.filter(c => 
                    ['htLeft', 'htCenter', 'htRight', 'htJustify', 'htTop', 'htMiddle', 'htBottom'].includes(c)
                 );
                 const def = BASE_COLUMNS.find(c => c.data === setting.data);
                 const baseClasses = def && def.className ? def.className.split(' ') : [];
                 const nonAlignBase = baseClasses.filter(c => !['htLeft', 'htCenter', 'htRight', 'htJustify', 'htTop', 'htMiddle', 'htBottom'].includes(c));
                 setting.className = [...nonAlignBase, ...alignmentClasses].join(' ');
            }
        }
    });
    const sortConfig = hot.getPlugin('columnSorting').getSortConfig();
    const settings = {
        columnSettings: columnSettings,
        fixedColumnsLeft: hot.getSettings().fixedColumnsLeft,
        sortConfig: sortConfig 
    };
    localStorage.setItem(getStorageKey(), JSON.stringify(settings));
}

function getProcessedColumns() {
    const activeCols = [];
    columnSettings.forEach(setting => {
        if (setting.isVisible) {
            const def = BASE_COLUMNS.find(c => c.data === setting.data);
            if (def) {
                activeCols.push({ 
                    ...def, 
                    title: def.titleKey ? t(def.titleKey) : def.data,
                    width: setting.width || def.width,
                    className: setting.className || def.className || '' 
                });
            }
        }
    });
    return activeCols;
}

function initHandsontable() {
    const container = document.getElementById('hot-product-container');
    const userCols = getProcessedColumns();
    let pinnedCount = columnSettings.filter(c => c.isVisible && c.isPinned).length;
    const canEdit = checkPermission('sua');
    const canDelete = checkPermission('xoa');

    hot = new Handsontable(container, {
        data: [], 
        columns: userCols,
        readOnly: !canEdit, 
        rowHeaders: false, 
        colHeaders: true,
        height: '100%',
        width: '100%',
        stretchH: 'all',
        fixedColumnsLeft: pinnedCount,
        autoRowSize: true, 
        viewportRowRenderingOffset: 20,
        manualColumnResize: true,
        manualRowResize: true,
        contextMenu: canDelete ? ['remove_row', '---------', 'alignment'] : ['alignment'],
        filters: true,
        columnSorting: {
            indicator: true,
            sortEmptyCells: true,
            initialConfig: savedSortConfig
        },
        dropdownMenu: ['filter_by_condition', 'filter_by_value', 'filter_action_bar', '---------', 'alignment'],
        licenseKey: 'non-commercial-and-evaluation',
        autoWrapRow: true,
        autoWrapCol: true,
        
        afterColumnResize: (newSize, column) => {
            const visibleCols = columnSettings.filter(c => c.isVisible);
            if (visibleCols[column]) {
                visibleCols[column].width = newSize;
                saveUserSettings();
            }
        },
        afterFilter: () => { updateFilterButtonState(); },
        afterColumnSort: () => { saveUserSettings(); },
        afterSetCellMeta: (row, col, key, val) => { if (key === 'className') saveUserSettings(); },
        afterSelectionEnd: (row, col, row2, col2) => { calculateSelectionStats(row, col, row2, col2); },
        afterDeselect: () => { document.getElementById('prod-selection-stats').innerHTML = ''; },
        afterOnCellDblClick: async (event, coords, td) => {
            if (coords.row < 0 || coords.col < 0) return; // Header click
            
            const rowData = hot.getSourceDataAtRow(hot.toPhysicalRow(coords.row));
            const colProp = hot.colToProp(coords.col);

            if (colProp === 'ma_vt' && rowData.ma_vt) {
                const confirmed = await showConfirm(t('confirm_view_tender_detail'), 'View Details');
                if (confirmed) {
                    showView('view-chi-tiet', { filterCode: rowData.ma_vt });
                }
            }
        },
        afterChange: async (changes, source) => {
            if (source === 'loadData' || !changes) return;
            let hasSelectionChange = false;
            for (const [row, prop, oldVal, newVal] of changes) {
                if (oldVal === newVal) continue;
                const physicalRow = hot.toPhysicalRow(row);
                const rowData = hot.getSourceDataAtRow(physicalRow);
                if (prop === 'selected') {
                    rowData.selected = newVal;
                    hasSelectionChange = true;
                    continue; 
                }
                if(['ma_vt','waiting','win','fail','url_hinh_anh'].includes(prop)) continue; // Skip readonly

                const maVt = rowData.ma_vt;
                if (!maVt) continue;
                try {
                    const { error } = await sb.from('product').update({ [prop]: newVal }).eq('ma_vt', maVt);
                    if (error) {
                        showToast('Lỗi cập nhật: ' + error.message, 'error');
                        fetchProductData(true); 
                    }
                } catch (e) { console.error(e); }
            }
            if (hasSelectionChange) updateBulkDeleteButton();
        },
        beforeRemoveRow: async (index, amount, physicalRows) => {
            const maVtsToDelete = [];
            physicalRows.forEach(pRow => {
                const rowData = hot.getSourceDataAtRow(pRow);
                if(rowData && rowData.ma_vt) maVtsToDelete.push(rowData.ma_vt);
            });
            if (maVtsToDelete.length > 0) {
                const confirmed = await showConfirm(`Bạn có chắc muốn xóa ${maVtsToDelete.length} sản phẩm?`);
                if (!confirmed) return false; 
                showLoading(true);
                const { error } = await sb.from('product').delete().in('ma_vt', maVtsToDelete);
                showLoading(false);
                if (error) {
                    showToast('Lỗi xóa: ' + error.message, 'error');
                    return false;
                } else {
                    showToast('Đã xóa thành công', 'success');
                }
            }
        }
    });
}

// ... (Rest of file: updateBulkDeleteButton, deleteSelectedProducts, updateTableData, updateFooterInfo, calculateSelectionStats, filterData, updateFilterButtonState, setupToolbarListeners, populateAutocompletes, setupSingleAutocomplete, downloadProductTemplate, handleProductImport, setupExportListeners, exportToExcel - UNCHANGED) ...

function updateBulkDeleteButton() {
    const btn = document.getElementById('btn-delete-selected');
    if (!btn) return;
    const hasChecked = allData.some(d => d.selected === true);
    if (hasChecked) btn.classList.remove('hidden');
    else btn.classList.add('hidden');
}

async function deleteSelectedProducts() {
    const selectedItems = allData.filter(d => d.selected === true);
    if (selectedItems.length === 0) return;
    const confirmed = await showConfirm(`Bạn có chắc chắn muốn xóa ${selectedItems.length} sản phẩm đã chọn?`);
    if (!confirmed) return;
    showLoading(true);
    const ids = selectedItems.map(i => i.ma_vt);
    const { error } = await sb.from('product').delete().in('ma_vt', ids);
    showLoading(false);
    if (error) {
        showToast("Lỗi xóa sản phẩm: " + error.message, "error");
    } else {
        showToast("Đã xóa thành công.", "success");
        document.getElementById('btn-delete-selected').classList.add('hidden');
        fetchProductData();
    }
}

function updateTableData() {
    if (!hot) return;
    let pageData = [];
    let totalPages = 1;
    if (rowsPerPage === -1) {
        pageData = displayedData;
        currentPage = 1;
        totalPages = 1;
    } else {
        totalPages = Math.ceil(displayedData.length / rowsPerPage) || 1;
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;
        const start = (currentPage - 1) * rowsPerPage;
        const end = start + rowsPerPage;
        pageData = displayedData.slice(start, end);
    }
    hot.loadData(pageData);
    const startIdx = rowsPerPage === -1 ? 1 : ((currentPage - 1) * rowsPerPage) + 1;
    const endIdx = rowsPerPage === -1 ? displayedData.length : Math.min(startIdx + rowsPerPage - 1, displayedData.length);
    updateFooterInfo(startIdx, endIdx, displayedData.length, totalPages);
    const btnPrev = document.getElementById('btn-prod-prev-page');
    const btnNext = document.getElementById('btn-prod-next-page');
    if(btnPrev) btnPrev.disabled = currentPage === 1;
    if(btnNext) btnNext.disabled = currentPage === totalPages;
    updateFilterButtonState();
    updateBulkDeleteButton();
    setTimeout(() => hot.render(), 100); 
}

function updateFooterInfo(start, end, total, totalPages) {
    const pagText = document.getElementById('prod-footer-pagination-text');
    const pageNumText = document.getElementById('prod-footer-page-number');
    if (pagText) {
        if (total === 0) pagText.textContent = "0 dòng";
        else pagText.textContent = `${start}-${end} trên ${total}`;
    }
    if (pageNumText) pageNumText.textContent = `Trang ${currentPage}/${totalPages}`;
    let sumWait = 0, sumWin = 0, sumFail = 0;
    for(let i = 0; i < displayedData.length; i++) {
        const item = displayedData[i];
        if (item.waiting) sumWait += Number(item.waiting) || 0;
        if (item.win) sumWin += Number(item.win) || 0;
        if (item.fail) sumFail += Number(item.fail) || 0;
    }
    const fmt = (n) => n.toLocaleString('vi-VN');
    document.getElementById('prod-footer-waiting').textContent = fmt(sumWait);
    document.getElementById('prod-footer-win').textContent = fmt(sumWin);
    document.getElementById('prod-footer-fail').textContent = fmt(sumFail);
}

function calculateSelectionStats(r1, c1, r2, c2) {
    const statsContainer = document.getElementById('prod-selection-stats');
    if (!statsContainer) return;
    if (r1 === undefined || c1 === undefined) {
        statsContainer.innerHTML = '';
        return;
    }
    const selectedData = hot.getData(r1, c1, r2, c2);
    let count = 0;
    let sum = 0;
    let hasNumeric = false;
    const flatData = selectedData.flat();
    flatData.forEach(val => {
        if (val !== null && val !== '' && val !== undefined) {
            count++;
            const num = parseFloat(val);
            if (!isNaN(num)) {
                hasNumeric = true;
                sum += num;
            }
        }
    });
    if (count === 0) {
        statsContainer.innerHTML = '';
        return;
    }
    const fmt = (n) => n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
    let html = `<div><span class="text-xs">Đếm:</span> <span class="text-gray-800 dark:text-gray-200 font-bold text-xs">${count}</span></div>`;
    if (hasNumeric) {
        html += `<div class="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600"><span class="text-xs">Tổng:</span> <span class="text-gray-800 dark:text-gray-200 font-bold text-xs">${fmt(sum)}</span></div>`;
    }
    statsContainer.innerHTML = html;
}

function filterData(keyword) {
    savedSearchKeyword = keyword; // Persist state
    if (!keyword || keyword.trim() === '') {
        displayedData = [...allData];
    } else {
        const lower = keyword.toLowerCase();
        displayedData = allData.filter(item => {
            return Object.values(item).some(val => String(val).toLowerCase().includes(lower));
        });
    }
    currentPage = 1;
    updateTableData();
}

function updateFilterButtonState() {
    if(!hot) return;
    const btn = document.getElementById('btn-toggle-prod-filter');
    const container = document.getElementById('hot-product-container');
    const plugin = hot.getPlugin('filters');
    if(!btn || !container) return;
    const hasConditions = plugin.conditionCollection && !plugin.conditionCollection.isEmpty();
    const isVisible = !container.classList.contains('filters-hidden');
    btn.classList.remove('bg-blue-100', 'text-blue-700', 'bg-red-50', 'text-red-600', 'hover:bg-red-100');
    btn.classList.add('bg-gray-100', 'text-gray-700');
    if (hasConditions) {
        btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg><span class="hidden md:inline line-through" data-i18n="btn_clear_filter">${t('btn_clear_filter')}</span>`;
        btn.classList.remove('bg-gray-100', 'text-gray-700');
        btn.classList.add('bg-red-50', 'text-red-600', 'hover:bg-red-100');
        container.classList.remove('filters-hidden');
    } else if (isVisible) {
        btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path></svg><span class="hidden md:inline" data-i18n="btn_hide_filter">${t('btn_hide_filter')}</span>`;
        btn.classList.remove('bg-gray-100', 'text-gray-700');
        btn.classList.add('bg-blue-100', 'text-blue-700');
    } else {
        btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg><span class="hidden md:inline" data-i18n="btn_show_filter">${t('btn_show_filter')}</span>`;
    }
}

function setupToolbarListeners() {
    const btnPrev = document.getElementById('btn-prod-prev-page');
    const btnNext = document.getElementById('btn-prod-next-page');
    const selectRows = document.getElementById('prod-rows-per-page');
    if(selectRows) {
        selectRows.value = rowsPerPage;
        selectRows.onchange = (e) => { rowsPerPage = parseInt(e.target.value); currentPage = 1; updateTableData(); };
    }
    if(btnPrev) btnPrev.onclick = () => { if (currentPage > 1) { currentPage--; updateTableData(); } };
    if(btnNext) btnNext.onclick = () => { const totalPages = rowsPerPage === -1 ? 1 : Math.ceil(displayedData.length / rowsPerPage); if (currentPage < totalPages) { currentPage++; updateTableData(); } };

    const searchInput = document.getElementById('product-search');
    if(searchInput) searchInput.addEventListener('input', (e) => { filterData(e.target.value); });

    const filterBtn = document.getElementById('btn-toggle-prod-filter');
    if(filterBtn) filterBtn.onclick = () => {
        if(!hot) return;
        const container = document.getElementById('hot-product-container');
        const plugin = hot.getPlugin('filters');
        const hasConditions = plugin.conditionCollection && !plugin.conditionCollection.isEmpty();
        if (hasConditions) { plugin.clearConditions(); plugin.filter(); hot.render(); } 
        else { container.classList.toggle('filters-hidden'); updateFilterButtonState(); }
    };

    const btnBulkDelete = document.getElementById('btn-delete-selected');
    if (btnBulkDelete) btnBulkDelete.onclick = deleteSelectedProducts;

    const btnTemplate = document.getElementById('btn-prod-template');
    const btnImport = document.getElementById('btn-prod-import');
    const inputImport = document.getElementById('prod-import-input');
    if (btnTemplate) btnTemplate.onclick = downloadProductTemplate;
    if (btnImport) btnImport.onclick = () => inputImport.click();
    if (inputImport) inputImport.onchange = handleProductImport;

    const btnMobileAdd = document.getElementById('btn-prod-mobile-add');
    const mobileDropdown = document.getElementById('prod-mobile-add-dropdown');
    if (btnMobileAdd && mobileDropdown) {
        btnMobileAdd.onclick = (e) => { e.stopPropagation(); mobileDropdown.classList.toggle('hidden'); };
        document.addEventListener('click', (e) => { if (!mobileDropdown.contains(e.target) && !btnMobileAdd.contains(e.target)) mobileDropdown.classList.add('hidden'); });
    }
    const btnMobManual = document.getElementById('btn-prod-mobile-manual');
    const btnMobExcel = document.getElementById('btn-prod-mobile-excel');
    const btnMobTemplate = document.getElementById('btn-prod-mobile-template');
    if(btnMobManual) {
        btnMobManual.onclick = () => { mobileDropdown.classList.add('hidden'); const addForm = document.getElementById('add-product-form'); if(addForm) addForm.reset(); document.getElementById('add-product-modal').classList.remove('hidden'); populateAutocompletes(); };
    }
    if(btnMobExcel) { btnMobExcel.onclick = () => { mobileDropdown.classList.add('hidden'); inputImport.click(); }; }
    if(btnMobTemplate) { btnMobTemplate.onclick = () => { mobileDropdown.classList.add('hidden'); downloadProductTemplate(); }; }

    const btnAdd = document.getElementById('btn-add-product');
    const addModal = document.getElementById('add-product-modal');
    const closeAddBtn = document.getElementById('close-add-prod-btn');
    const cancelAddBtn = document.getElementById('cancel-add-prod-btn');
    const addForm = document.getElementById('add-product-form');

    if (btnAdd) {
        btnAdd.onclick = () => {
            addForm.reset();
            addModal.classList.remove('hidden');
            populateAutocompletes();
        };
    }
    const closeAddModal = () => addModal.classList.add('hidden');
    if (closeAddBtn) closeAddBtn.onclick = closeAddModal;
    if (cancelAddBtn) cancelAddBtn.onclick = closeAddModal;

    // Original addForm logic replaced by setupAddProductFormListeners() call inside initCore
    // Keeping this block for reference but logic moved to dedicated function below

    const colBtn = document.getElementById('btn-prod-col-settings');
    if (colBtn) {
        colBtn.onclick = () => {
            const modal = document.getElementById('column-settings-modal');
            const listContainer = document.getElementById('column-list-container');
            const saveBtn = document.getElementById('btn-save-cols');
            
            listContainer.innerHTML = '';
            const sortedSettings = [...columnSettings].sort((a, b) => (a.isPinned === b.isPinned ? 0 : a.isPinned ? -1 : 1));

            sortedSettings.forEach((col) => {
                const def = BASE_COLUMNS.find(c => c.data === col.data);
                if (!def) return;
                const el = document.createElement('div');
                el.className = 'flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600 cursor-pointer';
                el.dataset.data = col.data;
                el.innerHTML = `
                    <div class="flex items-center gap-3 pointer-events-none">
                        <svg class="w-4 h-4 text-gray-400 cursor-grab pointer-events-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                        <input type="checkbox" class="col-vis-check w-4 h-4 text-primary rounded border-gray-300 focus:ring-primary pointer-events-none" ${col.isVisible ? 'checked' : ''}>
                        <span class="text-sm font-medium text-gray-700 dark:text-gray-200">${def.titleKey ? t(def.titleKey) : def.data}</span>
                    </div>
                    <button class="btn-pin p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${col.isPinned ? 'pin-active' : 'text-gray-400'} z-10 relative pointer-events-auto">
                         <svg class="w-4 h-4 transform rotate-45" fill="currentColor" viewBox="0 0 20 20"><path d="M6 6V2c0-1.1.9-2 2-2h1a2 2 0 012 2v4l5 5v3h-6v4h-2v-4H2v-3l4-4z"/></svg>
                    </button>
                `;
                el.onclick = (e) => {
                    if (e.target.closest('.btn-pin') || e.target.closest('.cursor-grab')) return;
                    const checkbox = el.querySelector('.col-vis-check');
                    checkbox.checked = !checkbox.checked;
                    const target = columnSettings.find(c => c.data === col.data);
                    if(target) target.isVisible = checkbox.checked;
                };
                el.querySelector('.btn-pin').onclick = (e) => {
                    e.stopPropagation();
                    const target = columnSettings.find(c => c.data === col.data);
                    if(target) target.isPinned = !target.isPinned;
                    colBtn.click(); 
                };
                listContainer.appendChild(el);
            });

            new Sortable(listContainer, {
                animation: 150,
                ghostClass: 'opacity-50',
                handle: '.cursor-grab',
                onEnd: () => {
                    const newOrder = [];
                    listContainer.querySelectorAll('[data-data]').forEach(el => {
                        const dataKey = el.dataset.data;
                        const colState = columnSettings.find(c => c.data === dataKey);
                        if (colState) newOrder.push(colState);
                    });
                    columnSettings = newOrder;
                }
            });

            saveBtn.onclick = () => {
                saveUserSettings();
                const userCols = getProcessedColumns();
                let pinnedCount = columnSettings.filter(c => c.isVisible && c.isPinned).length;
                hot.updateSettings({ columns: userCols, fixedColumnsLeft: pinnedCount });
                modal.classList.add('hidden');
            };
            modal.classList.remove('hidden');
        };
    }

    window.addEventListener('languageChanged', () => {
        if(!hot) return;
        const userCols = getProcessedColumns();
        hot.updateSettings({ columns: userCols });
        updateFilterButtonState();
    });
}

function populateAutocompletes() {
    const nganhValues = [...new Set(allData.map(i => i.nganh).filter(v => v))].sort();
    const groupValues = [...new Set(allData.map(i => i.group_product).filter(v => v))].sort();
    setupSingleAutocomplete('new-nganh', 'list-nganh', nganhValues);
    setupSingleAutocomplete('new-group', 'list-group', groupValues);
}

function setupSingleAutocomplete(inputId, listId, values) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    if (!input || !list) return;
    const renderList = (filterText = '') => {
        const lowerFilter = filterText.toLowerCase();
        const filtered = values.filter(v => v.toLowerCase().includes(lowerFilter));
        if (filtered.length === 0) { list.classList.remove('show'); return; }
        list.innerHTML = filtered.map(val => `<li class="custom-dropdown-item">${val}</li>`).join('');
        list.classList.add('show');
        list.querySelectorAll('li').forEach(li => { li.addEventListener('mousedown', (e) => { e.preventDefault(); input.value = li.textContent; list.classList.remove('show'); }); });
    };
    input.onfocus = () => renderList(input.value);
    input.oninput = () => renderList(input.value);
    input.onblur = () => { setTimeout(() => list.classList.remove('show'), 150); };
}

function downloadProductTemplate() {
    const headers = ['Mã VT', 'Tên Vật Tư', 'Cấu hình 1', 'Cấu hình 2', 'Ngành', 'Nhóm Sản Phẩm'];
    const example = [['VT-001', 'Máy siêu âm', 'Màn hình 15 inch', 'Đầu dò đa tần', 'Chẩn đoán hình ảnh', 'G1']];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...example]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mau_Import_SanPham");
    XLSX.writeFile(wb, "Mau_Import_SanPham.xlsx");
}

function handleProductImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    showLoading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
            if (jsonData.length === 0) throw new Error("File không có dữ liệu.");
            const keyMap = { 'Mã VT': 'ma_vt', 'Tên Vật Tư': 'ten_vt', 'Cấu hình 1': 'cau_hinh_1', 'Cấu hình 2': 'cau_hinh_2', 'Ngành': 'nganh', 'Nhóm Sản Phẩm': 'group_product' };
            const inserts = jsonData.map(row => {
                const newRow = {};
                Object.keys(row).forEach(k => { if(keyMap[k.trim()]) newRow[keyMap[k.trim()]] = row[k]; });
                return newRow;
            }).filter(r => r.ma_vt);
            if(inserts.length === 0) throw new Error("Không tìm thấy cột 'Mã VT' hoặc dữ liệu hợp lệ.");
            const { error } = await sb.from('product').upsert(inserts, { onConflict: 'ma_vt', ignoreDuplicates: true });
            if (error) throw error;
            showToast(`Đã import ${inserts.length} dòng thành công.`, 'success');
            fetchProductData();
        } catch (error) { showToast("Lỗi import: " + error.message, "error"); } 
        finally { showLoading(false); event.target.value = ''; }
    };
    reader.readAsArrayBuffer(file);
}

function setupExportListeners() {
    const btn = document.getElementById('btn-prod-export');
    const dropdown = document.getElementById('prod-export-dropdown');
    const btnFiltered = document.getElementById('btn-prod-export-filtered');
    const btnAll = document.getElementById('btn-prod-export-all');
    if(!btn || !dropdown) return;
    btn.onclick = (e) => { e.stopPropagation(); dropdown.classList.toggle('hidden'); };
    document.addEventListener('click', (e) => { if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && !btn.contains(e.target)) dropdown.classList.add('hidden'); });
    btnFiltered.onclick = () => { exportToExcel('filtered'); dropdown.classList.add('hidden'); };
    btnAll.onclick = () => { exportToExcel('all'); dropdown.classList.add('hidden'); };
}

function exportToExcel(type) {
    if (!hot) return;
    showLoading(true);
    setTimeout(() => {
        try {
            const visibleColSettings = columnSettings.filter(c => c.isVisible && c.data !== 'selected');
            const headers = visibleColSettings.map(setting => {
                const def = BASE_COLUMNS.find(c => c.data === setting.data);
                return def ? (def.titleKey ? t(def.titleKey) : def.data) : setting.data;
            });
            let dataToExport = [];
            if (type === 'filtered') {
                const visualCols = hot.countCols();
                const visualRows = hot.countRows();
                for(let r=0; r<visualRows; r++) {
                    let rowData = [];
                    for(let c=0; c<visualCols; c++) {
                        const prop = hot.colToProp(c);
                        if (prop !== 'selected' && visibleColSettings.find(s => s.data === prop)) {
                            rowData.push(hot.getDataAtCell(r, c));
                        }
                    }
                    if(rowData.length > 0) dataToExport.push(rowData);
                }
            } else {
                dataToExport = allData.map(row => visibleColSettings.map(setting => row[setting.data]));
            }
            const wsData = [headers, ...dataToExport];
            const ws = XLSX.utils.aoa_to_sheet(wsData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "SanPham");
            XLSX.writeFile(wb, `Product_Export_${type}.xlsx`);
            showToast("Xuất Excel thành công!", "success");
        } catch (e) { showToast("Lỗi khi xuất Excel: " + e.message, "error"); } 
        finally { showLoading(false); }
    }, 100);
}