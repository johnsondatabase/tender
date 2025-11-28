
import { translations, getCurrentLanguage } from './lang.js';

// --- State ---
let currentFilters = {
    keyword: '',
    dateRange: [],
    benh_vien: [],
    npp: [],
    khu_vuc: [],
    nganh: []
};

// Helper Translation
const t = (key) => {
    const lang = getCurrentLanguage();
    return translations[lang][key] || key;
};

// --- Exported Functions ---

export function getCurrentFilters() {
    return currentFilters;
}

export function setFilterKeyword(keyword) {
    currentFilters.keyword = keyword;
}

export function resetFilters() {
    currentFilters = {
        keyword: '',
        dateRange: [],
        benh_vien: [],
        npp: [],
        khu_vuc: [],
        nganh: []
    };
}

export function getFilteredData(allData) {
    const term = currentFilters.keyword.toLowerCase();
    
    return allData.filter(item => {
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
}

// UI Helpers for Filter Panel
export function updateFilterOptionsUI(allData, onFilterChangeCallback) {
    // Helper to get unique values
    const getOptions = (data, field) => [...new Set(data.map(item => item[field]).filter(v => v))].sort();
    
    // Helper to get data available based on OTHER filters (Cascading)
    const getAvailableData = (targetField) => {
        return allData.filter(item => {
            const matchesDate = targetField === 'dateRange' || checkDateRange(item.ngay, currentFilters.dateRange);
            const matchesHospital = targetField === 'benh_vien' || currentFilters.benh_vien.length === 0 || currentFilters.benh_vien.includes(item.benh_vien);
            const matchesNPP = targetField === 'npp' || currentFilters.npp.length === 0 || currentFilters.npp.includes(item.nha_phan_phoi);
            const matchesArea = targetField === 'khu_vuc' || currentFilters.khu_vuc.length === 0 || currentFilters.khu_vuc.includes(item.khu_vuc);
            const matchesSector = targetField === 'nganh' || currentFilters.nganh.length === 0 || currentFilters.nganh.includes(item.nganh);
            return matchesDate && matchesHospital && matchesNPP && matchesArea && matchesSector;
        });
    };

    const dateOpts = [
        { value: 'today', label: t('opt_today') },
        { value: 'week', label: t('opt_week') },
        { value: 'month', label: t('opt_month') },
        { value: 'quarter', label: t('opt_quarter') },
        { value: 'year', label: t('opt_year') }
    ];

    // Render Function Wrapper
    const render = (id, opts, currentVals, key) => {
        renderMultiSelect(id, opts, currentVals, (newVals) => {
            currentFilters[key] = newVals;
            onFilterChangeCallback(); // Trigger refresh in main listing.js
            // Recursive update for cascading effect
            updateFilterOptionsUI(allData, onFilterChangeCallback); 
        }, key === 'dateRange'); // Date range uses object with labels
    };

    // 1. Date
    render('filter-wrapper-date', dateOpts, currentFilters.dateRange, 'dateRange');

    // 2. Hospital
    const hospData = getAvailableData('benh_vien');
    const hospOpts = getOptions(hospData, 'benh_vien').map(v => ({ value: v, label: v }));
    render('filter-wrapper-hospital', hospOpts, currentFilters.benh_vien, 'benh_vien');

    // 3. NPP
    const nppData = getAvailableData('npp');
    const nppOpts = getOptions(nppData, 'nha_phan_phoi').map(v => ({ value: v, label: v }));
    render('filter-wrapper-npp', nppOpts, currentFilters.npp, 'npp');

    // 4. Area
    const areaData = getAvailableData('khu_vuc');
    const areaOpts = getOptions(areaData, 'khu_vuc').map(v => ({ value: v, label: v }));
    render('filter-wrapper-area', areaOpts, currentFilters.khu_vuc, 'khu_vuc');

    // 5. Sector
    const sectorData = getAvailableData('nganh');
    const sectorOpts = getOptions(sectorData, 'nganh').map(v => ({ value: v, label: v }));
    render('filter-wrapper-sector', sectorOpts, currentFilters.nganh, 'nganh');

    // Update Labels
    updateFilterLabels();
}

export function hasActiveFilters() {
    return currentFilters.dateRange.length > 0 || 
           currentFilters.benh_vien.length > 0 || 
           currentFilters.npp.length > 0 || 
           currentFilters.khu_vuc.length > 0 || 
           currentFilters.nganh.length > 0;
}

// --- Internal Logic ---

function checkDateRange(dateStr, rangeArray) {
    if (!dateStr || rangeArray.length === 0) return true;
    
    return rangeArray.some(range => {
        const d = new Date(dateStr);
        const now = new Date();
        d.setHours(0,0,0,0);
        now.setHours(0,0,0,0);

        if (range === 'today') return d.getTime() === now.getTime();
        if (range === 'week') {
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

function renderMultiSelect(containerId, options, selectedValues, onUpdate, isLabelValueObj = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const wasOpen = container.querySelector('.multi-select-dropdown')?.classList.contains('open');

    let btnText = t('opt_all');
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
            <div class="multi-select-options custom-scrollbar"></div>
        </div>
    `;

    const btn = container.querySelector('.multi-select-btn');
    const dropdown = container.querySelector('.multi-select-dropdown');
    const searchInput = container.querySelector('input');
    const optionsContainer = container.querySelector('.multi-select-options');

    const renderOptions = (filter = '') => {
        const lowerFilter = filter.toLowerCase();
        let normalizedOpts = isLabelValueObj ? options : options.map(o => ({ value: o.value, label: o.label }));
        const filtered = normalizedOpts.filter(o => String(o.label).toLowerCase().includes(lowerFilter));
        
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

        optionsContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                const val = cb.value;
                let newSelected = [...selectedValues];
                if (cb.checked) newSelected.push(val);
                else newSelected = newSelected.filter(v => v !== val);
                onUpdate(newSelected);
            });
        });
    };

    renderOptions();
    searchInput.addEventListener('input', (e) => renderOptions(e.target.value));

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.multi-select-dropdown').forEach(d => {
            if (d !== dropdown) d.classList.remove('open');
        });
        dropdown.classList.toggle('open');
        if (dropdown.classList.contains('open')) searchInput.focus();
    });
}

export function updateFilterLabels() {
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
            const labelEl = wrapper.previousElementSibling;
            if (labelEl) labelEl.textContent = t(key);
        }
    }
}
