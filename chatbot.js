
import { GoogleGenAI } from "@google/genai";
import { showToast, showLoading, sb, showView, currentUser } from './app.js';
import { openListingModal } from './listing-form.js';

let chatSession = null;
let aiClient = null;
let currentImageBlob = null;
let globalApiKey = '';

// --- QUẢN LÝ API KEY ---
const DEFAULT_API_KEY = 'AIzaSyDMMoL4G5FDGPNUB2e84XNsNIQo68USVdQ'; 

async function fetchGlobalApiKey() {
    try {
        const { data, error } = await sb
            .from('app_config')
            .select('value')
            .eq('key', 'gemini_api_key')
            .maybeSingle(); 

        if (!error && data && data.value) {
            globalApiKey = data.value;
        }
    } catch (e) {
        console.warn("Could not fetch global API key:", e);
    }
}

async function saveGlobalApiKey(key) {
    try {
        const { error } = await sb
            .from('app_config')
            .upsert({ key: 'gemini_api_key', value: key });

        if (error) throw error;
        globalApiKey = key;
        return true;
    } catch (e) {
        console.error("Error saving global API key:", e);
        showToast("Lỗi lưu Key hệ thống. Đã lưu cục bộ.", "info");
        return false;
    }
}

const getApiKey = () => {
    if (globalApiKey && globalApiKey.trim().length > 10) return globalApiKey;
    const storedKey = localStorage.getItem('user_gemini_api_key');
    if (storedKey && storedKey.trim().length > 10) return storedKey;
    return DEFAULT_API_KEY;
};

// --- HELPERS FOR SMART MAPPING ---

// Generic function to find best match in DB column
async function findBestMatchInDB(tableName, columnName, inputValue) {
    if (!inputValue) return inputValue;
    
    // Fetch distinct values for this column
    // Note: For large datasets, this should be optimized or cached/search via RPC
    const { data } = await sb.from(tableName).select(columnName);
    
    if (!data || data.length === 0) return inputValue;

    const lowerInput = inputValue.toLowerCase().trim()
        .replace(/\./g, ' ')
        .replace(/\s+/g, ' '); // Normalize spaces

    const uniqueValues = [...new Set(data.map(item => item[columnName]).filter(v => v))];
    
    // 1. Exact contains match (priority)
    const match = uniqueValues.find(val => {
        const lowerVal = val.toLowerCase();
        return lowerVal.includes(lowerInput) || lowerInput.includes(lowerVal);
    });

    return match || inputValue; // Return match or original if not found
}

async function validateProducts(materials) {
    if (!materials || materials.length === 0) return { valid: true, items: [] };

    const { data: products } = await sb.from('product').select('ma_vt');
    const validCodes = new Set(products ? products.map(p => p.ma_vt.toLowerCase()) : []);
    const productMap = new Map(products ? products.map(p => [p.ma_vt.toLowerCase(), p.ma_vt]) : []); 

    const validItems = [];
    const invalidCodes = [];

    for (const mat of materials) {
        const code = mat.ma_vt || mat.code; 
        if (!code) continue;
        
        const lowerCode = code.trim().toLowerCase();
        
        if (validCodes.has(lowerCode)) {
            validItems.push({
                ma_vt: productMap.get(lowerCode), 
                quota: mat.quota || 0,
                sl_trung: mat.sl_trung || mat.won || 0
            });
        } else {
            invalidCodes.push(code);
        }
    }

    if (invalidCodes.length > 0) {
        return { valid: false, invalidCodes: invalidCodes };
    }

    return { valid: true, items: validItems };
}

// --- TOOL DEFINITIONS ---

const searchListingsTool = {
    name: 'search_listings',
    description: 'Tìm kiếm hồ sơ thầu. Luôn trả về thông tin PSR.',
    parameters: {
        type: 'OBJECT',
        properties: {
            keyword: { type: 'STRING', description: 'Từ khóa tìm kiếm (Tên BV, Mã thầu, Tỉnh...)' },
            status: { type: 'STRING', description: 'Lọc theo trạng thái: "Win", "Fail", "Waiting", "Listing".' },
            from_date: { type: 'STRING', description: 'Ngày bắt đầu (YYYY-MM-DD).' },
            to_date: { type: 'STRING', description: 'Ngày kết thúc (YYYY-MM-DD).' },
            limit: { type: 'NUMBER', description: 'Số lượng kết quả tối đa (mặc định 15).' }
        }
    }
};

const getStatsTool = {
    name: 'get_general_stats',
    description: 'Tính toán thống kê tổng quát (Quota, Listing, Waiting, Win, Fail).',
    parameters: {
        type: 'OBJECT',
        properties: {
            from_date: { type: 'STRING', description: 'Ngày bắt đầu (YYYY-MM-DD).' },
            to_date: { type: 'STRING', description: 'Ngày kết thúc (YYYY-MM-DD).' },
            filter_psr: { type: 'STRING', description: 'Tên PSR.' }
        }
    }
};

const getListingItemsTool = {
    name: 'get_listing_items',
    description: 'Lấy chi tiết danh sách vật tư/sản phẩm bên trong một mã thầu cụ thể.',
    parameters: {
        type: 'OBJECT',
        properties: {
            ma_thau: { type: 'STRING', description: 'Mã hồ sơ thầu chính xác.' }
        },
        required: ['ma_thau']
    }
};

const updateListingStatusTool = {
    name: 'update_listing_status',
    description: 'CẬP NHẬT trạng thái của hồ sơ thầu.',
    parameters: {
        type: 'OBJECT',
        properties: {
            ma_thau: { type: 'STRING', description: 'Mã hồ sơ thầu cần cập nhật.' },
            new_status: { type: 'STRING', description: 'Trạng thái mới: "Win", "Fail", "Waiting", "Listing".' }
        },
        required: ['ma_thau', 'new_status']
    }
};

const navigateSmartTool = {
    name: 'navigate_smart',
    description: 'Điều hướng đến các màn hình trong ứng dụng.',
    parameters: {
        type: 'OBJECT',
        properties: {
            view_id: { type: 'STRING', description: 'ID màn hình.' },
            search_term: { type: 'STRING', description: 'Từ khóa tìm kiếm.' }
        },
        required: ['view_id']
    }
};

const openAddFormTool = {
    name: 'open_add_listing_form',
    description: 'Mở form thêm mới hồ sơ thầu sau khi đã validate dữ liệu.',
    parameters: {
        type: 'OBJECT',
        properties: {
            benh_vien: { type: 'STRING' },
            tinh: { type: 'STRING' },
            nha_phan_phoi: { type: 'STRING' },
            nganh: { type: 'STRING' },
            nam: { type: 'NUMBER' },
            psr: { type: 'STRING', description: 'Tên nhân viên phụ trách (PSR).' },
            materials: { 
                type: 'ARRAY', 
                description: 'Danh sách vật tư trích xuất (nếu có)',
                items: {
                    type: 'OBJECT',
                    properties: {
                        ma_vt: { type: 'STRING' },
                        quota: { type: 'NUMBER' }
                    }
                }
            }
        }
    }
};

export async function initChatbot() {
    await fetchGlobalApiKey();

    const toggleBtn = document.getElementById('chatbot-toggle-btn');
    const headerToggleBtn = document.getElementById('header-chatbot-btn');
    const closeBtn = document.getElementById('chatbot-close-btn');
    const minimizeBtn = document.getElementById('chatbot-minimize-btn');
    const chatWindow = document.getElementById('chatbot-window');
    const form = document.getElementById('chatbot-form');
    const input = document.getElementById('chatbot-input');
    const fileInput = document.getElementById('chatbot-file-input');
    const removeImgBtn = document.getElementById('chatbot-remove-img');

    // Add CSS for table scrolling within chatbot
    const style = document.createElement('style');
    style.textContent = `
        #chatbot-messages table { display: block; overflow-x: auto; white-space: nowrap; max-width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 0.8rem; }
        #chatbot-messages th, #chatbot-messages td { border: 1px solid #e5e7eb; padding: 6px 10px; }
        #chatbot-messages th { background-color: #f3f4f6; font-weight: 600; text-align: left; }
        .dark #chatbot-messages th { background-color: #374151; border-color: #4b5563; color: #e5e7eb; }
        .dark #chatbot-messages td { border-color: #4b5563; color: #e5e7eb; }
        #chatbot-messages::-webkit-scrollbar { width: 4px; }
    `;
    document.head.appendChild(style);

    if (!chatWindow) return;

    if (toggleBtn) {
        makeElementDraggable(toggleBtn, { isToggle: true, linkedEl: chatWindow });
        makeElementDraggable(chatWindow, { isWindow: true, linkedEl: toggleBtn });
    }

    if (headerToggleBtn) {
        headerToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            chatWindow.classList.toggle('hidden');
            if (!chatWindow.classList.contains('hidden')) {
                alignChatWindowToButton(headerToggleBtn, chatWindow);
                document.getElementById('chatbot-input').focus();
                if (!chatSession) startNewSession();
            }
        });
    }

    initResizableTopLeft(chatWindow);
    injectSettingsUI();

    closeBtn.addEventListener('click', () => chatWindow.classList.add('hidden'));
    minimizeBtn.addEventListener('click', () => chatWindow.classList.add('hidden'));

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleImageSelect(file);
    });

    input.addEventListener('paste', (e) => {
        const items = (e.clipboardData || window.clipboardData).items;
        for (let index in items) {
            const item = items[index];
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                e.preventDefault();
                handleImageSelect(item.getAsFile());
                return;
            }
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            form.dispatchEvent(new Event('submit'));
        }
    });

    removeImgBtn.addEventListener('click', () => {
        currentImageBlob = null;
        document.getElementById('chatbot-image-preview').classList.add('hidden');
        fileInput.value = '';
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text && !currentImageBlob) return;

        appendMessage(text, 'user', currentImageBlob);
        
        const userMessage = text; 
        const imageToSend = currentImageBlob;

        input.value = '';
        input.style.height = 'auto'; 
        currentImageBlob = null;
        document.getElementById('chatbot-image-preview').classList.add('hidden');
        fileInput.value = '';

        await sendMessageToAI(userMessage, imageToSend);
    });

    input.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    try {
        const apiKey = getApiKey();
        aiClient = new GoogleGenAI({ apiKey: apiKey });
    } catch(e) { console.error("AI Init Failed", e); }

    renderSuggestions();
}

async function startNewSession() {
    try {
        const currentKey = getApiKey();
        const userName = currentUser ? currentUser.ho_ten : "Người dùng";
        const userRole = currentUser ? currentUser.phan_quyen : "View";
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const dayName = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][today.getDay()];

        const systemPrompt = `
            Bạn là trợ lý ảo CRM Quản lý Thầu (WH-B4).
            
            **Thông tin ngữ cảnh:**
            - Người dùng: ${userName} (${userRole}).
            - **Hôm nay là:** ${dayName}, ${dateStr}. 
            
            **Quy tắc:**
            1. Tìm kiếm: Luôn hiện cột PSR.
            2. Thống kê: Tuân thủ logic Quota = Tổng Quota, Win/Fail/Waiting/Listing = Tổng SL Trúng theo trạng thái.
            3. **Tạo mới (QUAN TRỌNG):** 
               - Khi người dùng muốn tạo hồ sơ, hãy dùng 'open_add_listing_form'.
               - Trích xuất tối đa thông tin từ yêu cầu (Bệnh viện, Tỉnh, NPP, Ngành...).
               - **KHÔNG cần hỏi lại PSR nếu chưa có.** Hệ thống sẽ tự động điền tên người dùng hiện tại.

            **Nhiệm vụ:**
            - Trả lời ngắn gọn, tạo bảng Markdown khi liệt kê.
        `;

        chatSession = aiClient.chats.create({
            model: 'gemini-2.5-flash',
            config: {
                systemInstruction: systemPrompt,
                tools: [
                    { functionDeclarations: [
                        searchListingsTool, 
                        getListingItemsTool, 
                        updateListingStatusTool,
                        getStatsTool, 
                        navigateSmartTool, 
                        openAddFormTool 
                    ]}
                ]
            }
        });
        console.log("Chat session initialized.");
    } catch(e) {
        console.error("Session Start Error", e);
        appendMessage("Lỗi khởi tạo AI. Vui lòng kiểm tra API Key.", 'ai');
    }
}

async function sendMessageToAI(text, imageFile) {
    const loadingId = appendThinking();
    
    try {
        if (!chatSession) await startNewSession();

        let response;
        if (imageFile) {
            const base64Data = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(imageFile);
            });
            const imagePart = { inlineData: { mimeType: imageFile.type, data: base64Data } };
            const promptText = text || "Trích xuất thông tin từ ảnh này."; 
            const parts = [{ text: promptText }, imagePart];
            response = await chatSession.sendMessage({ message: parts });
        } else {
            response = await chatSession.sendMessage({ message: text });
        }

        const responseText = response.text || "";
        const functionCalls = response.functionCalls;

        if (functionCalls && functionCalls.length > 0) {
            removeThinking(loadingId);
            
            for (const call of functionCalls) {
                const fnName = call.name;
                const args = call.args;
                let result = { success: false, message: "Unknown error" };
                
                // --- 1. SEARCH LISTINGS ---
                if (fnName === 'search_listings') {
                    // Added psr to select
                    let query = sb.from('listing')
                        .select('ma_thau, benh_vien, tinh_trang, ngay, nha_phan_phoi, tinh, psr', { count: 'exact' })
                        .order('ngay', { ascending: false })
                        .limit(args.limit || 15); 

                    if (args.status) query = query.ilike('tinh_trang', `%${args.status}%`);
                    if (args.from_date) query = query.gte('ngay', args.from_date);
                    if (args.to_date) query = query.lte('ngay', args.to_date);
                    
                    if (args.keyword) {
                        const k = args.keyword;
                        query = query.or(`ma_thau.ilike.%${k}%,benh_vien.ilike.%${k}%,nha_phan_phoi.ilike.%${k}%,tinh.ilike.%${k}%`);
                    }
                    
                    const timeMsg = args.from_date ? ` từ ${args.from_date}` : '';
                    appendMessage(`🔍 Đang tìm kiếm hồ sơ${timeMsg}...`, 'ai');
                    const { data, count } = await query;
                    
                    if (data && data.length > 0) {
                        result = { 
                            count: count,
                            data: data.map(i => ({
                                ...i, 
                                ngay: i.ngay ? i.ngay.split('-').reverse().join('/') : ''
                            }))
                        };
                    } else {
                        result = { message: "Không tìm thấy hồ sơ nào phù hợp." };
                    }
                } 
                
                // --- 2. GET GENERAL STATS ---
                else if (fnName === 'get_general_stats') {
                    appendMessage(`📊 Đang tính toán số liệu thống kê...`, 'ai');
                    
                    let query = sb.from('detail').select('quota, sl_trung, tinh_trang, ngay, psr');
                    
                    if (args.from_date) query = query.gte('ngay', args.from_date);
                    if (args.to_date) query = query.lte('ngay', args.to_date);
                    if (args.filter_psr) query = query.ilike('psr', `%${args.filter_psr}%`);

                    const { data, error } = await query;

                    if (error || !data) {
                        result = { error: "Lỗi lấy dữ liệu thống kê." };
                    } else {
                        let stats = {
                            Total_Quota: 0,
                            Total_Listing: 0, 
                            Total_Waiting: 0, 
                            Total_Win: 0,     
                            Total_Fail: 0     
                        };

                        data.forEach(item => {
                            const quota = Number(item.quota) || 0;
                            const sl_trung = Number(item.sl_trung) || 0;
                            const status = item.tinh_trang;

                            stats.Total_Quota += quota;

                            if (status === 'Listing') stats.Total_Listing += sl_trung;
                            else if (status === 'Waiting') stats.Total_Waiting += sl_trung;
                            else if (status === 'Win') stats.Total_Win += sl_trung;
                            else if (status === 'Fail') stats.Total_Fail += sl_trung;
                        });

                        result = {
                            period: args.from_date ? `${args.from_date} đến ${args.to_date}` : 'Toàn thời gian',
                            stats: stats
                        };
                    }
                }

                // --- 3. GET LISTING ITEMS (Enhanced with Status Label Logic) ---
                else if (fnName === 'get_listing_items') {
                    appendMessage(`📦 Đang lấy chi tiết vật tư của thầu ${args.ma_thau}...`, 'ai');
                    
                    // First get parent status to determine label
                    const { data: listingData } = await sb.from('listing').select('tinh_trang').eq('ma_thau', args.ma_thau).single();
                    const parentStatus = listingData ? listingData.tinh_trang : 'Listing';
                    
                    const { data, error } = await sb.from('detail')
                        .select('ma_vt, quota, sl_trung, tinh_trang')
                        .eq('ma_thau', args.ma_thau);
                        
                    if (error || !data || data.length === 0) {
                        result = { message: "Không tìm thấy chi tiết." };
                    } else {
                        // Pass instruction to AI about header naming
                        result = { 
                            ma_thau: args.ma_thau, 
                            listing_status: parentStatus,
                            sl_header_label: `SL ${parentStatus}`, // Hint for AI
                            items: data 
                        };
                    }
                }

                // --- 4. UPDATE STATUS ---
                else if (fnName === 'update_listing_status') {
                    if (currentUser.phan_quyen === 'View') {
                        result = { error: "Bạn không có quyền cập nhật dữ liệu." };
                    } else {
                        appendMessage(`🔄 Đang cập nhật trạng thái ${args.ma_thau}...`, 'ai');
                        if (window.updateListingStatus) {
                             const { error } = await sb.from('listing').update({ tinh_trang: args.new_status }).eq('ma_thau', args.ma_thau);
                             if(!error) await sb.from('detail').update({ tinh_trang: args.new_status }).eq('ma_thau', args.ma_thau);
                             
                             if (error) result = { error: error.message };
                             else {
                                 result = { success: true };
                                 if(window.fetchListings) window.fetchListings(true);
                             }
                        } else {
                             const { error } = await sb.from('listing').update({ tinh_trang: args.new_status }).eq('ma_thau', args.ma_thau);
                             result = error ? { error: error.message } : { success: true };
                        }
                    }
                }

                // --- 5. NAVIGATE ---
                else if (fnName === 'navigate_smart') {
                    appendMessage(`🚀 Đang chuyển đến ${args.view_id}...`, 'ai');
                    await showView(args.view_id);
                    if (args.search_term) {
                        setTimeout(() => {
                            let searchInputId = '';
                            if (args.view_id === 'view-ton-kho') searchInputId = 'listing-search';
                            else if (args.view_id === 'view-chi-tiet') searchInputId = 'detail-search';
                            else if (args.view_id === 'view-san-pham') searchInputId = 'product-search';
                            
                            if (searchInputId) {
                                const inputEl = document.getElementById(searchInputId);
                                if (inputEl) {
                                    inputEl.value = args.search_term;
                                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                                }
                            }
                        }, 500);
                    }
                    result = { success: true };
                }

                // --- 6. OPEN ADD FORM (Enhanced Validation, Normalization & PSR Auto-fill) ---
                else if (fnName === 'open_add_listing_form') {
                    appendMessage(`🔍 Đang kiểm tra và chuẩn hóa dữ liệu...`, 'ai');
                    
                    // 1. Validate Product Codes
                    const materialValidation = await validateProducts(args.materials);
                    if (!materialValidation.valid) {
                        result = { 
                            status: "error",
                            message: `Không thể tạo. Mã vật tư sau không hợp lệ (không tồn tại trong hệ thống): ${materialValidation.invalidCodes.join(', ')}` 
                        };
                    } else {
                        // 2. Smart Normalization for ALL fields against DB
                        // Run in parallel for speed
                        const [normBenhVien, normTinh, normNPP, normNganh] = await Promise.all([
                            findBestMatchInDB('listing', 'benh_vien', args.benh_vien),
                            findBestMatchInDB('tinh_thanh', 'tinh', args.tinh),
                            findBestMatchInDB('listing', 'nha_phan_phoi', args.nha_phan_phoi),
                            findBestMatchInDB('listing', 'nganh', args.nganh)
                        ]);

                        // 3. Auto-fill PSR from Current User if not provided
                        const finalPsr = args.psr || (currentUser ? currentUser.ho_ten : '');

                        // 4. Prepare clean data
                        const cleanData = {
                            ...args,
                            benh_vien: normBenhVien,
                            tinh: normTinh,
                            nha_phan_phoi: normNPP,
                            nganh: normNganh,
                            psr: finalPsr,
                            details: materialValidation.items 
                        };

                        appendMessage(`📝 Đang mở form thêm mới...`, 'ai');
                        await showView('view-ton-kho');
                        
                        setTimeout(() => {
                            if (window.openListingModal) {
                                window.openListingModal(cleanData, false, true); // item, readOnly, isPreFill
                            }
                        }, 500);
                        
                        result = { success: true, normalized_data: cleanData };
                    }
                }

                // Send tool response back to AI
                const toolResponse = await chatSession.sendMessage({
                    message: [{
                        functionResponse: {
                            name: fnName,
                            response: { result: result }
                        }
                    }]
                });
                
                const finalResponseText = toolResponse.text;
                appendMessage(finalResponseText, 'ai');
                return; 
            }
        }

        removeThinking(loadingId);
        if (responseText) appendMessage(responseText, 'ai');

    } catch (error) {
        console.error("AI Error", error);
        removeThinking(loadingId);
        appendMessage("Xin lỗi, tôi gặp sự cố kết nối: " + error.message, 'ai');
    }
}

// ... (Rest of UI functions) ...

function appendMessage(text, sender, imageFile = null) {
    const messagesContainer = document.getElementById('chatbot-messages');
    const div = document.createElement('div');
    div.className = `flex ${sender === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in-up`;
    
    let contentHtml = '';
    if (imageFile) {
        const url = URL.createObjectURL(imageFile);
        contentHtml += `<img src="${url}" class="max-w-[200px] rounded-lg mb-2 border border-gray-200 dark:border-gray-600 block">`;
    }
    
    const formattedText = (sender === 'ai' && typeof marked !== 'undefined') ? marked.parse(text) : text;

    const bubbleClass = sender === 'user' 
        ? 'bg-[#2563eb] text-white p-3 rounded-2xl rounded-tr-none shadow-md max-w-[85%] text-sm' 
        : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 p-3 rounded-2xl rounded-tl-none shadow-sm border border-gray-100 dark:border-gray-600 max-w-[95%] prose dark:prose-invert text-sm leading-relaxed overflow-hidden';

    // Add overflow wrapper for tables within the bubble
    div.innerHTML = `
        <div class="${bubbleClass}">
            ${contentHtml}
            <div class="overflow-x-auto w-full max-w-full">${formattedText}</div>
        </div>
    `;
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function appendThinking() {
    const messagesContainer = document.getElementById('chatbot-messages');
    const id = 'thinking-' + Date.now();
    const div = document.createElement('div');
    div.id = id;
    div.className = 'flex justify-start animate-fade-in-up';
    div.innerHTML = `
        <div class="bg-white dark:bg-gray-700 p-3 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2 border border-gray-100 dark:border-gray-600">
            <div class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
            <div class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.1s"></div>
            <div class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0.2s"></div>
        </div>
    `;
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return id;
}

function removeThinking(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function initResizableTopLeft(el) { /* Code giữ nguyên */ 
    const handle = document.createElement('div');
    handle.className = 'absolute cursor-nwse-resize z-[100] flex items-center justify-center bg-transparent';
    handle.style.width = '24px';
    handle.style.height = '24px';
    handle.style.left = '0'; 
    handle.style.top = '0';
    
    handle.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" class="text-gray-400 opacity-80 rotate-180">
            <path d="M11 1V11H1L11 1Z" fill="currentColor"/>
        </svg>
    `;

    el.appendChild(handle);
    el.style.minWidth = '300px';
    el.style.minHeight = '400px';

    let isResizing = false;
    let startX, startY, startWidth, startHeight, startLeft, startTop;

    const onMouseDown = (e) => {
        if (window.innerWidth < 768) return;
        e.stopPropagation();
        e.preventDefault();
        isResizing = true;
        startX = e.clientX || e.touches[0].clientX;
        startY = e.clientY || e.touches[0].clientY;
        const rect = el.getBoundingClientRect();
        startWidth = rect.width;
        startHeight = rect.height;
        startLeft = rect.left;
        startTop = rect.top;
        el.style.bottom = 'auto';
        el.style.right = 'auto';
        el.style.left = startLeft + 'px';
        el.style.top = startTop + 'px';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('touchmove', onMouseMove, { passive: false });
        document.addEventListener('touchend', onMouseUp);
        document.body.style.cursor = 'nwse-resize';
    };

    const onMouseMove = (e) => {
        if (!isResizing) return;
        const clientX = e.clientX || e.touches[0].clientX;
        const clientY = e.clientY || e.touches[0].clientY;
        const dx = clientX - startX;
        const dy = clientY - startY;
        const newWidth = startWidth - dx;
        const newHeight = startHeight - dy;
        if (newWidth > 300) {
            el.style.width = `${newWidth}px`;
            el.style.left = `${startLeft + dx}px`;
        }
        if (newHeight > 400) {
            el.style.height = `${newHeight}px`;
            el.style.top = `${startTop + dy}px`;
        }
    };

    const onMouseUp = () => {
        isResizing = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('touchmove', onMouseMove);
        document.removeEventListener('touchend', onMouseUp);
        document.body.style.cursor = '';
    };

    handle.addEventListener('mousedown', onMouseDown);
    handle.addEventListener('touchstart', onMouseDown);
}

function makeElementDraggable(el, options = {}) { /* Code giữ nguyên */ 
    let isDragging = false;
    let hasMoved = false;
    let startX, startY, initialLeft, initialTop;
    let linkedEl = options.linkedEl;
    let linkedInitialLeft, linkedInitialTop;
    const chatWindow = document.getElementById('chatbot-window');

    const onMouseDown = (e) => {
        if (options.isWindow && window.innerWidth < 768) return;
        if (e.button !== 0 && e.type !== 'touchstart') return;
        if (options.isWindow) {
            const rect = el.getBoundingClientRect();
            const clickY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
            if (clickY - rect.top > 60 || ['INPUT', 'BUTTON', 'TEXTAREA', 'I', 'SVG', 'PATH'].includes(e.target.tagName)) return;
        }

        isDragging = true;
        hasMoved = false;
        
        const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        
        startX = clientX;
        startY = clientY;
        
        const rect = el.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        
        el.style.bottom = 'auto';
        el.style.right = 'auto';
        el.style.left = initialLeft + 'px';
        el.style.top = initialTop + 'px';
        el.style.cursor = 'grabbing';
        
        if (linkedEl) {
            const lRect = linkedEl.getBoundingClientRect();
            linkedInitialLeft = lRect.left;
            linkedInitialTop = lRect.top;
            linkedEl.style.bottom = 'auto';
            linkedEl.style.right = 'auto';
            linkedEl.style.left = linkedInitialLeft + 'px';
            linkedEl.style.top = linkedInitialTop + 'px';
        }

        document.body.style.userSelect = 'none';

        if (e.type === 'touchstart') {
            document.addEventListener('touchmove', onMouseMove, { passive: false });
            document.addEventListener('touchend', onMouseUp);
        } else {
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        }
    };

    const onMouseMove = (e) => {
        if (!isDragging) return;
        e.preventDefault(); 
        const clientX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        const clientY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        const dx = clientX - startX;
        const dy = clientY - startY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasMoved = true;

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        const elW = el.offsetWidth;
        const elH = el.offsetHeight;

        if (newLeft < 0) newLeft = 0;
        if (newLeft + elW > winW) newLeft = winW - elW;
        if (newTop < 0) newTop = 0;
        if (newTop + elH > winH) newTop = winH - elH;

        el.style.left = newLeft + 'px';
        el.style.top = newTop + 'px';

        if (linkedEl) {
            let lNewLeft = linkedInitialLeft + dx;
            let lNewTop = linkedInitialTop + dy;
            linkedEl.style.left = lNewLeft + 'px';
            linkedEl.style.top = lNewTop + 'px';
        }
    };

    const onMouseUp = (e) => {
        isDragging = false;
        el.style.cursor = options.isWindow ? 'default' : 'grab';
        document.body.style.userSelect = '';
        
        if (e.type === 'touchend') {
             if (e.cancelable) e.preventDefault();
             document.removeEventListener('touchmove', onMouseMove);
             document.removeEventListener('touchend', onMouseUp);
        } else {
             document.removeEventListener('mousemove', onMouseMove);
             document.removeEventListener('mouseup', onMouseUp);
        }

        if (options.isToggle && !hasMoved) {
            const now = Date.now();
            if (el.lastToggle && now - el.lastToggle < 300) return;
            el.lastToggle = now;

            chatWindow.classList.toggle('hidden');
            if (!chatWindow.classList.contains('hidden')) {
                alignChatWindowToButton(el, chatWindow);
                document.getElementById('chatbot-input').focus();
                if (!chatSession) startNewSession();
            }
        }
    };

    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('touchstart', onMouseDown, { passive: false });
}

function alignChatWindowToButton(btn, win) { /* Code giữ nguyên */
    const winW = window.innerWidth;
    if (winW < 768) {
        win.style.position = 'fixed';
        win.style.top = 'auto'; 
        win.style.bottom = '0'; 
        win.style.left = '0';
        win.style.right = '0';
        win.style.width = '100%';
        win.style.height = '85vh'; 
        win.style.maxHeight = '100%';
        win.style.borderRadius = '16px 16px 0 0';
        win.style.margin = '0';
        win.style.transform = 'none'; 
        win.style.zIndex = '10000';
        return;
    }
    const btnRect = btn.getBoundingClientRect();
    const winRect = win.getBoundingClientRect();
    let newTop = btnRect.top - winRect.height - 10;
    let newLeft = (btnRect.left + btnRect.width) - winRect.width;
    if (newTop < 10) newTop = 10; 
    if (newLeft < 10) newLeft = 10; 
    
    win.style.bottom = 'auto';
    win.style.right = 'auto';
    win.style.top = newTop + 'px';
    win.style.left = newLeft + 'px';
    win.style.width = ''; 
    win.style.height = ''; 
    win.style.borderRadius = ''; 
}

function handleImageSelect(file) { /* Code giữ nguyên */
    if (!file.type.startsWith('image/')) {
        showToast('Vui lòng chọn file ảnh.', 'error');
        return;
    }
    currentImageBlob = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = document.getElementById('chatbot-image-preview').querySelector('img');
        img.src = e.target.result;
        document.getElementById('chatbot-image-preview').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

function renderSuggestions() { /* Code giữ nguyên */
    const suggestions = [
        "Doanh số tuần này",
        "Hợp đồng nào sắp hết hạn?",
        "Thống kê tổng quát hôm nay",
        "Chi tiết thầu của BV Bạch Mai"
    ];
    const container = document.getElementById('chatbot-suggestions');
    if(container) {
        container.innerHTML = suggestions.map(s => `
            <button class="px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full text-xs text-gray-600 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-gray-600 hover:text-blue-600 hover:border-blue-200 transition-colors whitespace-nowrap shadow-sm" onclick="document.getElementById('chatbot-input').value = '${s}'; document.getElementById('chatbot-form').dispatchEvent(new Event('submit'));">
                ${s}
            </button>
        `).join('');
    }
}

// ... (Settings UI code - same as original) ...
function injectSettingsUI() {
    const minimizeBtn = document.getElementById('chatbot-minimize-btn');
    if (!minimizeBtn) return;

    if (!document.getElementById('chatbot-settings-btn')) {
        const settingsBtn = document.createElement('button');
        settingsBtn.id = 'chatbot-settings-btn';
        settingsBtn.className = "text-white hover:text-gray-200 transition-colors mr-2 opacity-80 hover:opacity-100";
        settingsBtn.title = "Cài đặt API Key";
        settingsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
        settingsBtn.onclick = openSettingsModal;
        minimizeBtn.parentNode.insertBefore(settingsBtn, minimizeBtn);
    }

    if (!document.getElementById('chatbot-settings-modal')) {
        const modal = document.createElement('div');
        modal.id = 'chatbot-settings-modal';
        modal.className = 'hidden absolute inset-0 bg-gray-900/90 flex flex-col items-center justify-center z-50 rounded-2xl p-4 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-800 p-5 rounded-xl w-full shadow-2xl border border-gray-200 dark:border-gray-700">
                <h3 class="text-base font-bold mb-2 text-gray-800 dark:text-white flex items-center gap-2">🔑 Cài đặt API Key</h3>
                <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">Nhập key riêng để dùng. Admin có thể lưu key cho hệ thống.</p>
                <div class="space-y-3">
                    <input type="password" id="custom-api-key" placeholder="dán key vào đây (AIza...)" class="w-full text-sm border border-gray-300 dark:border-gray-600 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#9333ea] transition-all">
                    <div class="flex justify-end gap-2 pt-2">
                        <button id="cancel-settings" class="px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">Đóng</button>
                        <button id="save-settings" class="px-4 py-2 text-xs font-medium bg-[#9333ea] text-white hover:bg-[#7e22ce] rounded-lg shadow-sm transition-colors">Lưu Key</button>
                    </div>
                </div>
                <div class="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 text-center">
                     <button id="remove-key" class="text-[11px] text-red-500 hover:text-red-600 hover:underline">Xóa Key & Dùng mặc định</button>
                </div>
            </div>
        `;
        document.getElementById('chatbot-window').appendChild(modal);

        document.getElementById('cancel-settings').onclick = () => modal.classList.add('hidden');
        document.getElementById('save-settings').onclick = async () => {
            const key = document.getElementById('custom-api-key').value.trim();
            if (key) {
                localStorage.setItem('user_gemini_api_key', key);
                if (currentUser && currentUser.phan_quyen === 'Admin') await saveGlobalApiKey(key);
                aiClient = new GoogleGenAI({ apiKey: key });
                chatSession = null; 
                showToast('✅ Đã lưu API Key!', 'success');
                modal.classList.add('hidden');
            } else { showToast('Vui lòng nhập Key hợp lệ.', 'error'); }
        };
        document.getElementById('remove-key').onclick = () => {
            if(confirm("Xóa Key?")) {
                localStorage.removeItem('user_gemini_api_key');
                const newKey = globalApiKey || DEFAULT_API_KEY;
                aiClient = new GoogleGenAI({ apiKey: newKey });
                chatSession = null;
                document.getElementById('custom-api-key').value = '';
                showToast('Đã khôi phục API Key mặc định.', 'info');
                modal.classList.add('hidden');
            }
        };
    }
}

function openSettingsModal() {
    const modal = document.getElementById('chatbot-settings-modal');
    const input = document.getElementById('custom-api-key');
    if (modal && input) {
        input.value = getApiKey() === DEFAULT_API_KEY ? '' : getApiKey();
        modal.classList.remove('hidden');
    }
}
