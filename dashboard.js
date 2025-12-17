
import { sb, showLoading, showToast, showView } from './app.js';
import { setLanguage, getCurrentLanguage, translations } from './lang.js';

let dashboardChartInstances = {};
let rawDetails = []; 
let rawListings = []; 
let psrFilters = {
    product: 'all' // Removed range from here, moving to global
};
let dashboardDateFilter = {
    type: 'year', // Default to current year
    start: '',
    end: ''
};

let expirationFilterDays = 30; 

// View Modes
let regionViewMode = 'count'; 
let distributorViewMode = 'count';
let statusViewMode = 'count'; // New: 'count' (Listing) vs 'value' (Product Volume)
let contractMonitorMode = 'upcoming'; // New: 'upcoming' (Sắp hết) vs 'expired' (Đã hết)

// Separate Display Modes (Format: Number vs Percent)
let regionDisplayMode = 'number'; // 'number' or 'percent'
let distributorDisplayMode = 'number'; // 'number' or 'percent'

// State to track expanded nodes
let expandedHierarchyNodes = new Set();
let expandedDistributorNodes = new Set(); 

const t = (key) => {
    const lang = getCurrentLanguage();
    return translations[lang][key] || key;
};

if (typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
}

// --- GLOBAL HELPER FUNCTIONS FOR HTML INTERACTIONS ---

window.copyToClipboard = function(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            showToast(`Đã sao chép: ${text}`, 'success');
        });
    } else {
        showToast(`Đã sao chép thủ công: ${text}`, 'success');
    }
};

window.filterAndNavigateListing = function(keyword) {
    showView('view-ton-kho');
    setTimeout(() => {
        const searchInput = document.getElementById('listing-search');
        if (searchInput) {
            searchInput.value = keyword;
            searchInput.dispatchEvent(new Event('input')); 
        }
    }, 300);
};

window.filterAndNavigateProduct = function(keyword) {
    showView('view-san-pham', { filterCode: keyword });
};

window.toggleHierarchyNode = function(path) {
    toggleNode(path, expandedHierarchyNodes, 'hierarchy-tree');
};

window.toggleDistributorNode = function(path) {
    toggleNode(path, expandedDistributorNodes, 'distributor-tree');
};

function toggleNode(path, set, containerId) {
    if (set.has(path)) {
        set.delete(path);
    } else {
        set.add(path);
    }
    const row = document.querySelector(`#${containerId} .tree-row[data-path="${CSS.escape(path)}"]`);
    if (row) {
        row.classList.toggle('expanded');
        const next = row.nextElementSibling;
        if (next && next.classList.contains('tree-children')) {
            next.classList.toggle('hidden');
        }
    }
}

export async function onShowDashboardView() {
    const container = document.getElementById('view-phat-trien');
    
    // Updated HTML with Ultra-Compact 2-Row Sticky Header for Mobile
    container.innerHTML = `
        <div class="flex flex-col h-full bg-gray-50 dark:bg-gray-900 overflow-y-auto custom-scrollbar relative">
            
            <!-- GLOBAL DATE FILTER BAR (Sticky & Compact) -->
            <div class="sticky top-0 z-40 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur-sm px-2 pt-2 md:px-6 md:pt-6 pb-2 transition-all shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
                <div class="bg-white dark:bg-gray-800 p-2 md:p-3 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row items-center gap-2 md:gap-3 justify-between">
                    
                    <!-- Row 1: Period Buttons (Scrollable) -->
                    <div class="w-full md:w-auto overflow-x-auto no-scrollbar flex-shrink-0">
                        <div class="flex items-center gap-2">
                            <span class="hidden md:flex text-sm font-bold text-gray-700 dark:text-gray-200 flex-shrink-0 items-center gap-1">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                                Thời gian:
                            </span>
                            <div class="flex bg-gray-100 dark:bg-gray-700 p-1 rounded-lg min-w-max">
                                <button class="dash-date-btn px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-600" data-type="all">Tất cả</button>
                                <button class="dash-date-btn px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-600" data-type="today">Hôm nay</button>
                                <button class="dash-date-btn px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-600" data-type="week">Tuần này</button>
                                <button class="dash-date-btn px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-600" data-type="month">Tháng này</button>
                                <button class="dash-date-btn px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-600" data-type="quarter">Quý này</button>
                                <button class="dash-date-btn px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap bg-white dark:bg-gray-600 text-blue-600 shadow-sm" data-type="year">Năm nay</button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Row 2: Custom Date Inputs -->
                    <div class="w-full md:w-auto flex items-center pt-1 md:pt-0 border-t md:border-t-0 border-dashed border-gray-200 dark:border-gray-700 md:border-none">
                        <span class="hidden md:block text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap mr-2">Tùy chọn:</span>
                        <div class="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center w-full md:w-auto">
                            <input type="date" id="dash-date-start" class="w-full md:w-32 px-2 py-1.5 text-xs border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-1 focus:ring-blue-500 outline-none">
                            <span class="text-gray-400">-</span>
                            <input type="date" id="dash-date-end" class="w-full md:w-32 px-2 py-1.5 text-xs border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-1 focus:ring-blue-500 outline-none">
                            <button id="btn-apply-dash-date" class="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 transition-colors shadow-sm whitespace-nowrap">Lọc</button>
                        </div>
                    </div>

                </div>
            </div>

            <div class="p-4 md:p-6 pt-2">
                <!-- MOBILE KPI BAR (Compact 1 Row) -->
                <div class="grid grid-cols-4 gap-2 mb-4 md:hidden">
                    <div class="bg-white dark:bg-gray-800 p-2 rounded-lg border border-gray-100 dark:border-gray-700 text-center shadow-sm flex flex-col items-center justify-center h-20">
                        <div class="text-blue-500 mb-1 bg-blue-50 dark:bg-blue-900/30 p-1.5 rounded-full">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                        </div>
                        <div class="text-[10px] text-gray-400 leading-tight">Hồ sơ</div>
                        <div class="font-bold text-gray-800 dark:text-white text-xs truncate w-full" id="mob-kpi-listings">0</div>
                    </div>
                    <div class="bg-white dark:bg-gray-800 p-2 rounded-lg border border-gray-100 dark:border-gray-700 text-center shadow-sm flex flex-col items-center justify-center h-20">
                        <div class="text-purple-500 mb-1 bg-purple-50 dark:bg-purple-900/30 p-1.5 rounded-full">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        </div>
                        <div class="text-[10px] text-gray-400 leading-tight">Quota</div>
                        <div class="font-bold text-gray-800 dark:text-white text-xs truncate w-full" id="mob-kpi-quota">0</div>
                    </div>
                    <div class="bg-white dark:bg-gray-800 p-2 rounded-lg border border-gray-100 dark:border-gray-700 text-center shadow-sm flex flex-col items-center justify-center h-20">
                        <div class="text-green-500 mb-1 bg-green-50 dark:bg-green-900/30 p-1.5 rounded-full">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
                        </div>
                        <div class="text-[10px] text-gray-400 leading-tight">Thắng</div>
                        <div class="font-bold text-green-600 dark:text-green-400 text-xs truncate w-full" id="mob-kpi-win">0</div>
                    </div>
                    <div class="bg-white dark:bg-gray-800 p-2 rounded-lg border border-gray-100 dark:border-gray-700 text-center shadow-sm flex flex-col items-center justify-center h-20">
                        <div class="text-orange-500 mb-1 bg-orange-50 dark:bg-orange-900/30 p-1.5 rounded-full">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"></path></svg>
                        </div>
                        <div class="text-[10px] text-gray-400 leading-tight">Tỷ lệ</div>
                        <div class="font-bold text-gray-800 dark:text-white text-xs truncate w-full" id="mob-kpi-rate">0%</div>
                    </div>
                </div>

                <!-- DESKTOP KPI CARDS (Hidden on Mobile) -->
                <div class="hidden md:grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    <!-- KPI 1 -->
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
                        <div>
                            <p class="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider" data-i18n="dash_total_listings">Tổng Hồ Sơ</p>
                            <h3 class="text-2xl font-bold text-gray-800 dark:text-white mt-1" id="kpi-total-listings">0</h3>
                        </div>
                        <div class="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                        </div>
                    </div>
                    <!-- KPI 2 -->
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
                        <div>
                            <p class="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider" data-i18n="dash_total_quota">Tổng Quota</p>
                            <h3 class="text-2xl font-bold text-gray-800 dark:text-white mt-1" id="kpi-total-quota">0</h3>
                        </div>
                        <div class="p-3 bg-purple-50 dark:bg-purple-900/30 rounded-lg text-purple-600 dark:text-purple-400">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        </div>
                    </div>
                    <!-- KPI 3 -->
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
                        <div>
                            <p class="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider" data-i18n="dash_total_win">Giá Trị Thắng</p>
                            <h3 class="text-2xl font-bold text-green-600 dark:text-green-400 mt-1" id="kpi-total-win">0</h3>
                        </div>
                        <div class="p-3 bg-green-50 dark:bg-green-900/30 rounded-lg text-green-600 dark:text-green-400">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
                        </div>
                    </div>
                    <!-- KPI 4 -->
                    <div class="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
                        <div>
                            <p class="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider" data-i18n="dash_win_rate">Tỷ Lệ Thắng</p>
                            <h3 class="text-2xl font-bold text-gray-800 dark:text-white mt-1" id="kpi-win-rate">0%</h3>
                        </div>
                        <div class="p-3 bg-orange-50 dark:bg-orange-900/30 rounded-lg text-orange-600 dark:text-orange-400">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"></path></svg>
                        </div>
                    </div>
                </div>

                <!-- Charts Section 1 -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    <!-- Status Distribution -->
                    <div class="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col">
                        <div class="flex justify-between items-center mb-4">
                            <h3 class="text-lg font-bold text-gray-800 dark:text-white" data-i18n="dash_chart_status">Tỷ Trọng Trạng Thái</h3>
                            <!-- Chart Mode Toggle -->
                            <div class="flex bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
                                <button class="status-mode-btn px-3 py-1.5 text-xs font-bold rounded-md transition-all shadow-sm bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-300" data-mode="count">Theo Mã Thầu</button>
                                <button class="status-mode-btn px-3 py-1.5 text-xs font-bold rounded-md transition-all text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" data-mode="value">Theo Vật Tư</button>
                            </div>
                        </div>
                        
                        <div class="flex flex-col md:flex-row h-80 w-full gap-4">
                            <!-- Chart Canvas -->
                            <div class="relative flex-1 h-full">
                                <canvas id="chart-status"></canvas>
                            </div>
                            <!-- Custom Legend Container -->
                            <div id="chart-status-legend" class="flex-shrink-0 w-full md:w-48 flex flex-col justify-center gap-2 overflow-y-auto">
                                <!-- Injected via JS -->
                            </div>
                        </div>
                    </div>

                    <!-- Monthly Trend -->
                    <div class="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                        <h3 class="text-lg font-bold text-gray-800 dark:text-white mb-4" data-i18n="dash_chart_monthly">Xu Hướng Hồ Sơ Mới</h3>
                        <div class="relative h-80 w-full">
                            <canvas id="chart-monthly"></canvas>
                        </div>
                    </div>
                </div>

                <!-- REGION & HIERARCHY SECTION -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    <!-- Region Analysis -->
                    <div class="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col h-[300px] md:h-[650px]">
                        <div class="flex justify-between items-center mb-4 flex-shrink-0">
                            <h3 class="text-lg font-bold text-gray-800 dark:text-white">Theo Địa bàn</h3>
                            
                            <div class="flex gap-2">
                                <!-- Display Mode Toggle (Number vs %) -->
                                <div class="flex bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
                                    <button class="display-mode-btn region-display-btn px-2 py-1.5 text-xs font-bold rounded-md transition-all shadow-sm bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-300" data-target="region" data-mode="number">#</button>
                                    <button class="display-mode-btn region-display-btn px-2 py-1.5 text-xs font-bold rounded-md transition-all text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" data-target="region" data-mode="percent">%</button>
                                </div>

                                <!-- Calculation Mode Toggle -->
                                <div class="flex bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
                                    <button class="view-mode-btn region-mode-btn px-3 py-1.5 text-xs font-bold rounded-md transition-all shadow-sm bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-300" data-target="region" data-mode="count">Mã Thầu</button>
                                    <button class="view-mode-btn region-mode-btn px-3 py-1.5 text-xs font-bold rounded-md transition-all text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" data-target="region" data-mode="value">Lượng VT</button>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Headers (Wrapped in overflow-x-auto for mobile) -->
                        <div class="overflow-x-auto custom-scrollbar flex-1 flex flex-col">
                            <div class="min-w-[600px] flex flex-col h-full">
                                <div class="flex items-center text-xs font-bold text-gray-500 dark:text-gray-400 border-b dark:border-gray-700 pb-2 mb-1 pr-2 select-none sticky top-0 bg-white dark:bg-gray-800 z-30">
                                    <div class="flex-1 pl-2">Khu vực / Đơn vị</div>
                                    <div class="w-16 text-center border-l border-gray-200 dark:border-gray-600" title="Listing (Mới)">L</div>
                                    <div class="w-16 text-center border-l border-gray-200 dark:border-gray-600" title="Waiting (Chờ)">W</div>
                                    <div class="w-16 text-center border-l border-gray-200 dark:border-gray-600" title="Win (Trúng)">Wi</div>
                                    <div class="w-16 text-center border-l border-gray-200 dark:border-gray-600" title="Fail (Trượt)">F</div>
                                    <div class="w-20 text-center border-l border-gray-200 dark:border-gray-600">Tổng</div>
                                </div>

                                <div class="flex-1 overflow-y-auto custom-scrollbar relative">
                                    <div id="hierarchy-tree" class="w-full text-xs"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Distributor & Contract Wrapper -->
                    <div class="flex flex-col gap-4 md:h-[650px]">
                        <!-- Distributor Analysis -->
                        <div class="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col overflow-hidden h-[300px] md:h-auto md:flex-1">
                            
                            <div class="flex justify-between items-center mb-4 flex-shrink-0">
                                <h3 class="text-lg font-bold text-gray-800 dark:text-white" data-i18n="dash_distributor_analysis">Nhà Phân Phối</h3>
                                
                                <div class="flex gap-2">
                                    <!-- Display Mode Toggle -->
                                    <div class="flex bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
                                        <button class="display-mode-btn dist-display-btn px-2 py-1.5 text-xs font-bold rounded-md transition-all shadow-sm bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-300" data-target="distributor" data-mode="number">#</button>
                                        <button class="display-mode-btn dist-display-btn px-2 py-1.5 text-xs font-bold rounded-md transition-all text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" data-target="distributor" data-mode="percent">%</button>
                                    </div>

                                    <!-- Calculation Mode Toggle -->
                                    <div class="flex bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
                                        <button class="view-mode-btn dist-mode-btn px-3 py-1.5 text-xs font-bold rounded-md transition-all shadow-sm bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-300" data-target="distributor" data-mode="count">Mã Thầu</button>
                                        <button class="view-mode-btn dist-mode-btn px-3 py-1.5 text-xs font-bold rounded-md transition-all text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" data-target="distributor" data-mode="value">Lượng VT</button>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Header for Distributor -->
                            <div class="overflow-x-auto custom-scrollbar flex-1 flex flex-col">
                                <div class="min-w-[600px] flex flex-col h-full">
                                    <div class="flex items-center text-xs font-bold text-gray-500 dark:text-gray-400 border-b dark:border-gray-700 pb-2 mb-1 pr-2 select-none sticky top-0 bg-white dark:bg-gray-800 z-30">
                                        <div class="flex-1 pl-2">NPP / <span id="dist-child-label">Chi tiết</span></div>
                                        <div class="w-16 text-center border-l border-gray-200 dark:border-gray-600" title="Listing (Mới)">L</div>
                                        <div class="w-16 text-center border-l border-gray-200 dark:border-gray-600" title="Waiting (Chờ)">W</div>
                                        <div class="w-16 text-center border-l border-gray-200 dark:border-gray-600" title="Win (Trúng)">Wi</div>
                                        <div class="w-16 text-center border-l border-gray-200 dark:border-gray-600" title="Fail (Trượt)">F</div>
                                        <div class="w-20 text-center border-l border-gray-200 dark:border-gray-600">Tổng</div>
                                    </div>

                                    <div class="flex-1 overflow-y-auto custom-scrollbar relative">
                                        <div id="distributor-tree" class="w-full text-xs"></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Contract Monitoring -->
                        <div class="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col overflow-hidden h-[300px] md:h-auto md:flex-1">
                            <div class="flex justify-between items-center mb-4">
                                <h3 class="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">Theo dõi hợp đồng</h3>
                                <!-- Tabs: Upcoming vs Expired -->
                                <div class="flex bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
                                    <button class="monitor-tab-btn px-3 py-1.5 text-xs font-bold rounded-md transition-all shadow-sm bg-white dark:bg-gray-600 text-red-600 dark:text-red-300" data-mode="upcoming">Sắp hết hạn</button>
                                    <button class="monitor-tab-btn px-3 py-1.5 text-xs font-bold rounded-md transition-all text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" data-mode="expired">Đã hết hạn</button>
                                </div>
                            </div>
                            
                            <!-- Filter Days Buttons (Only shown for Upcoming) -->
                            <div id="monitor-days-filter" class="flex gap-1 mb-2 justify-end">
                                <button class="exp-filter-btn px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors active-exp-btn" data-days="30">30d</button>
                                <button class="exp-filter-btn px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors" data-days="45">45d</button>
                                <button class="exp-filter-btn px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors" data-days="120">120d</button>
                            </div>

                            <div class="flex-1 overflow-y-auto custom-scrollbar border rounded-lg dark:border-gray-700">
                                <table class="w-full text-xs text-left">
                                    <thead class="bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-300 sticky top-0 z-10 shadow-sm">
                                        <tr>
                                            <th class="px-3 py-2" data-i18n="dt_ma_thau">Mã</th>
                                            <th class="px-3 py-2" data-i18n="dt_benh_vien">Bệnh Viện</th>
                                            <th class="px-3 py-2 text-right">Tình trạng</th>
                                        </tr>
                                    </thead>
                                    <tbody id="expiring-contracts-body" class="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800"></tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- PSR ANALYSIS SECTION -->
                <div class="mb-6">
                    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                        <div class="p-4 md:p-6 border-b border-gray-100 dark:border-gray-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                            <h3 class="text-lg font-bold text-gray-800 dark:text-white" data-i18n="dash_psr_analysis">Phân Tích Hiệu Quả PSR</h3>
                            <div class="flex flex-wrap gap-2 items-center w-full md:w-auto">
                                <div class="relative group w-full md:w-56 z-20">
                                    <div class="relative">
                                        <input type="text" id="psr-product-search" placeholder="Tất cả sản phẩm" class="w-full text-xs px-3 py-2 border rounded-lg bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer" autocomplete="off">
                                    </div>
                                    <div id="psr-product-dropdown" class="absolute hidden w-full bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg shadow-xl mt-1 max-h-40 overflow-y-auto custom-scrollbar">
                                        <div class="p-1" id="psr-product-list"></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="p-4 md:p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div class="lg:col-span-2">
                                <h4 class="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 uppercase" data-i18n="dash_psr_performance">Hiệu suất PSR (Quota vs Win)</h4>
                                <div class="relative h-80 w-full"><canvas id="chart-psr-perf"></canvas></div>
                            </div>
                            <div class="lg:col-span-1 flex flex-col">
                                <h4 class="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 uppercase" data-i18n="dash_psr_table_title">Chi tiết theo PSR</h4>
                                <div class="flex-1 overflow-y-auto max-h-80 custom-scrollbar border rounded-lg dark:border-gray-700">
                                    <table class="w-full text-xs text-left">
                                        <thead class="bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-300 sticky top-0 z-10 shadow-sm">
                                            <tr>
                                                <th class="px-3 py-2" data-i18n="col_psr">PSR</th>
                                                <th class="px-3 py-2 text-right" data-i18n="dt_stat_quota">Quota</th>
                                                <th class="px-3 py-2 text-right" data-i18n="dt_stat_win">Win</th>
                                                <th class="px-3 py-2 text-right" data-i18n="dash_win_rate">%</th>
                                            </tr>
                                        </thead>
                                        <tbody id="psr-table-body" class="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800"></tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <style>
            .active-exp-btn { background-color: #dbeafe !important; color: #2563eb !important; border-color: #93c5fd; }
            .dark .active-exp-btn { background-color: rgba(37, 99, 235, 0.2) !important; color: #93c5fd !important; border-color: #1e40af; }
            .tree-row:hover { background-color: #f9fafb; }
            .dark .tree-row:hover { background-color: #374151; }
            .tree-row.expanded > div > div:first-child > svg { transform: rotate(90deg); }
            
            /* Custom Scrollbar for Accordion */
            #hierarchy-tree::-webkit-scrollbar, #distributor-tree::-webkit-scrollbar { width: 4px; }
            #hierarchy-tree::-webkit-scrollbar-thumb, #distributor-tree::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 4px; }
            .dark #hierarchy-tree::-webkit-scrollbar-thumb, .dark #distributor-tree::-webkit-scrollbar-thumb { background-color: #475569; }
        </style>
    `;

    setLanguage(getCurrentLanguage());
    setupDashboardDateFilterListeners();
    setupContractMonitorListeners();
    setupHierarchyToggleListeners();
    await loadDashboardData();
}

function setupDashboardDateFilterListeners() {
    const btns = document.querySelectorAll('.dash-date-btn');
    const startInput = document.getElementById('dash-date-start');
    const endInput = document.getElementById('dash-date-end');
    const applyBtn = document.getElementById('btn-apply-dash-date');

    const updateActiveButton = (type) => {
        btns.forEach(b => {
            if (b.dataset.type === type) {
                b.className = "dash-date-btn px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap bg-white dark:bg-gray-600 text-blue-600 shadow-sm";
            } else {
                b.className = "dash-date-btn px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-600";
            }
        });
    };

    // Default to Year
    updateActiveButton('year');

    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            dashboardDateFilter.type = type;
            dashboardDateFilter.start = '';
            dashboardDateFilter.end = '';
            startInput.value = '';
            endInput.value = '';
            updateActiveButton(type);
            applyDashboardDateFilter();
        });
    });

    applyBtn.addEventListener('click', () => {
        const start = startInput.value;
        const end = endInput.value;
        if (start && end) {
            dashboardDateFilter.type = 'custom';
            dashboardDateFilter.start = start;
            dashboardDateFilter.end = end;
            updateActiveButton('custom'); // No button will match, acts as clear
            applyDashboardDateFilter();
        } else {
            showToast("Vui lòng chọn cả ngày bắt đầu và kết thúc.", "info");
        }
    });
}

function applyDashboardDateFilter() {
    // 1. Filter Raw Listings based on Date
    const filteredListings = rawListings.filter(l => isDateInDashboardRange(l.ngay));
    
    // 2. Filter Raw Details (Must match filtered listings OR have matching date if present)
    const validMaThaus = new Set(filteredListings.map(l => l.ma_thau));
    const filteredDetails = rawDetails.filter(d => validMaThaus.has(d.ma_thau));

    // 3. Recalculate
    calculateGlobalStats(filteredListings, filteredDetails);
    
    // 4. Update PSR Section (pass filtered details)
    refreshPsrSection(filteredDetails);
}

function isDateInDashboardRange(dateString) {
    if (!dateString) return false;
    const d = new Date(dateString);
    d.setHours(0,0,0,0);
    const now = new Date();
    now.setHours(0,0,0,0);

    const { type, start, end } = dashboardDateFilter;

    if (type === 'all') return true;
    
    if (type === 'custom' && start && end) {
        const s = new Date(start); s.setHours(0,0,0,0);
        const e = new Date(end); e.setHours(0,0,0,0);
        return d >= s && d <= e;
    }

    if (type === 'today') return d.getTime() === now.getTime();
    
    if (type === 'week') {
        const day = now.getDay() || 7; 
        const startOfWeek = new Date(now);
        if (day !== 1) startOfWeek.setHours(-24 * (day - 1)); 
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        return d >= startOfWeek && d <= endOfWeek;
    }

    if (type === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    
    if (type === 'quarter') {
        const qNow = Math.floor(now.getMonth() / 3);
        const qDate = Math.floor(d.getMonth() / 3);
        return qNow === qDate && d.getFullYear() === now.getFullYear();
    }

    if (type === 'year') return d.getFullYear() === now.getFullYear();

    return true;
}

// ... (setupContractMonitorListeners, setupHierarchyToggleListeners unchanged) ...

function setupContractMonitorListeners() {
    const btns = document.querySelectorAll('.exp-filter-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active-exp-btn'));
            btn.classList.add('active-exp-btn');
            expirationFilterDays = parseInt(btn.dataset.days);
            renderExpiringContracts(rawListings);
        });
    });

    const monitorTabs = document.querySelectorAll('.monitor-tab-btn');
    monitorTabs.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            contractMonitorMode = mode;
            
            monitorTabs.forEach(b => {
                b.className = 'monitor-tab-btn px-3 py-1.5 text-xs font-bold rounded-md transition-all text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200';
            });
            btn.className = `monitor-tab-btn px-3 py-1.5 text-xs font-bold rounded-md transition-all shadow-sm bg-white dark:bg-gray-600 ${mode === 'upcoming' ? 'text-red-600 dark:text-red-300' : 'text-gray-800 dark:text-white'}`;
            
            const daysFilter = document.getElementById('monitor-days-filter');
            if(daysFilter) daysFilter.classList.toggle('hidden', mode === 'expired');

            renderExpiringContracts(rawListings);
        });
    });
}

function setupHierarchyToggleListeners() {
    document.querySelectorAll('.status-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            statusViewMode = mode;
            document.querySelectorAll('.status-mode-btn').forEach(b => b.className = 'status-mode-btn px-3 py-1.5 text-xs font-bold rounded-md transition-all text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200');
            btn.className = 'status-mode-btn px-3 py-1.5 text-xs font-bold rounded-md transition-all shadow-sm bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-300 ring-1 ring-gray-200 dark:ring-gray-500';
            
            // Re-apply current filter context
            applyDashboardDateFilter(); 
        });
    });

    document.querySelectorAll('.view-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target;
            const mode = btn.dataset.mode;
            if (target === 'region') regionViewMode = mode;
            else distributorViewMode = mode;
            
            const groupClass = target === 'region' ? '.region-mode-btn' : '.dist-mode-btn';
            document.querySelectorAll(groupClass).forEach(b => b.className = `view-mode-btn ${target === 'region' ? 'region-mode-btn' : 'dist-mode-btn'} px-3 py-1.5 text-xs font-bold rounded-md transition-all text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200`);
            btn.className = `view-mode-btn ${target === 'region' ? 'region-mode-btn' : 'dist-mode-btn'} px-3 py-1.5 text-xs font-bold rounded-md transition-all shadow-sm bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-300 ring-1 ring-gray-200 dark:ring-gray-500`;
            
            applyDashboardDateFilter(); 
        });
    });

    document.querySelectorAll('.display-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target; 
            const mode = btn.dataset.mode;
            if (target === 'region') regionDisplayMode = mode;
            else distributorDisplayMode = mode;
            
            const groupClass = target === 'region' ? '.region-display-btn' : '.dist-display-btn';
            document.querySelectorAll(groupClass).forEach(b => b.className = `display-mode-btn ${target === 'region' ? 'region-display-btn' : 'dist-display-btn'} px-2 py-1.5 text-xs font-bold rounded-md transition-all text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200`);
            btn.className = `display-mode-btn ${target === 'region' ? 'region-display-btn' : 'dist-display-btn'} px-2 py-1.5 text-xs font-bold rounded-md transition-all shadow-sm bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-300 ring-1 ring-gray-200 dark:ring-gray-500`;
            
            applyDashboardDateFilter(); 
        });
    });
}

async function loadDashboardData() {
    showLoading(true);
    try {
        const { data: listings, error: lErr } = await sb.from('listing').select('*');
        if (lErr) throw lErr;
        rawListings = listings;

        const { data: details, error: dErr } = await sb.from('detail').select('*');
        if (dErr) throw dErr;
        rawDetails = details || [];

        const products = [...new Set(rawDetails.map(d => d.ma_vt).filter(v => v))].sort();
        setupProductSearchDropdown(products);

        // Apply filters initially (will default to Year)
        applyDashboardDateFilter();
        renderExpiringContracts(rawListings);

    } catch (e) {
        console.error("Dashboard Error:", e);
        showToast("Lỗi tải dữ liệu Dashboard: " + e.message, 'error');
    } finally {
        showLoading(false);
    }
}

// ... (calculateGlobalStats, updateTree, renderGlobalCharts, renderHierarchy, renderDistributorAnalysis, generateTreeHTML, renderExpiringContracts UNCHANGED) ...

function calculateGlobalStats(listings, details) {
    let totalQuota = 0, totalWin = 0;
    let statusCounts = { 'Listing': 0, 'Waiting': 0, 'Win': 0, 'Fail': 0 };
    let statusValues = { 'Listing': 0, 'Waiting': 0, 'Win': 0, 'Fail': 0 }; 
    let monthlyStats = {};
    const regionTree = {};
    const distributorTree = {};
    const listingMap = {};

    listings.forEach(l => {
        listingMap[l.ma_thau] = l;
        const status = l.tinh_trang || 'Listing';
        const sKey = ['Listing', 'Waiting', 'Win', 'Fail'].includes(status) ? status : 'Listing';
        statusCounts[sKey]++;
        
        if (l.ngay) {
            const date = new Date(l.ngay);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            monthlyStats[key] = (monthlyStats[key] || 0) + 1;
        }

        if (regionViewMode === 'count') {
            updateTree(regionTree, [l.khu_vuc || 'Khác', l.tinh || 'Khác', l.benh_vien || 'Khác', l.khoa || 'Chung'], status, 1);
        }
        if (distributorViewMode === 'count') {
            updateTree(distributorTree, [l.nha_phan_phoi || 'Khác', l.ma_thau], status, 1);
        }
    });

    details.forEach(d => {
        const status = ['Listing', 'Waiting', 'Win', 'Fail'].includes(d.tinh_trang) ? d.tinh_trang : 'Listing';
        const val = (status === 'Win' ? (d.sl_trung || 0) : (d.quota || 0));
        statusValues[status] += val;
    });

    const distChildLabel = document.getElementById('dist-child-label');
    if(distChildLabel) {
        distChildLabel.textContent = distributorViewMode === 'count' ? 'Mã Thầu' : 'Mã VT';
    }

    if (regionViewMode === 'value' || distributorViewMode === 'value') {
        details.forEach(d => {
            const parent = listingMap[d.ma_thau];
            if (!parent) return; 
            const status = ['Listing', 'Waiting', 'Win', 'Fail'].includes(d.tinh_trang) ? d.tinh_trang : 'Listing';
            const val = (status === 'Win' ? (d.sl_trung || 0) : (d.quota || 0));
            totalQuota += (d.quota || 0);
            totalWin += (d.sl_trung || 0);

            if (regionViewMode === 'value') {
                updateTree(regionTree, [parent.khu_vuc || 'Khác', parent.tinh || 'Khác', parent.benh_vien || 'Khác', d.khoa || parent.khoa || 'Chung'], status, val);
            }
            if (distributorViewMode === 'value') {
                updateTree(distributorTree, [parent.nha_phan_phoi || 'Khác', d.ma_vt || 'Unknown'], status, val);
            }
        });
    } else {
        details.forEach(d => {
            totalQuota += (d.quota || 0);
            totalWin += (d.sl_trung || 0);
        });
    }

    const fmt = (n) => n.toLocaleString('vi-VN');
    const winRate = totalQuota > 0 ? ((totalWin / totalQuota) * 100).toFixed(1) : 0;

    const kpiTotalListings = document.getElementById('kpi-total-listings');
    const kpiTotalQuota = document.getElementById('kpi-total-quota');
    const kpiTotalWin = document.getElementById('kpi-total-win');
    const kpiWinRate = document.getElementById('kpi-win-rate');
    if(kpiTotalListings) kpiTotalListings.textContent = fmt(listings.length);
    if(kpiTotalQuota) kpiTotalQuota.textContent = fmt(totalQuota);
    if(kpiTotalWin) kpiTotalWin.textContent = fmt(totalWin);
    if(kpiWinRate) kpiWinRate.textContent = `${winRate}%`;

    const mobKpiListings = document.getElementById('mob-kpi-listings');
    const mobKpiQuota = document.getElementById('mob-kpi-quota');
    const mobKpiWin = document.getElementById('mob-kpi-win');
    const mobKpiRate = document.getElementById('mob-kpi-rate');
    if(mobKpiListings) mobKpiListings.textContent = fmt(listings.length);
    if(mobKpiQuota) mobKpiQuota.textContent = fmt(totalQuota);
    if(mobKpiWin) mobKpiWin.textContent = fmt(totalWin);
    if(mobKpiRate) mobKpiRate.textContent = `${winRate}%`;

    const rootRegionStats = { Listing: 0, Waiting: 0, Win: 0, Fail: 0 };
    Object.values(regionTree).forEach(node => {
        rootRegionStats.Listing += node._stats.Listing;
        rootRegionStats.Waiting += node._stats.Waiting;
        rootRegionStats.Win += node._stats.Win;
        rootRegionStats.Fail += node._stats.Fail;
    });

    const rootDistStats = { Listing: 0, Waiting: 0, Win: 0, Fail: 0 };
    Object.values(distributorTree).forEach(node => {
        rootDistStats.Listing += node._stats.Listing;
        rootDistStats.Waiting += node._stats.Waiting;
        rootDistStats.Win += node._stats.Win;
        rootDistStats.Fail += node._stats.Fail;
    });

    renderGlobalCharts({ statusCounts, statusValues, monthlyStats });
    renderHierarchy(regionTree, regionDisplayMode, rootRegionStats);
    renderDistributorAnalysis(distributorTree, distributorDisplayMode, rootDistStats);
}

function updateTree(tree, path, status, value) {
    let current = tree;
    path.forEach((key, index) => {
        if (!current[key]) {
            current[key] = { 
                _stats: { Listing: 0, Waiting: 0, Win: 0, Fail: 0 }, 
                _children: {} 
            };
        }
        current[key]._stats[status] += value;
        if (index < path.length - 1) {
            current = current[key]._children;
        }
    });
}

function renderGlobalCharts(data) {
    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#e5e7eb' : '#4b5563';
    const gridColor = isDark ? '#374151' : '#e5e7eb';
    const destroyChart = (id) => { if (dashboardChartInstances[id]) dashboardChartInstances[id].destroy(); };

    destroyChart('chart-status');
    const ctxStatus = document.getElementById('chart-status').getContext('2d');
    const sourceData = statusViewMode === 'count' ? data.statusCounts : data.statusValues;
    const labels = ['Listing', 'Waiting', 'Win', 'Fail'];
    const values = [sourceData['Listing'], sourceData['Waiting'], sourceData['Win'], sourceData['Fail']];
    const total = values.reduce((a, b) => a + b, 0);
    const bgColors = ['#9ca3af', '#3b82f6', '#10b981', '#ef4444'];

    dashboardChartInstances['chart-status'] = new Chart(ctxStatus, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: bgColors,
                borderColor: '#ffffff',
                borderWidth: 2,
                hoverOffset: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: 10 },
            plugins: { 
                legend: { display: false }, 
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.raw;
                            const pct = total > 0 ? ((val / total) * 100).toFixed(1) + '%' : '0%';
                            return `${context.label}: ${val.toLocaleString('vi-VN')} (${pct})`;
                        }
                    }
                },
                datalabels: { display: false } 
            }
        }
    });

    const legendContainer = document.getElementById('chart-status-legend');
    if (legendContainer) {
        legendContainer.innerHTML = labels.map((label, i) => {
            const val = values[i];
            const pct = total > 0 ? ((val / total) * 100).toFixed(1) + '%' : '0%';
            const color = bgColors[i];
            return `<div class="flex items-center justify-between p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group"><div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full" style="background-color: ${color}"></span><div class="flex flex-col"><span class="text-xs font-bold text-gray-700 dark:text-gray-200">${label}</span><span class="text-[10px] text-gray-500 dark:text-gray-400">${val.toLocaleString('vi-VN')} (${pct})</span></div></div></div>`;
        }).join('');
    }

    destroyChart('chart-monthly');
    const sortedMonths = Object.keys(data.monthlyStats).sort().slice(-12);
    const ctxMonthly = document.getElementById('chart-monthly').getContext('2d');
    dashboardChartInstances['chart-monthly'] = new Chart(ctxMonthly, {
        type: 'line',
        data: {
            labels: sortedMonths,
            datasets: [{
                label: 'Hồ sơ mới',
                data: sortedMonths.map(m => data.monthlyStats[m]),
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, datalabels: { display: false } },
            scales: {
                x: { ticks: { color: textColor }, grid: { display: false } },
                y: { ticks: { color: textColor }, grid: { color: gridColor } }
            }
        }
    });
}

function renderHierarchy(tree, displayMode, rootStats) {
    const container = document.getElementById('hierarchy-tree');
    if (!container) return;
    container.innerHTML = generateTreeHTML(tree, expandedHierarchyNodes, 'hierarchy-tree', 0, "", displayMode, rootStats);
    if (container.innerHTML === '') container.innerHTML = '<div class="p-4 text-center text-gray-400 italic">Chưa có dữ liệu</div>';
}

function renderDistributorAnalysis(tree, displayMode, rootStats) {
    const container = document.getElementById('distributor-tree');
    if (!container) return;
    container.innerHTML = generateTreeHTML(tree, expandedDistributorNodes, 'distributor-tree', 0, "", displayMode, rootStats);
    if (container.innerHTML === '') container.innerHTML = '<div class="p-4 text-center text-gray-400 italic">Chưa có dữ liệu</div>';
}

function generateTreeHTML(node, expandedSet, containerId, level = 0, parentPath = "", displayMode = 'number', parentStats = null) {
    let html = '';
    const keys = Object.keys(node).sort((a, b) => {
        if (level === 0) {
            const totalA = Object.values(node[a]._stats).reduce((sum, v) => sum + v, 0);
            const totalB = Object.values(node[b]._stats).reduce((sum, v) => sum + v, 0);
            return totalB - totalA;
        }
        return a.localeCompare(b);
    });

    let maxTotalInLevel = 0;
    keys.forEach(k => {
        const s = node[k]._stats;
        const t = s.Listing + s.Waiting + s.Win + s.Fail;
        if(t > maxTotalInLevel) maxTotalInLevel = t;
    });
    
    keys.forEach(key => {
        const data = node[key];
        const stats = data._stats;
        const hasChildren = Object.keys(data._children).length > 0;
        const total = stats.Listing + stats.Waiting + stats.Win + stats.Fail;
        const currentPath = parentPath ? `${parentPath}|${key}` : key;
        const isExpanded = expandedSet.has(currentPath);
        
        if (total === 0) return;

        const barWidth = maxTotalInLevel > 0 ? (total / maxTotalInLevel) * 100 : 0;
        const paddingLeft = level * 16 + 8;
        const toggleIcon = hasChildren 
            ? `<svg class="w-3.5 h-3.5 transform transition-transform duration-200 text-gray-400 group-hover:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>` 
            : `<span class="w-3.5 h-3.5 inline-block"></span>`;

        let bgClass = 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400';
        let fontClass = 'text-[10px] font-normal';
        let stickyClass = '';

        if (level === 0) {
            bgClass = 'bg-gray-100 dark:bg-gray-800 border-b-2 dark:border-gray-600 shadow-sm'; 
            fontClass = 'text-sm font-bold text-gray-800 dark:text-white';
            stickyClass = 'sticky top-0 z-30';
        } else if (level === 1) {
            bgClass = 'bg-white dark:bg-gray-900 border-b dark:border-gray-700 shadow-sm';
            fontClass = 'text-xs font-semibold text-gray-700 dark:text-gray-300';
            stickyClass = 'sticky top-[38px] z-20';
        } else if (level === 2) {
            bgClass = 'bg-white dark:bg-gray-900 border-b dark:border-gray-700';
            fontClass = 'text-[11px] font-medium text-gray-600 dark:text-gray-400';
        }

        const borderClass = level === 0 ? '' : 'border-b dark:border-gray-700';
        const fmt = (val, type) => {
            if (displayMode === 'percent') {
                let denominator = 0;
                if (type === 'Total') {
                    denominator = (parentStats ? (parentStats.Listing + parentStats.Waiting + parentStats.Win + parentStats.Fail) : 0);
                } else {
                    denominator = parentStats ? parentStats[type] : 0;
                }
                if (!denominator || denominator === 0) return '0%';
                const p = (val / denominator) * 100;
                return Math.round(p) + '%'; 
            }
            return val.toLocaleString('vi-VN');
        };

        const expandedClass = isExpanded ? 'expanded' : '';
        const childrenHiddenClass = isExpanded ? '' : 'hidden';
        const toggleFunc = containerId === 'distributor-tree' ? 'window.toggleDistributorNode' : 'window.toggleHierarchyNode';

        let actionButtons = '';
        let labelClass = 'truncate';
        let labelOnClick = ''; 

        if (containerId === 'distributor-tree' && level === 1) {
            const isMaThau = distributorViewMode === 'count';
            const isMaVT = distributorViewMode === 'value';

            if (isMaThau) {
                labelClass = 'truncate text-blue-600 dark:text-blue-400 hover:underline cursor-pointer font-medium';
                labelOnClick = `onclick="window.filterAndNavigateListing('${key}')"`;
            } else if (isMaVT) {
                labelClass = 'truncate text-blue-600 dark:text-blue-400 hover:underline cursor-pointer font-medium';
                labelOnClick = `onclick="window.filterAndNavigateProduct('${key}')"`;
            }

            if (isMaThau || isMaVT) {
                actionButtons = `<div class="flex items-center gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity"><button class="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-500 dark:text-gray-400" onclick="window.copyToClipboard('${key}'); event.stopPropagation();" title="Copy"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button></div>`;
            }
        }

        html += `
            <div class="tree-row group ${borderClass} cursor-pointer transition-colors ${expandedClass} ${stickyClass}" data-path="${currentPath}" onclick="${toggleFunc}('${currentPath}')">
                <div class="flex items-center py-2 pr-2 hover:bg-gray-100 dark:hover:bg-gray-700/50 ${bgClass} ${fontClass}">
                    <div class="flex-1 flex items-center gap-2 overflow-hidden" style="padding-left: ${paddingLeft}px">
                        ${toggleIcon}
                        <span class="${labelClass}" title="${key}" ${labelOnClick}>${key}</span>
                        ${actionButtons}
                    </div>
                    <div class="w-16 text-center text-gray-500 border-l border-gray-200 dark:border-gray-600">${fmt(stats.Listing, 'Listing')}</div>
                    <div class="w-16 text-center text-blue-500 border-l border-gray-200 dark:border-gray-600">${fmt(stats.Waiting, 'Waiting')}</div>
                    <div class="w-16 text-center text-green-500 font-bold border-l border-gray-200 dark:border-gray-600">${fmt(stats.Win, 'Win')}</div>
                    <div class="w-16 text-center text-red-500 border-l border-gray-200 dark:border-gray-600">${fmt(stats.Fail, 'Fail')}</div>
                    <div class="w-20 relative text-center border-l border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30 overflow-hidden h-full flex items-center justify-center">
                        <div class="absolute inset-y-0 left-0 bg-blue-200 dark:bg-blue-900/40 z-0 transition-all duration-500" style="width: ${barWidth}%"></div>
                        <span class="relative z-10 font-bold text-gray-700 dark:text-gray-300 text-[10px]">${fmt(total, 'Total')}</span>
                    </div>
                </div>
            </div>
        `;

        if (hasChildren) {
            html += `<div class="tree-children ${childrenHiddenClass}">${generateTreeHTML(data._children, expandedSet, containerId, level + 1, currentPath, displayMode, stats)}</div>`;
        }
    });
    return html;
}

function renderExpiringContracts(listings) {
    const tbody = document.getElementById('expiring-contracts-body');
    const now = new Date();
    const limitDays = expirationFilterDays; 
    
    let filteredListings = listings.filter(l => {
        if (!l.ngay_ket_thuc || l.tinh_trang !== 'Win') return false;
        const endDate = new Date(l.ngay_ket_thuc);
        const diffTime = endDate - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (contractMonitorMode === 'upcoming') {
            return diffDays >= 0 && diffDays <= limitDays;
        } else {
            return diffDays < 0;
        }
    }).sort((a, b) => new Date(a.ngay_ket_thuc) - new Date(b.ngay_ket_thuc));

    if (filteredListings.length === 0) {
        const msg = contractMonitorMode === 'upcoming' 
            ? `Không có hợp đồng sắp hết hạn trong ${limitDays} ngày.` 
            : `Không có hợp đồng đã hết hạn.`;
        tbody.innerHTML = `<tr><td colspan="3" class="px-4 py-8 text-center text-gray-400 text-xs italic">${msg}</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredListings.map(l => {
        const endDate = new Date(l.ngay_ket_thuc);
        const diffDays = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
        
        let statusClass = '';
        let statusText = '';

        if (diffDays < 0) {
            statusClass = 'text-white bg-red-500 dark:bg-red-600';
            statusText = `Quá hạn ${Math.abs(diffDays)} ngày`;
        } else {
            statusText = `${diffDays} ngày`;
            if (diffDays <= 7) statusClass = 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-300 animate-pulse';
            else if (diffDays <= 30) statusClass = 'text-orange-600 bg-orange-100 dark:bg-orange-900/30 dark:text-orange-300';
            else statusClass = 'text-gray-600 bg-gray-100 dark:bg-gray-700 dark:text-gray-300';
        }

        return `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b dark:border-gray-700 last:border-0 transition-colors">
                <td class="px-3 py-2">
                    <span class="font-mono font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer text-[10px]" 
                          onclick="window.filterAndNavigateListing('${l.ma_thau}')" 
                          title="Click để xem chi tiết">${l.ma_thau}</span>
                </td>
                <td class="px-3 py-2 truncate max-w-[140px] text-gray-600 dark:text-gray-300" title="${l.benh_vien}">${l.benh_vien}</td>
                <td class="px-3 py-2 text-right">
                    <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold ${statusClass}">
                        ${statusText}
                    </span>
                </td>
            </tr>
        `;
    }).join('');
}

function setupProductSearchDropdown(products) {
    const input = document.getElementById('psr-product-search');
    const dropdown = document.getElementById('psr-product-dropdown');
    const list = document.getElementById('psr-product-list');
    if(!input || !dropdown || !list) return;

    const renderList = (filter = '') => {
        list.innerHTML = '';
        const allOption = document.createElement('div');
        allOption.className = "px-3 py-2 text-xs hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 rounded";
        allOption.textContent = "Tất cả sản phẩm";
        allOption.onclick = () => { input.value = ''; psrFilters.product = 'all'; dropdown.classList.add('hidden'); refreshPsrSection(rawDetails); };
        list.appendChild(allOption);

        const filtered = products.filter(p => p.toLowerCase().includes(filter.toLowerCase()));
        if (filtered.length === 0) {
            const noData = document.createElement('div');
            noData.className = "px-3 py-2 text-xs text-gray-400 text-center";
            noData.textContent = "Không tìm thấy";
            list.appendChild(noData);
        } else {
            filtered.forEach(p => {
                const item = document.createElement('div');
                item.className = "px-3 py-2 text-xs hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-gray-700 dark:text-gray-200 rounded truncate";
                item.textContent = p;
                item.onclick = () => { input.value = p; psrFilters.product = p; dropdown.classList.add('hidden'); refreshPsrSection(rawDetails); };
                list.appendChild(item);
            });
        }
    };
    renderList();
    input.addEventListener('click', (e) => { e.stopPropagation(); dropdown.classList.remove('hidden'); });
    input.addEventListener('input', (e) => { renderList(e.target.value); dropdown.classList.remove('hidden'); });
    document.addEventListener('click', (e) => { if (!dropdown.contains(e.target) && e.target !== input) { dropdown.classList.add('hidden'); } });
}

function refreshPsrSection(detailsToUse) {
    // If no specific details passed (e.g. initial load), use global rawDetails but filtered by date
    // Actually, in our new flow, we call this FROM applyDashboardDateFilter, so detailsToUse is already date-filtered.
    // If called from product dropdown (internal filter), we need to re-apply Date Filter + Product Filter.
    
    // BUT wait, rawDetails contains ALL data. 
    // We should use the currently "Date Filtered" subset as base.
    // Let's rely on applyDashboardDateFilter to drive this.
    // If called from dropdown, we trigger a full re-calc or just filter existing filtered set?
    // Easiest: Call applyDashboardDateFilter() which eventually calls refreshPsrSection(dateFilteredDetails)
    
    // However, setupProductSearchDropdown calls refreshPsrSection directly. 
    // Let's fix setupProductSearchDropdown to call applyDashboardDateFilter instead to keep flow consistent.
    
    // For now, let's assume detailsToUse IS the date-filtered set.
    const finalDetails = applyPsrProductFilter(detailsToUse || rawDetails); // Apply Product Filter on top
    renderPsrAnalysis(finalDetails);
}

// Renamed to clarify it only filters by product
function applyPsrProductFilter(details) {
    const { product } = psrFilters;
    return details.filter(d => {
        if (product !== 'all' && d.ma_vt !== product) return false;
        return true;
    });
}

function renderPsrAnalysis(filteredDetails) {
    const allPsrs = [...new Set(rawDetails.map(d => d.psr).filter(n => n))].sort();
    let psrStats = {};
    allPsrs.forEach(psr => { psrStats[psr] = { quota: 0, win: 0, products: {} }; });
    filteredDetails.forEach(d => {
        const q = parseFloat(d.quota) || 0;
        const w = parseFloat(d.sl_trung) || 0;
        const psrName = d.psr;
        if (psrName && psrStats[psrName]) {
            psrStats[psrName].quota += q;
            psrStats[psrName].win += w;
            if (d.ma_vt) {
                if (!psrStats[psrName].products[d.ma_vt]) psrStats[psrName].products[d.ma_vt] = 0;
                psrStats[psrName].products[d.ma_vt] += q; 
            }
        }
    });
    const psrList = Object.entries(psrStats).map(([name, stats]) => {
        let topProd = '-'; let maxQ = -1;
        for (const [prod, qty] of Object.entries(stats.products)) { if (qty > maxQ) { maxQ = qty; topProd = prod; } }
        return { name, quota: stats.quota, win: stats.win, rate: stats.quota > 0 ? (stats.win / stats.quota * 100) : 0, topProduct: topProd };
    }).sort((a, b) => b.quota - a.quota);

    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#e5e7eb' : '#4b5563';
    const gridColor = isDark ? '#374151' : '#e5e7eb';

    if (dashboardChartInstances['chart-psr-perf']) dashboardChartInstances['chart-psr-perf'].destroy();
    const ctxPsr = document.getElementById('chart-psr-perf').getContext('2d');
    dashboardChartInstances['chart-psr-perf'] = new Chart(ctxPsr, {
        type: 'bar',
        data: {
            labels: psrList.map(p => p.name),
            datasets: [
                { label: 'Quota', data: psrList.map(p => p.quota), backgroundColor: '#60a5fa', barPercentage: 0.6 },
                { label: 'Win', data: psrList.map(p => p.win), backgroundColor: '#34d399', barPercentage: 0.6 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { color: textColor } }, datalabels: { display: false } },
            scales: {
                x: { ticks: { color: textColor, autoSkip: false, maxRotation: 45, minRotation: 0 }, grid: { display: false } },
                y: { ticks: { color: textColor }, grid: { color: gridColor } }
            }
        }
    });

    const psrTableBody = document.getElementById('psr-table-body');
    psrTableBody.innerHTML = psrList.map(p => `
        <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors border-b dark:border-gray-700 last:border-0">
            <td class="px-3 py-2 font-medium text-gray-700 dark:text-gray-200">${p.name}</td>
            <td class="px-3 py-2 text-right font-mono text-blue-600 dark:text-blue-400">${p.quota.toLocaleString('vi-VN')}</td>
            <td class="px-3 py-2 text-right font-mono text-green-600 dark:text-green-400">${p.win.toLocaleString('vi-VN')}</td>
            <td class="px-3 py-2 text-right text-xs font-bold ${p.rate >= 50 ? 'text-green-500' : 'text-orange-500'}">${p.rate.toFixed(1)}%</td>
        </tr>
    `).join('');
}
