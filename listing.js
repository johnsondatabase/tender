import { sb, showToast, showLoading, showConfirm, currentUser } from './app.js';
import { translations, getCurrentLanguage, setLanguage } from './lang.js';
import { logHistory, viewListingHistory } from './lichsu.js';
import * as ListingFilter from './listing-filter.js';
import * as ListingWin from './listing-win.js';
import * as ListingUI from './listing-ui.js';
import * as ListingModal from './listing-form.js';
import * as ListingIO from './listing-io.js';

// --- Global Exports for HTML Access ---
window.viewListingHistory = viewListingHistory;
window.fetchListings = fetchListings;
window.openListingModal = ListingModal.openListingModal;
window.closeListingModal = ListingModal.closeListingModal;
window.saveListing = ListingModal.saveListing;
window.notifyAdmins = notifyAdmins;
window.getListingsCache = getListingsCache;

// --- State ---
let listingsCache = [];
let realtimeChannel = null;
let isListingLoaded = false;

const t = (key) => {
    const lang = getCurrentLanguage();
    return translations[lang][key] || key;
};

// --- Helpers ---
export function getListingsCache() {
    return listingsCache;
}

export function checkPermission(action) {
    if (!currentUser) return false;
    if (currentUser.phan_quyen === 'Admin') return true;
    try {
        const perms = Array.isArray(currentUser[action]) ? currentUser[action] : JSON.parse(currentUser[action] || '[]');
        return perms.includes('view-ton-kho');
    } catch(e) { return false; }
}

 

export async function notifyAdmins(title, content, actionData = null, type = 'info') {
    try {
        const { data: admins } = await sb.from('user').select('gmail').eq('phan_quyen', 'Admin');
        if (!admins || admins.length === 0) return;
        
        const notifications = admins.map(admin => ({
            gui_den_gmail: admin.gmail, tieu_de: title, noi_dung: content, loai: type, metadata: actionData
        }));
        
        const { error } = await sb.from('thong_bao').insert(notifications);
        if (error) {
            const simpleNotifs = notifications.map(n => ({ gui_den_gmail: n.gui_den_gmail, tieu_de: n.tieu_de, noi_dung: n.noi_dung, loai: n.loai }));
            await sb.from('thong_bao').insert(simpleNotifs);
        }
    } catch (e) { console.error("Notify error", e); }
}

// --- Main Init ---
export function onShowListingView() {
    const container = document.getElementById('view-ton-kho');
    
    // Check if board already exists. If yes, return immediately for instant switching.
    if (container.querySelector('#kanban-board')) {
        // Just refresh translations headers if needed
        Object.keys(ListingUI.COLUMNS).forEach(status => {
            const colHeader = document.querySelector(`#col-wrapper-${status} span[data-i18n]`);
            if(colHeader) colHeader.textContent = t(ListingUI.COLUMNS[status].labelKey);
        });
        const searchInput = document.getElementById('listing-search');
        if(searchInput) searchInput.placeholder = t('search_placeholder');
        
        // Re-apply filters to ensure board is consistent
        applyFilters();
        
        // Perform silent background update
        fetchListings(true);
        return; 
    }

    // First time load: Inject HTML
    container.innerHTML = getListingViewHTML(); 
    
    setupFilterListeners();
    ListingWin.initWinSystem(fetchListings);
    
    ListingUI.initUI({
        onDelete: deleteListing,
        onUpdateStatus: updateListingStatus,
        onOpenModal: ListingModal.openListingModal
    });

    setupDOMListeners();

    if (!realtimeChannel) {
        realtimeChannel = sb.channel('public:listing_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'listing' }, () => fetchListings(true))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'detail' }, () => fetchListings(true))
            .subscribe();
    }

    if (isListingLoaded) {
        applyFilters();
        fetchListings(true);
    } else {
        // Initial fetch - do not await here to block UI
        fetchListings(false);
    }
}

function setupDOMListeners() {
    const btnAdd = document.getElementById('btn-add-listing');
    if(btnAdd) btnAdd.addEventListener('click', () => ListingModal.openListingModal());
    
    // Mobile Menu
    const btnMobileAdd = document.getElementById('btn-mobile-add-menu');
    const mobileAddDropdown = document.getElementById('mobile-add-dropdown');
    if (btnMobileAdd && mobileAddDropdown) {
        btnMobileAdd.addEventListener('click', (e) => { e.stopPropagation(); mobileAddDropdown.classList.toggle('hidden'); });
        document.addEventListener('click', (e) => {
            if (!mobileAddDropdown.contains(e.target) && !btnMobileAdd.contains(e.target)) mobileAddDropdown.classList.add('hidden');
        });
    }

    const btnManual = document.getElementById('btn-mobile-manual');
    const btnExcel = document.getElementById('btn-mobile-excel');
    const btnTempl = document.getElementById('btn-mobile-template');
    const inputImport = document.getElementById('import-excel-input');
    const btnImport = document.getElementById('btn-import-excel');
    const btnTemplate = document.getElementById('btn-download-template');

    if (btnManual) btnManual.addEventListener('click', () => { mobileAddDropdown.classList.add('hidden'); ListingModal.openListingModal(); });
    if (btnExcel) btnExcel.addEventListener('click', () => { mobileAddDropdown.classList.add('hidden'); inputImport.click(); });
    if (btnTempl) btnTempl.addEventListener('click', () => { mobileAddDropdown.classList.add('hidden'); ListingIO.downloadImportTemplate(); });
    
    if (btnImport && inputImport) btnImport.addEventListener('click', () => inputImport.click());
    if (inputImport) inputImport.addEventListener('change', ListingIO.handleExcelImport);
    if (btnTemplate) btnTemplate.addEventListener('click', ListingIO.downloadImportTemplate);

    document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => ListingUI.switchMobileTab(e.currentTarget.dataset.status));
    });
    
    const btnAddMaterial = document.getElementById('btn-add-material');
    if (btnAddMaterial) btnAddMaterial.addEventListener('click', ListingModal.addMaterialRow);

    const fileInput = document.getElementById('file-upload-input');
    if(fileInput) fileInput.addEventListener('change', (e) => ListingModal.handleFileUpload(e.target.files));
    
    const modal = document.getElementById('listing-modal');
    if(modal) modal.addEventListener('paste', ListingModal.handlePaste);
    
    const dateInput = document.getElementById('l-ngay');
    const hospitalInput = document.getElementById('l-benh-vien');
    if (dateInput) dateInput.addEventListener('change', ListingModal.generateMaThau);
    if (hospitalInput) hospitalInput.addEventListener('input', ListingModal.generateMaThau);

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.multi-select-container')) {
            document.querySelectorAll('.multi-select-dropdown').forEach(d => d.classList.remove('open'));
        }
    });

    document.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape') {
            const listingModal = document.getElementById('listing-modal');
            const historyModal = document.getElementById('history-modal');
            const winModal = document.getElementById('win-transition-modal');
            
            if (winModal && !winModal.classList.contains('hidden')) winModal.classList.add('hidden');
            else if (historyModal && !historyModal.classList.contains('hidden')) historyModal.classList.add('hidden');
            else if (listingModal && !listingModal.classList.contains('hidden')) await ListingModal.closeListingModal();
        }
    });
}

// --- Data Controller ---

export async function fetchListings(silent = false) {
    if(!silent) showLoading(true);
    const { data, error } = await sb.from('listing').select('*').order('ma_thau', { ascending: true });
    
    if (error) {
        if(!silent) showLoading(false);
        showToast('Lỗi tải dữ liệu: ' + error.message, 'error');
        return;
    }

    // Filter Logic for "View" Role
    let processedData = data || [];
    
    if (currentUser && currentUser.phan_quyen === 'View') {
        const myName = currentUser.ho_ten || '';
        let allowedViewers = [];
        try {
            if (Array.isArray(currentUser.viewer)) {
                allowedViewers = currentUser.viewer;
            } else if (typeof currentUser.viewer === 'string') {
                allowedViewers = JSON.parse(currentUser.viewer || '[]');
            }
        } catch (e) {
            console.error("Error parsing viewer permissions", e);
            allowedViewers = [];
        }

        processedData = processedData.filter(item => {
            const itemPsr = item.psr || '';
            // Show if PSR is me OR PSR is in my allowed viewer list
            return itemPsr === myName || allowedViewers.includes(itemPsr);
        });
    }
    
    const maThauList = processedData.map(l => l.ma_thau);
    let detailStats = {};
    if (maThauList.length > 0) {
        const { data: details } = await sb.from('detail').select('ma_thau, quota, sl_trung').in('ma_thau', maThauList);
        if (details) {
            details.forEach(d => {
                if (!detailStats[d.ma_thau]) detailStats[d.ma_thau] = { count: 0, quota: 0, won: 0 };
                detailStats[d.ma_thau].count += 1;
                detailStats[d.ma_thau].quota += (d.quota || 0);
                detailStats[d.ma_thau].won += (d.sl_trung || 0);
            });
        }
    }

    listingsCache = processedData.map(l => ({ ...l, stats: detailStats[l.ma_thau] || { count: 0, quota: 0, won: 0 } })) || [];
    isListingLoaded = true;
    
    if(!silent) showLoading(false);

    const onFilterChange = () => { applyFilters(); if(window.updateFilterButton) window.updateFilterButton(); };
    ListingFilter.updateFilterOptionsUI(listingsCache, onFilterChange);
    
    applyFilters();
}

function applyFilters() {
    const filtered = ListingFilter.getFilteredData(listingsCache);
    const currentMobileStatus = document.querySelector('.mobile-tab-btn.bg-blue-100')?.dataset.status || 'Waiting';
    ListingUI.renderBoard(filtered, currentMobileStatus);
}

export async function updateListingStatus(maThau, newStatus, silent = false) {
    if (!silent) showLoading(true);
    let error = null;
    let submitResult = null;

    // If changing to Waiting (submission), show confirmation modal to enter submission details
    if (newStatus === 'Waiting' && !silent) {
        try {
            submitResult = await showSubmitModal(maThau);
            // If user cancelled modal, abort
            if (!submitResult || submitResult.cancelled) {
                if (!silent) showLoading(false);
                return;
            }
            // Apply updates: set listing status and optional dates
            const listingUpdate = { tinh_trang: newStatus };
            if (submitResult.ngay_ky) listingUpdate.ngay_ky = submitResult.ngay_ky;
            if (submitResult.ngay_ket_thuc) listingUpdate.ngay_ket_thuc = submitResult.ngay_ket_thuc;

            const { error: listingError } = await sb.from('listing').update(listingUpdate).eq('ma_thau', maThau);
            if (listingError) error = listingError;
            else {
                // Update details with submitted quantities and status
                // submitResult.materials = [{ma_vt, submitted}]
                const { data: details } = await sb.from('detail').select('*').eq('ma_thau', maThau);
                if (details && details.length > 0) {
                    const updates = details.map(d => {
                        const found = submitResult.materials.find(m => m.ma_vt === d.ma_vt);
                        const submitted = found ? (found.submitted || 0) : 0;
                        const updateData = {
                            ...d,
                            tinh_trang: newStatus,
                            sl_trung: submitted
                        };
                        // Khi nộp 1 phần, cập nhật quota xuống bằng số lượng nộp
                        if (submitResult.type === 'partial') {
                            updateData.quota = submitted;
                        }
                        return updateData;
                    });
                    const { error: upsertError } = await sb.from('detail').upsert(updates);
                    if (upsertError) error = upsertError;
                }
            }
        } catch (e) {
            console.error(e);
            error = e;
        }
    } else {
        // Default behavior for other statuses
        const listingUpdate = { tinh_trang: newStatus };
        const { error: listingError } = await sb.from('listing').update(listingUpdate).eq('ma_thau', maThau);
        if (listingError) error = listingError;
        else {
            if (newStatus === 'Fail') {
                 const { error: detError } = await sb.from('detail').update({ tinh_trang: newStatus, sl_trung: 0 }).eq('ma_thau', maThau);
                 if(detError) error = detError;
            } else {
                 const { error: detError } = await sb.from('detail').update({ tinh_trang: newStatus }).eq('ma_thau', maThau);
                 if(detError) error = detError;
            }
        }
    }

    if (!silent) showLoading(false);

    // Log history regardless of error status (but only if operation was attempted)
    if (submitResult !== null || newStatus !== 'Waiting') {
        let historyContent = `Chuyển sang trạng thái: ${newStatus}`;
        if (newStatus === 'Waiting' && submitResult) {
            if (submitResult.type === 'partial') {
                historyContent += `\nNộp 1 phần với số lượng:\n${submitResult.materials.map(m => `- ${m.ma_vt}: ${m.submitted}`).join('\n')}`;
            } else {
                historyContent += `\nNộp toàn phần`;
            }
            if (submitResult.ngay_ky) historyContent += `\nNgày ký: ${submitResult.ngay_ky}`;
            if (submitResult.ngay_ket_thuc) historyContent += `\nNgày kết thúc: ${submitResult.ngay_ket_thuc}`;
        }
        await logHistory(maThau, "Đổi trạng thái", historyContent);
    }

    if (error) {
         if(!silent) showToast('Cập nhật thất bại: ' + error.message, 'error');
         await fetchListings();
    } else {
        if(!silent) {
            showToast(t('msg_update_success'), 'success');
            await fetchListings();
        }
    }
}

async function deleteListing(maThau) {
    if (await showConfirm(t('confirm_msg'))) {
        showLoading(true);
        const { error } = await sb.from('listing').delete().eq('ma_thau', maThau);
        if (!error) await sb.from('detail').delete().eq('ma_thau', maThau);

        showLoading(false);
        if (error) showToast('Xóa thất bại', 'error');
        else {
            showToast(t('msg_delete_success'), 'success');
            await fetchListings();
        }
    }
}

// Show submission modal for changing status to Waiting
async function showSubmitModal(maThau) {
    return new Promise(async (resolve) => {
        // Create modal container
        const modalId = 'submit-transition-modal';
        let modal = document.getElementById(modalId);
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'fixed inset-0 z-[11000] flex items-center justify-center modal-backdrop p-4';
        // Use same style structure as Win confirmation to keep UI consistent
        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                <div class="p-4 border-b dark:border-gray-700 bg-green-50 dark:bg-green-900/30 flex justify-between items-start">
                    <div>
                        <h3 class="text-lg font-bold text-green-800 dark:text-green-300">${t('submit_modal_title')}</h3>
                        <p class="text-sm text-green-600 dark:text-green-400 mt-1">${t('submit_modal_desc')}</p>
                    </div>
                    <button id="submit-close-x" class="text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-1 rounded ml-4">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>
                <div class="p-4 max-h-[60vh] overflow-y-auto">
                    <div class="mb-3 flex items-center gap-6">
                        <label class="inline-flex items-center gap-2"><input type="radio" name="submit-type" value="full" checked class="w-4 h-4 text-green-600"> <span class="text-sm font-medium">${t('submit_full')}</span></label>
                        <label class="inline-flex items-center gap-2"><input type="radio" name="submit-type" value="partial" class="w-4 h-4 text-green-600"> <span class="text-sm font-medium">${t('submit_partial')}</span></label>
                    </div>

                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">${t('lbl_signed_date')}</label>
                            <input type="date" id="submit-ngay-ky" class="w-full px-3 py-2 border rounded dark:bg-gray-700 dark:border-gray-600">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">${t('lbl_end_date')}</label>
                            <input type="date" id="submit-ngay-kt" class="w-full px-3 py-2 border rounded dark:bg-gray-700 dark:border-gray-600">
                        </div>
                    </div>

                    <div id="submit-materials-wrapper" class="hidden">
                        <div class="mb-2 font-semibold text-sm text-gray-700 dark:text-gray-200">${t('submit_adjust_materials')}</div>
                        <div>
                            <table class="w-full text-sm text-left">
                                <thead class="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-200 sticky top-0">
                                    <tr><th class="px-2 py-2">${t('prod_ma_vt')}</th><th class="px-2 py-2 text-right">${t('lbl_quota')}</th><th class="px-2 py-2 text-right">${t('lbl_submitted')}</th></tr>
                                </thead>
                                <tbody id="submit-materials-body" class="bg-white dark:bg-gray-800"></tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <div class="p-4 border-t dark:border-gray-700 flex justify-end gap-3 bg-gray-50 dark:bg-gray-800">
                    <button id="submit-cancel-btn" class="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">${t('btn_cancel')}</button>
                    <button id="submit-confirm-btn" class="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">${t('submit_save')}</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        // Translate dynamic modal elements immediately
        try { setLanguage(getCurrentLanguage()); } catch (e) { /* ignore */ }

        // Load detail rows for this listing
        const { data: details, error } = await sb.from('detail').select('ma_vt, quota, sl_trung').eq('ma_thau', maThau);
        const body = modal.querySelector('#submit-materials-body');
        if (error || !body) {
            resolve({ cancelled: true });
            modal.remove();
            return;
        }

        // Populate rows
        details.forEach((d, idx) => {
            const q = d.quota || 0;
            const defaultSl = d.sl_trung || (q);
            const tr = document.createElement('tr');
            tr.innerHTML = `<td class="px-2 py-2">${d.ma_vt}</td><td class="px-2 py-2 text-right">${Number(q).toLocaleString()}</td><td class="px-2 py-2 text-right"><input type="number" data-vt="${d.ma_vt}" value="${defaultSl}" class="w-24 text-right px-2 py-1 border rounded"></td>`;
            body.appendChild(tr);
        });

        const cancelBtn = modal.querySelector('#submit-cancel-btn');
        const confirmBtn = modal.querySelector('#submit-confirm-btn');
        const typeInputs = modal.querySelectorAll('input[name="submit-type"]');

        // Toggle materials section visibility depending on selection
        const materialsWrapper = modal.querySelector('#submit-materials-wrapper');
        const setMaterialsVisibility = () => {
            const selectedType = Array.from(typeInputs).find(i => i.checked)?.value || 'full';
            if (materialsWrapper) materialsWrapper.classList.toggle('hidden', selectedType !== 'partial');
        };
        typeInputs.forEach(i => i.addEventListener('change', setMaterialsVisibility));
        // initial
        setMaterialsVisibility();

        cancelBtn.onclick = () => {
            modal.remove();
            resolve({ cancelled: true });
        };
        // Close X behavior
        const closeX = modal.querySelector('#submit-close-x');
        if (closeX) closeX.onclick = () => { modal.remove(); resolve({ cancelled: true }); };

        // ESC to close modal (local handler)
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                if (document.getElementById(modalId)) {
                    modal.remove();
                    document.removeEventListener('keydown', escHandler);
                    resolve({ cancelled: true });
                }
            }
        };
        document.addEventListener('keydown', escHandler);

        confirmBtn.onclick = () => {
            const selectedType = Array.from(typeInputs).find(i => i.checked)?.value || 'full';
            const ngayKy = modal.querySelector('#submit-ngay-ky').value || null;
            const ngayKt = modal.querySelector('#submit-ngay-kt').value || null;
            const materials = Array.from(modal.querySelectorAll('input[data-vt]')).map(inp => ({
                ma_vt: inp.dataset.vt,
                submitted: Number(inp.value) || 0
            }));

            modal.remove();
            resolve({ cancelled: false, type: selectedType, ngay_ky: ngayKy, ngay_ket_thuc: ngayKt, materials });
        };
    });
}

// --- UI Generators & Event Binding ---

function setupFilterListeners() {
    document.getElementById('listing-search').addEventListener('input', (e) => {
        ListingFilter.setFilterKeyword(e.target.value);
        applyFilters();
        if(window.updateFilterButton) window.updateFilterButton();
    });

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
                e.preventDefault(); e.stopPropagation(); 
                ListingFilter.resetFilters(); 
                document.getElementById('listing-search').value = ''; 
                const onFilterChange = () => { applyFilters(); updateToggleButtonState(); };
                applyFilters(); 
                ListingFilter.updateFilterOptionsUI(listingsCache, onFilterChange);
                updateToggleButtonState();
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
            if (isHidden) { filterPanel.classList.remove('translate-x-full', 'hidden'); filterBackdrop.classList.remove('hidden'); } 
            else { filterPanel.classList.add('translate-x-full'); setTimeout(() => filterPanel.classList.add('hidden'), 300); filterBackdrop.classList.add('hidden'); }
        } else {
            if (filterPanel.classList.contains('md:block')) { filterPanel.classList.remove('md:block'); filterPanel.classList.add('hidden'); } 
            else { filterPanel.classList.add('md:block'); filterPanel.classList.remove('hidden'); }
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

    window.updateFilterButton = updateToggleButtonState;
    updateToggleButtonState();
}

function getListingViewHTML() {
    let canImport = false;
    if (currentUser && currentUser.phan_quyen === 'Admin') canImport = true;
    else if (currentUser) {
        let importPerms = [];
        try { importPerms = Array.isArray(currentUser.nhap) ? currentUser.nhap : JSON.parse(currentUser.nhap || '[]'); } catch(e) {}
        if(importPerms.includes('view-ton-kho')) canImport = true;
    }
    const canAdd = checkPermission('them');

    const desktopImportButtons = canImport ? `<div class="hidden md:flex gap-1 ml-2"><button id="btn-download-template" class="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg flex items-center justify-center gap-1 transition-colors text-xs font-medium" title="Tải mẫu Excel"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>Mẫu</button><button id="btn-import-excel" class="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg shadow flex items-center justify-center gap-1 transition-colors text-xs font-medium"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>Import</button></div>` : '';
    const mobileImportItems = canImport ? `<button id="btn-mobile-excel" class="block w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 border-b border-gray-100 flex items-center gap-2"><svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg> ${t('btn_import')}</button><button id="btn-mobile-template" class="block w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"><svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg> ${t('btn_download_template')}</button>` : '';
    const desktopAddButton = canAdd ? `<button id="btn-add-listing" class="hidden md:flex flex-shrink-0 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow items-center justify-center gap-1 transition-colors"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg><span class="text-sm" data-i18n="btn_add_new">Thêm Mới</span></button>` : '';
    const mobileAddButton = canAdd ? `<div class="md:hidden relative"><button id="btn-mobile-add-menu" class="flex-shrink-0 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow flex items-center justify-center gap-1 transition-colors h-full" title="${t('btn_add_new')}"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg><span class="sr-only" data-i18n="btn_add_new">${t('btn_add_new')}</span></button><div id="mobile-add-dropdown" class="hidden absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden"><button id="btn-mobile-manual" class="block w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 border-b border-gray-100 flex items-center gap-2"><svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg> ${t('btn_manual_add')}</button>${mobileImportItems}</div></div>` : '';

    return `<div class="flex flex-col h-full relative"><input type="file" id="import-excel-input" accept=".xlsx, .xls" class="hidden" /><div class="sticky top-0 z-20 bg-gray-50 dark:bg-gray-900 pb-2 pt-1 mb-2 flex flex-col gap-2 transition-colors duration-300 shadow-sm md:shadow-none border-b dark:border-gray-700"><div class="flex flex-row justify-between items-center gap-2"><div class="relative flex-1"><span class="absolute inset-y-0 left-0 flex items-center pl-3"><svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg></span><input type="text" id="listing-search" class="w-full pl-9 pr-2 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white transition-colors" data-i18n="search_placeholder" placeholder="Tìm kiếm..."></div><button id="btn-toggle-filter" class="flex-shrink-0 w-10 md:w-auto px-0 md:px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center gap-1 transition-colors relative md:min-w-[100px]"></button>${desktopImportButtons}${desktopAddButton}${mobileAddButton}</div><div id="filter-backdrop" class="fixed inset-0 bg-black/50 z-30 hidden md:hidden transition-opacity"></div><div id="filter-panel" class="fixed inset-y-0 right-0 z-40 w-80 bg-white dark:bg-gray-800 shadow-2xl transform translate-x-full transition-transform duration-300 md:static md:w-full md:shadow-none md:transform-none md:translate-x-0 md:bg-gray-50 md:dark:bg-gray-900 md:border md:dark:border-gray-700 md:rounded-lg hidden flex flex-col md:block"><div class="flex items-center justify-between p-4 border-b dark:border-gray-700 md:hidden bg-primary text-white"><h3 class="font-bold text-lg" data-i18n="lbl_filter_title">Bộ Lọc Tìm Kiếm</h3><button id="btn-close-filter-mobile" class="p-1 hover:bg-white/20 rounded"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button></div><div class="p-2 grid grid-cols-1 md:grid-cols-7 gap-2 overflow-y-auto md:overflow-visible flex-1 items-end"><div class="filter-group relative"><label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-0.5 uppercase tracking-wide truncate" data-i18n="lbl_date_created">Ngày tạo</label><div id="filter-wrapper-date" class="multi-select-container"></div></div><div class="filter-group relative"><label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-0.5 uppercase tracking-wide truncate" data-i18n="lbl_expiration">Ngày hết hạn</label><div id="filter-wrapper-expiration" class="multi-select-container"></div></div><div class="filter-group relative"><label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-0.5 uppercase tracking-wide truncate" data-i18n="lbl_hospital">Bệnh Viện</label><div id="filter-wrapper-hospital" class="multi-select-container"></div></div><div class="filter-group relative"><label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-0.5 uppercase tracking-wide truncate" data-i18n="lbl_distributor">Nhà Phân Phối</label><div id="filter-wrapper-npp" class="multi-select-container"></div></div><div class="filter-group relative"><label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-0.5 uppercase tracking-wide truncate" data-i18n="lbl_area">Khu Vực</label><div id="filter-wrapper-area" class="multi-select-container"></div></div><div class="filter-group relative"><label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-0.5 uppercase tracking-wide truncate" data-i18n="lbl_sector">Ngành</label><div id="filter-wrapper-sector" class="multi-select-container"></div></div><div class="filter-group relative"><label class="block text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-0.5 uppercase tracking-wide truncate" data-i18n="lbl_psr">PSR</label><div id="filter-wrapper-psr" class="multi-select-container"></div></div></div><div class="p-4 border-t dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900 md:hidden"><button id="btn-reset-filter-mobile" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium flex items-center gap-2" data-i18n="btn_clear_filter"><svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>Xóa lọc</button><button id="btn-apply-filter-mobile" class="px-6 py-2 bg-primary text-white rounded-lg shadow font-medium" data-i18n="btn_confirm">Áp dụng</button></div></div></div><div class="md:hidden flex space-x-1 mb-3 bg-white dark:bg-gray-800 p-1 rounded-lg border dark:border-gray-700 overflow-x-auto no-scrollbar flex-shrink-0">${Object.keys(ListingUI.COLUMNS).map(status => `<button class="mobile-tab-btn flex-1 py-1.5 px-2 text-xs font-medium rounded text-center whitespace-nowrap transition-colors border border-transparent ${status === 'Waiting' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200 dark:border-blue-800' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'}" data-status="${status}">${t(ListingUI.COLUMNS[status].labelKey)} <span id="mobile-count-${status}" class="ml-1 text-[10px] bg-gray-200 dark:bg-gray-600 rounded-full px-1.5">0 (0%)</span></button>`).join('')}</div><div id="kanban-board" class="flex-1 overflow-x-auto overflow-y-hidden pb-2"><div class="flex h-full gap-4 md:min-w-[900px]">${Object.keys(ListingUI.COLUMNS).map(status => { const colDef = ListingUI.COLUMNS[status]; const hiddenClass = (status !== 'Waiting') ? 'hidden md:flex' : 'flex'; return `<div id="col-wrapper-${status}" class="kanban-col-wrapper flex-1 flex-col w-full md:min-w-[300px] h-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100/50 dark:bg-gray-800/50 transition-colors ${hiddenClass}"><div class="p-3 font-bold text-gray-700 dark:text-gray-200 border-b border-gray-300 dark:border-gray-600 flex justify-between items-center sticky top-0 rounded-t-xl z-10 backdrop-blur-sm bg-opacity-90 ${colDef.bgColor} ${colDef.darkBgColor}"><span data-i18n="${colDef.labelKey}">${t(colDef.labelKey)}</span><div class="flex items-center"><span class="text-xs bg-white dark:bg-gray-600 text-gray-600 dark:text-gray-200 px-2 py-0.5 rounded-full shadow-sm font-mono" id="count-${status}">0</span><span id="percent-${status}" class="text-[10px] text-gray-500 dark:text-gray-400 ml-1">(0%)</span></div></div><div id="col-${status}" data-status="${status}" class="kanban-col flex-1 overflow-y-auto p-2 space-y-3 custom-scrollbar"></div></div>`}).join('')}</div></div></div>`;
}