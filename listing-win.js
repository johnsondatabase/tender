
import { sb, showToast, showLoading } from './app.js';
import { logHistory } from './lichsu.js';

let winTransitionListingId = null;
let winTransitionMaterials = [];
let winTransitionOriginalStatus = null;

// Hook to refresh the main listing board (set by listing.js)
let refreshBoardCallback = null; 

export function initWinSystem(refreshCallback) {
    refreshBoardCallback = refreshCallback;
    
    // Set up listeners once
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
    
    const btnCancel = document.getElementById('win-cancel-btn');
    if (btnCancel) btnCancel.addEventListener('click', cancelWinTransition);
    
    const btnSave = document.getElementById('win-save-btn');
    if (btnSave) btnSave.addEventListener('click', saveWinTransition);
}

// Expose to window for HTML access (like onchange in generated table)
window.updateWinMaterial = function(idx, val) {
    if (winTransitionMaterials[idx]) {
        winTransitionMaterials[idx].sl_trung = val;
    }
};

export async function openWinModal(maThau, fromStatus, domItem = null, domFromContainer = null) {
    winTransitionListingId = maThau;
    winTransitionOriginalStatus = fromStatus;
    
    showLoading(true);
    const { data: details, error } = await sb.from('detail').select('ma_vt, quota, sl_trung').eq('ma_thau', maThau);
    const { data: listingData } = await sb.from('listing').select('ngay_ky, ngay_ket_thuc').eq('ma_thau', maThau).single();
    showLoading(false);

    if (error) {
        showToast("Lỗi tải chi tiết: " + error.message, 'error');
        // Revert drag if it was a drag action
        if(domItem && domFromContainer) domFromContainer.appendChild(domItem);
        return;
    }

    // Initialize materials. IMPORTANT: Default sl_trung to quota if null/0/undefined so saving partial win works without editing
    winTransitionMaterials = (details || []).map(d => ({
        ...d,
        sl_trung: (d.sl_trung !== null && d.sl_trung !== undefined && d.sl_trung !== 0) ? d.sl_trung : d.quota
    }));
    
    // Populate Modal
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
                 value="${item.sl_trung}" 
                 onchange="window.updateWinMaterial(${idx}, this.value)">
            </td>
        `;
        container.appendChild(tr);
    });
}

function cancelWinTransition() {
    document.getElementById('win-transition-modal').classList.add('hidden');
    if (refreshBoardCallback) refreshBoardCallback(); // Revert visual drag
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

    // 1. Update Listing
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

    // 2. Update Details
    const { data: currentListingData } = await sb.from('listing').select('*').eq('ma_thau', winTransitionListingId).single();
    
    // Delete old Details
    await sb.from('detail').delete().eq('ma_thau', winTransitionListingId);
    
    // Prepare New Details
    const newDetails = winTransitionMaterials.map(m => {
        let finalSlTrung = m.quota; // Default Full
        if (winType === 'partial') {
            // Use the value from the array, which was initialized to quota if not touched
            finalSlTrung = m.sl_trung;
        }

        return {
            id: Math.floor(Math.random() * 2000000000),
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
    
    // Log
    await logHistory(winTransitionListingId, "Win (Thắng thầu)", `Thắng thầu loại: ${winType === 'full' ? 'Toàn phần' : 'Một phần'}. Ngày ký: ${ngayKy}.`);

    showLoading(false);
    document.getElementById('win-transition-modal').classList.add('hidden');
    showToast("Thắng thầu thành công!", "success");
    
    if (refreshBoardCallback) refreshBoardCallback();
}
