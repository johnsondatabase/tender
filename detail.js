
import { sb, showToast, showLoading, currentUser } from './app.js';
import { translations, getCurrentLanguage, setLanguage } from './lang.js';

let hot; // Handsontable instance
let allData = []; // Full dataset from DB
let displayedData = []; // Filtered dataset
// Pagination variables removed as we actiavte Virtual Scrolling for correct Filtering
let detailRealtimeChannel = null;
let isDetailLoaded = false; // Caching flag
let targetDateColumnIndex = null; // Track which column triggered the date filter

// User Preferences Key
const getStorageKey = () => `crm_user_settings_${currentUser ? currentUser.gmail : 'guest'}_detail_view`;

// Helper Translation
const t = (key) => {
    const lang = getCurrentLanguage();
    return translations[lang][key] || key;
};

// --- Custom Renderers ---

function dateRenderer(instance, td, row, col, prop, value, cellProperties) {
    Handsontable.renderers.TextRenderer.apply(this, arguments);
    if (value) {
        // Try to parse YYYY-MM-DD
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            td.innerHTML = `${day}/${month}/${year}`;
        }
    }
    td.className = 'htCenter'; // Center align dates
}

// Base Column Definitions
const BASE_COLUMNS = [
    { data: 'id', type: 'numeric', defaultHidden: true, readOnly: true }, // 0. Hidden ID
    { data: 'ma_thau', type: 'text', titleKey: 'dt_ma_thau', width: 120 },
    { data: 'nam', type: 'numeric', titleKey: 'dt_nam', width: 60 },
    { data: 'benh_vien', type: 'text', titleKey: 'dt_benh_vien', width: 150 },
    { data: 'khoa', type: 'text', titleKey: 'dt_department', width: 120 },
    { data: 'tinh', type: 'text', titleKey: 'dt_tinh', width: 100 },
    { data: 'khu_vuc', type: 'text', titleKey: 'dt_khu_vuc', width: 80 },
    { data: 'nha_phan_phoi', type: 'text', titleKey: 'dt_npp', width: 150 },
    { data: 'ngay', type: 'text', titleKey: 'dt_ngay', width: 90, renderer: dateRenderer }, // Custom Format
    { data: 'loai', type: 'text', titleKey: 'dt_loai', width: 80 },
    { data: 'ma_vt', type: 'text', titleKey: 'dt_ma_vt', width: 100 },
    { data: 'quota', type: 'numeric', titleKey: 'dt_quota', width: 80 },
    { data: 'tinh_trang', type: 'text', titleKey: 'dt_tinh_trang', width: 100 },
    { data: 'sl_trung', type: 'numeric', titleKey: 'dt_sl_trung', width: 80 },
    { data: 'ngay_ky', type: 'text', titleKey: 'dt_ngay_ky', width: 90, renderer: dateRenderer }, // Custom Format
    { data: 'ngay_ket_thuc', type: 'text', titleKey: 'dt_ngay_kt', width: 90, renderer: dateRenderer }, // Custom Format
    { data: 'nganh', type: 'text', titleKey: 'dt_nganh', width: 100 },
    { data: 'psr', type: 'text', titleKey: 'dt_psr', width: 80 }, 
    { data: 'quan_ly', type: 'text', titleKey: 'dt_quan_ly', width: 120 },
    { data: 'group_product', type: 'text', titleKey: 'dt_group_product', width: 120 }
];

// Current Column State (Order, Visibility)
let columnSettings = [];
let savedSortConfig = undefined; // Store saved sort state

export function onShowDetailView() {
    const container = document.getElementById('view-chi-tiet');
    
    // check export permission
    let exportPermissions = [];
    if (currentUser.phan_quyen === 'Admin') {
        exportPermissions = ['view-chi-tiet']; // Admin can export everywhere
    } else {
         if (Array.isArray(currentUser.xuat)) {
             exportPermissions = currentUser.xuat;
         } else if (typeof currentUser.xuat === 'string') {
             try { exportPermissions = JSON.parse(currentUser.xuat); } catch(e) { exportPermissions = []; }
         }
    }
    const canExport = exportPermissions.includes('view-chi-tiet');

    // If grid container exists, just refresh and return for instant view switch
    if (container.querySelector('#hot-container')) {
        // Trigger resize observer to fix Handsontable layout in tabs
        setTimeout(() => {
            if(hot) hot.refreshDimensions();
        }, 50); // slight delay to ensure layout is visible
        
        // Background refresh
        fetchDetailData(true);
        return;
    }

    // Inject Structure
    // HYBRID LAYOUT: 
    // - Mobile: Stats + Row Count on top (toggleable). Footer HIDDEN.
    // - Desktop: Stats on bottom (Footer). No toggle on top.
    container.innerHTML = `
        <div class="flex flex-col h-full relative">
            <!-- Toolbar -->
            <div class="flex flex-wrap items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700 shadow-sm z-[200]">
                
                <!-- Search -->
                <div class="relative w-full md:w-64">
                    <span class="absolute inset-y-0 left-0 flex items-center pl-2">
                        <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    </span>
                    <input type="text" id="detail-search" class="w-full pl-8 pr-2 py-1.5 text-xs md:text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-1 focus:ring-blue-500 dark:text-white" data-i18n="search_all_cols" placeholder="Tìm kiếm...">
                </div>

                <div class="h-6 w-px bg-gray-300 dark:bg-gray-600 mx-1 hidden md:block"></div>
                
                <!-- Stats Toggle (Eye Icon) - MOBILE ONLY (md:hidden) -->
                <button id="btn-toggle-stats" class="md:hidden flex items-center justify-center p-1.5 bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 transition-colors" title="Hiện/Ẩn số liệu">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                </button>

                <!-- Header Filters Toggle -->
                <button id="btn-toggle-header-filter" class="flex items-center gap-1 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-xs font-medium text-gray-700 dark:text-gray-200 transition-colors" title="Bộ lọc">
                    <!-- Icon injected via JS -->
                </button>

                <!-- Column Settings -->
                <button id="btn-col-settings" class="ml-1 flex items-center gap-1 px-2 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-xs font-medium text-gray-700 dark:text-gray-200 transition-colors" title="Quản lý cột">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 00-2 2"></path></svg>
                    <span class="hidden md:inline" data-i18n="btn_col_manager">Cột</span>
                </button>

                <!-- Export Button -->
                <div class="relative ${canExport ? '' : 'hidden'}">
                    <button id="btn-export-excel" class="ml-1 flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50 rounded text-xs font-medium transition-colors" title="Xuất Excel">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                        <span class="hidden md:inline" data-i18n="btn_export">Excel</span>
                    </button>
                    <!-- Dropdown Menu -->
                    <div id="export-dropdown" class="hidden absolute right-0 mt-1 w-40 bg-white dark:bg-gray-700 rounded-md shadow-lg border border-gray-200 dark:border-gray-600 z-[1000]">
                        <div class="py-1">
                            <button id="btn-export-filtered" class="block w-full text-left px-4 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600" data-i18n="btn_export_filtered">
                                Xuất theo bộ lọc
                            </button>
                            <button id="btn-export-all" class="block w-full text-left px-4 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600" data-i18n="btn_export_all">
                                Xuất tất cả
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Stats Panel (Top) - MOBILE ONLY -->
            <div id="stats-panel-mobile" class="md:hidden bg-blue-50 dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-2 text-xs overflow-x-auto select-none transition-all duration-300 hidden">
                <div class="flex flex-row items-center gap-4 min-w-max">
                    <div class="flex items-center gap-2 whitespace-nowrap">
                        <span class="text-gray-500" data-i18n="txt_rows">Dòng:</span>
                        <span id="mob-row-count" class="text-gray-800 dark:text-gray-100 font-bold">0</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600"></div>
                    <div class="flex items-center gap-1 whitespace-nowrap">
                        <span class="text-gray-500" data-i18n="dt_stat_quota">Quota:</span>
                        <span id="mob-total-quota" class="text-gray-800 dark:text-gray-100 font-bold">0</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600"></div>
                    <div class="flex items-center gap-1 whitespace-nowrap" title="Quota có trạng thái Listing">
                        <span class="text-gray-500" data-i18n="dt_stat_listing">Listing:</span>
                        <span id="mob-listing-val" class="font-bold text-gray-600 dark:text-gray-300">0</span>
                        <span id="mob-listing-pct" class="text-[10px] text-gray-400 font-normal">(0%)</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600"></div>
                    <div class="flex items-center gap-1 whitespace-nowrap" title="Quota có trạng thái Waiting">
                        <span class="text-blue-500" data-i18n="dt_stat_waiting">Waiting:</span>
                        <span id="mob-waiting-val" class="font-bold text-blue-600 dark:text-blue-400">0</span>
                        <span id="mob-waiting-pct" class="text-[10px] text-gray-400 font-normal">(0%)</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600"></div>
                    <div class="flex items-center gap-1 whitespace-nowrap" title="SL Trúng có trạng thái Win">
                        <span class="text-green-500" data-i18n="dt_stat_win">Win (Trúng):</span>
                        <span id="mob-win-val" class="font-bold text-green-600 dark:text-green-400">0</span>
                        <span id="mob-win-pct" class="text-[10px] text-gray-400 font-normal">(0%)</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600"></div>
                    <div class="flex items-center gap-1 whitespace-nowrap" title="Quota có trạng thái Fail">
                        <span class="text-red-500" data-i18n="dt_stat_fail">Fail:</span>
                        <span id="mob-fail-val" class="font-bold text-red-600 dark:text-red-400">0</span>
                        <span id="mob-fail-pct" class="text-[10px] text-gray-400 font-normal">(0%)</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600"></div>
                    <div class="flex items-center gap-1 whitespace-nowrap" title="Quota(Win) - SL Trúng(Win)">
                        <span class="text-orange-500" data-i18n="dt_stat_partial">Thua 1 Phần:</span>
                        <span id="mob-partial-val" class="font-bold text-orange-600 dark:text-orange-400">0</span>
                        <span id="mob-partial-pct" class="text-[10px] text-gray-400 font-normal">(0%)</span>
                    </div>
                </div>
            </div>

            <!-- Grid Container -->
            <div id="hot-container" class="flex-1 w-full overflow-hidden filters-hidden"></div>

            <!-- Bottom Footer Bar (Desktop Only) -->
            <div id="detail-footer" class="hidden md:flex h-auto bg-white dark:bg-gray-800 border-t dark:border-gray-700 md:flex-row items-center justify-between px-4 py-1 text-xs select-none shadow-[0_-2px_10px_rgba(0,0,0,0.05)] z-[200]">
                
                <!-- Desktop Stats -->
                <div class="flex flex-1 items-center gap-4">
                    <div class="flex items-center gap-1 whitespace-nowrap flex-shrink-0">
                        <span class="text-gray-500" data-i18n="dt_stat_quota">Quota:</span>
                        <span id="desk-total-quota" class="text-gray-800 dark:text-gray-100 font-bold">0</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600 flex-shrink-0"></div>
                    <div class="flex items-center gap-1 whitespace-nowrap flex-shrink-0" title="Quota có trạng thái Listing">
                        <span class="text-gray-500" data-i18n="dt_stat_listing">Listing:</span>
                        <span id="desk-listing-val" class="font-bold text-gray-600 dark:text-gray-300">0</span>
                        <span id="desk-listing-pct" class="text-[10px] text-gray-400 font-normal">(0%)</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600 flex-shrink-0"></div>
                    <div class="flex items-center gap-1 whitespace-nowrap flex-shrink-0" title="Quota có trạng thái Waiting">
                        <span class="text-blue-500" data-i18n="dt_stat_waiting">Waiting:</span>
                        <span id="desk-waiting-val" class="font-bold text-blue-600 dark:text-blue-400">0</span>
                        <span id="desk-waiting-pct" class="text-[10px] text-gray-400 font-normal">(0%)</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600 flex-shrink-0"></div>
                    <div class="flex items-center gap-1 whitespace-nowrap flex-shrink-0" title="SL Trúng có trạng thái Win">
                        <span class="text-green-500" data-i18n="dt_stat_win">Win (Trúng):</span>
                        <span id="desk-win-val" class="font-bold text-green-600 dark:text-green-400">0</span>
                        <span id="desk-win-pct" class="text-[10px] text-gray-400 font-normal">(0%)</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600 flex-shrink-0"></div>
                    <div class="flex items-center gap-1 whitespace-nowrap flex-shrink-0" title="Quota có trạng thái Fail">
                        <span class="text-red-500" data-i18n="dt_stat_fail">Fail:</span>
                        <span id="desk-fail-val" class="font-bold text-red-600 dark:text-red-400">0</span>
                        <span id="desk-fail-pct" class="text-[10px] text-gray-400 font-normal">(0%)</span>
                    </div>
                    <div class="w-px h-3 bg-gray-300 dark:bg-gray-600 flex-shrink-0"></div>
                    <div class="flex items-center gap-1 whitespace-nowrap flex-shrink-0" title="Quota(Win) - SL Trúng(Win)">
                        <span class="text-orange-500" data-i18n="dt_stat_partial">Thua 1 Phần:</span>
                        <span id="desk-partial-val" class="font-bold text-orange-600 dark:text-orange-400">0</span>
                        <span id="desk-partial-pct" class="text-[10px] text-gray-400 font-normal">(0%)</span>
                    </div>
                </div>

                <!-- Right Side: Selection Stats + Rows Info -->
                <div class="flex items-center justify-end gap-4 flex-none">
                    <!-- Selection Stats -->
                    <div id="selection-stats" class="hidden xl:flex items-center gap-3 text-gray-500 dark:text-gray-400 pr-2 border-r dark:border-gray-600 border-gray-300 mr-2"></div>
                    
                    <!-- Row Info -->
                    <div class="flex items-center gap-2 ml-auto">
                        <span id="footer-row-count" class="text-gray-500 dark:text-gray-400 text-xs">Loading...</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Date Filter Modal -->
        <div id="date-filter-modal" class="hidden fixed inset-0 z-[12000] flex items-center justify-center modal-backdrop p-4">
            <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden transform transition-all">
                <div class="p-4 border-b dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-700">
                    <h3 class="font-bold text-gray-800 dark:text-white" data-i18n="lbl_date_filter_title">Bộ lọc ngày</h3>
                    <button id="close-date-filter-btn" class="text-gray-500 hover:text-gray-700 dark:text-gray-400">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="p-4 grid grid-cols-2 gap-3">
                    <button class="date-preset-btn px-3 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded text-xs font-medium dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 transition-colors" data-range="today" data-i18n="opt_today">Hôm nay</button>
                    <button class="date-preset-btn px-3 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded text-xs font-medium dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 transition-colors" data-range="week" data-i18n="opt_week">Tuần này</button>
                    <button class="date-preset-btn px-3 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded text-xs font-medium dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 transition-colors" data-range="month" data-i18n="opt_month">Tháng này</button>
                    <button class="date-preset-btn px-3 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded text-xs font-medium dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 transition-colors" data-range="quarter" data-i18n="opt_quarter">Quý này</button>
                    <button class="date-preset-btn px-3 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded text-xs font-medium dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 transition-colors col-span-2" data-range="year" data-i18n="opt_year">Năm nay</button>
                </div>
                <div class="px-4 pb-4">
                    <div class="border-t dark:border-gray-700 my-2"></div>
                    <p class="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2" data-i18n="lbl_custom_range_opt">Tùy chọn khoảng thời gian:</p>
                    <div class="flex gap-2 items-center mb-3">
                        <input type="date" id="filter-date-start" class="w-full px-2 py-1.5 text-xs border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                        <span class="text-gray-400">-</span>
                        <input type="date" id="filter-date-end" class="w-full px-2 py-1.5 text-xs border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                    </div>
                    <div class="flex gap-2">
                        <button id="clear-date-filter-btn" class="flex-1 px-3 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded text-xs font-medium dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600" data-i18n="btn_clear_filter">Xóa lọc</button>
                        <button id="apply-date-filter-btn" class="flex-1 px-3 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded text-xs font-medium shadow-sm" data-i18n="btn_apply">Áp dụng</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Apply initial translations immediately
    setLanguage(getCurrentLanguage());

    loadUserSettings(); 

    // Initialize Handsontable immediately with empty data if needed
    initHandsontable();
    updateTableData();
    setupToolbarListeners();
    setupColumnManager();
    setupExportListeners();
    setupDateFilterModal();
    
    // Resize Observer to handle layout changes
    const resizeObserver = new ResizeObserver(() => {
        if(hot) hot.refreshDimensions();
    });
    resizeObserver.observe(document.getElementById('hot-container'));

    // PERFORMANCE: Background fetch
    // If cache exists, data is already shown by updateTableData above (via allData global).
    // If not, fetch in background.
    if (!isDetailLoaded) {
        // Do not await to prevent blocking UI switch
        fetchDetailData(false); 
    } else {
        // Silent refresh
        fetchDetailData(true);
    }

    if(!detailRealtimeChannel) {
        detailRealtimeChannel = sb.channel('public:detail_view_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'detail' }, () => {
                fetchDetailData(true);
            })
            .subscribe();
    }
}

async function fetchDetailData(silent = false) {
    if(!silent) showLoading(true);
    
    let query = sb.from('detail').select('*').order('ngay', { ascending: false });

    // --- PERMISSION CHECK: View Role Logic ---
    // Chỉ xem được của chính mình (ho_ten) VÀ những người được cấp quyền (viewer column)
    if (currentUser && currentUser.phan_quyen === 'View') {
        const myName = currentUser.ho_ten;
        let allowedPsrs = [myName]; // Luôn xem được của chính mình

        // Lấy danh sách viewer được cấp quyền
        try {
            if (currentUser.viewer) {
                const viewers = typeof currentUser.viewer === 'string' ? JSON.parse(currentUser.viewer) : currentUser.viewer;
                if (Array.isArray(viewers)) {
                    allowedPsrs = [...allowedPsrs, ...viewers];
                }
            }
        } catch (e) {
            console.error("Error parsing viewer permissions", e);
        }

        // Lọc trùng và loại bỏ giá trị rỗng
        allowedPsrs = [...new Set(allowedPsrs)].filter(n => n && n.trim() !== '');

        if (allowedPsrs.length > 0) {
            query = query.in('psr', allowedPsrs);
        } else {
            // Nếu không có tên và không có quyền xem ai -> Không trả về dữ liệu nào
            query = query.eq('id', -1); 
        }
    }
    // -----------------------------------------

    const { data, error } = await query;
    if(!silent) showLoading(false);

    if (error) {
        showToast('Lỗi tải dữ liệu chi tiết: ' + error.message, 'error');
        return;
    }

    allData = data || [];
    isDetailLoaded = true; 

    const keyword = document.getElementById('detail-search')?.value || '';
    if(keyword) filterData(keyword);
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
                isVisible: !c.defaultHidden,
                isPinned: false,
                width: c.width || 100,
                className: '' 
            }));
            const mergedSettings = [...settings.columnSettings, ...newCols];
            const currentKeys = new Set(BASE_COLUMNS.map(c => c.data));
            columnSettings = mergedSettings.filter(c => currentKeys.has(c.data));
            return settings;
        } catch(e) { console.error("Settings load error", e); }
    }
    columnSettings = BASE_COLUMNS.map(c => ({
        data: c.data,
        isVisible: !c.defaultHidden, 
        isPinned: false,
        width: c.width || 100,
        className: ''
    }));
    savedSortConfig = undefined;
    return null;
}

function saveUserSettings() {
    if (!hot) return;
    columnSettings.forEach(setting => {
        const visualIndex = hot.propToCol(setting.data);
        if (visualIndex !== null && visualIndex !== undefined && visualIndex >= 0) {
            const cellMeta = hot.getCellMeta(0, visualIndex); 
            if (cellMeta && cellMeta.className) {
                 const classes = cellMeta.className.split(' ');
                 const alignClasses = classes.filter(c => 
                    ['htLeft', 'htCenter', 'htRight', 'htJustify', 'htTop', 'htMiddle', 'htBottom'].includes(c)
                 );
                 setting.className = alignClasses.join(' ');
            } else {
                 setting.className = '';
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
                    className: setting.className || '' 
                });
            }
        }
    });
    return activeCols;
}

// ... (Date Filtering Functions unchanged) ...
function getDateRangeByType(type) {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    let start, end;

    if (type === 'today') {
        start = todayStr;
        end = todayStr;
    } else if (type === 'week') {
        const day = now.getDay() || 7; 
        const startOfWeek = new Date(now);
        if (day !== 1) startOfWeek.setHours(-24 * (day - 1)); 
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        start = startOfWeek.toISOString().split('T')[0];
        end = endOfWeek.toISOString().split('T')[0];
    } else if (type === 'month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    } else if (type === 'quarter') {
        const quarter = Math.floor(now.getMonth() / 3);
        start = new Date(now.getFullYear(), quarter * 3, 1).toISOString().split('T')[0];
        end = new Date(now.getFullYear(), quarter * 3 + 3, 0).toISOString().split('T')[0];
    } else if (type === 'year') {
        start = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
        end = new Date(now.getFullYear(), 11, 31).toISOString().split('T')[0];
    }
    return { start, end };
}

function setupDateFilterModal() {
    const modal = document.getElementById('date-filter-modal');
    const closeBtn = document.getElementById('close-date-filter-btn');
    const applyBtn = document.getElementById('apply-date-filter-btn');
    const clearBtn = document.getElementById('clear-date-filter-btn');
    const presetBtns = document.querySelectorAll('.date-preset-btn');
    const inputStart = document.getElementById('filter-date-start');
    const inputEnd = document.getElementById('filter-date-end');

    if (closeBtn) closeBtn.onclick = () => modal.classList.add('hidden');

    presetBtns.forEach(btn => {
        btn.onclick = () => {
            const range = getDateRangeByType(btn.dataset.range);
            inputStart.value = range.start;
            inputEnd.value = range.end;
        };
    });

    if (clearBtn) {
        clearBtn.onclick = () => {
            if (targetDateColumnIndex !== null && hot) {
                const filtersPlugin = hot.getPlugin('filters');
                filtersPlugin.removeConditions(targetDateColumnIndex);
                filtersPlugin.filter();
                hot.render();
            }
            modal.classList.add('hidden');
        };
    }

    if (applyBtn) {
        applyBtn.onclick = () => {
            const start = inputStart.value;
            const end = inputEnd.value;
            
            if (targetDateColumnIndex !== null && hot) {
                const filtersPlugin = hot.getPlugin('filters');
                filtersPlugin.removeConditions(targetDateColumnIndex);
                if (start && end) filtersPlugin.addCondition(targetDateColumnIndex, 'between', [start, end]);
                else if (start) filtersPlugin.addCondition(targetDateColumnIndex, 'after', [start]); 
                else if (end) filtersPlugin.addCondition(targetDateColumnIndex, 'before', [end]);
                filtersPlugin.filter();
                hot.render();
            }
            modal.classList.add('hidden');
        };
    }
}

function openDateFilter(colIndex) {
    targetDateColumnIndex = colIndex;
    const modal = document.getElementById('date-filter-modal');
    document.getElementById('filter-date-start').value = '';
    document.getElementById('filter-date-end').value = '';
    modal.classList.remove('hidden');
}

function getDropdownMenuConfig() {
    return {
        items: {
            'filter_by_condition': {},
            'filter_by_value': {},
            'filter_action_bar': {},
            '---------': {},
            'date_filter_custom': {
                name: t('ctx_advanced_date_filter'), 
                callback: function(key, selection, clickEvent) {
                    const visualColIndex = selection[0].start.col;
                    const physicalColIndex = this.toPhysicalColumn(visualColIndex);
                    openDateFilter(physicalColIndex);
                },
                hidden: function() {
                    const selection = this.getSelectedRangeLast();
                    if (!selection) return true;
                    const visualCol = selection.highlight.col;
                    const prop = this.colToProp(visualCol);
                    return !['ngay', 'ngay_ky', 'ngay_ket_thuc'].includes(prop);
                }
            },
            'alignment': {}
        }
    };
}

function initHandsontable() {
    const container = document.getElementById('hot-container');
    const userCols = getProcessedColumns();
    let pinnedCount = columnSettings.filter(c => c.isVisible && c.isPinned).length;
    const isMobile = window.innerWidth < 768;

    hot = new Handsontable(container, {
        data: [], 
        columns: userCols,
        readOnly: true, 
        rowHeaders: false, 
        colHeaders: true,
        height: '100%',
        width: '100%',
        stretchH: 'all',
        fixedColumnsLeft: pinnedCount,
        autoRowSize: true, 
        viewportRowRenderingOffset: 50, // Increased buffer
        viewportColumnRenderingOffset: 20, // Increased horizontal buffer for better sync
        manualColumnResize: true,
        manualRowResize: true,
        contextMenu: true,
        filters: true, 
        columnSorting: {
            indicator: true,
            sortEmptyCells: true,
            initialConfig: savedSortConfig 
        },
        dropdownMenu: getDropdownMenuConfig(),
        licenseKey: 'non-commercial-and-evaluation',
        autoWrapRow: true,
        autoWrapCol: true,
        // Disable selection on mobile to prevent accidental edits/highlighting when scrolling
        disableVisualSelection: isMobile ? ['current', 'area', 'header'] : false,
        
        afterColumnResize: (newSize, column) => {
            const visibleCols = columnSettings.filter(c => c.isVisible);
            if (visibleCols[column]) {
                visibleCols[column].width = newSize;
                saveUserSettings();
            }
        },
        afterFilter: () => {
             updateFilterButtonState();
             calculateHotTotals(); 
        },
        afterSetCellMeta: (row, col, key, val) => {
            if (key === 'className') {
                saveUserSettings();
            }
        },
        afterColumnSort: (currentSortConfig, destinationSortConfigs) => {
            saveUserSettings(); 
        },
        afterSelectionEnd: (row, col, row2, col2) => {
            calculateSelectionStats(row, col, row2, col2);
        },
        afterDeselect: () => {
            const statsContainer = document.getElementById('selection-stats');
            if (statsContainer) statsContainer.innerHTML = '';
        }
    });
}

function updateTableData() {
    if (!hot) return;
    hot.loadData(displayedData);
    updateFooterInfo(displayedData.length);
    calculateHotTotals();
    updateFilterButtonState();
    setTimeout(() => hot.render(), 100);
}

// Function to calculate totals based on visible rows in Handsontable (Subtotal logic)
function calculateHotTotals() {
    if (!hot) return;

    const visibleData = hot.getData(); 
    
    const quotaIdx = hot.propToCol('quota');
    const wonIdx = hot.propToCol('sl_trung');
    const statusIdx = hot.propToCol('tinh_trang');

    let totalQuota = 0;
    let listingQuota = 0;
    let waitingQuota = 0;
    let winQty = 0;
    let winQuotaForCalc = 0; 
    let failQuota = 0;

    visibleData.forEach(row => {
        if (row) {
            const q = (quotaIdx !== null) ? (parseFloat(row[quotaIdx]) || 0) : 0;
            const w = (wonIdx !== null) ? (parseFloat(row[wonIdx]) || 0) : 0;
            const status = (statusIdx !== null) ? (row[statusIdx] || '') : '';

            totalQuota += q;

            if (status === 'Listing') {
                listingQuota += q;
            }
            else if (status === 'Waiting') {
                waitingQuota += q;
            } 
            else if (status === 'Win') {
                winQty += w; 
                winQuotaForCalc += q; 
            } 
            else if (status === 'Fail') {
                failQuota += q; 
            }
        }
    });

    const partialLoss = winQuotaForCalc - winQty;

    const fmt = (n) => n.toLocaleString('vi-VN');
    const pct = (n) => {
        if (totalQuota === 0) return '(0%)';
        const p = (n / totalQuota) * 100;
        return `(${p.toFixed(1)}%)`;
    };

    const setVal = (id, val) => { 
        const el = document.getElementById(id); 
        if(el) el.textContent = fmt(val); 
    };
    const setPct = (id, val) => { 
        const el = document.getElementById(id); 
        if(el) el.textContent = pct(val); 
    };

    // Update Mobile Stats IDs
    setVal('mob-total-quota', totalQuota);
    setVal('mob-listing-val', listingQuota);
    setPct('mob-listing-pct', listingQuota);
    setVal('mob-waiting-val', waitingQuota);
    setPct('mob-waiting-pct', waitingQuota);
    setVal('mob-win-val', winQty);
    setPct('mob-win-pct', winQty);
    setVal('mob-fail-val', failQuota);
    setPct('mob-fail-pct', failQuota);
    setVal('mob-partial-val', partialLoss);
    setPct('mob-partial-pct', partialLoss);

    // Update Desktop Stats IDs
    setVal('desk-total-quota', totalQuota);
    setVal('desk-listing-val', listingQuota);
    setPct('desk-listing-pct', listingQuota);
    setVal('desk-waiting-val', waitingQuota);
    setPct('desk-waiting-pct', waitingQuota);
    setVal('desk-win-val', winQty);
    setPct('desk-win-pct', winQty);
    setVal('desk-fail-val', failQuota);
    setPct('desk-fail-pct', failQuota);
    setVal('desk-partial-val', partialLoss);
    setPct('desk-partial-pct', partialLoss);
}

function updateFooterInfo(total) {
    const rowCountEl = document.getElementById('footer-row-count');
    if (rowCountEl) {
        rowCountEl.textContent = `${total} ${t('txt_rows')}`;
    }
    const mobRowCountEl = document.getElementById('mob-row-count');
    if (mobRowCountEl) {
        mobRowCountEl.textContent = total;
    }
}

function calculateSelectionStats(r1, c1, r2, c2) {
    const statsContainer = document.getElementById('selection-stats');
    if (!statsContainer) return;

    if (r1 === undefined || c1 === undefined) {
        statsContainer.innerHTML = '';
        return;
    }

    const selectedData = hot.getData(r1, c1, r2, c2);
    let count = 0;
    let sum = 0;
    let min = null;
    let max = null;
    let hasNumeric = false;

    const flatData = selectedData.flat();

    flatData.forEach(val => {
        if (val !== null && val !== '' && val !== undefined) {
            count++;
            const num = parseFloat(val);
            if (!isNaN(num)) {
                hasNumeric = true;
                sum += num;
                if (min === null || num < min) min = num;
                if (max === null || num > max) max = num;
            }
        }
    });

    if (count === 0) {
        statsContainer.innerHTML = '';
        return;
    }

    const fmt = (n) => n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
    
    let html = `<div><span class="text-xs">${t('stat_count')}:</span> <span class="text-gray-800 dark:text-gray-200 font-bold text-xs">${count}</span></div>`;
    
    if (hasNumeric) {
        html += `
            <div class="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600"><span class="text-xs">${t('stat_sum')}:</span> <span class="text-gray-800 dark:text-gray-200 font-bold text-xs">${fmt(sum)}</span></div>
            <div class="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 hidden lg:block"><span class="text-xs">${t('stat_min')}:</span> <span class="text-gray-800 dark:text-gray-200 font-bold text-xs">${fmt(min)}</span></div>
            <div class="ml-2 pl-2 border-l border-gray-300 dark:border-gray-600 hidden lg:block"><span class="text-xs">${t('stat_max')}:</span> <span class="text-gray-800 dark:text-gray-200 font-bold text-xs">${fmt(max)}</span></div>
        `;
    }

    statsContainer.innerHTML = html;
}

function filterData(keyword) {
    if (!keyword || keyword.trim() === '') {
        displayedData = [...allData];
    } else {
        const lower = keyword.toLowerCase();
        displayedData = allData.filter(item => {
            return Object.values(item).some(val => 
                String(val).toLowerCase().includes(lower)
            );
        });
    }
    updateTableData();
}

function updateFilterButtonState() {
    if(!hot) return;
    const btn = document.getElementById('btn-toggle-header-filter');
    const container = document.getElementById('hot-container');
    const plugin = hot.getPlugin('filters');
    
    if(!btn || !container) return;

    const hasConditions = plugin.conditionCollection && !plugin.conditionCollection.isEmpty();
    const isVisible = !container.classList.contains('filters-hidden');

    btn.classList.remove('bg-blue-100', 'text-blue-700', 'bg-red-50', 'text-red-600', 'hover:bg-red-100');
    btn.classList.add('bg-gray-100', 'text-gray-700');

    if (hasConditions) {
        btn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            <span class="hidden md:inline" data-i18n="btn_clear_filter">${t('btn_clear_filter')}</span>
        `;
        btn.classList.remove('bg-gray-100', 'text-gray-700');
        btn.classList.add('bg-red-50', 'text-red-600', 'hover:bg-red-100');
        container.classList.remove('filters-hidden');
    } else if (isVisible) {
        btn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path></svg>
            <span class="hidden md:inline" data-i18n="btn_hide_filter">${t('btn_hide_filter')}</span>
        `;
        btn.classList.remove('bg-gray-100', 'text-gray-700');
        btn.classList.add('bg-blue-100', 'text-blue-700');
    } else {
        btn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg>
            <span class="hidden md:inline" data-i18n="btn_show_filter">${t('btn_show_filter')}</span>
        `;
    }
}

function handleFilterButtonClick() {
    if(!hot) return;
    const container = document.getElementById('hot-container');
    const plugin = hot.getPlugin('filters');
    const hasConditions = plugin.conditionCollection && !plugin.conditionCollection.isEmpty();

    if (hasConditions) {
        plugin.clearConditions();
        plugin.filter();
        hot.render();
    } else {
        container.classList.toggle('filters-hidden');
        updateFilterButtonState();
    }
}

function setupToolbarListeners() {
    const searchInput = document.getElementById('detail-search');
    if(searchInput) searchInput.addEventListener('input', (e) => {
        filterData(e.target.value);
    });

    const filterBtn = document.getElementById('btn-toggle-header-filter');
    if(filterBtn) filterBtn.onclick = handleFilterButtonClick;

    const statsToggleBtn = document.getElementById('btn-toggle-stats');
    if(statsToggleBtn) {
        statsToggleBtn.onclick = () => {
            const statsPanel = document.getElementById('stats-panel-mobile'); // Changed to mobile specific ID
            if(statsPanel) {
                statsPanel.classList.toggle('hidden');
                // Re-calculate dimensions for Handsontable if needed, though flex should handle it
                if(hot) setTimeout(() => hot.refreshDimensions(), 100);
            }
        };
    }

    window.addEventListener('languageChanged', (e) => {
        if(!hot) return;
        const userCols = getProcessedColumns();
        hot.updateSettings({ 
            columns: userCols,
            dropdownMenu: getDropdownMenuConfig() 
        });
        updateFilterButtonState();
        const selected = hot.getSelected();
        if(selected && selected.length > 0) {
            const [r1, c1, r2, c2] = selected[0];
            calculateSelectionStats(r1, c1, r2, c2);
        }
    });
}

// ... (Export Functionality and Column Manager Logic unchanged) ...
function setupExportListeners() {
    const btn = document.getElementById('btn-export-excel');
    const dropdown = document.getElementById('export-dropdown');
    const btnFiltered = document.getElementById('btn-export-filtered');
    const btnAll = document.getElementById('btn-export-all');

    if(!btn || !dropdown) return;

    btn.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('hidden');
    };

    document.addEventListener('click', (e) => {
        if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && !btn.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });

    btnFiltered.onclick = () => {
        exportToExcel('filtered');
        dropdown.classList.add('hidden');
    };

    btnAll.onclick = () => {
        exportToExcel('all');
        dropdown.classList.add('hidden');
    };
}

function exportToExcel(type) {
    if (!hot) return;
    showLoading(true);
    setTimeout(() => {
        try {
            const visibleColSettings = columnSettings.filter(c => c.isVisible);
            const headers = visibleColSettings.map(setting => {
                const def = BASE_COLUMNS.find(c => c.data === setting.data);
                return def ? (def.titleKey ? t(def.titleKey) : def.data) : setting.data;
            });
            let dataToExport = [];
            if (type === 'filtered') {
                const hotData = hot.getData();
                dataToExport = hotData;
            } else {
                dataToExport = allData.map(row => {
                    return visibleColSettings.map(setting => {
                        return row[setting.data];
                    });
                });
            }
            const wsData = [headers, ...dataToExport];
            const ws = XLSX.utils.aoa_to_sheet(wsData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "ChiTiet");
            const now = new Date();
            const timeStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
            const fileName = `Export_ChiTiet_${type}_${timeStr}.xlsx`;
            XLSX.writeFile(wb, fileName);
            showToast("Xuất Excel thành công!", "success");
        } catch (e) {
            console.error(e);
            showToast("Lỗi khi xuất Excel: " + e.message, "error");
        } finally {
            showLoading(false);
        }
    }, 100);
}

function setupColumnManager() {
    const btn = document.getElementById('btn-col-settings');
    const modal = document.getElementById('column-settings-modal');
    const closeBtn = document.getElementById('close-col-settings-btn');
    const saveBtn = document.getElementById('btn-save-cols');
    const listContainer = document.getElementById('column-list-container');
    let sortable;

    if(!btn) return;

    btn.onclick = () => {
        renderColumnList();
        modal.classList.remove('hidden');
    };

    const closeModal = () => modal.classList.add('hidden');
    if(closeBtn) closeBtn.onclick = closeModal;

    const renderColumnList = () => {
        listContainer.innerHTML = '';
        columnSettings.forEach((col, index) => {
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
                <button class="btn-pin p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${col.isPinned ? 'pin-active' : 'text-gray-400'} z-10 relative">
                     <svg class="w-4 h-4 transform rotate-45" fill="currentColor" viewBox="0 0 20 20"><path d="M6 6V2c0-1.1.9-2 2-2h1a2 2 0 012 2v4l5 5v3h-6v4h-2v-4H2v-3l4-4z"/></svg>
                </button>
            `;
            el.onclick = (e) => {
                if (e.target.closest('.btn-pin') || e.target.closest('.cursor-grab')) return;
                const checkbox = el.querySelector('.col-vis-check');
                checkbox.checked = !checkbox.checked;
                col.isVisible = checkbox.checked;
            };
            el.querySelector('.btn-pin').onclick = (e) => {
                e.stopPropagation();
                col.isPinned = !col.isPinned;
                if(col.isPinned) {
                    e.currentTarget.classList.add('pin-active', 'text-blue-500');
                    e.currentTarget.classList.remove('text-gray-400');
                } else {
                    e.currentTarget.classList.remove('pin-active', 'text-blue-500');
                    e.currentTarget.classList.add('text-gray-400');
                }
                reorderColumnsInMemory();
                renderColumnList();
            };
            listContainer.appendChild(el);
        });

        if (sortable) sortable.destroy();
        sortable = new Sortable(listContainer, {
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
    };

    const reorderColumnsInMemory = () => {
        columnSettings.sort((a, b) => {
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;
            return 0;
        });
    };

    if(saveBtn) saveBtn.onclick = () => {
        saveUserSettings();
        const userCols = getProcessedColumns();
        let pinnedCount = columnSettings.filter(c => c.isVisible && c.isPinned).length;
        hot.updateSettings({
            columns: userCols,
            fixedColumnsLeft: pinnedCount
        });
        closeModal();
    };
}
