
import { sb, showToast, showLoading, showConfirm, sanitizeFileName, currentUser } from './app.js';
import { translations, getCurrentLanguage, setLanguage } from './lang.js';
import { logHistory, viewListingHistory } from './lichsu.js';
import * as ListingFilter from './listing-filter.js';
import * as ListingWin from './listing-win.js';

// Expose functions for HTML access
window.viewListingHistory = viewListingHistory;
// Expose fetchListings so other modules (like listing-win) can call it if needed directly or via callback
window.fetchListings = fetchListings; 

let listingsCache = [];
let sortables = [];
let currentFiles = []; 
let currentMaterials = [];
let originalMaThau = null;
let isReadOnlyMode = false;
let currentMobileStatus = 'Waiting';
let realtimeChannel = null; // Store subscription
let isListingLoaded = false; // Caching flag
let initialFormState = null; // Track form changes

const t = (key) => {
    const lang = getCurrentLanguage();
    return translations[lang][key] || key;
};

// Column Definitions
const COLUMNS = {
    'Waiting': { 
        labelKey: 'col_waiting', 
        borderColor: 'border-yellow-400', 
        bgColor: 'bg-yellow-50', 
        darkBgColor: 'dark:bg-yellow-900/20',
        badgeColor: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300'
    },
    'Win': { 
        labelKey: 'col_win', 
        borderColor: 'border-green-500', 
        bgColor: 'bg-green-50', 
        darkBgColor: 'dark:bg-green-900/20',
        badgeColor: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
    },
    'Fail': { 
        labelKey: 'col_fail', 
        borderColor: 'border-red-500', 
        bgColor: 'bg-red-50', 
        darkBgColor: 'dark:bg-red-900/20',
        badgeColor: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
    }
};

// Helper to check specific action permissions for this view
function checkPermission(action) {
    if (!currentUser) return false;
    if (currentUser.phan_quyen === 'Admin') return true;
    
    try {
        // action is 'them', 'sua', 'xoa'
        const perms = Array.isArray(currentUser[action]) ? currentUser[action] : JSON.parse(currentUser[action] || '[]');
        return perms.includes('view-ton-kho');
    } catch(e) {
        return false;
    }
}

// Helper to notify admins with Fallback logic
async function notifyAdmins(title, content, actionData = null, type = 'info') {
    try {
        // Fetch all admins
        const { data: admins, error: adminError } = await sb.from('user').select('gmail').eq('phan_quyen', 'Admin');
        if (adminError || !admins || admins.length === 0) return;

        // Prepare notification objects
        const notifications = admins.map(admin => ({
            gui_den_gmail: admin.gmail,
            tieu_de: title,
            noi_dung: content,
            loai: type,
            metadata: actionData // Try sending metadata first
        }));

        // Attempt 1: Insert with metadata
        const { error } = await sb.from('thong_bao').insert(notifications);
        
        if (error) {
            console.warn("Insert notification with metadata failed (likely missing column). Retrying without metadata...", error.message);
            
            // Attempt 2: Fallback - Insert without metadata
            // Note: We preserve the 'loai' (type) so app.js can still route based on type
            const simpleNotifications = notifications.map(n => ({
                gui_den_gmail: n.gui_den_gmail,
                tieu_de: n.tieu_de,
                noi_dung: n.noi_dung,
                loai: n.loai 
            }));
            
            const { error: retryError } = await sb.from('thong_bao').insert(simpleNotifications);
            if (retryError) {
                console.error("Failed to send notification even without metadata:", retryError);
            }
        }
    } catch (e) {
        console.error("Error notifying admins:", e);
    }
}

// Helper: Get Current Form State for Dirty Check
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
        files: currentFiles.map(f => ({ name: f.name, size: f.size, type: f.type })), // Simplify to avoid URL mismatch
        materials: currentMaterials
    });
}

export async function onShowListingView() {
    const container = document.getElementById('view-ton-kho');
    
    // Check if board exists. If not, inject HTML.
    if (!container.querySelector('#kanban-board')) {
        // Inject HTML
        container.innerHTML = getListingViewHTML(); 
        
        // Init Filter System
        setupFilterListeners();
        
        // Init Win System
        ListingWin.initWinSystem(fetchListings);

        // Add Button (Desktop)
        const btnAdd = document.getElementById('btn-add-listing');
        if(btnAdd) btnAdd.addEventListener('click', () => openListingModal());
        
        // Mobile Action Menu Logic
        const btnMobileAdd = document.getElementById('btn-mobile-add-menu');
        const mobileAddDropdown = document.getElementById('mobile-add-dropdown');
        if (btnMobileAdd && mobileAddDropdown) {
            btnMobileAdd.addEventListener('click', (e) => {
                e.stopPropagation();
                mobileAddDropdown.classList.toggle('hidden');
            });
            document.addEventListener('click', (e) => {
                if (!mobileAddDropdown.contains(e.target) && !btnMobileAdd.contains(e.target)) {
                    mobileAddDropdown.classList.add('hidden');
                }
            });
        }

        // Menu Actions
        const btnManual = document.getElementById('btn-mobile-manual');
        const btnExcel = document.getElementById('btn-mobile-excel');
        const btnTempl = document.getElementById('btn-mobile-template');
        const inputImport = document.getElementById('import-excel-input');

        if (btnManual) btnManual.addEventListener('click', () => { mobileAddDropdown.classList.add('hidden'); openListingModal(); });
        if (btnExcel) btnExcel.addEventListener('click', () => { mobileAddDropdown.classList.add('hidden'); inputImport.click(); });
        if (btnTempl) btnTempl.addEventListener('click', () => { mobileAddDropdown.classList.add('hidden'); downloadImportTemplate(); });

        // Desktop Import Logic
        const btnImport = document.getElementById('btn-import-excel');
        const btnTemplate = document.getElementById('btn-download-template');

        if (btnImport && inputImport) {
            btnImport.addEventListener('click', () => inputImport.click());
        }
        if (inputImport) {
            inputImport.addEventListener('change', handleExcelImport);
        }
        if (btnTemplate) {
            btnTemplate.addEventListener('click', downloadImportTemplate);
        }

        // Mobile Tab Click
        document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => switchMobileTab(e.currentTarget.dataset.status));
        });
        
        // Add Material Button
        const btnAddMaterial = document.getElementById('btn-add-material');
        if (btnAddMaterial) btnAddMaterial.addEventListener('click', addMaterialRow);

        // File Upload & Paste
        const fileInput = document.getElementById('file-upload-input');
        if(fileInput) fileInput.addEventListener('change', (e) => handleFileUpload(e.target.files));
        const modal = document.getElementById('listing-modal');
        if(modal) modal.addEventListener('paste', handlePaste);
        
        // Init Draggable Modal
        initDraggableModal();
        
        // Auto-generate Ma Thau
        const dateInput = document.getElementById('l-ngay');
        const hospitalInput = document.getElementById('l-benh-vien');
        if (dateInput) dateInput.addEventListener('change', generateMaThau);
        if (hospitalInput) hospitalInput.addEventListener('input', generateMaThau);

        // Click outside to close dropdowns
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.multi-select-container')) {
                document.querySelectorAll('.multi-select-dropdown').forEach(d => d.classList.remove('open'));
            }
        });

        // ESC key to close modals
        document.addEventListener('keydown', async (e) => {
            if (e.key === 'Escape') {
                const listingModal = document.getElementById('listing-modal');
                const historyModal = document.getElementById('history-modal');
                const winModal = document.getElementById('win-transition-modal');
                
                if (winModal && !winModal.classList.contains('hidden')) {
                    winModal.classList.add('hidden');
                } else if (historyModal && !historyModal.classList.contains('hidden')) {
                    historyModal.classList.add('hidden');
                } else if (listingModal && !listingModal.classList.contains('hidden')) {
                    await window.closeListingModal();
                }
            }
        });

    } else {
        // If view already exists, just refresh translations
        Object.keys(COLUMNS).forEach(status => {
            const colHeader = document.querySelector(`#col-wrapper-${status} span[data-i18n]`);
            if(colHeader) colHeader.textContent = t(COLUMNS[status].labelKey);
        });
        const searchInput = document.getElementById('listing-search');
        if(searchInput) searchInput.placeholder = t('search_placeholder');
        
        // Re-apply filters to ensure board is correct
        applyFilters();
    }

    // Subscribe to Realtime changes
    if (!realtimeChannel) {
        realtimeChannel = sb.channel('public:listing_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'listing' }, () => {
                fetchListings(true); 
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'detail' }, () => {
                fetchListings(true);
            })
            .subscribe();
    }

    // PERFORMANCE: If loaded, show cache immediately, then silent fetch. If not, full load.
    if (isListingLoaded) {
        applyFilters(); // Show existing data instantly
        fetchListings(true); // Update in background
    } else {
        await fetchListings(false);
    }
}

function getListingViewHTML() {
    // Permission check for Import buttons
    let canImport = false;
    if (currentUser && currentUser.phan_quyen === 'Admin') {
        canImport = true;
    } else if (currentUser) {
        let importPerms = [];
        try { 
            importPerms = Array.isArray(currentUser.nhap) ? currentUser.nhap : JSON.parse(currentUser.nhap || '[]'); 
        } catch(e) {}
        if(importPerms.includes('view-ton-kho')) canImport = true;
    }

    // Permission check for Add button
    const canAdd = checkPermission('them');

    // Desktop Import Buttons
    const desktopImportButtons = canImport ? `
        <div class="hidden md:flex gap-1 ml-2">
            <button id="btn-download-template" class="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg flex items-center justify-center gap-1 transition-colors text-xs font-medium" title="Tải mẫu Excel">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                Mẫu
            </button>
            <button id="btn-import-excel" class="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg shadow flex items-center justify-center gap-1 transition-colors text-xs font-medium">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                Import
            </button>
        </div>
    ` : '';

    // Mobile Dropdown Menu Items
    const mobileImportItems = canImport ? `
        <button id="btn-mobile-excel" class="block w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 border-b border-gray-100 flex items-center gap-2">
            <svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg> Import Excel
        </button>
        <button id="btn-mobile-template" class="block w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2">
            <svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg> Tải Mẫu
        </button>
    ` : '';

    const desktopAddButton = canAdd ? `
        <button id="btn-add-listing" class="hidden md:flex flex-shrink-0 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow items-center justify-center gap-1 transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
            <span class="text-sm" data-i18n="btn_add_new">Thêm Mới</span>
        </button>
    ` : '';

    const mobileAddButton = canAdd ? `
        <div class="md:hidden relative">
            <button id="btn-mobile-add-menu" class="flex-shrink-0 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow flex items-center justify-center gap-1 transition-colors h-full">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                <span class="text-sm">Thêm</span>
            </button>
            <!-- Dropdown -->
            <div id="mobile-add-dropdown" class="hidden absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden">
                <button id="btn-mobile-manual" class="block w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 border-b border-gray-100 flex items-center gap-2">
                    <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg> Thủ Công
                </button>
                ${mobileImportItems}
            </div>
        </div>
    ` : '';

    return `
        <div class="flex flex-col h-full relative">
            <!-- Hidden File Input for both Mobile/Desktop -->
            <input type="file" id="import-excel-input" accept=".xlsx, .xls" class="hidden" />

            <!-- Sticky Header -->
            <div class="sticky top-0 z-20 bg-gray-50 dark:bg-gray-900 pb-2 pt-1 mb-2 flex flex-col gap-2 transition-colors duration-300 shadow-sm md:shadow-none border-b dark:border-gray-700">
                <div class="flex flex-row justify-between items-center gap-2">
                    <div class="relative flex-1">
                        <span class="absolute inset-y-0 left-0 flex items-center pl-3"><svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg></span>
                        <input type="text" id="listing-search" class="w-full pl-9 pr-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white transition-colors" data-i18n="search_placeholder" placeholder="Tìm kiếm...">
                    </div>
                    
                    <!-- Filter Button -->
                    <button id="btn-toggle-filter" class="flex-shrink-0 w-10 md:w-auto px-0 md:px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center gap-1 transition-colors relative md:min-w-[100px]"></button>
                    
                    <!-- Desktop: Import Buttons -->
                    ${desktopImportButtons}

                    <!-- Desktop: Add Button -->
                    ${desktopAddButton}

                    <!-- Mobile: Add Menu Button (Dropdown) -->
                    ${mobileAddButton}
                </div>

                <!-- Filter Panel -->
                <div id="filter-backdrop" class="fixed inset-0 bg-black/50 z-30 hidden md:hidden transition-opacity"></div>
                <div id="filter-panel" class="fixed inset-y-0 right-0 z-40 w-80 bg-white dark:bg-gray-800 shadow-2xl transform translate-x-full transition-transform duration-300 md:static md:w-full md:shadow-none md:transform-none md:translate-x-0 md:bg-gray-50 md:dark:bg-gray-900 md:border md:dark:border-gray-700 md:rounded-lg hidden flex flex-col md:block">
                    <div class="flex items-center justify-between p-4 border-b dark:border-gray-700 md:hidden bg-primary text-white">
                        <h3 class="font-bold text-lg" data-i18n="lbl_filter_title">Bộ Lọc Tìm Kiếm</h3>
                        <button id="btn-close-filter-mobile" class="p-1 hover:bg-white/20 rounded"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                    </div>
                    <div class="p-4 grid grid-cols-1 md:grid-cols-5 gap-3 md:gap-4 overflow-y-auto md:overflow-visible flex-1">
                        <div class="filter-group relative"><label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1" data-i18n="lbl_date_created">Ngày tạo</label><div id="filter-wrapper-date" class="multi-select-container"></div></div>
                        <div class="filter-group relative"><label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1" data-i18n="lbl_hospital">Bệnh Viện</label><div id="filter-wrapper-hospital" class="multi-select-container"></div></div>
                        <div class="filter-group relative"><label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1" data-i18n="lbl_distributor">Nhà Phân Phối</label><div id="filter-wrapper-npp" class="multi-select-container"></div></div>
                        <div class="filter-group relative"><label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1" data-i18n="lbl_area">Khu Vực</label><div id="filter-wrapper-area" class="multi-select-container"></div></div>
                        <div class="filter-group relative"><label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1" data-i18n="lbl_sector">Ngành</label><div id="filter-wrapper-sector" class="multi-select-container"></div></div>
                    </div>
                    <div class="p-4 border-t dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900 md:hidden">
                        <button id="btn-reset-filter-mobile" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium flex items-center gap-2" data-i18n="btn_clear_filter"><svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>Xóa lọc</button>
                        <button id="btn-apply-filter-mobile" class="px-6 py-2 bg-primary text-white rounded-lg shadow font-medium" data-i18n="btn_confirm">Áp dụng</button>
                    </div>
                </div>
            </div>

            <!-- Mobile Status Tabs -->
            <div class="md:hidden flex space-x-1 mb-3 bg-white dark:bg-gray-800 p-1 rounded-lg border dark:border-gray-700 overflow-x-auto no-scrollbar flex-shrink-0">
                 ${Object.keys(COLUMNS).map(status => `
                    <button class="mobile-tab-btn flex-1 py-1.5 px-2 text-xs font-medium rounded text-center whitespace-nowrap transition-colors border border-transparent ${status === currentMobileStatus ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200 dark:border-blue-800' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'}" data-status="${status}">
                        ${t(COLUMNS[status].labelKey)} <span id="mobile-count-${status}" class="ml-1 text-[10px] bg-gray-200 dark:bg-gray-600 rounded-full px-1.5">0 (0%)</span>
                    </button>
                 `).join('')}
            </div>

            <!-- Kanban Board -->
            <div id="kanban-board" class="flex-1 overflow-x-auto overflow-y-hidden pb-2">
                <div class="flex h-full gap-4 md:min-w-[900px]">
                    ${Object.keys(COLUMNS).map(status => {
                        const colDef = COLUMNS[status];
                        const hiddenClass = (status !== currentMobileStatus) ? 'hidden md:flex' : 'flex';
                        return `
                        <div id="col-wrapper-${status}" class="kanban-col-wrapper flex-1 flex-col w-full md:min-w-[300px] h-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100/50 dark:bg-gray-800/50 transition-colors ${hiddenClass}">
                            <div class="p-3 font-bold text-gray-700 dark:text-gray-200 border-b border-gray-300 dark:border-gray-600 flex justify-between items-center sticky top-0 rounded-t-xl z-10 backdrop-blur-sm bg-opacity-90 ${colDef.bgColor} ${colDef.darkBgColor}">
                                <span data-i18n="${colDef.labelKey}">${t(colDef.labelKey)}</span>
                                <div class="flex items-center">
                                    <span class="text-xs bg-white dark:bg-gray-600 text-gray-600 dark:text-gray-200 px-2 py-0.5 rounded-full shadow-sm font-mono" id="count-${status}">0</span>
                                    <span id="percent-${status}" class="text-[10px] text-gray-500 dark:text-gray-400 ml-1">(0%)</span>
                                </div>
                            </div>
                            <div id="col-${status}" data-status="${status}" class="kanban-col flex-1 overflow-y-auto p-2 space-y-3 custom-scrollbar"></div>
                        </div>
                    `}).join('')}
                </div>
            </div>
        </div>
    `;
}

// --- Controller Functions ---

async function fetchListings(silent = false) {
    if(!silent) showLoading(true);
    const { data, error } = await sb.from('listing').select('*').order('ma_thau', { ascending: true });
    
    if (error) {
        if(!silent) showLoading(false);
        showToast('Lỗi tải dữ liệu: ' + error.message, 'error');
        return;
    }
    
    // Fetch details for aggregation
    const maThauList = data.map(l => l.ma_thau);
    let detailStats = {};
    
    if (maThauList.length > 0) {
        const { data: details, error: detailError } = await sb.from('detail')
            .select('ma_thau, quota, sl_trung')
            .in('ma_thau', maThauList);
            
        if (!detailError && details) {
            details.forEach(d => {
                if (!detailStats[d.ma_thau]) {
                    detailStats[d.ma_thau] = { count: 0, quota: 0, won: 0 };
                }
                detailStats[d.ma_thau].count += 1;
                detailStats[d.ma_thau].quota += (d.quota || 0);
                detailStats[d.ma_thau].won += (d.sl_trung || 0);
            });
        }
    }

    listingsCache = data.map(l => ({
        ...l,
        stats: detailStats[l.ma_thau] || { count: 0, quota: 0, won: 0 }
    })) || [];
    
    isListingLoaded = true; // Mark as loaded
    
    if(!silent) showLoading(false);

    // Update Filter dropdowns with new data
    // Wrap applyFilters to ensuring toggle button update happens after recursive cascading updates
    const onFilterChange = () => {
        applyFilters();
        if(window.updateFilterButton) window.updateFilterButton();
    };
    ListingFilter.updateFilterOptionsUI(listingsCache, onFilterChange);
    
    // Render
    applyFilters();
}

function applyFilters() {
    const filtered = ListingFilter.getFilteredData(listingsCache);
    renderBoard(filtered);
}

function setupFilterListeners() {
    // Search Input
    document.getElementById('listing-search').addEventListener('input', (e) => {
        ListingFilter.setFilterKeyword(e.target.value);
        applyFilters();
        if(window.updateFilterButton) window.updateFilterButton();
    });

    // Buttons
    const btnToggle = document.getElementById('btn-toggle-filter');
    const filterPanel = document.getElementById('filter-panel');
    const filterBackdrop = document.getElementById('filter-backdrop');
    const btnCloseMobile = document.getElementById('btn-close-filter-mobile');
    const btnApplyMobile = document.getElementById('btn-apply-filter-mobile');
    const btnResetMobile = document.getElementById('btn-reset-filter-mobile');

    const updateToggleButtonState = () => {
        const searchTerm = document.getElementById('listing-search').value.trim();
        const hasActive = ListingFilter.hasActiveFilters() || searchTerm !== '';
        
        const isDesktop = window.innerWidth >= 768;
        let isOpen = isDesktop ? filterPanel.classList.contains('md:block') : (!filterPanel.classList.contains('translate-x-full') && !filterPanel.classList.contains('hidden'));

        btnToggle.classList.remove('btn-filter-active');

        if (hasActive) {
            btnToggle.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg><span class="hidden md:inline text-sm font-medium line-through decoration-current" data-i18n="btn_clear_filter">${t('btn_clear_filter')}</span>`;
            btnToggle.classList.add('btn-filter-active');
            btnToggle.onclick = (e) => { 
                e.preventDefault(); 
                e.stopPropagation(); 
                ListingFilter.resetFilters(); 
                document.getElementById('listing-search').value = ''; 
                
                const onFilterChange = () => {
                    applyFilters();
                    // Re-check state to flip button back to standard
                    updateToggleButtonState();
                };
                
                applyFilters(); 
                ListingFilter.updateFilterOptionsUI(listingsCache, onFilterChange);
                updateToggleButtonState(); // Immediate UI update
            };
        } else if (isOpen) {
            btnToggle.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path></svg><span class="hidden md:inline text-sm" data-i18n="btn_hide_filter">${t('btn_hide_filter')}</span>`;
            btnToggle.onclick = (e) => { e.preventDefault(); toggleFilterPanel(); };
        } else {
            btnToggle.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg><span class="hidden md:inline text-sm" data-i18n="btn_show_filter">${t('btn_show_filter')}</span>`;
            btnToggle.onclick = (e) => { e.preventDefault(); toggleFilterPanel(); };
        }
    };

    const toggleFilterPanel = () => {
        const isMobile = window.innerWidth < 768;
        if (isMobile) {
            const isHidden = filterPanel.classList.contains('translate-x-full');
            if (isHidden) {
                filterPanel.classList.remove('translate-x-full', 'hidden');
                filterBackdrop.classList.remove('hidden');
            } else {
                filterPanel.classList.add('translate-x-full');
                setTimeout(() => filterPanel.classList.add('hidden'), 300);
                filterBackdrop.classList.add('hidden');
            }
        } else {
            if (filterPanel.classList.contains('md:block')) {
                filterPanel.classList.remove('md:block');
                filterPanel.classList.add('hidden');
            } else {
                filterPanel.classList.add('md:block');
                filterPanel.classList.remove('hidden');
            }
        }
        setTimeout(updateToggleButtonState, 100);
    };

    btnCloseMobile.addEventListener('click', toggleFilterPanel);
    filterBackdrop.addEventListener('click', toggleFilterPanel);
    btnApplyMobile.addEventListener('click', toggleFilterPanel);
    btnResetMobile.addEventListener('click', () => {
        ListingFilter.resetFilters();
        document.getElementById('listing-search').value = '';
        applyFilters();
        const onFilterChange = () => { applyFilters(); updateToggleButtonState(); };
        ListingFilter.updateFilterOptionsUI(listingsCache, onFilterChange);
        updateToggleButtonState(); 
    });

    // Expose hook for other modules to trigger button update
    window.updateFilterButton = updateToggleButtonState;
    updateToggleButtonState();
}

function renderBoard(data) {
    const totalItems = data.length;

    Object.keys(COLUMNS).forEach(status => {
        const col = document.getElementById(`col-${status}`);
        if(col) col.innerHTML = '';
        const count = document.getElementById(`count-${status}`);
        if(count) count.textContent = '0';
        const percent = document.getElementById(`percent-${status}`);
        if(percent) percent.textContent = '(0%)';
        const mobileCount = document.getElementById(`mobile-count-${status}`);
        if(mobileCount) mobileCount.textContent = '0 (0%)';
    });

    data.forEach(item => {
        let status = item.tinh_trang;
        if (!COLUMNS[status]) status = 'Waiting';
        const col = document.getElementById(`col-${status}`);
        if (col) {
            const card = createCard(item);
            col.appendChild(card);
        }
    });

    Object.keys(COLUMNS).forEach(status => {
        const col = document.getElementById(`col-${status}`);
        const countEl = document.getElementById(`count-${status}`);
        const percentEl = document.getElementById(`percent-${status}`);
        const mobileCountEl = document.getElementById(`mobile-count-${status}`);
        
        const count = col ? col.children.length : 0;
        const percentage = totalItems > 0 ? Math.round((count / totalItems) * 100) : 0;
        
        if (countEl) countEl.textContent = count;
        if (percentEl) percentEl.textContent = `(${percentage}%)`;
        if (mobileCountEl) mobileCountEl.textContent = `${count} (${percentage}%)`;
    });

    initSortable();
}

function createCard(item) {
    const el = document.createElement('div');
    const colDef = COLUMNS[item.tinh_trang] || COLUMNS['Waiting'];
    const statusColor = colDef.borderColor;
    const itemId = item.id !== undefined ? item.id : item.ma_thau;
    const progress = calculateProgress(item.ngay_ky, item.ngay_ket_thuc);
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('vi-VN') : '-';
    
    let fileCount = 0;
    try {
        const files = typeof item.files === 'string' ? JSON.parse(item.files) : (item.files || []);
        fileCount = Array.isArray(files) ? files.length : 0;
    } catch(e) { fileCount = 0; }

    // Mini Stats
    const wonPercent = item.stats.quota > 0 ? Math.round((item.stats.won / item.stats.quota) * 100) : 0;

    let progressHtml = '';
    if (progress) {
        progressHtml = `
            <div class="mt-2 pt-2 border-t border-gray-100 dark:border-gray-600">
                <div class="flex justify-between text-[10px] text-gray-400 mb-0.5 font-mono">
                     <span>${t('lbl_contract_duration')}</span>
                     <span>${progress.text}</span>
                </div>
                <div class="w-full h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden mb-1">
                    <div class="h-full ${progress.colorClass} transition-all duration-500" style="width: ${progress.percent}%"></div>
                </div>
                <div class="flex justify-between text-[10px] text-gray-500 dark:text-gray-400 font-mono">
                    <span>${fmtDate(item.ngay_ky)}</span>
                    <span>${fmtDate(item.ngay_ket_thuc)}</span>
                </div>
            </div>
        `;
    }

    el.className = `bg-white dark:bg-gray-700 p-3 rounded-lg shadow-sm border-l-4 ${statusColor} cursor-grab hover:shadow-md hover:-translate-y-0.5 transition-all relative group select-none flex flex-col gap-1.5`;
    el.setAttribute('data-id', itemId);
    el.setAttribute('data-ma-thau', item.ma_thau);

    // Check Permissions
    const canEdit = checkPermission('sua');
    const canDelete = checkPermission('xoa');

    el.innerHTML = `
        <div class="flex justify-between items-start mb-2">
             <div class="overflow-hidden mr-2">
                <h4 class="font-bold text-gray-800 dark:text-gray-100 text-sm leading-tight" title="${item.benh_vien || ''}">${item.benh_vien || 'Không tên'}</h4>
             </div>
             <div class="text-right flex-shrink-0">
                <div class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-600 font-mono font-bold text-gray-700 dark:text-gray-200 border dark:border-gray-500">${item.ma_thau || 'N/A'}</div>
             </div>
        </div>

        <div class="text-xs space-y-1.5">
            <div class="grid grid-cols-2 gap-2 border-t border-dashed border-gray-100 dark:border-gray-600 pt-1">
                <div class="flex items-center gap-1 overflow-hidden"><span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_year')}:</span><span class="font-medium text-gray-700 dark:text-gray-300 truncate">${item.nam || '-'}</span></div>
                <div class="flex items-center justify-start gap-1 pl-3 border-l border-gray-100 dark:border-gray-600 overflow-hidden"><span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_date_created')}:</span><span class="font-bold text-gray-700 dark:text-gray-200 truncate">${fmtDate(item.ngay)}</span></div>
            </div>
            <div class="grid grid-cols-2 gap-2">
                <div class="flex items-center gap-1 overflow-hidden"><span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_province')}:</span><span class="font-medium text-gray-700 dark:text-gray-300 truncate" title="${item.tinh}">${item.tinh || '-'}</span></div>
                <div class="flex items-center justify-start gap-1 pl-3 border-l border-gray-100 dark:border-gray-600 overflow-hidden"><span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_area')}:</span><span class="font-bold text-gray-700 dark:text-gray-200 truncate" title="${item.khu_vuc}">${item.khu_vuc || '-'}</span></div>
            </div>
            <div class="grid grid-cols-2 gap-2">
                <div class="flex items-center gap-1 overflow-hidden"><span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_type')}:</span><span class="font-medium text-gray-700 dark:text-gray-300 truncate">${item.loai || '-'}</span></div>
                <div class="flex items-center justify-start gap-1 pl-3 border-l border-gray-100 dark:border-gray-600 overflow-hidden"><span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_sector')}:</span><span class="font-bold text-gray-700 dark:text-gray-200 truncate">${item.nganh || '-'}</span></div>
            </div>
            <div class="grid grid-cols-2 gap-2">
                <div class="flex items-center gap-1 overflow-hidden"><span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_psr')}:</span><span class="font-medium text-gray-700 dark:text-gray-300 truncate">${item.psr || '-'}</span></div>
                <div class="flex items-center justify-start gap-1 pl-3 border-l border-gray-100 dark:border-gray-600 overflow-hidden"><span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_manager')}:</span><span class="font-bold text-gray-700 dark:text-gray-200 truncate">${item.quan_ly || '-'}</span></div>
            </div>
             <div class="pt-1 border-t dark:border-gray-600 mt-1 flex justify-between items-center">
                <div class="flex items-center gap-1 overflow-hidden flex-1 mr-2">
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_distributor')}:</span>
                    <span class="font-medium text-gray-700 dark:text-gray-300 truncate" title="${item.nha_phan_phoi}">${item.nha_phan_phoi || '-'}</span>
                </div>
                <div class="flex items-center gap-2">
                    <div class="flex flex-col bg-gray-50 dark:bg-gray-800 border dark:border-gray-600 rounded overflow-hidden">
                         <div class="px-1.5 py-0.5 flex items-center gap-1 text-[9px] text-gray-500 dark:text-gray-400 font-mono leading-none">
                             <span>Product: ${item.stats.count}</span>
                             <span class="text-gray-300 dark:text-gray-600">|</span>
                             <span>${item.stats.quota}</span>
                         </div>
                         <div class="w-full h-0.5 bg-gray-200 dark:bg-gray-700">
                            <div class="h-full bg-red-500" style="width: ${wonPercent}%"></div>
                         </div>
                    </div>
                    <div class="flex items-center gap-1 text-gray-400 bg-gray-50 dark:bg-gray-800 px-2 py-0.5 rounded border dark:border-gray-600 flex-shrink-0" title="${fileCount} files">
                        <svg class="w-3.5 h-3.5 ${fileCount > 0 ? 'text-blue-500' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg>
                        <span class="text-[10px] font-mono font-bold">${fileCount}</span>
                    </div>
                </div>
            </div>
        </div>
        ${progressHtml}
        <div class="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 dark:bg-gray-800/90 rounded shadow-sm backdrop-blur-sm p-0.5 z-10 border dark:border-gray-600">
            <button class="btn-action-view p-1 rounded hover:bg-indigo-100 text-indigo-600 dark:hover:bg-indigo-900 dark:text-indigo-400 transition-colors" title="${t('perm_view')}"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 0 1 6 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg></button> 
            ${canEdit && item.tinh_trang !== 'Win' ? `<button class="btn-action-win p-1 rounded hover:bg-green-100 text-green-600 dark:hover:bg-green-900 dark:text-green-400 transition-colors" title="${t('col_win')}"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg></button>` : ''}
            ${canEdit && item.tinh_trang !== 'Fail' ? `<button class="btn-action-fail p-1 rounded hover:bg-red-100 text-red-600 dark:hover:bg-red-900 dark:text-red-400 transition-colors" title="${t('col_fail')}"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>` : ''}
            ${canEdit ? `<button class="btn-action-edit p-1 rounded hover:bg-blue-100 text-blue-600 dark:hover:bg-blue-900 dark:text-blue-400 transition-colors" title="${t('perm_edit')}"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button>` : ''}
            <button class="btn-action-history p-1 rounded hover:bg-yellow-100 text-yellow-600 dark:hover:bg-yellow-900 dark:text-yellow-400 transition-colors" title="Xem lịch sử"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></button>
            ${canDelete && item.tinh_trang === 'Fail' ? `<button class="btn-action-delete p-1 rounded hover:bg-gray-200 text-gray-500 dark:hover:bg-gray-600 dark:text-gray-400 transition-colors" title="${t('perm_delete')}"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>` : ''}
        </div>
    `;

    el.querySelector('.btn-action-view').onclick = (e) => { e.stopPropagation(); openListingModal(item, true); };
    if (canEdit) {
        const btnEdit = el.querySelector('.btn-action-edit');
        if(btnEdit) btnEdit.onclick = (e) => { e.stopPropagation(); openListingModal(item, false); };
        const btnWin = el.querySelector('.btn-action-win');
        if(btnWin) btnWin.onclick = (e) => { e.stopPropagation(); ListingWin.openWinModal(item.ma_thau, item.tinh_trang); };
        const btnFail = el.querySelector('.btn-action-fail');
        if(btnFail) btnFail.onclick = (e) => { e.stopPropagation(); updateListingStatus(item.ma_thau, 'Fail'); };
    }
    el.querySelector('.btn-action-history').onclick = (e) => { e.stopPropagation(); viewListingHistory(item.ma_thau); };
    
    if (canDelete) {
        const btnDelete = el.querySelector('.btn-action-delete');
        if(btnDelete) btnDelete.onclick = (e) => { e.stopPropagation(); deleteListing(item.ma_thau); };
    }

    return el;
}

function initSortable() {
    sortables.forEach(s => s.destroy());
    sortables = [];
    const containers = document.querySelectorAll('.kanban-col');
    containers.forEach(container => {
        const sortable = new Sortable(container, {
            group: 'kanban',
            animation: 150,
            ghostClass: 'opacity-50',
            delay: 100,
            delayOnTouchOnly: true,
            onEnd: function (evt) {
                const itemEl = evt.item;
                const newStatus = evt.to.dataset.status;
                const oldStatus = evt.from.dataset.status;
                const maThau = itemEl.getAttribute('data-ma-thau');

                // Permission check for Drag & Drop (which is effectively an Edit action)
                if (!checkPermission('sua')) {
                    showToast("Bạn không có quyền sửa (kéo thả) hồ sơ này.", "error");
                    // SortableJS doesn't have an easy 'revert' on end without reloading, 
                    // but since we don't call updateListingStatus, the DB won't change.
                    // The UI might look wrong until refresh.
                    fetchListings(true); // Silent refresh to revert UI
                    return;
                }

                if (newStatus !== oldStatus) {
                    if (newStatus === 'Win') {
                        ListingWin.openWinModal(maThau, oldStatus, itemEl, evt.from);
                    } else if (newStatus === 'Fail') {
                        updateListingStatus(maThau, 'Fail');
                    } else if (newStatus === 'Waiting') {
                        updateListingStatus(maThau, 'Waiting');
                    } else {
                        updateListingStatus(maThau, newStatus);
                    }
                }
            }
        });
        sortables.push(sortable);
    });
}

// --- Import / Export Logic ---

function downloadImportTemplate() {
    const headers = [
        'Năm', 'Bệnh Viện', 'Tỉnh', 'Khu Vực', 'Nhà Phân Phối', 'Ngày', 'Loại', 
        'Mã VT', 'Quota', 'SL Trúng', 'Tình Trạng', 'Ngày Ký', 'Ngày Kết Thúc', 
        'Ngành', 'PSR', 'Quản Lý', 'Nhóm Sản Phẩm'
    ];
    const exampleData = [
        [2024, 'BV Chợ Rẫy', 'Hồ Chí Minh', 'HCM', 'Công ty A', '2024-01-15', 'Thầu tập trung', 'VT-001', 1000, 0, 'Waiting', '', '', 'Tim mạch', 'Nguyen Van A', 'Tran Van B', 'G1'],
        [2024, 'BV Chợ Rẫy', 'Hồ Chí Minh', 'HCM', 'Công ty A', '2024-01-15', 'Thầu tập trung', 'VT-002', 500, 0, 'Waiting', '', '', 'Tim mạch', 'Nguyen Van A', 'Tran Van B', 'G2'],
        [2024, 'BV Bạch Mai', 'Hà Nội', 'Hà Nội', 'Công ty B', '2024-02-01', 'Mua sắm trực tiếp', 'VT-003', 200, 0, 'Waiting', '', '', 'Hô hấp', 'Le Van C', 'Pham Van D', 'G1']
    ];

    const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleData]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "Mau_Import_Listing.xlsx");
}

function handleExcelImport(event) {
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
            // Reset input so same file can be selected again
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
        'Năm': 'nam', 'Bệnh Viện': 'benh_vien', 'Tỉnh': 'tinh', 'Khu Vực': 'khu_vuc', 
        'Nhà Phân Phối': 'nha_phan_phoi', 'Ngày': 'ngay', 'Loại': 'loai', 
        'Mã VT': 'ma_vt', 'Quota': 'quota', 'SL Trúng': 'sl_trung', 'Tình Trạng': 'tinh_trang', 
        'Ngày Ký': 'ngay_ky', 'Ngày Kết Thúc': 'ngay_ket_thuc', 
        'Ngành': 'nganh', 'PSR': 'psr', 'Quản Lý': 'quan_ly', 'Nhóm Sản Phẩm': 'group_product'
    };

    const groups = {};
    
    // 1. Normalize and Group Data
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

    // 2. Generate IDs and Prepare Batches
    let listingInserts = [];
    let detailInserts = [];

    for (const key in groups) {
        const group = groups[key];
        const [y, m, d] = group.common.ngay.split('-');
        const dateStr = `${d}${m}${y}`;
        const acronym = getAcronym(group.common.benh_vien);
        const maThau = `${dateStr}-${acronym}`;
        
        group.ma_thau = maThau;
        
        listingInserts.push({
            ...group.common,
            ma_thau: maThau
        });

        group.details.forEach(det => {
            detailInserts.push({
                id: Math.floor(Math.random() * 2000000000), 
                ma_thau: maThau,
                ...group.common,
                ...det
            });
        });
    }

    if (listingInserts.length === 0) {
        showLoading(false);
        showToast("Không tìm thấy dữ liệu hợp lệ để nhập.", "info");
        return;
    }

    // 3. Check for Duplicates
    const allMaThaus = listingInserts.map(i => i.ma_thau);
    try {
        const { data: duplicates, error: checkError } = await sb
            .from('listing')
            .select('ma_thau')
            .in('ma_thau', allMaThaus);

        if (checkError) throw checkError;

        if (duplicates && duplicates.length > 0) {
            const duplicateIds = duplicates.map(d => d.ma_thau);
            
            // Map to Date - Hospital
            const duplicateDetails = listingInserts
                .filter(i => duplicateIds.includes(i.ma_thau))
                .map(i => {
                    const [y, m, d] = i.ngay.split('-');
                    return `${d}/${m}/${y} - ${i.benh_vien}`;
                });

            const duplicateListStr = duplicateDetails.join('\n');
            const msg = `Hệ thống phát hiện ${duplicates.length} hồ sơ đã tồn tại (Ngày - Bệnh Viện):\n\n${duplicateListStr}\n\nBạn có muốn bỏ qua các hồ sơ trùng và chỉ nhập các hồ sơ mới không?`;
            
            showLoading(false); // Pause loading for confirm
            const shouldProceed = await showConfirm(msg, t('dup_detect_title'));
            showLoading(true); // Resume loading

            if (shouldProceed) {
                // Filter out duplicates
                listingInserts = listingInserts.filter(i => !duplicateIds.includes(i.ma_thau));
                detailInserts = detailInserts.filter(i => !duplicateIds.includes(i.ma_thau));
                
                if (listingInserts.length === 0) {
                    showLoading(false);
                    showToast("Không còn dữ liệu mới để nhập sau khi loại bỏ trùng lặp.", "info");
                    return;
                }
            } else {
                showLoading(false);
                showToast("Đã hủy nhập liệu.", "info");
                return;
            }
        }

        // 4. Database Insert
        const { error: listError } = await sb.from('listing').insert(listingInserts);
        if (listError) throw listError;

        if (detailInserts.length > 0) {
            const chunkSize = 1000;
            for (let i = 0; i < detailInserts.length; i += chunkSize) {
                const chunk = detailInserts.slice(i, i + chunkSize);
                const { error: detError } = await sb.from('detail').insert(chunk);
                if (detError) console.error("Lỗi nhập chi tiết batch:", detError); 
            }
        }

        // 5. Notify Admin (Bell Notification)
        const importedHospitals = [...new Set(listingInserts.map(i => i.benh_vien))].join(', ');
        await notifyAdmins(
            'Import Excel Thành Công', 
            `User ${currentUser.ho_ten} đã import thành công ${listingInserts.length} hồ sơ thầu.\nBV: ${importedHospitals.substring(0, 100)}${importedHospitals.length > 100 ? '...' : ''}`,
            { view: 'view-ton-kho' },
            'excel_import' // Set specific type for robust navigation
        );

        // 6. Log History (Individual Logs for each new listing)
        const historyInserts = listingInserts.map(item => ({
            ma_thau: item.ma_thau,
            nguoi_thuc_hien: currentUser.ho_ten || currentUser.gmail,
            hanh_dong: 'Import Excel', // Specific action name
            noi_dung: `Hồ sơ được tạo tự động từ tính năng Import Excel. Bao gồm ${groups[`${item.benh_vien.trim().toLowerCase()}_${item.ngay}`]?.details.length || 0} mã vật tư.`
        }));

        if (historyInserts.length > 0) {
             const { error: histError } = await sb.from('history').insert(historyInserts);
             if(histError) console.error("Lỗi ghi lịch sử:", histError);
        }

        showToast("Import dữ liệu thành công!", "success");
        await fetchListings(); // Refresh UI

    } catch (error) {
        console.error("Import Error:", error);
        showToast("Lỗi khi import dữ liệu: " + error.message, "error");
    } finally {
        showLoading(false);
    }
}

function getAcronym(str) {
    if (!str) return '';
    return str.trim().replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(word => word.length > 0).map(word => word.charAt(0)).join('').toUpperCase();
}

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
            });
        });
    };

    input.onfocus = () => renderList(input.value);
    input.oninput = () => renderList(input.value);
    input.onblur = () => { setTimeout(() => list.classList.remove('show'), 150); };
}

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
        <td class="px-3 py-2 text-left pl-4">${totalQuota}</td>
        <td class="px-3 py-2 text-left pl-4">${totalWon}</td>
        <td class="px-3 py-2"></td>
    `;
    container.appendChild(totalRow);
}

function addMaterialRow() {
    currentMaterials.push({ ma_vt: '', quota: '', sl_trung: '' });
    renderMaterialList(isReadOnlyMode);
}

window.updateMaterial = function(index, field, value) {
    if(currentMaterials[index]) {
        currentMaterials[index][field] = value;
        if (field === 'quota') {
             currentMaterials[index]['sl_trung'] = value;
             renderMaterialList(isReadOnlyMode); // Re-render to calculate sums
        } else if (field === 'sl_trung') {
             // Re-render to update total if won qty changes manually
             renderMaterialList(isReadOnlyMode);
        }
    }
}

window.removeMaterial = function(index) {
    currentMaterials.splice(index, 1);
    renderMaterialList(isReadOnlyMode);
}

window.openListingModal = async function(item = null, readOnly = false) {
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
    
    setupAutocompletes(listingsCache);

    if (item) {
        title.textContent = readOnly ? t('nav_detail') : t('modal_edit_title');
        document.getElementById('listing-id').value = item.id || item.ma_thau;
        document.getElementById('l-ma-thau').value = item.ma_thau || '';
        originalMaThau = item.ma_thau; 
        
        document.getElementById('l-nam').value = item.nam || '';
        document.getElementById('l-benh-vien').value = item.benh_vien || '';
        document.getElementById('l-tinh').value = item.tinh || '';
        document.getElementById('l-khu-vuc').value = item.khu_vuc || '';
        document.getElementById('l-loai').value = item.loai || '';
        document.getElementById('l-npp').value = item.nha_phan_phoi || '';
        document.getElementById('l-ngay').value = item.ngay || '';
        document.getElementById('l-ngay-ky').value = item.ngay_ky || '';
        document.getElementById('l-ngay-kt').value = item.ngay_ket_thuc || '';
        document.getElementById('l-nganh').value = item.nganh || '';
        document.getElementById('l-psr').value = item.psr || '';
        document.getElementById('l-quan-ly').value = item.quan_ly || '';
        document.getElementById('l-status').value = item.tinh_trang || 'Waiting';
        
        try {
             const files = typeof item.files === 'string' ? JSON.parse(item.files) : (item.files || []);
             currentFiles = Array.isArray(files) ? files : [];
             renderFileList(readOnly);
        } catch(e) { console.error(e); }

        if (item.ma_thau) {
            showLoading(true);
            const { data, error } = await sb.from('detail').select('ma_vt, quota, sl_trung').eq('ma_thau', item.ma_thau);
            showLoading(false);
            if (!error && data) {
                currentMaterials = data;
            }
        }

    } else {
        title.textContent = t('modal_add_title');
        document.getElementById('listing-id').value = '';
        document.getElementById('l-status').value = currentMobileStatus || 'Waiting'; 
        
        const now = new Date();
        document.getElementById('l-nam').value = now.getFullYear();
        document.getElementById('l-ngay').value = now.toISOString().split('T')[0];
    }

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
    }

    // Capture initial state for dirty check
    initialFormState = getFormState();

    modal.classList.remove('hidden');
};

window.closeListingModal = async function(force = false) {
    if (!force && !isReadOnlyMode) {
        const currentState = getFormState();
        if (initialFormState !== currentState) {
            const confirmed = await showConfirm(t('confirm_unsaved_close'), t('confirm_title'));
            if (!confirmed) return;
        }
    }
    
    document.getElementById('listing-modal').classList.add('hidden');
    document.getElementById('history-modal').classList.add('hidden');
};

window.saveListing = async function(e) {
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

    if (originalMaThau) {
        actionType = "Cập nhật";
        
        const { data: listingData } = await sb.from('listing').select('*').eq('ma_thau', originalMaThau).single();
        const { data: detailData } = await sb.from('detail').select('ma_vt, quota, sl_trung').eq('ma_thau', originalMaThau);
        
        oldListing = listingData;
        oldDetails = detailData || [];

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
                
                if (Number(oldMat.quota) !== Number(newMat.quota)) {
                    matChanges.push(`Quota: ${oldMat.quota} -> ${newMat.quota}`);
                }
                if (Number(oldMat.sl_trung) !== Number(newMat.sl_trung)) {
                    matChanges.push(`Trúng: ${oldMat.sl_trung} -> ${newMat.sl_trung}`);
                }

                if (matChanges.length > 0) {
                    changeLog.push(`Cập nhật VT [${maVt}]: ${matChanges.join(', ')}`);
                }
            } else {
                changeLog.push(`Thêm VT mới [${maVt}]: Quota ${newMat.quota}`);
            }
        }

        for (const [maVt, oldMat] of oldMatMap.entries()) {
            if (!newMatMap.has(maVt)) {
                changeLog.push(`Xóa VT [${maVt}]`);
            }
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
    
    if (delError) {
        showLoading(false);
        showToast('Cảnh báo: Listing đã lưu nhưng lỗi xóa chi tiết cũ: ' + delError.message, 'info');
    }

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
                showToast('Cảnh báo: Listing đã lưu nhưng lỗi lưu chi tiết vật tư: ' + insertError.message, 'error');
            }
        }
    }
    
    if (changeLog.length > 0) {
        await logHistory(formData.ma_thau, actionType, changeLog.join('\n'));
    }
    
    // Notify Admin if creating new manually
    if (!originalMaThau) {
         await notifyAdmins(
            'Hồ sơ mới (Thủ công)', 
            `User ${currentUser.ho_ten} đã tạo mới hồ sơ thầu ${formData.ma_thau} (${formData.benh_vien}).`,
            { view: 'view-ton-kho' }
        );
    }

    showLoading(false);
    showToast(t('msg_update_success'), 'success');
    // Close modal without confirmation since we just saved successfully
    window.closeListingModal(true);
    await fetchListings();
};

async function updateListingStatus(maThau, newStatus, silent = false) {
    if (!silent) showLoading(true);
    
    const updateData = { tinh_trang: newStatus };
    const detailUpdateData = { tinh_trang: newStatus };

    let error = null;

    const { error: listingError } = await sb.from('listing').update(updateData).eq('ma_thau', maThau); 
    
    if (listingError) {
         error = listingError;
    } else {
        if (newStatus === 'Fail') {
             detailUpdateData.sl_trung = 0;
             const { error: detError } = await sb.from('detail').update(detailUpdateData).eq('ma_thau', maThau);
             if(detError) error = detError;
        } else if (newStatus === 'Waiting') {
             const { data: details, error: fetchError } = await sb.from('detail').select('*').eq('ma_thau', maThau);
             if (fetchError) {
                 error = fetchError;
             } else if (details && details.length > 0) {
                 const updates = details.map(d => ({
                     ...d,
                     tinh_trang: newStatus,
                     sl_trung: d.quota
                 }));
                 const { error: upsertError } = await sb.from('detail').upsert(updates);
                 if(upsertError) error = upsertError;
             }
        } else {
             const { error: detError } = await sb.from('detail').update(detailUpdateData).eq('ma_thau', maThau);
             if(detError) error = detError;
        }
    }
    
    if (!silent) showLoading(false);
    
    if (error) {
         if(!silent) showToast('Cập nhật thất bại: ' + error.message, 'error');
         await fetchListings(); 
    } else {
        await logHistory(maThau, "Đổi trạng thái", `Chuyển sang trạng thái: ${newStatus}`);
        if(!silent) {
            showToast(t('msg_update_success'), 'success');
            await fetchListings();
        }
    }
}

async function deleteListing(id) {
    if (await showConfirm(t('confirm_msg'))) {
        showLoading(true);
        
        const item = listingsCache.find(i => i.id == id || i.ma_thau == id);
        const targetMaThau = item ? item.ma_thau : id;
        
        const { error } = await sb.from('listing').delete().eq('ma_thau', targetMaThau);
        
        if (!error) {
            await sb.from('detail').delete().eq('ma_thau', targetMaThau);
        }

        showLoading(false);
        if (error) {
             showToast('Xóa thất bại', 'error');
        } else {
            showToast(t('msg_delete_success'), 'success');
            await fetchListings();
        }
    }
}

function calculateProgress(startDateStr, endDateStr) {
    if (!startDateStr || !endDateStr) return null;
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    const now = new Date();
    start.setHours(0,0,0,0);
    end.setHours(0,0,0,0);
    now.setHours(0,0,0,0);

    const totalDuration = end.getTime() - start.getTime();
    const elapsed = now.getTime() - start.getTime();
    
    if (totalDuration <= 0) return { percent: 100, daysLeft: 0, isExpired: true, text: t('lbl_expired') };

    let percent = (elapsed / totalDuration) * 100;
    const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const isExpired = daysLeft < 0;
    percent = isExpired ? 100 : Math.max(0, Math.min(100, percent));

    let colorClass = 'bg-green-500';
    if (isExpired) colorClass = 'bg-gray-500';
    else if (percent > 90) colorClass = 'bg-red-500';
    else if (percent > 75) colorClass = 'bg-orange-400';
    else if (percent > 50) colorClass = 'bg-blue-500';

    return {
        percent,
        daysLeft: Math.abs(daysLeft),
        isExpired,
        colorClass,
        text: isExpired ? t('lbl_expired') : `${daysLeft} ${t('lbl_days_left')}`
    };
}

function handleFileUpload(files) {
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

function handlePaste(e) {
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

function renderFileList(readOnly) {
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
}

function generateMaThau() {
    if(isReadOnlyMode) return;
    const dateVal = document.getElementById('l-ngay').value;
    const hospitalVal = document.getElementById('l-benh-vien').value;
    const maThauInput = document.getElementById('l-ma-thau');
    if (dateVal && hospitalVal) {
        const [year, month, day] = dateVal.split('-');
        const dateStr = `${day}${month}${year}`;
        const hospitalCode = getAcronym(hospitalVal);
        if (dateStr && hospitalCode) maThauInput.value = `${dateStr}-${hospitalCode}`;
    }
}

function initDraggableModal() {
    const modal = document.getElementById('listing-modal-content');
    const header = document.getElementById('listing-modal-header');
    
    if(!modal || !header) return;

    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    header.onmousedown = (e) => {
        if(window.innerWidth < 768) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        const rect = modal.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        
        modal.style.transform = 'none';
        modal.style.left = initialLeft + 'px';
        modal.style.top = initialTop + 'px';
        
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

    const resizer = document.getElementById('modal-resize-handle');
    if(resizer) {
        resizer.onmousedown = (e) => {
            e.stopPropagation();
            let startW = modal.offsetWidth;
            let startH = modal.offsetHeight;
            let startX = e.clientX;
            let startY = e.clientY;

            document.onmousemove = (e) => {
                modal.style.width = (startW + e.clientX - startX) + 'px';
                modal.style.height = (startH + e.clientY - startY) + 'px';
            };

            document.onmouseup = () => {
                document.onmousemove = null;
                document.onmouseup = null;
            };
        };
    }
}

function switchMobileTab(status) {
    currentMobileStatus = status;
    document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
        if(btn.dataset.status === status) {
            btn.className = `mobile-tab-btn flex-1 py-1.5 px-2 text-xs font-medium rounded text-center whitespace-nowrap transition-colors border border-blue-200 dark:border-blue-800 bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300`;
        } else {
            btn.className = `mobile-tab-btn flex-1 py-1.5 px-2 text-xs font-medium rounded text-center whitespace-nowrap transition-colors border border-transparent text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700`;
        }
    });

    Object.keys(COLUMNS).forEach(key => {
        const colWrapper = document.getElementById(`col-wrapper-${key}`);
        if(colWrapper) {
            if (key === status) {
                colWrapper.classList.remove('hidden');
                colWrapper.classList.add('flex');
            } else {
                colWrapper.classList.add('hidden');
                colWrapper.classList.remove('flex');
                colWrapper.classList.add('md:flex');
            }
        }
    });
}
