
import { sb, showLoading, showToast } from './app.js';
import { setLanguage, getCurrentLanguage, translations } from './lang.js';

let dashboardChartInstances = {};
let rawDetails = []; // Store raw details for local filtering
let rawListings = []; // Store raw listings
let psrFilters = {
    range: 'all', // today, week, month, year, custom
    start: '',
    end: '',
    product: 'all'
};

const t = (key) => {
    const lang = getCurrentLanguage();
    return translations[lang][key] || key;
};

export async function onShowDashboardView() {
    const container = document.getElementById('view-phat-trien');
    
    // Inject Dashboard Template (Header & Buttons Removed to push layout up)
    container.innerHTML = `
        <div class="flex flex-col h-full bg-gray-50 dark:bg-gray-900 p-4 md:p-6 overflow-y-auto custom-scrollbar">
            
            <!-- KPI Cards Row -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <!-- KPI 1: Total Listings -->
                <div class="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
                    <div>
                        <p class="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider" data-i18n="dash_total_listings">Tổng Hồ Sơ</p>
                        <h3 class="text-2xl font-bold text-gray-800 dark:text-white mt-1" id="kpi-total-listings">0</h3>
                    </div>
                    <div class="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    </div>
                </div>

                <!-- KPI 2: Total Quota -->
                <div class="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
                    <div>
                        <p class="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider" data-i18n="dash_total_quota">Tổng Quota</p>
                        <h3 class="text-2xl font-bold text-gray-800 dark:text-white mt-1" id="kpi-total-quota">0</h3>
                    </div>
                    <div class="p-3 bg-purple-50 dark:bg-purple-900/30 rounded-lg text-purple-600 dark:text-purple-400">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                </div>

                <!-- KPI 3: Total Win Value -->
                <div class="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between">
                    <div>
                        <p class="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider" data-i18n="dash_total_win">Giá Trị Thắng</p>
                        <h3 class="text-2xl font-bold text-green-600 dark:text-green-400 mt-1" id="kpi-total-win">0</h3>
                    </div>
                    <div class="p-3 bg-green-50 dark:bg-green-900/30 rounded-lg text-green-600 dark:text-green-400">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path></svg>
                    </div>
                </div>

                <!-- KPI 4: Win Rate -->
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
                <div class="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <h3 class="text-lg font-bold text-gray-800 dark:text-white mb-4" data-i18n="dash_chart_status">Tỷ Trọng Trạng Thái</h3>
                    <div class="relative h-64 w-full">
                        <canvas id="chart-status"></canvas>
                    </div>
                </div>

                <!-- Monthly Trend -->
                <div class="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <h3 class="text-lg font-bold text-gray-800 dark:text-white mb-4" data-i18n="dash_chart_monthly">Xu Hướng Hồ Sơ Mới</h3>
                    <div class="relative h-64 w-full">
                        <canvas id="chart-monthly"></canvas>
                    </div>
                </div>
            </div>

            <!-- PSR ANALYSIS SECTION -->
            <div class="mb-6">
                <div class="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                    <div class="p-4 md:p-6 border-b border-gray-100 dark:border-gray-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <h3 class="text-lg font-bold text-gray-800 dark:text-white" data-i18n="dash_psr_analysis">Phân Tích Hiệu Quả PSR</h3>
                        
                        <!-- PSR Filter Toolbar -->
                        <div class="flex flex-wrap gap-2 items-center w-full md:w-auto">
                            <!-- Custom Product Search Dropdown -->
                            <div class="relative group w-full md:w-56 z-20">
                                <div class="relative">
                                    <input type="text" id="psr-product-search" placeholder="Tất cả sản phẩm" class="w-full text-xs px-3 py-2 border rounded-lg bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer" autocomplete="off">
                                    <span class="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none text-gray-400">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                                    </span>
                                </div>
                                <div id="psr-product-dropdown" class="absolute hidden w-full bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg shadow-xl mt-1 max-h-40 overflow-y-auto custom-scrollbar">
                                    <div class="p-1" id="psr-product-list">
                                        <!-- Options Injected Here -->
                                    </div>
                                </div>
                            </div>

                            <!-- Date Select -->
                            <div class="flex items-center bg-gray-50 dark:bg-gray-700 rounded-lg p-1 border dark:border-gray-600">
                                <button class="psr-date-btn px-3 py-1.5 text-xs font-medium rounded transition-colors bg-white dark:bg-gray-600 text-blue-600 shadow-sm" data-range="all" data-i18n="opt_all">Tất cả</button>
                                <button class="psr-date-btn px-3 py-1.5 text-xs font-medium rounded transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600" data-range="today" data-i18n="opt_today">Hôm nay</button>
                                <button class="psr-date-btn px-3 py-1.5 text-xs font-medium rounded transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600" data-range="month" data-i18n="opt_month">Tháng</button>
                                <button class="psr-date-btn px-3 py-1.5 text-xs font-medium rounded transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600" data-range="year" data-i18n="opt_year">Năm</button>
                                <button class="psr-date-btn px-3 py-1.5 text-xs font-medium rounded transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600" data-range="custom">Custom</button>
                            </div>

                            <!-- Custom Date Inputs (Hidden by default) -->
                            <div id="psr-custom-date-wrapper" class="hidden flex items-center gap-1">
                                <input type="date" id="psr-date-start" class="text-xs px-2 py-1.5 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                <span class="text-gray-400">-</span>
                                <input type="date" id="psr-date-end" class="text-xs px-2 py-1.5 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                                <button id="psr-apply-custom" class="px-2 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700" data-i18n="btn_apply">Áp dụng</button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="p-4 md:p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <!-- PSR Chart (Left - 2 Cols) -->
                        <div class="lg:col-span-2">
                            <h4 class="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 uppercase" data-i18n="dash_psr_performance">Hiệu suất PSR (Quota vs Win)</h4>
                            <div class="relative h-80 w-full">
                                <canvas id="chart-psr-perf"></canvas>
                            </div>
                        </div>

                        <!-- PSR Table (Right - 1 Col) -->
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
                                            <th class="px-3 py-2" data-i18n="col_top_product">Top SP</th>
                                        </tr>
                                    </thead>
                                    <tbody id="psr-table-body" class="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
                                        <!-- JS Injected -->
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ROW 4: Expiring Contracts & Recent Activity (New Widget) -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <!-- Expiring Contracts -->
                <div class="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-bold text-red-600 dark:text-red-400 flex items-center gap-2" data-i18n="dash_expiring_title">
                            Sắp hết hạn (30 ngày)
                        </h3>
                        <svg class="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                    <div class="flex-1 overflow-y-auto max-h-72 custom-scrollbar border rounded-lg dark:border-gray-700">
                        <table class="w-full text-xs text-left">
                            <thead class="bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-300 sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th class="px-3 py-2" data-i18n="dt_ma_thau">Mã Thầu</th>
                                    <th class="px-3 py-2" data-i18n="dt_benh_vien">Bệnh Viện</th>
                                    <th class="px-3 py-2 text-right" data-i18n="dt_ngay_kt">Ngày KT</th>
                                    <th class="px-3 py-2 text-right">Còn lại</th>
                                </tr>
                            </thead>
                            <tbody id="expiring-contracts-body" class="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
                                <!-- JS Injected -->
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Recent Activity (New Feature) -->
                <div class="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2" data-i18n="dash_activity_title">
                            Hoạt động gần đây
                        </h3>
                        <svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                    <div class="flex-1 overflow-y-auto max-h-72 custom-scrollbar" id="recent-activity-container">
                        <div class="text-center text-gray-400 text-xs py-4">Đang tải...</div>
                    </div>
                </div>
            </div>

            <!-- ROW 5: Top 10 Products (Chart) -->
            <div class="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 mb-6">
                <h3 class="text-lg font-bold text-gray-800 dark:text-white mb-4" data-i18n="dash_top_10_products">Top 10 Sản Phẩm (Quota & Win Rate)</h3>
                <div class="relative h-72 w-full">
                    <canvas id="chart-top-products"></canvas>
                </div>
            </div>

            <!-- Charts Section 2 -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-20">
                <!-- Top Hospitals -->
                <div class="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <h3 class="text-lg font-bold text-gray-800 dark:text-white mb-4" data-i18n="dash_chart_hospital">Top 5 Bệnh Viện (Quota)</h3>
                    <div class="relative h-64 w-full">
                        <canvas id="chart-hospital"></canvas>
                    </div>
                </div>

                <!-- Product Groups (Win Value) -->
                <div class="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                    <h3 class="text-lg font-bold text-gray-800 dark:text-white mb-4" data-i18n="dash_chart_product_group">Nhóm Sản Phẩm (Win)</h3>
                    <div class="relative h-64 w-full">
                        <canvas id="chart-product-group"></canvas>
                    </div>
                </div>
            </div>
        </div>
    `;

    setLanguage(getCurrentLanguage());
    setupPsrFilterListeners();
    // Removed setupAIButton call
    await loadDashboardData();

    // Removed refresh button listener
}

function setupPsrFilterListeners() {
    const btns = document.querySelectorAll('.psr-date-btn');
    const customWrapper = document.getElementById('psr-custom-date-wrapper');
    const btnApplyCustom = document.getElementById('psr-apply-custom');

    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            btns.forEach(b => b.className = "psr-date-btn px-3 py-1.5 text-xs font-medium rounded transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600");
            btn.className = "psr-date-btn px-3 py-1.5 text-xs font-medium rounded transition-colors bg-white dark:bg-gray-600 text-blue-600 shadow-sm";
            
            const range = btn.dataset.range;
            psrFilters.range = range;
            
            if (range === 'custom') {
                customWrapper.classList.remove('hidden');
            } else {
                customWrapper.classList.add('hidden');
                refreshPsrSection();
            }
        });
    });

    if (btnApplyCustom) {
        btnApplyCustom.addEventListener('click', () => {
            psrFilters.start = document.getElementById('psr-date-start').value;
            psrFilters.end = document.getElementById('psr-date-end').value;
            refreshPsrSection();
        });
    }
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
        allOption.onclick = () => {
            input.value = '';
            psrFilters.product = 'all';
            dropdown.classList.add('hidden');
            refreshPsrSection();
        };
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
                item.title = p;
                item.onclick = () => {
                    input.value = p;
                    psrFilters.product = p;
                    dropdown.classList.add('hidden');
                    refreshPsrSection();
                };
                list.appendChild(item);
            });
        }
    };

    renderList();

    input.addEventListener('click', (e) => { e.stopPropagation(); dropdown.classList.remove('hidden'); });
    input.addEventListener('input', (e) => { renderList(e.target.value); dropdown.classList.remove('hidden'); });
    document.addEventListener('click', (e) => { if (!dropdown.contains(e.target) && e.target !== input) { dropdown.classList.add('hidden'); } });
}

function refreshPsrSection() {
    const filteredDetails = applyPsrFilters(rawDetails);
    renderPsrAnalysis(filteredDetails);
}

function applyPsrFilters(details) {
    const { range, start, end, product } = psrFilters;
    const now = new Date();
    
    return details.filter(d => {
        if (product !== 'all' && d.ma_vt !== product) return false;
        if (range === 'all') return true;
        if (!d.ngay) return false; 
        const dDate = new Date(d.ngay);
        dDate.setHours(0,0,0,0);
        const today = new Date();
        today.setHours(0,0,0,0);

        if (range === 'today') return dDate.getTime() === today.getTime();
        if (range === 'month') return dDate.getMonth() === now.getMonth() && dDate.getFullYear() === now.getFullYear();
        if (range === 'year') return dDate.getFullYear() === now.getFullYear();
        if (range === 'custom') {
            if (!start && !end) return true;
            const s = start ? new Date(start) : new Date('1970-01-01');
            const e = end ? new Date(end) : new Date('2099-12-31');
            s.setHours(0,0,0,0); e.setHours(0,0,0,0);
            return dDate >= s && dDate <= e;
        }
        return true;
    });
}

// AI Functions Removed

async function loadDashboardData() {
    showLoading(true);
    
    try {
        // Fetch Listings
        const { data: listings, error: lErr } = await sb.from('listing').select('*');
        if (lErr) throw lErr;
        rawListings = listings;

        // Fetch Details
        const { data: details, error: dErr } = await sb.from('detail').select('ma_thau, quota, sl_trung, tinh_trang, group_product, psr, ma_vt, ngay');
        if (dErr) throw dErr;
        
        rawDetails = details || [];

        // Init Product Search
        const products = [...new Set(rawDetails.map(d => d.ma_vt).filter(v => v))].sort();
        setupProductSearchDropdown(products);

        // Global Stats
        calculateGlobalStats(listings, details);

        // PSR Analysis
        refreshPsrSection();

        // Top 10 Products (Unfiltered)
        renderTopProductsChart(rawDetails);

        // Expiring Contracts Widget
        renderExpiringContracts(rawListings);

        // Recent Activity Widget
        renderRecentActivity();

    } catch (e) {
        console.error("Dashboard Error:", e);
        showToast("Lỗi tải dữ liệu Dashboard: " + e.message, 'error');
    } finally {
        showLoading(false);
    }
}

function calculateGlobalStats(listings, details) {
    let totalQuota = 0;
    let totalWin = 0;
    let statusCounts = { 'Waiting': 0, 'Win': 0, 'Fail': 0 };
    let hospitalStats = {}; 
    let monthlyStats = {}; 
    let groupStats = {}; 

    listings.forEach(l => {
        const status = l.tinh_trang || 'Waiting';
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        if (l.ngay) {
            const date = new Date(l.ngay);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            monthlyStats[key] = (monthlyStats[key] || 0) + 1;
        }
    });

    const listingHospitalMap = {};
    listings.forEach(l => listingHospitalMap[l.ma_thau] = l.benh_vien);

    details.forEach(d => {
        const q = parseFloat(d.quota) || 0;
        const w = parseFloat(d.sl_trung) || 0;
        totalQuota += q;
        totalWin += w;
        const hospital = listingHospitalMap[d.ma_thau] || 'Unknown';
        hospitalStats[hospital] = (hospitalStats[hospital] || 0) + q;
        if (d.tinh_trang === 'Win' && d.group_product) {
            groupStats[d.group_product] = (groupStats[d.group_product] || 0) + w;
        }
    });

    const fmt = (n) => n.toLocaleString('vi-VN');
    const winRate = totalQuota > 0 ? ((totalWin / totalQuota) * 100).toFixed(1) : 0;

    document.getElementById('kpi-total-listings').textContent = fmt(listings.length);
    document.getElementById('kpi-total-quota').textContent = fmt(totalQuota);
    document.getElementById('kpi-total-win').textContent = fmt(totalWin);
    document.getElementById('kpi-win-rate').textContent = `${winRate}%`;

    renderGlobalCharts({ statusCounts, monthlyStats, hospitalStats, groupStats });
}

function renderGlobalCharts(data) {
    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#e5e7eb' : '#4b5563';
    const gridColor = isDark ? '#374151' : '#e5e7eb';
    const destroyChart = (id) => { if (dashboardChartInstances[id]) dashboardChartInstances[id].destroy(); };

    destroyChart('chart-status');
    const ctxStatus = document.getElementById('chart-status').getContext('2d');
    dashboardChartInstances['chart-status'] = new Chart(ctxStatus, {
        type: 'doughnut',
        data: {
            labels: ['Waiting', 'Win', 'Fail'],
            datasets: [{
                data: [data.statusCounts['Waiting'], data.statusCounts['Win'], data.statusCounts['Fail']],
                backgroundColor: ['#60a5fa', '#34d399', '#f87171'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { color: textColor } } }
        }
    });

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
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: textColor }, grid: { display: false } },
                y: { ticks: { color: textColor }, grid: { color: gridColor } }
            }
        }
    });

    destroyChart('chart-hospital');
    const sortedHospitals = Object.entries(data.hospitalStats).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const ctxHosp = document.getElementById('chart-hospital').getContext('2d');
    dashboardChartInstances['chart-hospital'] = new Chart(ctxHosp, {
        type: 'bar',
        data: {
            labels: sortedHospitals.map(i => i[0]),
            datasets: [{ label: 'Quota', data: sortedHospitals.map(i => i[1]), backgroundColor: '#818cf8', borderRadius: 4 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: textColor }, grid: { color: gridColor } },
                y: { ticks: { color: textColor }, grid: { display: false } }
            }
        }
    });

    destroyChart('chart-product-group');
    const sortedGroups = Object.entries(data.groupStats).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const ctxGroup = document.getElementById('chart-product-group').getContext('2d');
    dashboardChartInstances['chart-product-group'] = new Chart(ctxGroup, {
        type: 'bar',
        data: {
            labels: sortedGroups.map(i => i[0]),
            datasets: [{ label: 'Giá trị thắng', data: sortedGroups.map(i => i[1]), backgroundColor: '#34d399', borderRadius: 4 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: textColor }, grid: { display: false } },
                y: { ticks: { color: textColor }, grid: { color: gridColor } }
            }
        }
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

    const psrList = Object.entries(psrStats)
        .map(([name, stats]) => {
            let topProd = '-';
            let maxQ = -1;
            for (const [prod, qty] of Object.entries(stats.products)) { if (qty > maxQ) { maxQ = qty; topProd = prod; } }
            return { name, quota: stats.quota, win: stats.win, rate: stats.quota > 0 ? (stats.win / stats.quota * 100) : 0, topProduct: topProd };
        })
        .sort((a, b) => b.quota - a.quota);

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
            plugins: { legend: { position: 'top', labels: { color: textColor } } },
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
            <td class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 truncate max-w-[100px]" title="${p.topProduct}">${p.topProduct}</td>
        </tr>
    `).join('');
}

function renderTopProductsChart(details) {
    const prodStats = {};
    details.forEach(d => {
        const prod = d.ma_vt;
        if (!prod) return;
        if (!prodStats[prod]) prodStats[prod] = { quota: 0, win: 0 };
        prodStats[prod].quota += parseFloat(d.quota) || 0;
        prodStats[prod].win += parseFloat(d.sl_trung) || 0;
    });

    const top10 = Object.entries(prodStats)
        .map(([name, stats]) => ({
            name,
            quota: stats.quota,
            rate: stats.quota > 0 ? (stats.win / stats.quota * 100) : 0
        }))
        .sort((a, b) => b.quota - a.quota)
        .slice(0, 10);

    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#e5e7eb' : '#4b5563';
    const gridColor = isDark ? '#374151' : '#e5e7eb';

    if (dashboardChartInstances['chart-top-products']) dashboardChartInstances['chart-top-products'].destroy();
    const ctx = document.getElementById('chart-top-products').getContext('2d');
    
    dashboardChartInstances['chart-top-products'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: top10.map(p => p.name),
            datasets: [
                {
                    label: 'Tổng Quota',
                    data: top10.map(p => p.quota),
                    backgroundColor: 'rgba(59, 130, 246, 0.7)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1,
                    order: 2,
                    yAxisID: 'y'
                },
                {
                    label: 'Tỷ lệ thắng (%)',
                    data: top10.map(p => p.rate),
                    type: 'line',
                    borderColor: '#f59e0b',
                    backgroundColor: '#f59e0b',
                    borderWidth: 2,
                    pointRadius: 4,
                    order: 1,
                    yAxisID: 'y1',
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) { label += ': '; }
                            if (context.dataset.type === 'line') {
                                label += context.parsed.y.toFixed(1) + '%';
                            } else {
                                label += context.parsed.y.toLocaleString();
                            }
                            return label;
                        }
                    }
                },
                legend: { position: 'top', labels: { color: textColor } }
            },
            scales: {
                x: { ticks: { color: textColor }, grid: { display: false } },
                y: { 
                    type: 'linear', 
                    display: true, 
                    position: 'left',
                    ticks: { color: textColor },
                    grid: { color: gridColor },
                    title: { display: true, text: 'Quota', color: textColor }
                },
                y1: { 
                    type: 'linear', 
                    display: true, 
                    position: 'right',
                    ticks: { color: textColor },
                    grid: { display: false },
                    title: { display: true, text: 'Win Rate (%)', color: textColor },
                    max: 100
                }
            }
        }
    });
}

function renderExpiringContracts(listings) {
    const tbody = document.getElementById('expiring-contracts-body');
    const now = new Date();
    const warningLimit = 30; // days

    const expiring = listings.filter(l => {
        if (!l.ngay_ket_thuc || l.tinh_trang !== 'Win') return false;
        const endDate = new Date(l.ngay_ket_thuc);
        const diffTime = endDate - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays <= warningLimit;
    }).sort((a, b) => new Date(a.ngay_ket_thuc) - new Date(b.ngay_ket_thuc));

    if (expiring.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-8 text-center text-gray-400 text-xs">Không có hợp đồng nào sắp hết hạn</td></tr>`;
        return;
    }

    tbody.innerHTML = expiring.map(l => {
        const endDate = new Date(l.ngay_ket_thuc);
        const diffDays = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
        const isExpired = diffDays < 0;
        const statusClass = isExpired ? 'text-red-600 bg-red-50 dark:bg-red-900/20' : 'text-orange-600 bg-orange-50 dark:bg-orange-900/20';
        const label = isExpired ? 'Đã hết hạn' : `${diffDays} ngày`;

        return `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b dark:border-gray-700 last:border-0">
                <td class="px-3 py-2 font-mono font-medium text-gray-700 dark:text-gray-200">${l.ma_thau}</td>
                <td class="px-3 py-2 truncate max-w-[120px] text-gray-600 dark:text-gray-300" title="${l.benh_vien}">${l.benh_vien}</td>
                <td class="px-3 py-2 text-right font-mono text-xs text-gray-500 dark:text-gray-400">${new Date(l.ngay_ket_thuc).toLocaleDateString('vi-VN')}</td>
                <td class="px-3 py-2 text-right">
                    <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold ${statusClass}">
                        ${label}
                    </span>
                </td>
            </tr>
        `;
    }).join('');
}

async function renderRecentActivity() {
    const container = document.getElementById('recent-activity-container');
    try {
        // Fetch history
        const { data: history, error } = await sb.from('history')
            .select('*')
            .order('ngay_tao', { ascending: false })
            .limit(10);

        if (error) throw error;

        if (!history || history.length === 0) {
            container.innerHTML = '<div class="text-center text-gray-400 text-xs py-4">Chưa có hoạt động nào.</div>';
            return;
        }

        container.innerHTML = history.map(h => {
            const time = new Date(h.ngay_tao).toLocaleString('vi-VN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            let iconColor = 'bg-gray-100 text-gray-600';
            if (h.hanh_dong.includes('Win')) iconColor = 'bg-green-100 text-green-600';
            else if (h.hanh_dong.includes('Fail')) iconColor = 'bg-red-100 text-red-600';
            else if (h.hanh_dong.includes('Tạo')) iconColor = 'bg-blue-100 text-blue-600';

            return `
                <div class="flex gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg transition-colors">
                    <div class="flex-shrink-0 mt-1">
                        <div class="w-8 h-8 rounded-full ${iconColor} flex items-center justify-center text-xs font-bold">
                            ${h.hanh_dong.charAt(0)}
                        </div>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex justify-between items-start">
                            <p class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate pr-2">${h.hanh_dong}</p>
                            <span class="text-[10px] text-gray-400 whitespace-nowrap">${time}</span>
                        </div>
                        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">${h.noi_dung}</p>
                        <p class="text-[10px] text-gray-400 mt-1">Bởi: <span class="font-medium text-gray-600 dark:text-gray-300">${h.nguoi_thuc_hien}</span></p>
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) {
        container.innerHTML = '<div class="text-center text-red-400 text-xs py-4">Lỗi tải dữ liệu.</div>';
    }
}
