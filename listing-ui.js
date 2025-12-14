




import { translations, getCurrentLanguage } from './lang.js';
import { viewListingHistory } from './lichsu.js';
import { checkPermission } from './listing.js';
import * as ListingWin from './listing-win.js';
import { showToast } from './app.js'; // Import showToast

const t = (key) => {
    const lang = getCurrentLanguage();
    return translations[lang][key] || key;
};

export const COLUMNS = {
    'Listing': { 
        labelKey: 'col_listing', 
        borderColor: 'border-gray-400', 
        bgColor: 'bg-gray-50', 
        darkBgColor: 'dark:bg-gray-800',
        badgeColor: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
    },
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

let sortables = [];

// Callbacks injected from Controller
let onDeleteListing;
let onUpdateStatus;
let onOpenModal;

export function initUI(callbacks) {
    onDeleteListing = callbacks.onDelete;
    onUpdateStatus = callbacks.onUpdateStatus;
    onOpenModal = callbacks.onOpenModal;
}

export function renderBoard(data, currentMobileStatus) {
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
        if (!COLUMNS[status]) status = 'Listing'; // Default fallback to Listing if status unknown
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
    const colDef = COLUMNS[item.tinh_trang] || COLUMNS['Listing'];
    const statusColor = colDef.borderColor;
    const itemId = item.id !== undefined ? item.id : item.ma_thau;
    const progress = calculateProgress(item.ngay_ky, item.ngay_ket_thuc);
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('vi-VN') : '-';
    
    let fileCount = 0;
    try {
        const files = typeof item.files === 'string' ? JSON.parse(item.files) : (item.files || []);
        fileCount = Array.isArray(files) ? files.length : 0;
    } catch(e) { fileCount = 0; }

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

    const canEdit = checkPermission('sua');
    const canDelete = checkPermission('xoa');
    const isListingStatus = item.tinh_trang === 'Listing';

    el.innerHTML = `
        <div class="flex justify-between items-start mb-2">
             <div class="overflow-hidden mr-2">
                <h4 class="font-bold text-gray-800 dark:text-gray-100 text-sm leading-tight" title="${item.benh_vien || ''}">${item.benh_vien || 'Không tên'}</h4>
             </div>
             <div class="text-right flex-shrink-0 flex items-center gap-1">
                <button class="btn-copy-code p-1 text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors rounded hover:bg-gray-100 dark:hover:bg-gray-600" title="Sao chép">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                </button>
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
            
            ${canEdit && isListingStatus ? `<button class="btn-action-submit p-1 rounded hover:bg-blue-100 text-blue-600 dark:hover:bg-blue-900 dark:text-blue-400 transition-colors" title="Nộp thầu (Chuyển sang Waiting)"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg></button>` : ''}

            ${canEdit && !isListingStatus && item.tinh_trang !== 'Win' ? `<button class="btn-action-win p-1 rounded hover:bg-green-100 text-green-600 dark:hover:bg-green-900 dark:text-green-400 transition-colors" title="${t('col_win')}"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg></button>` : ''}
            ${canEdit && !isListingStatus && item.tinh_trang !== 'Fail' ? `<button class="btn-action-fail p-1 rounded hover:bg-red-100 text-red-600 dark:hover:bg-red-900 dark:text-red-400 transition-colors" title="${t('col_fail')}"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>` : ''}
            
            ${canEdit ? `<button class="btn-action-edit p-1 rounded hover:bg-blue-100 text-blue-600 dark:hover:bg-blue-900 dark:text-blue-400 transition-colors" title="${t('perm_edit')}"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg></button>` : ''}
            <button class="btn-action-history p-1 rounded hover:bg-yellow-100 text-yellow-600 dark:hover:bg-yellow-900 dark:text-yellow-400 transition-colors" title="Xem lịch sử"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></button>
            ${canDelete && item.tinh_trang === 'Fail' ? `<button class="btn-action-delete p-1 rounded hover:bg-gray-200 text-gray-500 dark:hover:bg-gray-600 dark:text-gray-400 transition-colors" title="${t('perm_delete')}"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>` : ''}
        </div>
    `;

    // Event Listeners
    el.querySelector('.btn-action-view').onclick = (e) => { e.stopPropagation(); onOpenModal(item, true); };
    if (canEdit) {
        const btnEdit = el.querySelector('.btn-action-edit');
        if(btnEdit) btnEdit.onclick = (e) => { e.stopPropagation(); onOpenModal(item, false); };
        
        const btnSubmit = el.querySelector('.btn-action-submit');
        if(btnSubmit) btnSubmit.onclick = (e) => { e.stopPropagation(); onUpdateStatus(item.ma_thau, 'Waiting'); };

        const btnWin = el.querySelector('.btn-action-win');
        if(btnWin) btnWin.onclick = (e) => { e.stopPropagation(); ListingWin.openWinModal(item.ma_thau, item.tinh_trang); };
        
        const btnFail = el.querySelector('.btn-action-fail');
        if(btnFail) btnFail.onclick = (e) => { e.stopPropagation(); onUpdateStatus(item.ma_thau, 'Fail'); };
    }
    el.querySelector('.btn-action-history').onclick = (e) => { e.stopPropagation(); viewListingHistory(item.ma_thau); };
    
    // Copy Logic
    const btnCopy = el.querySelector('.btn-copy-code');
    if (btnCopy) {
        btnCopy.onclick = (e) => {
            e.stopPropagation();
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(item.ma_thau).then(() => {
                    showToast(t('msg_copy_success'), 'success');
                });
            } else {
                // Fallback for non-secure context
                showToast(t('msg_copy_success') + ' (Manual)', 'success');
            }
        };
    }
    
    if (canDelete) {
        const btnDelete = el.querySelector('.btn-action-delete');
        if(btnDelete) btnDelete.onclick = (e) => { e.stopPropagation(); onDeleteListing(item.ma_thau); };
    }

    return el;
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

                if (!checkPermission('sua')) {
                    if(window.fetchListings) window.fetchListings(true);
                    return;
                }

                if (newStatus !== oldStatus) {
                    if (oldStatus === 'Listing' && newStatus !== 'Waiting') {
                        showToast("Chỉ có thể chuyển hồ sơ Listing sang trạng thái Waiting (Nộp thầu).", "error");
                        if(window.fetchListings) window.fetchListings(true); 
                        return;
                    }

                    if (newStatus === 'Win') {
                        ListingWin.openWinModal(maThau, oldStatus, itemEl, evt.from);
                    } else if (newStatus === 'Fail') {
                        onUpdateStatus(maThau, 'Fail');
                    } else if (newStatus === 'Waiting') {
                        onUpdateStatus(maThau, 'Waiting');
                    } else {
                        onUpdateStatus(maThau, newStatus);
                    }
                }
            }
        });
        sortables.push(sortable);
    });
}

export function switchMobileTab(status) {
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