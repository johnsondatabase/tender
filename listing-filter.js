


import { translations, getCurrentLanguage } from './lang.js';

// --- State ---
let currentFilters = {
    keyword: '',
    dateRange: [], // Array for presets OR object for custom {start, end}
    expirationRange: [], // New: For expiration presets
    customCreatedDate: { start: '', end: '' }, // New: Store created date input values
    customExpirationDate: { days: '' }, // CHANGED: Store days as number string
    benh_vien: [],
    npp: [],
    khu_vuc: [],
    nganh: [],
    psr: [] // New: PSR Filter
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
        expirationRange: [],
        customCreatedDate: { start: '', end: '' },
        customExpirationDate: { days: '' },
        benh_vien: [],
        npp: [],
        khu_vuc: [],
        nganh: [],
        psr: []
    };
    // Need to manually reset inputs in UI if they exist?
    // They will be re-rendered by updateFilterOptionsUI anyway.
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
        const matchesPSR = currentFilters.psr.length === 0 || currentFilters.psr.includes(item.psr);
        
        // Date Range (Created)
        const matchesDate = checkDateRange(item.ngay, currentFilters.dateRange, currentFilters.customCreatedDate);
        
        // Expiration Date
        const matchesExpiration = checkExpiration(item.ngay_ket_thuc, currentFilters.expirationRange, currentFilters.customExpirationDate);

        return matchesKeyword && matchesHospital && matchesNPP && matchesArea && matchesSector && matchesPSR && matchesDate && matchesExpiration;
    });
}

// UI Helpers for Filter Panel
export function updateFilterOptionsUI(allData, onFilterChangeCallback) {
    // Helper to get unique values
    const getOptions = (data, field) => [...new Set(data.map(item => item[field]).filter(v => v))].sort();
    
    // Helper to get data available based on OTHER filters (Cascading)
    const getAvailableData = (targetField) => {
        return allData.filter(item => {
            const matchesDate = targetField === 'dateRange' || checkDateRange(item.ngay, currentFilters.dateRange, currentFilters.customCreatedDate);
            const matchesExpiration = targetField === 'expiration' || checkExpiration(item.ngay_ket_thuc, currentFilters.expirationRange, currentFilters.customExpirationDate);
            const matchesHospital = targetField === 'benh_vien' || currentFilters.benh_vien.length === 0 || currentFilters.benh_vien.includes(item.benh_vien);
            const matchesNPP = targetField === 'npp' || currentFilters.npp.length === 0 || currentFilters.npp.includes(item.nha_phan_phoi);
            const matchesArea = targetField === 'khu_vuc' || currentFilters.khu_vuc.length === 0 || currentFilters.khu_vuc.includes(item.khu_vuc);
            const matchesSector = targetField === 'nganh' || currentFilters.nganh.length === 0 || currentFilters.nganh.includes(item.nganh);
            const matchesPSR = targetField === 'psr' || currentFilters.psr.length === 0 || currentFilters.psr.includes(item.psr);
            return matchesDate && matchesExpiration && matchesHospital && matchesNPP && matchesArea && matchesSector && matchesPSR;
        });
    };

    const dateOpts = [
        { value: 'today', label: t('opt_today') },
        { value: 'week', label: t('opt_week') },
        { value: 'month', label: t('opt_month') },
        { value: 'quarter', label: t('opt_quarter') },
        { value: 'year', label: t('opt_year') }
    ];
    
    const expOpts = [
        { value: '7', label: t('opt_exp_7') },
        { value: '15', label: t('opt_exp_15') },
        { value: '30', label: t('opt_exp_30') },
        { value: '45', label: t('opt_exp_45') },
        { value: '90', label: t('opt_exp_90') },
        { value: '120', label: t('opt_exp_120') }
    ];

    // Render Function Wrapper
    const render = (id, opts, currentVals, key) => {
        renderMultiSelect(id, opts, currentVals, (newVals) => {
            currentFilters[key] = newVals;
            onFilterChangeCallback(); 
            updateFilterOptionsUI(allData, onFilterChangeCallback); 
        }, key === 'dateRange' || key === 'expirationRange'); 
    };

    // 1. Date (Special Render with Custom Range)
    renderDateFilterUI('filter-wrapper-date', dateOpts, currentFilters.dateRange, currentFilters.customCreatedDate, (type, val) => {
        if(type === 'preset') currentFilters.dateRange = val;
        if(type === 'custom') currentFilters.customCreatedDate = val; // {start, end}
        onFilterChangeCallback();
        updateFilterOptionsUI(allData, onFilterChangeCallback);
    });

    // 2. Expiration (Special Render - Number Input)
    renderDateFilterUI('filter-wrapper-expiration', expOpts, currentFilters.expirationRange, currentFilters.customExpirationDate, (type, val) => {
        if(type === 'preset') currentFilters.expirationRange = val;
        if(type === 'custom') currentFilters.customExpirationDate = val; // {days: '60'}
        onFilterChangeCallback();
        updateFilterOptionsUI(allData, onFilterChangeCallback);
    }, true);

    // 3. Hospital
    const hospData = getAvailableData('benh_vien');
    const hospOpts = getOptions(hospData, 'benh_vien').map(v => ({ value: v, label: v }));
    render('filter-wrapper-hospital', hospOpts, currentFilters.benh_vien, 'benh_vien');

    // 4. NPP
    const nppData = getAvailableData('npp');
    const nppOpts = getOptions(nppData, 'nha_phan_phoi').map(v => ({ value: v, label: v }));
    render('filter-wrapper-npp', nppOpts, currentFilters.npp, 'npp');

    // 5. Area
    const areaData = getAvailableData('khu_vuc');
    const areaOpts = getOptions(areaData, 'khu_vuc').map(v => ({ value: v, label: v }));
    render('filter-wrapper-area', areaOpts, currentFilters.khu_vuc, 'khu_vuc');

    // 6. Sector
    const sectorData = getAvailableData('nganh');
    const sectorOpts = getOptions(sectorData, 'nganh').map(v => ({ value: v, label: v }));
    render('filter-wrapper-sector', sectorOpts, currentFilters.nganh, 'nganh');

    // 7. PSR (New)
    const psrData = getAvailableData('psr');
    const psrOpts = getOptions(psrData, 'psr').map(v => ({ value: v, label: v }));
    render('filter-wrapper-psr', psrOpts, currentFilters.psr, 'psr');

    // Update Labels
    updateFilterLabels();
}

export function hasActiveFilters() {
    return currentFilters.dateRange.length > 0 || 
           currentFilters.expirationRange.length > 0 ||
           (currentFilters.customCreatedDate.start || currentFilters.customCreatedDate.end) ||
           (currentFilters.customExpirationDate.days) ||
           currentFilters.benh_vien.length > 0 || 
           currentFilters.npp.length > 0 || 
           currentFilters.khu_vuc.length > 0 || 
           currentFilters.nganh.length > 0 ||
           currentFilters.psr.length > 0;
}

// --- Internal Logic ---

function checkDateRange(dateStr, rangeArray, customRange) {
    const hasPreset = rangeArray && rangeArray.length > 0;
    const hasCustom = customRange && (customRange.start || customRange.end);

    if (!hasPreset && !hasCustom) return true;
    if (!dateStr) return false;
    // local parse helper YYYY-MM-DD -> Date at local midnight
    const parseYMD = (ymd) => {
        if (!ymd) return null;
        const parts = String(ymd).split('-').map(n => parseInt(n, 10));
        if (parts.length !== 3) return null;
        return new Date(parts[0], parts[1] - 1, parts[2]);
    };

    const d = new Date(dateStr);
    d.setHours(0,0,0,0);

    if (hasCustom) {
        let matchCustom = true;
        if (customRange.start) {
            const start = parseYMD(customRange.start);
            if (start) start.setHours(0,0,0,0);
            if (start && d < start) matchCustom = false;
        }
        if (customRange.end) {
            const end = parseYMD(customRange.end);
            if (end) end.setHours(23,59,59,999);
            if (end && d > end) matchCustom = false;
        }
        if (!matchCustom) return false;
    }

    if (!hasPreset) return true;

    // Helper to compute local range for presets
    const formatLocal = (dt) => {
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const day = String(dt.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };
    const getRangeForPreset = (preset) => {
        const now = new Date();
        if (preset === 'today') return { start: formatLocal(now), end: formatLocal(now) };
        if (preset === 'week') {
            const day = now.getDay();
            const diffToMonday = (day + 6) % 7;
            const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - diffToMonday); startOfWeek.setHours(0,0,0,0);
            const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6); endOfWeek.setHours(23,59,59,999);
            return { start: formatLocal(startOfWeek), end: formatLocal(endOfWeek) };
        }
        if (preset === 'month') {
            const s = new Date(now.getFullYear(), now.getMonth(), 1);
            const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            return { start: formatLocal(s), end: formatLocal(e) };
        }
        if (preset === 'quarter') {
            const quarter = Math.floor(now.getMonth() / 3);
            const s = new Date(now.getFullYear(), quarter * 3, 1);
            const e = new Date(now.getFullYear(), quarter * 3 + 3, 0);
            return { start: formatLocal(s), end: formatLocal(e) };
        }
        if (preset === 'year') {
            const s = new Date(now.getFullYear(), 0, 1);
            const e = new Date(now.getFullYear(), 11, 31);
            return { start: formatLocal(s), end: formatLocal(e) };
        }
        return null;
    };

    return rangeArray.some(range => {
        const r = getRangeForPreset(range);
        if (!r) return false;
        const s = parseYMD(r.start); if (s) s.setHours(0,0,0,0);
        const e = parseYMD(r.end); if (e) e.setHours(23,59,59,999);
        if (s && e) return d >= s && d <= e;
        return false;
    });
}

function checkExpiration(dateStr, rangeArray, customDate) {
    const hasPreset = rangeArray && rangeArray.length > 0;
    const hasCustom = customDate && customDate.days && parseInt(customDate.days) > 0;

    if (!hasPreset && !hasCustom) return true;
    if (!dateStr) return false;

    const d = new Date(dateStr);
    const now = new Date();
    d.setHours(0,0,0,0);
    now.setHours(0,0,0,0);

    // Custom exact days or "within X days" check. 
    // Usually "60 days" means "Expiring within the next 60 days".
    if (hasCustom) {
        const days = parseInt(customDate.days);
        const limit = new Date(now);
        limit.setDate(limit.getDate() + days);
        // If contract expires today or in future up to limit
        if (d >= now && d <= limit) return true;
        // If only custom is set and fails, return false. If preset is also set, continue to check preset (OR logic).
        if (!hasPreset) return false;
    }

    if (!hasPreset) return true;

    return rangeArray.some(days => {
        const limit = new Date(now);
        limit.setDate(limit.getDate() + parseInt(days));
        return d >= now && d <= limit;
    });
}

// Special Renderer for Date Filters (Created & Expiration)
function renderDateFilterUI(containerId, options, selectedValues, customValues, onUpdate, isExpiration = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const wasOpen = container.querySelector('.multi-select-dropdown')?.classList.contains('open');

    let btnText = t('opt_all');
    if (selectedValues.length > 0) {
        btnText = `${t('opt_selected')} (${selectedValues.length})`;
    } else if (isExpiration && customValues.days) {
        btnText = t('opt_custom_range');
    } else if (!isExpiration && (customValues.start || customValues.end)) {
        btnText = t('opt_custom_range');
    }

    // HTML Structure
    let customInputs = '';
    if (isExpiration) {
        // Changed to type="number"
        customInputs = `
            <div class="p-2 border-t border-gray-100 dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
                <span class="text-xs text-gray-500 dark:text-gray-400 block mb-1">Số ngày tới:</span>
                <input type="number" id="${containerId}-custom" class="w-full px-2 py-1 text-xs border rounded dark:bg-gray-600 dark:border-gray-500 dark:text-white" value="${customValues.days || ''}" placeholder="Nhập số ngày (vd: 60)">
            </div>
        `;
    } else {
        customInputs = `
            <div class="p-2 border-t border-gray-100 dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
                <span class="text-xs text-gray-500 dark:text-gray-400 block mb-1">Tùy chọn:</span>
                <div class="flex gap-1 items-center">
                    <input type="date" id="${containerId}-start" class="w-full px-1 py-1 text-[10px] border rounded dark:bg-gray-600 dark:border-gray-500 dark:text-white" value="${customValues.start || ''}">
                    <span class="text-gray-400">-</span>
                    <input type="date" id="${containerId}-end" class="w-full px-1 py-1 text-[10px] border rounded dark:bg-gray-600 dark:border-gray-500 dark:text-white" value="${customValues.end || ''}">
                </div>
            </div>
        `;
    }

    container.innerHTML = `
        <button type="button" class="multi-select-btn py-1.5 px-2 text-xs h-8">
            <span class="truncate">${btnText}</span>
            <svg class="w-3 h-3 ml-1 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
        </button>
        <div class="multi-select-dropdown ${wasOpen ? 'open' : ''}">
            <div class="multi-select-options custom-scrollbar max-h-40 overflow-y-auto">
                ${options.map(opt => `
                    <label class="checkbox-item text-xs text-gray-700 dark:text-gray-200">
                        <input type="checkbox" value="${opt.value}" ${selectedValues.includes(opt.value) ? 'checked' : ''}>
                        <span class="truncate">${opt.label}</span>
                    </label>
                `).join('')}
            </div>
            ${customInputs}
        </div>
    `;

    const btn = container.querySelector('.multi-select-btn');
    const dropdown = container.querySelector('.multi-select-dropdown');

    // Toggle Dropdown
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.multi-select-dropdown').forEach(d => {
            if (d !== dropdown) d.classList.remove('open');
        });
        dropdown.classList.toggle('open');
    });

    // Helper to format local YYYY-MM-DD
    const formatLocal = (dt) => {
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const d = String(dt.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };
    // Compute start/end for a preset
    const getRangeForPreset = (preset) => {
        const now = new Date();
        if (preset === 'today') return { start: formatLocal(now), end: formatLocal(now) };
        if (preset === 'week') {
            const day = now.getDay();
            const diffToMonday = (day + 6) % 7;
            const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - diffToMonday); startOfWeek.setHours(0,0,0,0);
            const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6); endOfWeek.setHours(23,59,59,999);
            return { start: formatLocal(startOfWeek), end: formatLocal(endOfWeek) };
        }
        if (preset === 'month') {
            const s = new Date(now.getFullYear(), now.getMonth(), 1);
            const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            return { start: formatLocal(s), end: formatLocal(e) };
        }
        if (preset === 'quarter') {
            const quarter = Math.floor(now.getMonth() / 3);
            const s = new Date(now.getFullYear(), quarter * 3, 1);
            const e = new Date(now.getFullYear(), quarter * 3 + 3, 0);
            return { start: formatLocal(s), end: formatLocal(e) };
        }
        if (preset === 'year') {
            const s = new Date(now.getFullYear(), 0, 1);
            const e = new Date(now.getFullYear(), 11, 31);
            return { start: formatLocal(s), end: formatLocal(e) };
        }
        return null;
    };

    // Checkbox Listeners (Presets) — also populate custom inputs when single preset selected
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            const val = cb.value;
            let newSelected = [...selectedValues];
            if (cb.checked) newSelected.push(val);
            else newSelected = newSelected.filter(v => v !== val);
            onUpdate('preset', newSelected);

            // Update custom inputs UI when exactly one preset is active
            if (!isExpiration) {
                const startInput = container.querySelector(`#${containerId}-start`);
                const endInput = container.querySelector(`#${containerId}-end`);
                if (newSelected.length === 1) {
                    const r = getRangeForPreset(newSelected[0]);
                    if (startInput) startInput.value = r.start || '';
                    if (endInput) endInput.value = r.end || '';
                } else {
                    // Clear inputs when multiple/no presets selected
                    if (startInput) startInput.value = customValues.start || '';
                    if (endInput) endInput.value = customValues.end || '';
                }
            }
        });
    });

    // Custom Input Listeners
    if (isExpiration) {
        const input = document.getElementById(`${containerId}-custom`);
        input.addEventListener('change', (e) => {
            onUpdate('custom', { days: e.target.value });
        });
        // Also trigger on input/keyup for smoother experience if desired, but change is safer for filter logic
    } else {
        const start = document.getElementById(`${containerId}-start`);
        const end = document.getElementById(`${containerId}-end`);
        const handleRangeChange = () => {
            onUpdate('custom', { start: start.value, end: end.value });
        };
        start.addEventListener('change', handleRangeChange);
        end.addEventListener('change', handleRangeChange);
    }
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
        <button type="button" class="multi-select-btn py-1.5 px-2 text-xs h-8">
            <span class="truncate">${btnText}</span>
            <svg class="w-3 h-3 ml-1 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
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
        'filter-wrapper-expiration': 'lbl_expiration',
        'filter-wrapper-hospital': 'lbl_hospital',
        'filter-wrapper-npp': 'lbl_distributor',
        'filter-wrapper-area': 'lbl_area',
        'filter-wrapper-sector': 'lbl_sector',
        'filter-wrapper-psr': 'lbl_psr'
    };
    for (const [id, key] of Object.entries(labels)) {
        const wrapper = document.getElementById(id);
        if (wrapper) {
            const labelEl = wrapper.previousElementSibling;
            if (labelEl) labelEl.textContent = t(key);
        }
    }
}