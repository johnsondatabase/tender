
import { sb, currentUser } from './app.js';

// Helper to log history
export async function logHistory(maThau, action, content) {
    if (!maThau) return;
    try {
        const user = currentUser ? (currentUser.ho_ten || currentUser.gmail) : 'Unknown';
        await sb.from('history').insert({
            ma_thau: maThau,
            nguoi_thuc_hien: user,
            hanh_dong: action,
            noi_dung: content
        });
    } catch (e) {
        console.warn("Could not log history. Ensure 'history' table exists.", e);
    }
}

// View History Function
// Accepts specificMaThau (from Kanban card) or defaults to Modal input (from Modal header)
export async function viewListingHistory(specificMaThau = null) {
    let maThau = specificMaThau;
    
    // If not passed explicitly, try to get from the open Listing Modal
    if (!maThau) {
        const inputEl = document.getElementById('l-ma-thau');
        if (inputEl) maThau = inputEl.value;
    }

    if (!maThau) return;

    const modal = document.getElementById('history-modal');
    const list = document.getElementById('history-list');
    
    if (modal) modal.classList.remove('hidden');
    if (list) list.innerHTML = '<div class="text-center text-gray-500 text-sm py-4">Đang tải dữ liệu...</div>';

    try {
        const { data, error } = await sb
            .from('history')
            .select('*')
            .eq('ma_thau', maThau)
            .order('ngay_tao', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            list.innerHTML = '<div class="text-center text-gray-500 text-sm py-8">Chưa có lịch sử hoạt động.</div>';
            return;
        }

        list.innerHTML = data.map(item => {
            const date = new Date(item.ngay_tao);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateStr = date.toLocaleDateString();
            
            let iconClass = "bg-gray-200 text-gray-600";
            if (item.hanh_dong.includes('Tạo')) iconClass = "bg-blue-100 text-blue-600";
            else if (item.hanh_dong.includes('Win')) iconClass = "bg-green-100 text-green-600";
            else if (item.hanh_dong.includes('Fail')) iconClass = "bg-red-100 text-red-600";
            else if (item.hanh_dong.includes('Đổi')) iconClass = "bg-yellow-100 text-yellow-600";
            else if (item.hanh_dong.includes('Cập nhật')) iconClass = "bg-indigo-100 text-indigo-600";

            return `
                <div class="relative pl-8 pb-4 timeline-item">
                    <div class="absolute left-0 top-0 w-8 h-8 flex items-center justify-center rounded-full ${iconClass} z-10 border-2 border-white dark:border-gray-800">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    </div>
                    <div class="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm">
                        <div class="flex justify-between items-start mb-1">
                            <span class="font-bold text-sm text-gray-800 dark:text-gray-200">${item.hanh_dong}</span>
                            <span class="text-xs text-gray-400 whitespace-nowrap">${timeStr} - ${dateStr}</span>
                        </div>
                        <p class="text-xs text-gray-600 dark:text-gray-300 mb-1 whitespace-pre-wrap">${item.noi_dung}</p>
                        <div class="text-[10px] text-gray-400 font-medium bg-gray-50 dark:bg-gray-700/50 inline-block px-2 py-0.5 rounded">
                            Bởi: ${item.nguoi_thuc_hien}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) {
        if (list) list.innerHTML = `<div class="text-center text-red-500 text-sm py-4">Lỗi tải lịch sử: ${e.message}</div>`;
    }
}
