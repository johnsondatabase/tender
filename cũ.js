
import { sb, showToast, showLoading, showConfirm, sanitizeFileName, currentUser } from './app.js';
import { translations, getCurrentLanguage, setLanguage } from './lang.js';
import { logHistory, viewListingHistory } from './lichsu.js';

// Expose viewListingHistory to window for HTML onclick attributes (like in Modal Header)
window.viewListingHistory = viewListingHistory;

let listingsCache = [];
let sortables = [];
let currentFiles = []; // Store files for the currently open modal
let currentMaterials = []; // Store material rows for the currently open modal
let originalMaThau = null; // Track original ID for updates
let isReadOnlyMode = false;
let currentMobileStatus = 'Waiting'; // Default mobile view status

// Variables for Win Transition
let winTransitionListingId = null;
let winTransitionMaterials = [];
let winTransitionOriginalStatus = null;

// Filter State - Arrays for Multi-select
let currentFilters = {
    keyword: '',
    dateRange: [],
    benh_vien: [],
    npp: [],
    khu_vuc: [],
    nganh: []
};

// Helper function for quick translation
const t = (key) => {
    const lang = getCurrentLanguage();
    return translations[lang][key] || key;
};

// Column Definitions with distinct colors
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

export async function onShowListingView() {
    const container = document.getElementById('view-ton-kho');
    
    // Inject Layout if not exists
    if (!container.querySelector('#kanban-board')) {
        container.innerHTML = `
            <div class="flex flex-col h-full relative">
                <!-- Sticky Header: Search, Filter & Add -->
                <div class="sticky top-0 z-20 bg-gray-50 dark:bg-gray-900 pb-2 pt-1 mb-2 flex flex-col gap-2 transition-colors duration-300 shadow-sm md:shadow-none border-b dark:border-gray-700">
                    
                    <!-- Top Row -->
                    <div class="flex flex-row justify-between items-center gap-2">
                        <div class="relative flex-1">
                            <span class="absolute inset-y-0 left-0 flex items-center pl-3">
                                <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                            </span>
                            <input type="text" id="listing-search" class="w-full pl-9 pr-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white transition-colors" data-i18n="search_placeholder" placeholder="Tìm kiếm...">
                        </div>
                        
                        <!-- Filter Toggle Button (3 States) - Compact on Mobile -->
                        <button id="btn-toggle-filter" class="flex-shrink-0 w-10 md:w-auto px-0 md:px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center gap-1 transition-colors relative md:min-w-[100px]">
                            <!-- Icon & Text injected by JS -->
                        </button>

                        <button id="btn-add-listing" class="flex-shrink-0 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow flex items-center justify-center gap-1 transition-colors">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                            <span class="hidden md:inline text-sm" data-i18n="btn_add_new">Thêm Mới</span>
                            <span class="md:hidden text-sm">Thêm</span>
                        </button>
                    </div>

                    <!-- Filter Panel (Collapsible Desktop / Slide-out Mobile) -->
                    <!-- Overlay for Mobile -->
                    <div id="filter-backdrop" class="fixed inset-0 bg-black/50 z-30 hidden md:hidden transition-opacity"></div>
                    
                    <!-- Panel Container -->
                    <div id="filter-panel" class="fixed inset-y-0 right-0 z-40 w-80 bg-white dark:bg-gray-800 shadow-2xl transform translate-x-full transition-transform duration-300 md:static md:w-full md:shadow-none md:transform-none md:translate-x-0 md:bg-gray-50 md:dark:bg-gray-900 md:border md:dark:border-gray-700 md:rounded-lg hidden flex flex-col md:block">
                        
                        <!-- Mobile Header -->
                        <div class="flex items-center justify-between p-4 border-b dark:border-gray-700 md:hidden bg-primary text-white">
                            <h3 class="font-bold text-lg" data-i18n="lbl_filter_title">Bộ Lọc Tìm Kiếm</h3>
                            <button id="btn-close-filter-mobile" class="p-1 hover:bg-white/20 rounded">
                                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>

                        <!-- Filter Inputs Grid -->
                        <div class="p-4 grid grid-cols-1 md:grid-cols-5 gap-3 md:gap-4 overflow-y-auto md:overflow-visible flex-1">
                            
                            <!-- Date Range -->
                            <div class="filter-group relative">
                                <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1" data-i18n="lbl_date_created">Ngày tạo</label>
                                <div id="filter-wrapper-date" class="multi-select-container"></div>
                            </div>

                            <!-- Hospital -->
                            <div class="filter-group relative">
                                <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1" data-i18n="lbl_hospital">Bệnh Viện</label>
                                <div id="filter-wrapper-hospital" class="multi-select-container"></div>
                            </div>

                            <!-- Distributor -->
                            <div class="filter-group relative">
                                <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1" data-i18n="lbl_distributor">Nhà Phân Phối</label>
                                <div id="filter-wrapper-npp" class="multi-select-container"></div>
                            </div>
                            
                            <!-- Area -->
                            <div class="filter-group relative">
                                <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1" data-i18n="lbl_area">Khu Vực</label>
                                <div id="filter-wrapper-area" class="multi-select-container"></div>
                            </div>
                            
                            <!-- Sector -->
                            <div class="filter-group relative">
                                <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1" data-i18n="lbl_sector">Ngành</label>
                                <div id="filter-wrapper-sector" class="multi-select-container"></div>
                            </div>
                        </div>

                        <!-- Filter Footer Actions (Mobile Only) -->
                        <div class="p-4 border-t dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900 md:hidden">
                            <button id="btn-reset-filter-mobile" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium flex items-center gap-2" data-i18n="btn_clear_filter">
                                <svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                Xóa lọc
                            </button>
                            <button id="btn-apply-filter-mobile" class="px-6 py-2 bg-primary text-white rounded-lg shadow font-medium" data-i18n="btn_confirm">Áp dụng</button>
                        </div>
                    </div>
                </div>

                <!-- Mobile Status Tabs (AppSheet style) -->
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
                                <div id="col-${status}" data-status="${status}" class="kanban-col flex-1 overflow-y-auto p-2 space-y-3 custom-scrollbar">
                                    <!-- Cards will go here -->
                                </div>
                            </div>
                        `}).join('')}
                    </div>
                </div>
            </div>
        `;
        
        // --- Event Listeners ---
        
        // Search & Filter Input
        document.getElementById('listing-search').addEventListener('input', (e) => {
            currentFilters.keyword = e.target.value;
            applyFilters();
        });

        // Toggle / Clear / Close Button Logic
        const btnToggle = document.getElementById('btn-toggle-filter');
        const filterPanel = document.getElementById('filter-panel');
        const filterBackdrop = document.getElementById('filter-backdrop');
        const btnCloseMobile = document.getElementById('btn-close-filter-mobile');
        const btnApplyMobile = document.getElementById('btn-apply-filter-mobile');
        const btnResetMobile = document.getElementById('btn-reset-filter-mobile');

        const updateToggleButtonState = () => {
            const hasActiveFilters = hasFilters();
            
            // Check if open. 
            // On desktop: it has md:block if open.
            // On mobile: it does NOT have translate-x-full if open.
            const isDesktop = window.innerWidth >= 768;
            let isOpen = false;
            
            if (isDesktop) {
                // If it has md:block, it's open
                isOpen = filterPanel.classList.contains('md:block');
            } else {
                isOpen = !filterPanel.classList.contains('translate-x-full') && !filterPanel.classList.contains('hidden');
            }

            // Remove previous special styling classes
            btnToggle.classList.remove('btn-filter-active');

            if (hasActiveFilters) {
                // State 3: Clear Filter
                btnToggle.innerHTML = `
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    <span class="hidden md:inline text-sm font-medium line-through decoration-current" data-i18n="btn_clear_filter">${t('btn_clear_filter')}</span>
                `;
                btnToggle.classList.add('btn-filter-active');
                
                // Override onclick for this state
                btnToggle.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    resetAllFilters();
                };
            } else if (isOpen) {
                // State 2: Hide Filter
                btnToggle.innerHTML = `
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path></svg>
                    <span class="hidden md:inline text-sm" data-i18n="btn_hide_filter">${t('btn_hide_filter')}</span>
                `;
                btnToggle.onclick = (e) => {
                    e.preventDefault();
                    toggleFilterPanel();
                };
            } else {
                 // State 1: Show Filter
                 btnToggle.innerHTML = `
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path></svg>
                    <span class="hidden md:inline text-sm" data-i18n="btn_show_filter">${t('btn_show_filter')}</span>
                `;
                btnToggle.onclick = (e) => {
                    e.preventDefault();
                    toggleFilterPanel();
                };
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
                // Desktop toggle logic: toggle md:block explicitly
                if (filterPanel.classList.contains('md:block')) {
                    filterPanel.classList.remove('md:block');
                    filterPanel.classList.add('hidden');
                } else {
                    filterPanel.classList.add('md:block');
                    filterPanel.classList.remove('hidden');
                }
            }
            // Small delay to let DOM update before checking state again
            setTimeout(updateToggleButtonState, 100);
        };

        btnCloseMobile.addEventListener('click', toggleFilterPanel);
        filterBackdrop.addEventListener('click', toggleFilterPanel);
        btnApplyMobile.addEventListener('click', toggleFilterPanel);
        btnResetMobile.addEventListener('click', resetAllFilters);
        
        // Initial State
        updateToggleButtonState();
        // Expose function for re-use
        window.updateFilterButton = updateToggleButtonState; 

        // Add Button
        document.getElementById('btn-add-listing').addEventListener('click', () => openListingModal());
        
        // Mobile Tab Click Listeners
        document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget;
                const status = target.dataset.status;
                switchMobileTab(status);
            });
        });
        
        // Add Material Button
        const btnAddMaterial = document.getElementById('btn-add-material');
        if (btnAddMaterial) btnAddMaterial.addEventListener('click', addMaterialRow);

        // File Upload & Paste logic...
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

        // Win Modal Listeners
        document.querySelectorAll('input[name="win-type"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const materialSection = document.getElementById('win-material-section');
                if (e.target.value === 'partial') {
                    materialSection.classList.remove('hidden');
                } else {
                    materialSection.classList.add('hidden');
                }
            });
        });
        document.getElementById('win-cancel-btn').addEventListener('click', cancelWinTransition);
        document.getElementById('win-save-btn').addEventListener('click', saveWinTransition);


    } else {
        // ... (Re-translate headers code) ...
        Object.keys(COLUMNS).forEach(status => {
            const labelKey = COLUMNS[status].labelKey;
            const text = t(labelKey);
            const colHeader = document.querySelector(`#col-wrapper-${status} span[data-i18n]`);
            if(colHeader) colHeader.textContent = text;
        });
        const searchInput = document.getElementById('listing-search');
        if(searchInput) searchInput.placeholder = t('search_placeholder');
        
        // Re-render board to update counts/percentages
        applyFilters(); 
    }

    await fetchListings();
}


// --- Multi-Select Logic & Dependent Filtering ---

function getFilteredOptions(data, field) {
    // Return unique values for 'field' from data
    return [...new Set(data.map(item => item[field]).filter(v => v))].sort();
}

function getDateOptions() {
    return [
        { value: 'today', label: t('opt_today') },
        { value: 'week', label: t('opt_week') },
        { value: 'month', label: t('opt_month') },
        { value: 'quarter', label: t('opt_quarter') },
        { value: 'year', label: t('opt_year') }
    ];
}

// Cascading Logic: To simulate Excel-like dependent filters
function getAvailableDataForField(targetField) {
    // We filter the original listings based on all current filters EXCEPT the target field itself.
    return listingsCache.filter(item => {
        const matchesDate = targetField === 'dateRange' || checkDateRange(item.ngay, currentFilters.dateRange);
        const matchesHospital = targetField === 'benh_vien' || currentFilters.benh_vien.length === 0 || currentFilters.benh_vien.includes(item.benh_vien);
        const matchesNPP = targetField === 'npp' || currentFilters.npp.length === 0 || currentFilters.npp.includes(item.nha_phan_phoi);
        const matchesArea = targetField === 'khu_vuc' || currentFilters.khu_vuc.length === 0 || currentFilters.khu_vuc.includes(item.khu_vuc);
        const matchesSector = targetField === 'nganh' || currentFilters.nganh.length === 0 || currentFilters.nganh.includes(item.nganh);
        
        return matchesDate && matchesHospital && matchesNPP && matchesArea && matchesSector;
    });
}

function updateFilterUI() {
    // 1. Date (Static options)
    renderMultiSelect('filter-wrapper-date', getDateOptions(), currentFilters.dateRange, (vals) => onFilterChange('dateRange', vals), true);

    // 2. Hospital (Dependent)
    const hospData = getAvailableDataForField('benh_vien');
    const hospOpts = getFilteredOptions(hospData, 'benh_vien').map(v => ({ value: v, label: v }));
    renderMultiSelect('filter-wrapper-hospital', hospOpts, currentFilters.benh_vien, (vals) => onFilterChange('benh_vien', vals));

    // 3. NPP (Dependent)
    const nppData = getAvailableDataForField('npp');
    const nppOpts = getFilteredOptions(nppData, 'nha_phan_phoi').map(v => ({ value: v, label: v }));
    renderMultiSelect('filter-wrapper-npp', nppOpts, currentFilters.npp, (vals) => onFilterChange('npp', vals));

    // 4. Area (Dependent)
    const areaData = getAvailableDataForField('khu_vuc');
    const areaOpts = getFilteredOptions(areaData, 'khu_vuc').map(v => ({ value: v, label: v }));
    renderMultiSelect('filter-wrapper-area', areaOpts, currentFilters.khu_vuc, (vals) => onFilterChange('khu_vuc', vals));

    // 5. Sector (Dependent)
    const sectorData = getAvailableDataForField('nganh');
    const sectorOpts = getFilteredOptions(sectorData, 'nganh').map(v => ({ value: v, label: v }));
    renderMultiSelect('filter-wrapper-sector', sectorOpts, currentFilters.nganh, (vals) => onFilterChange('nganh', vals));
    
    // Update labels via translations
    const labels = {
        'filter-wrapper-date': 'lbl_date_created',
        'filter-wrapper-hospital': 'lbl_hospital',
        'filter-wrapper-npp': 'lbl_distributor',
        'filter-wrapper-area': 'lbl_area',
        'filter-wrapper-sector': 'lbl_sector'
    };
    
    for (const [id, key] of Object.entries(labels)) {
        const wrapper = document.getElementById(id);
        if (wrapper) {
            const labelEl = wrapper.previousElementSibling; // The <label> tag
            if (labelEl) labelEl.textContent = t(key);
        }
    }

    if (window.updateFilterButton) window.updateFilterButton();
}

function onFilterChange(key, values) {
    currentFilters[key] = values;
    applyFilters();
    updateFilterUI(); // Re-render other dropdowns based on new selection state (Dependency)
}

function hasFilters() {
    return currentFilters.dateRange.length > 0 || 
           currentFilters.benh_vien.length > 0 || 
           currentFilters.npp.length > 0 || 
           currentFilters.khu_vuc.length > 0 || 
           currentFilters.nganh.length > 0;
}

function resetAllFilters() {
    currentFilters = {
        keyword: '',
        dateRange: [],
        benh_vien: [],
        npp: [],
        khu_vuc: [],
        nganh: []
    };
    document.getElementById('listing-search').value = '';
    applyFilters();
    updateFilterUI();
}

function renderMultiSelect(containerId, options, selectedValues, onUpdate, isLabelValueObj = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Preserve open state if re-rendering
    const wasOpen = container.querySelector('.multi-select-dropdown')?.classList.contains('open');

    // Button Text Logic
    let btnText = t('opt_all'); // Default "All"
    if (selectedValues.length > 0) {
        if (options.length > 0 && selectedValues.length === options.length) {
            btnText = t('opt_all');
        } else {
             btnText = `${t('opt_selected')} (${selectedValues.length})`;
        }
    }

    container.innerHTML = `
        <button type="button" class="multi-select-btn">
            <span class="truncate">${btnText}</span>
            <svg class="w-4 h-4 ml-2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
        </button>
        <div class="multi-select-dropdown ${wasOpen ? 'open' : ''}">
            <div class="multi-select-search">
                <input type="text" placeholder="${t('search_placeholder')}" class="w-full text-xs p-1 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white outline-none focus:ring-1 focus:ring-blue-500">
            </div>
            <div class="multi-select-options custom-scrollbar">
                <!-- Options injected below -->
            </div>
        </div>
    `;

    const btn = container.querySelector('.multi-select-btn');
    const dropdown = container.querySelector('.multi-select-dropdown');
    const searchInput = container.querySelector('input');
    const optionsContainer = container.querySelector('.multi-select-options');

    // Render Checkboxes function
    const renderOptions = (filter = '') => {
        const lowerFilter = filter.toLowerCase();
        
        let normalizedOpts = isLabelValueObj ? options : options.map(o => ({ value: o.value, label: o.label }));
        
        const filtered = normalizedOpts.filter(o => o.label.toLowerCase().includes(lowerFilter));
        
        if (filtered.length === 0) {
             optionsContainer.innerHTML = '<div class="p-2 text-xs text-gray-500 text-center">Không có dữ liệu</div>';
             return;
        }

        optionsContainer.innerHTML = filtered.map(opt => {
            const isChecked = selectedValues.includes(opt.value);
            return `
                <label class="checkbox-item text-xs text-gray-700 dark:text-gray-200">
                    <input type="checkbox" value="${opt.value}" ${isChecked ? 'checked' : ''}>
                    <span class="truncate">${opt.label}</span>
                </label>
            `;
        }).join('');

        // Attach listeners to new checkboxes
        optionsContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                const val = cb.value;
                let newSelected = [...selectedValues];
                if (cb.checked) newSelected.push(val);
                else newSelected = newSelected.filter(v => v !== val);
                onUpdate(newSelected); // Trigger update callback
            });
        });
    };

    renderOptions();

    // Search Listener
    searchInput.addEventListener('input', (e) => renderOptions(e.target.value));

    // Toggle Dropdown
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close others
        document.querySelectorAll('.multi-select-dropdown').forEach(d => {
            if (d !== dropdown) d.classList.remove('open');
        });
        dropdown.classList.toggle('open');
        if (dropdown.classList.contains('open')) {
            searchInput.focus();
        }
    });
}

function checkDateRange(dateStr, rangeArray) {
    if (!dateStr || rangeArray.length === 0) return true;
    
    // If multiple ranges selected, perform OR logic
    return rangeArray.some(range => {
        const d = new Date(dateStr);
        const now = new Date();
        d.setHours(0,0,0,0);
        now.setHours(0,0,0,0);

        if (range === 'today') return d.getTime() === now.getTime();
        if (range === 'week') {
            // Calculate start of week (Monday)
            const day = now.getDay() || 7; 
            const startOfWeek = new Date(now);
            if (day !== 1) startOfWeek.setHours(-24 * (day - 1)); 
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);
            
            return d >= startOfWeek && d <= endOfWeek;
        }
        if (range === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        if (range === 'quarter') {
            const currentQuarter = Math.floor(now.getMonth() / 3);
            const dateQuarter = Math.floor(d.getMonth() / 3);
            return currentQuarter === dateQuarter && d.getFullYear() === now.getFullYear();
        }
        if (range === 'year') return d.getFullYear() === now.getFullYear();
        return false;
    });
}

function applyFilters() {
    const term = currentFilters.keyword.toLowerCase();
    
    const filtered = listingsCache.filter(item => {
        // Keyword Search
        const matchesKeyword = !term || 
            (item.ma_thau && item.ma_thau.toLowerCase().includes(term)) ||
            (item.benh_vien && item.benh_vien.toLowerCase().includes(term)) ||
            (item.nha_phan_phoi && item.nha_phan_phoi.toLowerCase().includes(term));

        // Array Filters (Multi-select)
        const matchesHospital = currentFilters.benh_vien.length === 0 || currentFilters.benh_vien.includes(item.benh_vien);
        const matchesNPP = currentFilters.npp.length === 0 || currentFilters.npp.includes(item.nha_phan_phoi);
        const matchesArea = currentFilters.khu_vuc.length === 0 || currentFilters.khu_vuc.includes(item.khu_vuc);
        const matchesSector = currentFilters.nganh.length === 0 || currentFilters.nganh.includes(item.nganh);
        
        // Date Range
        const matchesDate = checkDateRange(item.ngay, currentFilters.dateRange);

        return matchesKeyword && matchesHospital && matchesNPP && matchesArea && matchesSector && matchesDate;
    });

    renderBoard(filtered);
}

function switchMobileTab(status) {
    currentMobileStatus = status;
    
    // Update Tab UI
    document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
        if(btn.dataset.status === status) {
            btn.className = `mobile-tab-btn flex-1 py-1.5 px-2 text-xs font-medium rounded text-center whitespace-nowrap transition-colors border border-blue-200 dark:border-blue-800 bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300`;
        } else {
            btn.className = `mobile-tab-btn flex-1 py-1.5 px-2 text-xs font-medium rounded text-center whitespace-nowrap transition-colors border border-transparent text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700`;
        }
    });

    // Update Column Visibility
    Object.keys(COLUMNS).forEach(key => {
        const colWrapper = document.getElementById(`col-wrapper-${key}`);
        if(colWrapper) {
            if (key === status) {
                colWrapper.classList.remove('hidden');
                colWrapper.classList.add('flex');
            } else {
                colWrapper.classList.add('hidden');
                colWrapper.classList.remove('flex');
                // Ensure desktop visibility is maintained via media query class in HTML (md:flex) 
                colWrapper.classList.add('md:flex');
            }
        }
    });
}

// Logic to generate Ma Thau automatically
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

function getAcronym(str) {
    if (!str) return '';
    return str.trim().replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(word => word.length > 0).map(word => word.charAt(0)).join('').toUpperCase();
}

async function fetchListings() {
    showLoading(true);
    const { data, error } = await sb.from('listing').select('*').order('ma_thau', { ascending: true });
    
    if (error) {
        showLoading(false);
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

    // Merge stats into listings
    listingsCache = data.map(l => ({
        ...l,
        stats: detailStats[l.ma_thau] || { count: 0, quota: 0, won: 0 }
    })) || [];
    
    showLoading(false);

    // Init Filters based on data
    updateFilterUI();
    
    // Render Board
    applyFilters();
}

// Setup Custom Dropdowns for Edit Form (Simple Autocomplete, not multiselect)
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

// Helper to determine the ID key
function getItemId(item) {
    return item.id !== undefined ? item.id : item.ma_thau;
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

function createCard(item) {
    const el = document.createElement('div');
    const colDef = COLUMNS[item.tinh_trang] || COLUMNS['Waiting'];
    const statusColor = colDef.borderColor;
    const itemId = getItemId(item); 
    const progress = calculateProgress(item.ngay_ky, item.ngay_ket_thuc);
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('vi-VN') : '-';
    
    let fileCount = 0;
    try {
        const files = typeof item.files === 'string' ? JSON.parse(item.files) : (item.files || []);
        fileCount = Array.isArray(files) ? files.length : 0;
    } catch(e) { fileCount = 0; }

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

    // Calculate Mini Circle Progress
    const wonPercent = item.stats.quota > 0 ? Math.round((item.stats.won / item.stats.quota) * 100) : 0;
    const radius = 6;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (wonPercent / 100) * circumference;
    const circleColor = wonPercent >= 100 ? 'text-green-500' : (wonPercent > 0 ? 'text-blue-500' : 'text-gray-300');

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
            <!-- Row 1: Year | Date Created -->
            <div class="grid grid-cols-2 gap-2 border-t border-dashed border-gray-100 dark:border-gray-600 pt-1">
                <div class="flex items-center gap-1 overflow-hidden">
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_year')}:</span>
                    <span class="font-medium text-gray-700 dark:text-gray-300 truncate">${item.nam || '-'}</span>
                </div>
                <div class="flex items-center justify-start gap-1 pl-3 border-l border-gray-100 dark:border-gray-600 overflow-hidden">
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_date_created')}:</span>
                    <span class="font-bold text-gray-700 dark:text-gray-200 truncate">${fmtDate(item.ngay)}</span>
                </div>
            </div>
            <!-- Row 2: Province | Area -->
            <div class="grid grid-cols-2 gap-2">
                <div class="flex items-center gap-1 overflow-hidden">
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_province')}:</span>
                    <span class="font-medium text-gray-700 dark:text-gray-300 truncate" title="${item.tinh}">${item.tinh || '-'}</span>
                </div>
                <div class="flex items-center justify-start gap-1 pl-3 border-l border-gray-100 dark:border-gray-600 overflow-hidden">
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_area')}:</span>
                    <span class="font-bold text-gray-700 dark:text-gray-200 truncate" title="${item.khu_vuc}">${item.khu_vuc || '-'}</span>
                </div>
            </div>
            <!-- Row 3: Type | Sector -->
            <div class="grid grid-cols-2 gap-2">
                <div class="flex items-center gap-1 overflow-hidden">
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_type')}:</span>
                    <span class="font-medium text-gray-700 dark:text-gray-300 truncate">${item.loai || '-'}</span>
                </div>
                <div class="flex items-center justify-start gap-1 pl-3 border-l border-gray-100 dark:border-gray-600 overflow-hidden">
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_sector')}:</span>
                    <span class="font-bold text-gray-700 dark:text-gray-200 truncate">${item.nganh || '-'}</span>
                </div>
            </div>
            <!-- Row 4: PSR | Manager -->
            <div class="grid grid-cols-2 gap-2">
                <div class="flex items-center gap-1 overflow-hidden">
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_psr')}:</span>
                    <span class="font-medium text-gray-700 dark:text-gray-300 truncate">${item.psr || '-'}</span>
                </div>
                <div class="flex items-center justify-start gap-1 pl-3 border-l border-gray-100 dark:border-gray-600 overflow-hidden">
                     <span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_manager')}:</span>
                    <span class="font-bold text-gray-700 dark:text-gray-200 truncate">${item.quan_ly || '-'}</span>
                </div>
            </div>
            <!-- Row 5: NPP | Files -->
             <div class="pt-1 border-t dark:border-gray-600 mt-1 flex justify-between items-center">
                <div class="flex items-center gap-1 overflow-hidden flex-1 mr-2">
                    <span class="text-[10px] text-gray-500 dark:text-gray-400 whitespace-nowrap">${t('lbl_distributor')}:</span>
                    <span class="font-medium text-gray-700 dark:text-gray-300 truncate" title="${item.nha_phan_phoi}">${item.nha_phan_phoi || '-'}</span>
                </div>
                
                <div class="flex items-center gap-2">
                    <!-- New Stats Area -->
                    <div class="flex items-center text-[9px] text-gray-500 dark:text-gray-400 gap-1 bg-gray-50 dark:bg-gray-800 px-1.5 py-0.5 rounded border dark:border-gray-600 font-mono" title="Won: ${item.stats.won}">
                         <span>Product: ${item.stats.count}</span>
                         <span class="text-gray-300 dark:text-gray-600">|</span>
                         <span>${item.stats.quota}</span>
                         <div class="relative w-4 h-4 ml-0.5">
                            <svg class="w-full h-full transform -rotate-90">
                                <circle cx="8" cy="8" r="${radius}" stroke="currentColor" stroke-width="1.5" fill="none" class="text-gray-200 dark:text-gray-700" />
                                <circle cx="8" cy="8" r="${radius}" stroke="currentColor" stroke-width="1.5" fill="none" class="${circleColor}" 
                                    stroke-dasharray="${circumference}" 
                                    stroke-dashoffset="${offset}" 
                                    stroke-linecap="round" />
                            </svg>
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
            <button class="btn-action-view p-1 rounded hover:bg-indigo-100 text-indigo-600 dark:hover:bg-indigo-900 dark:text-indigo-400 transition-colors" title="${t('perm_view')}">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 0 1 6 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
            </button> 
            ${item.tinh_trang !== 'Win' ? `<button class="btn-action-win p-1 rounded hover:bg-green-100 text-green-600 dark:hover:bg-green-900 dark:text-green-400 transition-colors" title="${t('col_win')}"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg></button>` : ''}
            ${item.tinh_trang !== 'Fail' ? `<button class="btn-action-fail p-1 rounded hover:bg-red-100 text-red-600 dark:hover:bg-red-900 dark:text-red-400 transition-colors" title="${t('col_fail')}"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>` : ''}
            <button class="btn-action-edit p-1 rounded hover:bg-blue-100 text-blue-600 dark:hover:bg-blue-900 dark:text-blue-400 transition-colors" title="${t('perm_edit')}">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
            </button>
            <button class="btn-action-history p-1 rounded hover:bg-yellow-100 text-yellow-600 dark:hover:bg-yellow-900 dark:text-yellow-400 transition-colors" title="Xem lịch sử">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            </button>
            ${item.tinh_trang === 'Fail' ? `
            <button class="btn-action-delete p-1 rounded hover:bg-gray-200 text-gray-500 dark:hover:bg-gray-600 dark:text-gray-400 transition-colors" title="${t('perm_delete')}">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>` : ''}
        </div>
    `;

    el.querySelector('.btn-action-view').onclick = (e) => { e.stopPropagation(); openListingModal(item, true); };
    el.querySelector('.btn-action-edit').onclick = (e) => { e.stopPropagation(); openListingModal(item, false); };
    el.querySelector('.btn-action-history').onclick = (e) => { e.stopPropagation(); viewListingHistory(item.ma_thau); };
    
    const btnDelete = el.querySelector('.btn-action-delete');
    if(btnDelete) btnDelete.onclick = (e) => { e.stopPropagation(); deleteListing(itemId); };
    
    const btnWin = el.querySelector('.btn-action-win');
    if(btnWin) btnWin.onclick = (e) => { e.stopPropagation(); handleWinTransition(item.ma_thau, item.tinh_trang); };
    const btnFail = el.querySelector('.btn-action-fail');
    if(btnFail) btnFail.onclick = (e) => { e.stopPropagation(); updateListingStatus(item.ma_thau, 'Fail'); };

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
                const maThau = itemEl.getAttribute('data-ma-thau'); // Use Ma Thau for logic

                if (newStatus !== oldStatus) {
                    if (newStatus === 'Win') {
                        // Prevent default drop by moving back visually first (logic handled by modal)
                        // Actually, SortableJS modifies DOM before onEnd. 
                        // If user cancels modal, we need to revert DOM.
                        handleWinTransition(maThau, oldStatus, itemEl, evt.from);
                    } else if (newStatus === 'Fail') {
                        // Fail Logic: Update status AND zero out won quantities
                        updateListingStatus(maThau, 'Fail');
                    } else if (newStatus === 'Waiting') {
                        // Waiting Logic: Reset sl_trung = quota
                        updateListingStatus(maThau, 'Waiting');
                    } else {
                         // Normal Move (e.g. back to Waiting)
                        updateListingStatus(maThau, newStatus);
                    }
                }
            }
        });
        sortables.push(sortable);
    });
}

// ... (Rest of material list functions unchanged) ...
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

    currentMaterials.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.className = 'bg-white dark:bg-gray-800 border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700';
        tr.innerHTML = `
            <td class="px-3 py-2">
                <input type="text" class="w-full px-2 py-1 border rounded text-xs focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${item.ma_vt || ''}" placeholder="Mã VT" onchange="window.updateMaterial(${index}, 'ma_vt', this.value)" ${readOnly ? 'disabled' : ''}>
            </td>
            <td class="px-3 py-2">
                <input type="number" class="w-full px-2 py-1 border rounded text-xs focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${item.quota || ''}" placeholder="0" onchange="window.updateMaterial(${index}, 'quota', this.value)" ${readOnly ? 'disabled' : ''}>
            </td>
            <td class="px-3 py-2">
                <input type="number" class="w-full px-2 py-1 border rounded text-xs focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" value="${item.sl_trung || ''}" placeholder="0" onchange="window.updateMaterial(${index}, 'sl_trung', this.value)" ${readOnly ? 'disabled' : ''}>
            </td>
            <td class="px-3 py-2 text-right">
                ${!readOnly ? `<button type="button" onclick="window.removeMaterial(${index})" class="text-red-500 hover:text-red-700"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>` : ''}
            </td>
        `;
        container.appendChild(tr);
    });
}

function addMaterialRow() {
    currentMaterials.push({ ma_vt: '', quota: '', sl_trung: '' });
    renderMaterialList(isReadOnlyMode);
}

window.updateMaterial = function(index, field, value) {
    if(currentMaterials[index]) {
        currentMaterials[index][field] = value;
        // Auto-fill SL Trung when Quota changes
        if (field === 'quota') {
             currentMaterials[index]['sl_trung'] = value;
             renderMaterialList(isReadOnlyMode); // Re-render to show updated value
        }
    }
}

window.removeMaterial = function(index) {
    currentMaterials.splice(index, 1);
    renderMaterialList(isReadOnlyMode);
}

// Global functions for HTML access
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
    
    // Setup Autocompletes on Open to ensure latest data
    setupAutocompletes(listingsCache);

    if (item) {
        title.textContent = readOnly ? t('nav_detail') : t('modal_edit_title');
        document.getElementById('listing-id').value = getItemId(item);
        document.getElementById('l-ma-thau').value = item.ma_thau || '';
        originalMaThau = item.ma_thau; // Store Original Ma Thau
        
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

        // Fetch existing materials from 'detail' table
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
        document.getElementById('l-status').value = currentMobileStatus || 'Waiting'; // Default to current view status
        
        // Auto set Year/Date
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

    modal.classList.remove('hidden');
};

window.closeListingModal = function() {
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

    // --- STEP 1: PREPARE DATA & CALCULATE DIFF ---
    if (originalMaThau) {
        actionType = "Cập nhật";
        
        // Fetch OLD data for comparison before updating
        const { data: listingData } = await sb.from('listing').select('*').eq('ma_thau', originalMaThau).single();
        const { data: detailData } = await sb.from('detail').select('ma_vt, quota, sl_trung').eq('ma_thau', originalMaThau);
        
        oldListing = listingData;
        oldDetails = detailData || [];

        // 1. Compare General Fields
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

            // Normalize for comparison
            if (oldVal === null) oldVal = '';
            if (newVal === null) newVal = '';
            
            // Handle Dates comparison (ignore time part differences if string format differs slightly but value is same)
            // But here both are usually YYYY-MM-DD string or null.
            if (String(oldVal) !== String(newVal)) {
                changeLog.push(`${label}: ${oldVal || '(Trống)'} -> ${newVal || '(Trống)'}`);
            }
        }

        // 2. Compare Materials (Details)
        const oldMatMap = new Map();
        oldDetails.forEach(d => oldMatMap.set(d.ma_vt, d));

        const newMatMap = new Map();
        currentMaterials.forEach(d => {
            if (d.ma_vt && d.ma_vt.trim() !== '') {
                newMatMap.set(d.ma_vt, d);
            }
        });

        // Check for Updates and Adds
        for (const [maVt, newMat] of newMatMap.entries()) {
            if (oldMatMap.has(maVt)) {
                // Check for value changes
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

        // Check for Removals
        for (const [maVt, oldMat] of oldMatMap.entries()) {
            if (!newMatMap.has(maVt)) {
                changeLog.push(`Xóa VT [${maVt}]`);
            }
        }
    } else {
        // Create Mode
        changeLog.push(`Tạo mới thầu với ${currentMaterials.length} mã vật tư.`);
    }

    // --- STEP 2: EXECUTE DB UPDATES ---

    let error;

    // 1. Save Listing (Parent)
    if (originalMaThau) {
        // Update using originalMaThau as key
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

    // 2. Sync Detail (Children)
    const targetMaThauToDelete = originalMaThau || formData.ma_thau;

    // A. Delete existing details
    const { error: delError } = await sb.from('detail').delete().eq('ma_thau', targetMaThauToDelete);
    
    if (delError) {
        showLoading(false);
        showToast('Cảnh báo: Listing đã lưu nhưng lỗi xóa chi tiết cũ: ' + delError.message, 'info');
    }

    // B. Insert new details from currentMaterials
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
    
    // --- STEP 3: LOG HISTORY ---
    if (changeLog.length > 0) {
        await logHistory(formData.ma_thau, actionType, changeLog.join('\n'));
    }

    showLoading(false);
    showToast(t('msg_update_success'), 'success');
    window.closeListingModal();
    await fetchListings();
};

async function updateListingStatus(maThau, newStatus, silent = false) {
    if (!silent) showLoading(true);
    
    const updateData = { tinh_trang: newStatus };
    const detailUpdateData = { tinh_trang: newStatus };

    let error = null;

    // 1. Update Parent Listing
    const { error: listingError } = await sb.from('listing').update(updateData).eq('ma_thau', maThau); 
    
    if (listingError) {
         error = listingError;
    } else {
        // 2. Update Details logic
        if (newStatus === 'Fail') {
             // FAIL LOGIC: Reset SL Trúng to 0
             detailUpdateData.sl_trung = 0;
             const { error: detError } = await sb.from('detail').update(detailUpdateData).eq('ma_thau', maThau);
             if(detError) error = detError;
        } else if (newStatus === 'Waiting') {
             // WAITING LOGIC: Reset SL Trúng = Quota
             // Need to fetch details first, update sl_trung, and upsert/update
             const { data: details, error: fetchError } = await sb.from('detail').select('*').eq('ma_thau', maThau);
             if (fetchError) {
                 error = fetchError;
             } else if (details && details.length > 0) {
                 // Prepare updates: set sl_trung to quota
                 const updates = details.map(d => ({
                     ...d,
                     tinh_trang: newStatus,
                     sl_trung: d.quota
                 }));
                 // Use Upsert to update all rows
                 const { error: upsertError } = await sb.from('detail').upsert(updates);
                 if(upsertError) error = upsertError;
             }
        } else {
             // Normal status update (no special quantity logic)
             const { error: detError } = await sb.from('detail').update(detailUpdateData).eq('ma_thau', maThau);
             if(detError) error = detError;
        }
    }
    
    if (!silent) showLoading(false);
    
    if (error) {
         if(!silent) showToast('Cập nhật thất bại: ' + error.message, 'error');
         await fetchListings(); // Revert UI
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
        
        // Get ma_thau to delete details
        // id passed is likely ma_thau
        const item = listingsCache.find(i => i.id == id || i.ma_thau == id);
        const targetMaThau = item ? item.ma_thau : id;
        
        // Delete Listing
        const { error } = await sb.from('listing').delete().eq('ma_thau', targetMaThau);
        
        if (!error) {
            // Delete related Details
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

// === WIN TRANSITION LOGIC ===

async function handleWinTransition(maThau, fromStatus, domItem = null, domFromContainer = null) {
    // 1. If dragging, we temporarily visually revert or keep it there but don't save DB yet.
    // Ideally, SortableJS has moved the DOM. If user cancels, we must revert DOM.
    // We store references to handle cancel.
    winTransitionListingId = maThau;
    winTransitionOriginalStatus = fromStatus;
    
    // 2. Fetch current details to populate modal
    showLoading(true);
    const { data: details, error } = await sb.from('detail').select('ma_vt, quota, sl_trung').eq('ma_thau', maThau);
    const { data: listingData } = await sb.from('listing').select('ngay_ky, ngay_ket_thuc').eq('ma_thau', maThau).single();
    showLoading(false);

    if (error) {
        showToast("Lỗi tải chi tiết: " + error.message, 'error');
        if(domItem && domFromContainer) domFromContainer.appendChild(domItem); // Revert drag
        return;
    }

    winTransitionMaterials = details || [];
    
    // 3. Populate Win Modal
    const modal = document.getElementById('win-transition-modal');
    document.getElementById('win-ngay-ky').value = listingData?.ngay_ky || '';
    document.getElementById('win-ngay-kt').value = listingData?.ngay_ket_thuc || '';
    
    // Default to Full Win
    const radioFull = document.querySelector('input[name="win-type"][value="full"]');
    if(radioFull) radioFull.checked = true;
    document.getElementById('win-material-section').classList.add('hidden');
    
    renderWinMaterialList();
    
    modal.classList.remove('hidden');
}

function renderWinMaterialList() {
    const container = document.getElementById('win-material-list');
    container.innerHTML = '';
    
    winTransitionMaterials.forEach((item, idx) => {
        const tr = document.createElement('tr');
        tr.className = "bg-white dark:bg-gray-800 border-b dark:border-gray-700";
        tr.innerHTML = `
            <td class="px-3 py-2 text-xs font-mono">${item.ma_vt}</td>
            <td class="px-3 py-2 text-xs">${item.quota}</td>
            <td class="px-3 py-2">
                 <input type="number" class="w-full px-2 py-1 border rounded text-xs focus:ring-1 focus:ring-green-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" 
                 value="${item.sl_trung || item.quota}" 
                 onchange="window.updateWinMaterial(${idx}, this.value)">
            </td>
        `;
        container.appendChild(tr);
    });
}

window.updateWinMaterial = function(idx, val) {
    if (winTransitionMaterials[idx]) {
        winTransitionMaterials[idx].sl_trung = val;
    }
}

function cancelWinTransition() {
    document.getElementById('win-transition-modal').classList.add('hidden');
    fetchListings(); // Refresh board to revert any drag visual changes
}

async function saveWinTransition() {
    const ngayKy = document.getElementById('win-ngay-ky').value;
    const ngayKt = document.getElementById('win-ngay-kt').value;
    
    if (!ngayKy || !ngayKt) {
        showToast("Vui lòng điền đầy đủ Ngày Ký và Ngày Kết Thúc.", "error");
        return;
    }

    const winType = document.querySelector('input[name="win-type"]:checked').value;
    
    showLoading(true);

    // 1. Update Listing Status & Dates
    const { error: listingError } = await sb.from('listing').update({
        tinh_trang: 'Win',
        ngay_ky: ngayKy,
        ngay_ket_thuc: ngayKt
    }).eq('ma_thau', winTransitionListingId);

    if (listingError) {
        showLoading(false);
        showToast("Lỗi cập nhật thầu: " + listingError.message, "error");
        return;
    }

    // 2. Update Details (Status, Dates, SL Trúng)
    // We need to update row by row or delete/insert. Since we have specific SL Trúng values, we iterate.
    // A simpler way: Fetch existing rows to get IDs, then update.
    // Or just Delete & Re-insert details? No, that changes IDs.
    // Let's use Upsert or sequential Update.
    // Strategy: Delete old, Insert new with same common data but updated SL Trúng.
    // Fetch full common data first to ensure we don't lose it.
    
    const { data: currentListingData } = await sb.from('listing').select('*').eq('ma_thau', winTransitionListingId).single();
    
    // Delete old Details
    await sb.from('detail').delete().eq('ma_thau', winTransitionListingId);
    
    // Prepare New Details
    const newDetails = winTransitionMaterials.map(m => {
        let finalSlTrung = m.quota; // Default Full
        if (winType === 'partial') {
            finalSlTrung = m.sl_trung;
        }

        return {
            id: Math.floor(Math.random() * 2000000000), // New Random ID
            ma_thau: winTransitionListingId,
            nam: currentListingData.nam,
            benh_vien: currentListingData.benh_vien,
            tinh: currentListingData.tinh,
            khu_vuc: currentListingData.khu_vuc,
            nha_phan_phoi: currentListingData.nha_phan_phoi,
            ngay: currentListingData.ngay,
            loai: currentListingData.loai,
            tinh_trang: 'Win',
            ngay_ky: ngayKy,
            ngay_ket_thuc: ngayKt,
            nganh: currentListingData.nganh,
            psr: currentListingData.psr,
            quan_ly: currentListingData.quan_ly,
            ma_vt: m.ma_vt,
            quota: m.quota,
            sl_trung: finalSlTrung
        };
    });
    
    if (newDetails.length > 0) {
        const { error: detailError } = await sb.from('detail').insert(newDetails);
        if(detailError) console.error("Detail update error", detailError);
    }
    
    // Log History
    await logHistory(winTransitionListingId, "Win (Thắng thầu)", `Thắng thầu loại: ${winType === 'full' ? 'Toàn phần' : 'Một phần'}. Ngày ký: ${ngayKy}.`);

    showLoading(false);
    document.getElementById('win-transition-modal').classList.add('hidden');
    showToast("Thắng thầu thành công!", "success");
    await fetchListings();
}

// File Handling logic
function handleFileUpload(files) {
    if (!files || files.length === 0) return;
    
    Array.from(files).forEach(file => {
        // Mock upload logic for UI demo - In real app, upload to Storage here
        const mockUrl = URL.createObjectURL(file);
        currentFiles.push({
            name: file.name,
            url: mockUrl, // Temporary blob URL
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

function initDraggableModal() {
    const modal = document.getElementById('listing-modal-content');
    const header = document.getElementById('listing-modal-header');
    
    if(!modal || !header) return;

    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    header.onmousedown = (e) => {
        if(window.innerWidth < 768) return; // Disable drag on mobile
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        const rect = modal.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        
        // Remove transform centering to allow absolute positioning
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

    // Resizable logic
    const resizer = document.getElementById('modal-resize-handle');
    if(resizer) {
        resizer.onmousedown = (e) => {
            e.stopPropagation(); // Prevent drag
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
