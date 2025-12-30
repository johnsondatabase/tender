
import { sb, showToast, showLoading, showConfirm, currentUser, sanitizeFileName, showView } from './app.js';
import { translations, getCurrentLanguage, setLanguage } from './lang.js';

let hot; // Handsontable instance
let allData = []; // Combined Data for Grid
let displayedData = []; // Filtered by Search Keyword
let rawProducts = []; // Raw Product Metadata
let rawDetails = []; // Raw Transaction Data
let productRealtimeChannel = null;
let isProductLoaded = false; 
let currentManagingProduct = null; 
let addProductFiles = []; 
let savedSearchKeyword = ''; 

// Date Filter State
let productDateFilter = {
    type: 'all', // all, today, week, month, quarter, year, custom
    start: '',
    end: ''
};

// Helpers for local date formatting/parsing (YYYY-MM-DD)
function formatLocalDate(dt) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function parseYMD(ymd) {
    if (!ymd) return null;
    const parts = String(ymd).split('-').map(n => parseInt(n, 10));
    if (parts.length !== 3) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

function getDateRangeByTypeProduct(type) {
    const now = new Date();
    let start, end;
    if (type === 'today') {
        start = formatLocalDate(now); end = formatLocalDate(now);
    } else if (type === 'week') {
        const day = now.getDay();
        const diffToMonday = (day + 6) % 7;
        const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - diffToMonday); startOfWeek.setHours(0,0,0,0);
        const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6); endOfWeek.setHours(23,59,59,999);
        start = formatLocalDate(startOfWeek); end = formatLocalDate(endOfWeek);
    } else if (type === 'month') {
        const s = new Date(now.getFullYear(), now.getMonth(), 1);
        const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        start = formatLocalDate(s); end = formatLocalDate(e);
    } else if (type === 'quarter') {
        const quarter = Math.floor(now.getMonth() / 3);
        const s = new Date(now.getFullYear(), quarter * 3, 1);
        const e = new Date(now.getFullYear(), quarter * 3 + 3, 0);
        start = formatLocalDate(s); end = formatLocalDate(e);
    } else if (type === 'year') {
        const s = new Date(now.getFullYear(), 0, 1);
        const e = new Date(now.getFullYear(), 11, 31);
        start = formatLocalDate(s); end = formatLocalDate(e);
    }
    return { start, end };
}

// User Preferences Key
const getStorageKey = () => `crm_user_settings_${currentUser ? currentUser.gmail : 'guest'}_product_view_v4`;

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

// --- Custom Image Renderer ---
function imageRenderer(instance, td, row, col, prop, value, cellProperties) {
    td.innerHTML = '';
    td.className = 'htCenter htMiddle relative p-0'; 

    let images = [];
    try {
        if (value) {
            if (Array.isArray(value)) {
                images = value;
            } else if (typeof value === 'string') {
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
    
    const rowData = instance.getSourceDataAtRow(instance.toPhysicalRow(row));

    container.ondblclick = (e) => {
        e.stopPropagation(); 
        openImageManager(rowData);
    };

    if (images.length > 0) {
        const firstUrl = images[0];
        const count = images.length;
        const img = document.createElement('img');
        img.src = firstUrl;
        img.className = 'h-8 w-8 object-cover rounded border border-gray-200 dark:border-gray-600 shadow-sm bg-white dark:bg-gray-700';
        img.onerror = () => { img.src = 'https://via.placeholder.com/32?text=Err'; }; 
        container.appendChild(img);

        if (count > 1) {
            const badge = document.createElement('span');
            badge.className = 'absolute -bottom-1 -right-1 bg-blue-600 text-white text-[9px] font-bold h-4 w-4 flex items-center justify-center rounded-full border border-white dark:border-gray-800 shadow-sm z-10';
            badge.innerText = count;
            container.appendChild(badge);
        }
    } else {
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
    { data: 'listing', type: 'numeric', titleKey: 'prod_listing', width: 80, readOnly: true, className: 'htRight text-gray-600 font-bold' },
    { data: 'waiting', type: 'numeric', titleKey: 'prod_waiting', width: 80, readOnly: true, className: 'htRight text-blue-600 font-bold' },
    { data: 'win', type: 'numeric', titleKey: 'prod_win', width: 80, readOnly: true, className: 'htRight text-green-600 font-bold' },
    { data: 'fail', type: 'numeric', titleKey: 'prod_fail', width: 80, readOnly: true, className: 'htRight text-red-600 font-bold' },
    { data: 'cau_hinh_1', type: 'text', titleKey: 'prod_ch1', width: 150, renderer: 'html' },
    { data: 'cau_hinh_2', type: 'text', titleKey: 'prod_ch2', width: 150, renderer: 'html' },
    { data: 'nganh', type: 'text', titleKey: 'prod_nganh', width: 100 },
    { data: 'group_product', type: 'text', titleKey: 'prod_group', width: 120 }
];

let columnSettings = [];
let savedSortConfig = undefined; 

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

export function onShowProductView(params = null) {
    const container = document.getElementById('view-san-pham');
    
    if (params && params.filterCode) {
        savedSearchKeyword = params.filterCode;
    }

    if (container.querySelector('#hot-product-container')) {
        const searchInput = document.getElementById('product-search');
        if(searchInput) searchInput.value = savedSearchKeyword;

        setLanguage(getCurrentLanguage());
        updateFilterButtonState();
        
        setTimeout(() => { if(hot) hot.refreshDimensions(); }, 50);

        if (params && params.filterCode) {
            filterData(savedSearchKeyword);
        } else {
            fetchProductData(true);
        }
        
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

    container.innerHTML = `
        <div class="flex flex-col h-full relative">
            <input type="file" id="prod-import-input" accept=".xlsx, .xls" class="hidden" />
            
            <!-- Toolbar -->
            <div class="flex flex-wrap items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700 shadow-sm z-[200]">
                <!-- Search -->
                <div class="relative w-full md:w-48 lg:w-64">
                    <span class="absolute inset-y-0 left-0 flex items-center pl-2">
                        <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    </span>
                    <input type="text" id="product-search" class="w-full pl-8 pr-2 py-1.5 text-xs md:text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-1 focus:ring-blue-500 dark:text-white" data-i18n="search_all_cols" placeholder="Tìm kiếm...">
                </div>

                <!-- Date Filter Scrollable Area -->
                <div class="flex-1 overflow-x-auto no-scrollbar mx-1 w-full md:w-auto order-3 md:order-2 border-t md:border-t-0 pt-2 md:pt-0 border-gray-200 dark:border-gray-700 md:border-none">
                    <div class="flex items-center gap-1.5 min-w-max">
                        <button class="prod-date-btn px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap bg-white dark:bg-gray-600 text-blue-600 shadow-sm border border-gray-200 dark:border-gray-500" data-type="all">${t('opt_all')}</button>
                        <button class="prod-date-btn px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200" data-type="today">${t('opt_today')}</button>
                        <button class="prod-date-btn px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200" data-type="week">${t('opt_week')}</button>
                        <button class="prod-date-btn px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200" data-type="month">${t('opt_month')}</button>
                        <button class="prod-date-btn px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200" data-type="quarter">${t('opt_quarter')}</button>
                        <button class="prod-date-btn px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200" data-type="year">${t('opt_year')}</button>
                        
                        <div class="h-4 w-px bg-gray-300 dark:bg-gray-600 mx-1"></div>
                        
                        <div class="flex items-center gap-1">
                            <input type="date" id="prod-date-start" class="w-24 px-1 py-1 text-[10px] border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                            <span class="text-gray-400">-</span>
                            <input type="date" id="prod-date-end" class="w-24 px-1 py-1 text-[10px] border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                            <button id="btn-apply-prod-date" class="p-1 bg-blue-100 text-blue-600 rounded hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300">
                                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Right Side Actions -->
                <div class="flex items-center gap-1 ml-auto order-2 md:order-3">
                    <div class="h-6 w-px bg-gray-300 dark:bg-gray-600 mx-1 hidden md:block"></div>
                    
                    <!-- Eye Toggle (Show/Hide Stats) - MOBILE ONLY -->
                    <button id="btn-toggle-prod-stats" class="md:hidden flex items-center justify-center p-1.5 bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 transition-colors" title="Hiện/Ẩn số liệu">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                    </button>

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
                    <!-- EXPORT EXCEL (Green Style) -->
                    <div class="relative ml-1 ${canExport ? '' : 'hidden'}">
                        <button id="btn-prod-export" class="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50 rounded text-xs font-medium transition-colors">
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
            </div>

            <!-- Stats Panel (Mobile) -->
            <div id="prod-stats-mobile" class="md:hidden hidden bg-blue-50 dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-2 text-xs overflow-x-auto select-none transition-all duration-300">
                <div class="flex flex-row items-center gap-4 min-w-max">
                    <div class="flex items-center gap-2 whitespace-nowrap">
                        <span class="text-gray-500" data-i18n="txt_rows">Dòng:</span>
                        <span id="mob-prod-row-count" class="text-gray-800 dark:text-gray-100 font-bold">0</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600"></div>
                    
                    <div class="flex items-center gap-1 whitespace-nowrap">
                        <span class="text-gray-500" data-i18n="prod_listing">Listing:</span>
                        <span id="mob-prod-listing" class="font-bold text-gray-600 dark:text-gray-300">0</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600"></div>

                    <div class="flex items-center gap-1 whitespace-nowrap">
                        <span class="text-blue-500" data-i18n="prod_waiting">Waiting:</span>
                        <span id="mob-prod-waiting" class="font-bold text-blue-600 dark:text-blue-400">0</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600"></div>
                    <div class="flex items-center gap-1 whitespace-nowrap">
                        <span class="text-green-500" data-i18n="prod_win">Win:</span>
                        <span id="mob-prod-win" class="font-bold text-green-600 dark:text-green-400">0</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600"></div>
                    <div class="flex items-center gap-1 whitespace-nowrap">
                        <span class="text-red-500" data-i18n="prod_fail">Fail:</span>
                        <span id="mob-prod-fail" class="font-bold text-red-600 dark:text-red-400">0</span>
                    </div>
                </div>
            </div>

            <!-- Grid Container -->
            <div id="hot-product-container" class="flex-1 w-full overflow-hidden filters-hidden"></div>

            <!-- Bottom Footer Bar (Desktop Only) -->
            <div id="prod-footer-desktop" class="hidden md:flex bg-white dark:bg-gray-800 border-t dark:border-gray-700 items-center justify-between px-4 py-1 text-xs select-none shadow-[0_-2px_10px_rgba(0,0,0,0.05)] z-[200]">
                <!-- Desktop Stats -->
                <div class="flex flex-1 items-center gap-4">
                    <div class="flex items-center gap-2 whitespace-nowrap">
                        <span class="text-gray-500" data-i18n="txt_rows">Dòng:</span>
                        <span id="desk-prod-row-count" class="text-gray-800 dark:text-gray-100 font-bold">0</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600"></div>
                    
                    <div class="flex items-center gap-1 whitespace-nowrap">
                        <span class="text-gray-500" data-i18n="prod_listing">Listing:</span>
                        <span id="desk-prod-listing" class="font-bold text-gray-600 dark:text-gray-300">0</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600"></div>

                    <div class="flex items-center gap-1 whitespace-nowrap">
                        <span class="text-blue-500" data-i18n="prod_waiting">Waiting:</span>
                        <span id="desk-prod-waiting" class="font-bold text-blue-600 dark:text-blue-400">0</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600"></div>
                    <div class="flex items-center gap-1 whitespace-nowrap">
                        <span class="text-green-500" data-i18n="prod_win">Win:</span>
                        <span id="desk-prod-win" class="font-bold text-green-600 dark:text-green-400">0</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600"></div>
                    <div class="flex items-center gap-1 whitespace-nowrap">
                        <span class="text-red-500" data-i18n="prod_fail">Fail:</span>
                        <span id="desk-prod-fail" class="font-bold text-red-600 dark:text-red-400">0</span>
                    </div>
                </div>

                <!-- Right Side: Selection Stats (Desktop) -->
                <div id="prod-selection-stats" class="flex items-center justify-end gap-3 text-gray-500 dark:text-gray-400 pl-4 border-l border-gray-300 dark:border-gray-600"></div>
            </div>
        </div>
        
        <!-- Add Product Modal, Image Modal, Column Modal are injected here in original code (omitted for brevity as they don't change) -->
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
                        <div id="add-prod-img-previews" class="flex flex-wrap gap-2 mb-2 min-h-[40px] border-2 border-dashed border-gray-200 dark:border-gray-700 rounded p-2 bg-gray-50 dark:bg-gray-900/50 items-center">
                            <span class="text-gray-400 text-xs italic w-full text-center pointer-events-none">Khu vực dán ảnh</span>
                        </div>
                        <input type="file" id="prod-images" multiple accept="image/*" class="w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"/>
                    </div>
                    <div class="flex justify-end gap-3 pt-4 border-t dark:border-gray-700 mt-2"><button type="button" id="cancel-add-prod-btn" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300" data-i18n="btn_cancel">Hủy</button><button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-md" data-i18n="btn_save">Lưu</button></div>
                </form>
            </div>
        </div>
        <div id="image-management-modal" class="hidden fixed inset-0 z-[11000] flex items-center justify-center modal-backdrop p-4"><div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl flex flex-col h-[80vh] md:h-[85vh] relative overflow-hidden"><div class="flex justify-between items-center p-4 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700 flex-shrink-0"><h3 id="img-modal-title" class="font-bold text-lg text-gray-800 dark:text-white truncate">Quản lý hình ảnh</h3><button id="close-img-modal-btn" class="text-gray-500 hover:text-gray-700 dark:text-gray-400"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button></div><div id="img-modal-body" class="flex-1 p-4 overflow-y-auto bg-gray-100 dark:bg-gray-900 custom-scrollbar outline-none" tabindex="0"><div id="img-grid" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"></div><div id="img-empty-state" class="hidden flex flex-col items-center justify-center h-full text-gray-400"><svg class="w-16 h-16 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg><p>Chưa có hình ảnh. Dán (Ctrl+V) hoặc chọn ảnh để thêm.</p></div></div><div class="p-4 border-t dark:border-gray-700 bg-white dark:bg-gray-800 flex justify-between items-center flex-shrink-0"><div class="text-xs text-gray-500 dark:text-gray-400 hidden md:block">Mẹo: Bạn có thể dán ảnh trực tiếp (Ctrl+V) vào cửa sổ này. Kéo thả để sắp xếp.</div><div class="flex gap-3"><label class="cursor-pointer bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>Thêm ảnh<input type="file" id="img-modal-file-input" multiple accept="image/*" class="hidden"></label><button id="btn-download-all-imgs" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors shadow-sm"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>Tải xuống tất cả</button></div></div></div></div><div id="column-settings-modal" class="hidden fixed inset-0 z-[10000] flex items-center justify-center modal-backdrop p-4"><div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm flex flex-col max-h-[80vh]"><div class="p-4 border-b dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-700 rounded-t-xl"><h3 class="text-lg font-bold text-gray-800 dark:text-white" data-i18n="col_manager_title">Quản lý cột</h3><button id="close-col-settings-btn" class="text-gray-500 hover:text-gray-700 dark:text-gray-400"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button></div><div class="p-2 bg-yellow-50 dark:bg-yellow-900/20 text-xs text-yellow-800 dark:text-yellow-200 border-b dark:border-gray-700 text-center">Kéo thả để sắp xếp. Ghim để đưa lên đầu.</div><div id="column-list-container" class="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar"></div><div class="p-4 border-t dark:border-gray-700 flex justify-end"><button id="btn-save-cols" class="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-700 font-medium shadow-md" data-i18n="btn_save">Áp dụng</button></div></div></div>
    `;
    
    setLanguage(getCurrentLanguage());
    loadUserSettings();

    document.removeEventListener('keydown', handleProductEscKey);
    document.addEventListener('keydown', handleProductEscKey);

    const initCore = (silent) => {
        initHandsontable();
        updateTableData(); 
        setupToolbarListeners();
        setupExportListeners();
        setupImageModalListeners(); 
        setupAddProductFormListeners(); 
        setupProductDateFilterListeners(); // NEW: Date Filter Listeners
        
        const resizeObserver = new ResizeObserver(() => {
            if(hot) hot.refreshDimensions();
        });
        resizeObserver.observe(document.getElementById('hot-product-container'));

        if (savedSearchKeyword) {
            const searchInput = document.getElementById('product-search');
            if (searchInput) searchInput.value = savedSearchKeyword;
            filterData(savedSearchKeyword);
        }

        fetchProductData(silent);
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

// --- Date Filter Logic ---

function setupProductDateFilterListeners() {
    const btns = document.querySelectorAll('.prod-date-btn');
    const startInput = document.getElementById('prod-date-start');
    const endInput = document.getElementById('prod-date-end');
    const applyBtn = document.getElementById('btn-apply-prod-date');

    const updateActiveButton = (type) => {
        btns.forEach(b => {
            if (b.dataset.type === type) {
                b.className = "prod-date-btn px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap bg-white dark:bg-gray-600 text-blue-600 shadow-sm border border-gray-200 dark:border-gray-500 ring-1 ring-blue-500/20";
            } else {
                b.className = "prod-date-btn px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200";
            }
        });
    };

    updateActiveButton('all');

    // Helper to format local date YYYY-MM-DD
    const formatLocal = (dt) => {
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const d = String(dt.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const getDateRangeByTypeLocal = (type) => {
        const now = new Date();
        let start, end;
        if (type === 'today') {
            start = formatLocal(now); end = formatLocal(now);
        } else if (type === 'week') {
            const day = now.getDay();
            const diffToMonday = (day + 6) % 7;
            const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - diffToMonday); startOfWeek.setHours(0,0,0,0);
            const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6); endOfWeek.setHours(23,59,59,999);
            start = formatLocal(startOfWeek); end = formatLocal(endOfWeek);
        } else if (type === 'month') {
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            start = formatLocal(startOfMonth); end = formatLocal(endOfMonth);
        } else if (type === 'quarter') {
            const quarter = Math.floor(now.getMonth() / 3);
            const startOfQuarter = new Date(now.getFullYear(), quarter * 3, 1);
            const endOfQuarter = new Date(now.getFullYear(), quarter * 3 + 3, 0);
            start = formatLocal(startOfQuarter); end = formatLocal(endOfQuarter);
        } else if (type === 'year') {
            const startOfYear = new Date(now.getFullYear(), 0, 1);
            const endOfYear = new Date(now.getFullYear(), 11, 31);
            start = formatLocal(startOfYear); end = formatLocal(endOfYear);
        }
        return { start, end };
    };

    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            productDateFilter.type = type;
            // Populate custom inputs for non-'all' and non-'custom'
            if (type && type !== 'all' && type !== 'custom') {
                const range = getDateRangeByTypeLocal(type);
                productDateFilter.start = range.start || '';
                productDateFilter.end = range.end || '';
                if (startInput) startInput.value = range.start || '';
                if (endInput) endInput.value = range.end || '';
            } else {
                productDateFilter.start = '';
                productDateFilter.end = '';
                if (startInput) startInput.value = '';
                if (endInput) endInput.value = '';
            }
            updateActiveButton(type);
            recalcProductData(); // Recalculate based on new filter
        });
    });

    applyBtn.addEventListener('click', () => {
        const start = startInput.value;
        const end = endInput.value;
        if (start && end) {
            productDateFilter.type = 'custom';
            productDateFilter.start = start;
            productDateFilter.end = end;
            updateActiveButton('custom'); 
            recalcProductData();
        } else {
            showToast(t('select_dates_error'), "info");
        }
    });
}

function isDateInProductRange(dateString) {
    if (!dateString) return false;
    const d = new Date(dateString);
    d.setHours(0,0,0,0);
    const { type, start, end } = productDateFilter;

    if (type === 'all') return true;

    if (type === 'custom' && start && end) {
        const s = parseYMD(start); if (s) s.setHours(0,0,0,0);
        const e = parseYMD(end); if (e) e.setHours(23,59,59,999);
        if (s && e) return d >= s && d <= e;
        return false;
    }

    if (type && type !== 'custom' && type !== 'all') {
        const range = getDateRangeByTypeProduct(type);
        if (range && range.start && range.end) {
            const s = parseYMD(range.start); if (s) s.setHours(0,0,0,0);
            const e = parseYMD(range.end); if (e) e.setHours(23,59,59,999);
            if (s && e) return d >= s && d <= e;
        }
    }
    return true;
}

// --- Data Fetching & Calculation ---

async function fetchProductData(silent = false) {
    if(!silent) showLoading(true);
    
    // 1. Fetch Products
    const { data: prods, error: pErr } = await sb.from('product').select('*').order('ma_vt', { ascending: true });
    
    // 2. Fetch Details (Only needed columns)
    const { data: dets, error: dErr } = await sb.from('detail').select('ma_vt, quota, sl_trung, tinh_trang, ngay');

    if(!silent) showLoading(false);

    if (pErr || dErr) {
        const msg = (pErr?.message || dErr?.message) || '';
        showToast(t('err_load_data').replace('{msg}', msg), 'error');
        return;
    }

    rawProducts = prods || [];
    rawDetails = dets || [];
    isProductLoaded = true;

    recalcProductData();
}

function recalcProductData() {
    // 1. Filter Details based on Date Range
    const filteredDetails = rawDetails.filter(d => isDateInProductRange(d.ngay));

    // 2. Aggregate Stats per Product
    const stats = {};
    filteredDetails.forEach(d => {
        if (!d.ma_vt) return;
        if (!stats[d.ma_vt]) stats[d.ma_vt] = { listing: 0, waiting: 0, win: 0, fail: 0 };
        
        const q = d.quota || 0;
        const w = d.sl_trung || 0;
        
        if (d.tinh_trang === 'Listing') stats[d.ma_vt].listing += q;
        else if (d.tinh_trang === 'Waiting') stats[d.ma_vt].waiting += q;
        else if (d.tinh_trang === 'Win') stats[d.ma_vt].win += w;
        else if (d.tinh_trang === 'Fail') stats[d.ma_vt].fail += q;
    });

    // 3. Merge with Products
    allData = rawProducts.map(p => ({
        ...p,
        listing: stats[p.ma_vt]?.listing || 0,
        waiting: stats[p.ma_vt]?.waiting || 0,
        win: stats[p.ma_vt]?.win || 0,
        fail: stats[p.ma_vt]?.fail || 0,
        selected: false
    }));

    // 4. Update View
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
    const isMobile = window.innerWidth < 768;

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
        viewportRowRenderingOffset: 50, // Increased buffer for smoother scroll
        viewportColumnRenderingOffset: 20, // Increased buffer for horizontal scroll
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
        
        // Mobile Selection Logic: Block selecting Read-Only cells
        beforeOnCellMouseDown: function(event, coords, TD) {
            if (isMobile && coords.row >= 0 && coords.col >= 0) {
                const cellMeta = this.getCellMeta(coords.row, coords.col);
                if (cellMeta.readOnly) {
                    event.stopImmediatePropagation(); // Block selection
                    return false;
                }
            }
        },
        
        afterColumnResize: (newSize, column) => {
            const visibleCols = columnSettings.filter(c => c.isVisible);
            if (visibleCols[column]) {
                visibleCols[column].width = newSize;
                saveUserSettings();
            }
        },
        afterFilter: () => { 
            updateFilterButtonState(); 
            calculateHotTotals(); // Recalculate stats on filter
        },
        afterColumnSort: () => { saveUserSettings(); },
        afterSetCellMeta: (row, col, key, val) => { if (key === 'className') saveUserSettings(); },
        afterSelectionEnd: (row, col, row2, col2) => { calculateSelectionStats(row, col, row2, col2); },
        afterDeselect: () => { document.getElementById('prod-selection-stats').innerHTML = ''; },
        afterOnCellDblClick: async (event, coords, td) => {
            if (coords.row < 0 || coords.col < 0) return; 
            
            const rowData = hot.getSourceDataAtRow(hot.toPhysicalRow(coords.row));
            const colProp = hot.colToProp(coords.col);

            if (colProp === 'ma_vt' && rowData.ma_vt) {
                const confirmed = await showConfirm(t('confirm_view_tender_detail'), t('confirm_title'));
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
                if(['ma_vt','listing','waiting','win','fail','url_hinh_anh'].includes(prop)) continue; 

                const maVt = rowData.ma_vt;
                if (!maVt) continue;
                try {
                    const { error } = await sb.from('product').update({ [prop]: newVal }).eq('ma_vt', maVt);
                    if (error) {
                        showToast(t('prod_update_error').replace('{msg}', error.message), 'error');
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
                const confirmed = await showConfirm(t('confirm_delete_items').replace('{n}', maVtsToDelete.length), t('confirm_title'));
                if (!confirmed) return false; 
                showLoading(true);
                const { error } = await sb.from('product').delete().in('ma_vt', maVtsToDelete);
                showLoading(false);
                if (error) {
                    showToast(t('prod_delete_error').replace('{msg}', error.message), 'error');
                    return false;
                } else {
                    showToast(t('prod_delete_success'), 'success');
                }
            }
        }
    });
}

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
    const confirmed = await showConfirm(t('confirm_delete_selected').replace('{n}', selectedItems.length), t('confirm_title'));
    if (!confirmed) return;
    showLoading(true);
    const ids = selectedItems.map(i => i.ma_vt);
    const { error } = await sb.from('product').delete().in('ma_vt', ids);
    showLoading(false);
    if (error) {
        showToast(t('prod_delete_error').replace('{msg}', error.message), "error");
    } else {
        showToast(t('prod_delete_success'), "success");
        document.getElementById('btn-delete-selected').classList.add('hidden');
        fetchProductData();
    }
}

function updateTableData() {
    if (!hot) return;
    hot.loadData(displayedData);
    calculateHotTotals();
    updateFilterButtonState();
    updateBulkDeleteButton();
    setTimeout(() => hot.render(), 100); 
}

function calculateHotTotals() {
    if (!hot) return;

    const visibleData = hot.getData();
    const listingIdx = hot.propToCol('listing');
    const waitingIdx = hot.propToCol('waiting');
    const winIdx = hot.propToCol('win');
    const failIdx = hot.propToCol('fail');

    let totalListing = 0;
    let totalWaiting = 0;
    let totalWin = 0;
    let totalFail = 0;

    visibleData.forEach(row => {
        if (row) {
            totalListing += (listingIdx !== null) ? (parseFloat(row[listingIdx]) || 0) : 0;
            totalWaiting += (waitingIdx !== null) ? (parseFloat(row[waitingIdx]) || 0) : 0;
            totalWin += (winIdx !== null) ? (parseFloat(row[winIdx]) || 0) : 0;
            totalFail += (failIdx !== null) ? (parseFloat(row[failIdx]) || 0) : 0;
        }
    });

    const fmt = (n) => n.toLocaleString('vi-VN');
    const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = fmt(val); };

    // Update Mobile Stats
    setVal('mob-prod-listing', totalListing);
    setVal('mob-prod-waiting', totalWaiting);
    setVal('mob-prod-win', totalWin);
    setVal('mob-prod-fail', totalFail);
    
    // Update Desktop Stats
    setVal('desk-prod-listing', totalListing);
    setVal('desk-prod-waiting', totalWaiting);
    setVal('desk-prod-win', totalWin);
    setVal('desk-prod-fail', totalFail);
    
    // Update Row Count
    const rowCount = displayedData.length;
    const mobRowCount = document.getElementById('mob-prod-row-count');
    const deskRowCount = document.getElementById('desk-prod-row-count');
    if (mobRowCount) mobRowCount.textContent = rowCount;
    if (deskRowCount) deskRowCount.textContent = rowCount;
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
    savedSearchKeyword = keyword; 
    if (!keyword || keyword.trim() === '') {
        displayedData = [...allData];
    } else {
        const lower = keyword.toLowerCase();
        displayedData = allData.filter(item => {
            return Object.values(item).some(val => String(val).toLowerCase().includes(lower));
        });
    }
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

    const statsBtn = document.getElementById('btn-toggle-prod-stats');
    if(statsBtn) {
        statsBtn.onclick = () => {
            const panel = document.getElementById('prod-stats-mobile');
            if(panel) {
                panel.classList.toggle('hidden');
                if(hot) setTimeout(() => hot.refreshDimensions(), 100);
            }
        };
    }

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
            showToast(t('import_success'), 'success');
            fetchProductData();
        } catch (error) { showToast(t('import_error').replace('{msg}', error.message), "error"); } 
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
            showToast(t('export_success'), "success");
        } catch (e) { showToast(t('export_error').replace('{msg}', e.message), "error"); } 
        finally { showLoading(false); }
    }, 100);
}

// ... (setupAddProductFormListeners, setupImageModalListeners, openImageManager, renderImageGrid, uploadImages, deleteImage, downloadAllImages UNCHANGED) ...

function setupAddProductFormListeners() {
    const addForm = document.getElementById('add-product-form');
    const imageInput = document.getElementById('prod-images');
    const previewContainer = document.getElementById('add-prod-img-previews');
    const btnAdd = document.getElementById('btn-add-product');
    const addModal = document.getElementById('add-product-modal');
    const closeAddBtn = document.getElementById('close-add-prod-btn');
    const cancelAddBtn = document.getElementById('cancel-add-prod-btn');

    if (!addForm) return;

    const resetForm = () => {
        addForm.reset();
        addProductFiles = [];
        renderAddProductPreviews();
        addModal.classList.remove('hidden');
        populateAutocompletes();
        addForm.focus(); 
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

    imageInput.onchange = (e) => {
        if (e.target.files.length > 0) {
            Array.from(e.target.files).forEach(file => {
                addProductFiles.push(file);
            });
            renderAddProductPreviews();
            e.target.value = ''; 
        }
    };

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

    addForm.onsubmit = async (e) => {
        e.preventDefault();
        const ma_vt = document.getElementById('new-ma-vt').value;
        const ten_vt = document.getElementById('new-ten-vt').value;
        const cau_hinh_1 = document.getElementById('new-ch1').value;
        const cau_hinh_2 = document.getElementById('new-ch2').value;
        const nganh = document.getElementById('new-nganh').value;
        const group_product = document.getElementById('new-group').value;

    if (allData.some(i => i.ma_vt === ma_vt)) {
            showToast(t('prod_code_exists'), 'error');
            return;
        }

        showLoading(true);
        let uploadedUrls = [];
        
        if (addProductFiles.length > 0) {
            for(const file of addProductFiles) {
                try {
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
            showToast(t('prod_update_error').replace('{msg}', error.message), 'error');
        } else {
            showToast(t('prod_add_success'), 'success');
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

    if (canEdit) {
        new Sortable(container, {
            animation: 150,
            ghostClass: 'opacity-50',
            delay: 100, 
            delayOnTouchOnly: true,
            onEnd: async (evt) => {
                if (evt.oldIndex === evt.newIndex) return;
                
                const movedItem = images.splice(evt.oldIndex, 1)[0];
                images.splice(evt.newIndex, 0, movedItem);
                
                showLoading(true);
                const { error } = await sb.from('product').update({ url_hinh_anh: JSON.stringify(images) }).eq('ma_vt', currentManagingProduct.ma_vt);
                showLoading(false);
                
                if (error) {
                    showToast(t('prod_update_error').replace('{msg}', error.message), 'error');
                    renderImageGrid();
                } else {
                    currentManagingProduct.url_hinh_anh = JSON.stringify(images);
                    renderImageGrid(); 
                    fetchProductData(true); 
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
        
        const { error } = await sb.from('product').update({ url_hinh_anh: JSON.stringify(combined) }).eq('ma_vt', currentManagingProduct.ma_vt);
        
        if (error) {
            showToast(t('prod_update_error').replace('{msg}', error.message), 'error');
        } else {
            currentManagingProduct.url_hinh_anh = JSON.stringify(combined); 
            renderImageGrid();
            fetchProductData(true);
        }
    }
    showLoading(false);
}

async function deleteImage(index) {
    if (!currentManagingProduct) return;
    const confirmed = await showConfirm(t('confirm_delete_image'), t('confirm_title'));
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
        showToast(t('no_images'), 'info');
        return;
    }

    showLoading(true);
    try {
        const zip = new JSZip();
        
        const promises = images.map(async (url, i) => {
            try {
                const response = await fetch(url);
                const blob = await response.blob();
                
                let ext = 'jpg';
                const type = blob.type;
                if (type === 'image/png') ext = 'png';
                else if (type === 'image/jpeg') ext = 'jpg';
                else if (type === 'image/webp') ext = 'webp';
                
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
        
        showToast(t('download_complete'), 'success');
    } catch (error) {
        console.error(error);
        showToast(t('zip_error'), 'error');
    } finally {
        showLoading(false);
    }
}

