// --- 数据结构 ---
let items = [];
let finances = [];
let checkmarks = [];
let customTags = ['学习', '生活', '其他'];
let currentFilterTag = '全部';
let currentPage = 'schedule';
let currentTodoTab = 'pending';
let focusMinutes = 25;
let chartPeriod = 'week';
let currentCheckinTab = 'daily';
let editingItemId = null; // 编辑模式：非 null 表示正在编辑的 item id

let financeCategories = {
    income: ['工资', '奖金', '副业', '其他收入'],
    expense: ['食物', '交通', '娱乐', '学习', '生活', '医疗', '其他支出']
};

window.handleNativeCalendarSync = function(payloadJson) {
    let payload;
    try {
        payload = typeof payloadJson === 'string' ? JSON.parse(payloadJson) : payloadJson;
    } catch (error) {
        alert('同步系统日历失败：返回数据无法解析。');
        return;
    }

    if (!payload || !payload.ok) {
        alert(payload?.message || '同步系统日历失败。');
        return;
    }

    const nativeEvents = Array.isArray(payload.events) ? payload.events : [];
    let imported = 0;

    nativeEvents.forEach(ev => {
        if (!ev || !ev.start || !ev.summary) return;
        const sourceKey = ev.sourceKey || `${ev.summary}|${ev.start}|${ev.end || ev.start}|${ev.location || ''}`;
        const exists = items.some(item => item.source === 'android-calendar' && item.sourceKey === sourceKey);
        if (exists) return;

        items.push({
            id: Date.now() + Math.random(),
            type: 'period',
            name: ev.summary,
            location: ev.location || ev.calendarName || '',
            tag: detectTag(ev.summary || ''),
            startTime: ev.start,
            endTime: ev.end || ev.start,
            completed: false,
            source: 'android-calendar',
            sourceKey: sourceKey,
            calendarName: ev.calendarName || ''
        });
        imported++;
    });

    if (imported > 0) {
        localStorage.setItem('to-list-pro-data', JSON.stringify(items));
        updateTagFilters();
        // 切换到日程页并刷新（setTimeout 确保 DOM 先渲染再弹窗）
        if (currentPage !== 'schedule') switchPage('schedule');
        else renderAll();
        setTimeout(() => {
            alert(`已同步系统日历 ${imported} 个事件！\n请查看日程时间轴。`);
        }, 200);
    } else {
        alert('未发现新的系统日历事件。\n\n可能原因：\n1. 手机系统日历中没有事件\n2. 未授予"读取日历"权限（请去系统设置→应用→To-do list→权限中开启）\n3. 鸿蒙设备需使用华为日历App中创建的事件');
    }
};

// --- 初始化 ---
window.onload = () => {
    loadData();
    updateTagFilters();
    renderAll();
    setupEventListeners();
    registerSW();
};

function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (window.location.protocol === 'file:') return;
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

function loadData() {
    const saved = localStorage.getItem('to-list-pro-data');
    if (saved) items = JSON.parse(saved);
    const savedFinances = localStorage.getItem('to-list-pro-finances');
    if (savedFinances) finances = JSON.parse(savedFinances);
    const savedCheckmarks = localStorage.getItem('to-list-pro-checkmarks');
    if (savedCheckmarks) checkmarks = JSON.parse(savedCheckmarks);
    const savedTags = localStorage.getItem('to-list-pro-tags');
    if (savedTags) customTags = JSON.parse(savedTags);
    const savedCategories = localStorage.getItem('to-list-pro-finance-categories');
    if (savedCategories) financeCategories = JSON.parse(savedCategories);
}

function setupEventListeners() {
    // 页面切换
    document.querySelectorAll('.nav-item').forEach(item => {
        item.onclick = () => switchPage(item.dataset.page);
    });

    // 模态框
    const modal = document.getElementById('modal');
    document.getElementById('addTaskBtn').onclick = () => openModal('todo');
    document.getElementById('addPeriodBtn').onclick = () => openModal('period');
    document.getElementById('addFinanceBtn').onclick = () => openModal('finance');
    document.getElementById('addCheckinModuleBtn').onclick = () => {
        if (currentCheckinTab === 'daily') {
            openModal('checkmark-daily');
        } else {
            openModal('checkmark-weekly');
        }
    };
    document.querySelector('.close-modal').onclick = () => { modal.style.display = 'none'; modal.classList.remove('active'); };

    // 待办事项标签切换
    document.querySelectorAll('.todo-tabs span').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.todo-tabs span').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentTodoTab = tab.dataset.tab;
            renderTodoList();
        };
    });

    // 打卡时间选择器
    document.getElementById('checkinTimeClose').onclick = closeCheckinTimeModal;
    document.getElementById('checkinTimeCancel').onclick = closeCheckinTimeModal;
    document.getElementById('checkinTimeConfirm').onclick = confirmCheckinTime;

    // 专注页
    document.getElementById('focusPageStartBtn').onclick = startFocus;
    document.getElementById('stopFocusBtn').onclick = stopFocus;
    document.querySelectorAll('.focus-preset-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.focus-preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            focusMinutes = parseInt(btn.dataset.min);
            document.getElementById('focusPageTimer').innerText = fmtTime(focusMinutes, 0);
            document.getElementById('timerDisplay').innerText = fmtTime(focusMinutes, 0);
        };
    });

    // 打卡每日/每周切换
    document.querySelectorAll('.checkin-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.checkin-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentCheckinTab = tab.dataset.ctype;
            renderCheckinModule();
        };
    });

    // 图表时间切换
    document.querySelectorAll('.chart-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            chartPeriod = tab.dataset.period;
            const customRange = document.getElementById('customRange');
            if (customRange) customRange.style.display = chartPeriod === 'custom' ? 'flex' : 'none';
            if (chartPeriod !== 'custom') drawExpenseChart();
        };
    });
    const rangeApplyBtn = document.getElementById('rangeApplyBtn');
    if (rangeApplyBtn) rangeApplyBtn.onclick = () => drawExpenseChart();

    const syncCalendarBtn = document.getElementById('syncDeviceCalendarBtn');
    if (syncCalendarBtn) syncCalendarBtn.onclick = triggerNativeCalendarSync;

    // 设置页 — 文件导入（label+input 方式，移动端最可靠）
    const icsInput = document.getElementById('_icsFileInput');
    if (icsInput) icsInput.onchange = handleIcsImport;
    // Ensure label explicitly triggers the file input click (some WebView builds
    // do not forward label clicks correctly). This makes the action robust.
    const icsLabel = document.querySelector("label[for='_icsFileInput']");
    if (icsLabel && icsInput) {
        icsLabel.addEventListener('click', (ev) => {
            ev.preventDefault();
            try { icsInput.click(); } catch (e) { /* ignore */ }
        });
    }
    const backupInput = document.getElementById('_backupFileInput');
    if (backupInput) backupInput.onchange = handleBackupImport;

    const exportBtn = document.getElementById('exportDataBtn');
    if (exportBtn) exportBtn.onclick = exportAllData;

    const clearBtn = document.getElementById('clearAllDataBtn');
    if (clearBtn) clearBtn.onclick = clearAllData;
}

function triggerNativeCalendarSync() {
    if (window.AndroidCalendarSync && typeof window.AndroidCalendarSync.requestSync === 'function') {
        // 显示同步中提示
        const syncBtn = document.getElementById('syncDeviceCalendarBtn');
        if (syncBtn) {
            syncBtn.querySelector('.settings-btn-text').innerText = '正在同步...';
            syncBtn.style.opacity = '0.6';
        }
        window.AndroidCalendarSync.requestSync();
        // 3秒后恢复按钮
        setTimeout(() => {
            if (syncBtn) {
                syncBtn.querySelector('.settings-btn-text').innerText = '同步系统日历';
                syncBtn.style.opacity = '1';
            }
        }, 3000);
        return;
    }
    // WebView 环境没有 JS Bridge，给出指引
    alert('系统日历同步功能需要在 APK 中使用。\n\n如果你在用浏览器，请安装最新 APK。\n\n华为/鸿蒙手机：请在系统设置中确保已授予本应用"读取日历"权限。');
}

// --- 页面切换 ---
function switchPage(page) {
    currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    if (page === 'schedule') {
        document.getElementById('page-schedule').classList.add('active');
        renderAll();
    } else if (page === 'finance') {
        document.getElementById('page-finance').classList.add('active');
        renderFinanceList();
        updateFinanceSummary();
        setTimeout(drawExpenseChart, 150);
    } else if (page === 'focus') {
        document.getElementById('page-focus').classList.add('active');
    } else if (page === 'settings') {
        document.getElementById('page-settings').classList.add('active');
        renderTagManage();
        renderFinanceCatManage();
    }
    document.querySelector(`[data-page="${page}"]`).classList.add('active');
}

// --- 模态框逻辑 ---
let currentAddingType = 'todo';
let currentFinanceType = 'income';
let currentCheckmarkType = 'daily';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
    return escapeHtml(value);
}

function openModal(type) {
    currentAddingType = type;
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modalBody');
    const isEdit = editingItemId !== null;
    const editData = isEdit ? items.find(i => i.id === editingItemId) : null;

    if (type === 'todo') {
        document.getElementById('modalTitle').innerText = isEdit ? '编辑任务' : '添加任务';
        const tagOptions = customTags.map(tag =>
            `<span class="selectable-tag" data-val="${escapeAttr(tag)}">${escapeHtml(tag)}</span>`
        ).join('');
        modalBody.innerHTML = `
            <div class="input-row">
                <label>任务名称 *</label>
                <input type="text" id="itemName" placeholder="输入任务" value="${isEdit ? escapeAttr(editData.name) : ''}">
            </div>
            <div class="input-row">
                <label>地点</label>
                <input type="text" id="itemLocation" placeholder="地点（可选）" value="${isEdit ? escapeAttr(editData.location || '') : ''}">
            </div>
            <div class="input-row">
                <label>标签</label>
                <div class="tag-selector" id="tagSelector">
                    ${tagOptions}
                    <input type="text" id="newTagInput" placeholder="新标签" style="flex:1; padding:6px 12px; border: 1px solid #eee; border-radius: 10px; font-size: 12px; min-width:80px;">
                </div>
            </div>
            <div class="input-row">
                <label>截止时间</label>
                <input type="datetime-local" id="startTime" value="${isEdit && editData.startTime ? editData.startTime : ''}">
            </div>
            <button class="save-btn" id="saveItemBtn">${isEdit ? '保存修改' : '保存任务'}</button>
        `;
        setupTagSelectors();
        if (isEdit && editData.tag) {
            setTimeout(() => {
                document.querySelectorAll('#tagSelector .selectable-tag').forEach(t => {
                    if (t.dataset.val === editData.tag) t.classList.add('selected');
                });
            }, 50);
        }
    } else if (type === 'period') {
        document.getElementById('modalTitle').innerText = isEdit ? '编辑安排' : '添加安排';
        const tagOptions = customTags.map(tag =>
            `<span class="selectable-tag" data-val="${escapeAttr(tag)}">${escapeHtml(tag)}</span>`
        ).join('');
        modalBody.innerHTML = `
            <div class="input-row">
                <label>事件名称 *</label>
                <input type="text" id="itemName" placeholder="输入事件" value="${isEdit ? escapeAttr(editData.name) : ''}">
            </div>
            <div class="input-row">
                <label>地点</label>
                <input type="text" id="itemLocation" placeholder="地点（可选）" value="${isEdit ? escapeAttr(editData.location || '') : ''}">
            </div>
            <div class="input-row">
                <label>标签</label>
                <div class="tag-selector" id="tagSelector">${tagOptions}</div>
            </div>
            <div class="input-row">
                <label>开始时间 *</label>
                <input type="datetime-local" id="startTime" value="${isEdit && editData.startTime ? editData.startTime : ''}">
            </div>
            <div class="input-row">
                <label>结束时间 *</label>
                <input type="datetime-local" id="endTime" value="${isEdit && editData.endTime ? editData.endTime : ''}">
            </div>
            <button class="save-btn" id="saveItemBtn">${isEdit ? '保存修改' : '保存安排'}</button>
        `;
        setupTagSelectors();
        if (isEdit && editData.tag) {
            setTimeout(() => {
                document.querySelectorAll('#tagSelector .selectable-tag').forEach(t => {
                    if (t.dataset.val === editData.tag) t.classList.add('selected');
                });
            }, 50);
        }
        if (!isEdit) {
            const now = new Date();
            now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
            const timeStr = now.toISOString().slice(0, 16);
            document.getElementById('startTime').value = timeStr;
            document.getElementById('endTime').value = timeStr;
        }
    } else if (type === 'finance') {
        currentFinanceType = 'income';
        document.getElementById('modalTitle').innerText = '记账';
        const incomeOptions = financeCategories.income.map(cat =>
            `<span class="selectable-tag finance-type-tag" data-val="${escapeAttr(cat)}">${escapeHtml(cat)}</span>`
        ).join('');
        const expenseOptions = financeCategories.expense.map(cat =>
            `<span class="selectable-tag finance-type-tag" data-val="${escapeAttr(cat)}">${escapeHtml(cat)}</span>`
        ).join('');

        modalBody.innerHTML = `
            <div class="input-row">
                <label>类型</label>
                <div class="tag-selector" id="financeTypeSelector">
                    <span class="selectable-tag finance-type-selector selected" data-val="income" style="background:#E8F5E9">💰 收入</span>
                    <span class="selectable-tag finance-type-selector" data-val="expense" style="background:#FFE8E8">💸 支出</span>
                </div>
            </div>
            <div class="input-row">
                <label>分类 <span style="font-size:10px;color:var(--harmony-red)">可自定义</span></label>
                <div class="tag-selector" id="categorySelector">${incomeOptions}</div>
                <input type="text" id="customCategoryInput" placeholder="或输入自定义分类" style="margin-top:8px; width:100%; padding:8px; border: 1px solid #eee; border-radius: 10px; font-size: 12px;">
            </div>
            <div class="input-row">
                <label>金额 *</label>
                <input type="number" id="financeAmount" placeholder="0.00" step="0.01">
            </div>
            <div class="input-row">
                <label>备注</label>
                <input type="text" id="financeNote" placeholder="备注（可选）">
            </div>
            <button class="save-btn" id="saveItemBtn">保存记账</button>
        `;

        document.querySelectorAll('.finance-type-selector').forEach(tag => {
            tag.onclick = (e) => {
                document.querySelectorAll('.finance-type-selector').forEach(t => t.classList.remove('selected'));
                e.target.classList.add('selected');
                currentFinanceType = e.target.dataset.val;
                const categories = currentFinanceType === 'income' ? financeCategories.income : financeCategories.expense;
                document.getElementById('categorySelector').innerHTML = categories.map(cat =>
                    `<span class="selectable-tag finance-type-tag" data-val="${escapeAttr(cat)}">${escapeHtml(cat)}</span>`
                ).join('');
                setupCategorySelectors();
            };
        });
        setupCategorySelectors();
    } else if (type === 'checkmark-daily') {
        currentCheckmarkType = 'daily';
        document.getElementById('modalTitle').innerText = '新建每日打卡';
        modalBody.innerHTML = `
            <div class="input-row">
                <label>打卡名称 *</label>
                <input type="text" id="checkmarkName" placeholder="如：跑步、学习等">
            </div>
            <div class="input-row">
                <label>打卡描述</label>
                <input type="text" id="checkmarkDesc" placeholder="描述（可选）">
            </div>
            <button class="save-btn" id="saveItemBtn">创建打卡</button>
        `;
    } else if (type === 'checkmark-weekly') {
        currentCheckmarkType = 'weekly';
        document.getElementById('modalTitle').innerText = '新建每周打卡';
        modalBody.innerHTML = `
            <div class="input-row">
                <label>打卡名称 *</label>
                <input type="text" id="checkmarkName" placeholder="如：健身、阅读等">
            </div>
            <div class="input-row">
                <label>打卡描述</label>
                <input type="text" id="checkmarkDesc" placeholder="描述（可选）">
            </div>
            <div class="input-row">
                <label>选择打卡日</label>
                <div class="week-selector">
                    <span class="week-day" data-day="0">一</span><span class="week-day" data-day="1">二</span>
                    <span class="week-day" data-day="2">三</span><span class="week-day" data-day="3">四</span>
                    <span class="week-day" data-day="4">五</span><span class="week-day" data-day="5">六</span>
                    <span class="week-day" data-day="6">日</span>
                </div>
                <div id="selectedDays" style="margin-top:8px; font-size:11px; color:#999;">未选择任何天数</div>
            </div>
            <div class="input-row">
                <label>每周目标次数</label>
                <input type="number" id="weeklyTarget" placeholder="目标打卡次数" min="1" max="7" value="3" style="width:100%">
            </div>
            <button class="save-btn" id="saveItemBtn">创建打卡</button>
        `;
        let selectedWeekDays = [];
        document.querySelectorAll('.week-day').forEach(day => {
            day.onclick = () => {
                const dayNum = parseInt(day.dataset.day);
                if (selectedWeekDays.includes(dayNum)) {
                    selectedWeekDays = selectedWeekDays.filter(d => d !== dayNum);
                    day.classList.remove('selected');
                } else {
                    selectedWeekDays.push(dayNum);
                    day.classList.add('selected');
                }
                const dayNames = ['周一','周二','周三','周四','周五','周六','周日'];
                document.getElementById('selectedDays').innerText =
                    selectedWeekDays.length === 0 ? '未选择任何天数' :
                    selectedWeekDays.sort().map(d => dayNames[d]).join('、');
            };
        });
        window.getSelectedWeekDays = () => selectedWeekDays;
    }

    document.getElementById('saveItemBtn').onclick = saveItem;
    modal.style.display = 'block';
    modal.classList.add('active');
}

function setupTagSelectors() {
    document.querySelectorAll('#tagSelector .selectable-tag').forEach(tag => {
        tag.onclick = () => {
            document.querySelectorAll('#tagSelector .selectable-tag').forEach(t => t.classList.remove('selected'));
            tag.classList.add('selected');
        };
    });
}

function setupCategorySelectors() {
    document.querySelectorAll('#categorySelector .selectable-tag').forEach(tag => {
        tag.onclick = () => {
            document.querySelectorAll('#categorySelector .selectable-tag').forEach(t => t.classList.remove('selected'));
            tag.classList.add('selected');
            document.getElementById('customCategoryInput').value = '';
        };
    });
}

function saveItem() {
    if (currentAddingType === 'finance') {
        let category = document.getElementById('customCategoryInput').value.trim();
        if (!category) {
            const categoryEl = document.querySelector('#categorySelector .selectable-tag.selected');
            category = categoryEl ? categoryEl.dataset.val :
                (currentFinanceType === 'income' ? financeCategories.income[0] : financeCategories.expense[0]);
        } else {
            const cats = currentFinanceType === 'income' ? financeCategories.income : financeCategories.expense;
            if (!cats.includes(category)) {
                cats.push(category);
                localStorage.setItem('to-list-pro-finance-categories', JSON.stringify(financeCategories));
            }
        }
        const amount = parseFloat(document.getElementById('financeAmount').value);
        if (!amount || amount <= 0) return alert('金额必须大于0');

        finances.push({
            id: Date.now(),
            type: currentFinanceType,
            category: category,
            amount: amount,
            note: document.getElementById('financeNote').value,
            date: new Date().toISOString().split('T')[0]
        });
        localStorage.setItem('to-list-pro-finances', JSON.stringify(finances));
        closeModal();
        renderFinanceList();
        updateFinanceSummary();
        drawExpenseChart();
    } else if (currentAddingType === 'checkmark-daily' || currentAddingType === 'checkmark-weekly') {
        const name = document.getElementById('checkmarkName').value;
        if (!name) return alert('打卡名称不能为空');
        const newCheckmark = {
            id: Date.now(),
            type: currentCheckmarkType,
            name: name,
            desc: document.getElementById('checkmarkDesc').value,
            createdDate: new Date().toISOString().split('T')[0],
            records: {}
        };
        if (currentCheckmarkType === 'weekly') {
            newCheckmark.weekDays = window.getSelectedWeekDays() || [];
            const targetEl = document.getElementById('weeklyTarget');
            newCheckmark.weeklyTarget = targetEl ? parseInt(targetEl.value) || 3 : 3;
        }
        checkmarks.push(newCheckmark);
        localStorage.setItem('to-list-pro-checkmarks', JSON.stringify(checkmarks));
        closeModal();
        renderCheckinModule();
    } else {
        const name = document.getElementById('itemName').value;
        if (!name) return alert('名称不能为空');

        let tag = document.querySelector('#tagSelector .selectable-tag.selected')?.dataset.val || '';
        const newTagInput = document.getElementById('newTagInput');
        if (newTagInput && newTagInput.value.trim()) {
            tag = newTagInput.value.trim();
            if (!customTags.includes(tag)) {
                customTags.push(tag);
                localStorage.setItem('to-list-pro-tags', JSON.stringify(customTags));
                updateTagFilters();
            }
        } else if (!tag) {
            tag = customTags[0] || '其他';
        }

        if (editingItemId !== null) {
            // 编辑模式：更新已有 item
            const idx = items.findIndex(i => i.id === editingItemId);
            if (idx >= 0) {
                items[idx].name = name;
                items[idx].location = document.getElementById('itemLocation').value;
                items[idx].tag = tag;
                items[idx].startTime = document.getElementById('startTime').value || null;
                if (currentAddingType === 'period') {
                    items[idx].endTime = document.getElementById('endTime').value;
                }
            }
            editingItemId = null;
        } else {
            // 新建模式
            items.push({
                id: Date.now(),
                type: currentAddingType,
                name: name,
                location: document.getElementById('itemLocation').value,
                tag: tag,
                startTime: document.getElementById('startTime').value || null,
                endTime: currentAddingType === 'period' ? document.getElementById('endTime').value : null,
                completed: false
            });
        }
        localStorage.setItem('to-list-pro-data', JSON.stringify(items));
        updateTagFilters();
        closeModal();
        renderAll();
    }
}

function closeModal() {
    editingItemId = null;
    const modal = document.getElementById('modal');
    modal.style.display = 'none';
    modal.classList.remove('active');
}

function updateTagFilters() {
    const container = document.getElementById('tagFilters');
    if (!container) return;

    const activeTodos = items.filter(i => i.type === 'todo' && !i.completed);
    // 所有标签平等：customTags 中只要曾经用过就出现在筛选栏
    const allTodoItems = items.filter(i => i.type === 'todo');
    const everUsedTags = [...new Set(allTodoItems.map(i => i.tag))];
    const visibleTags = customTags.filter(t => everUsedTags.includes(t));
    const allTags = ['全部', ...visibleTags];

    container.innerHTML = allTags.map(tag => {
        const count = tag === '全部' ? activeTodos.length : activeTodos.filter(i => i.tag === tag).length;
        return `<span class="tag-pill ${tag === currentFilterTag ? 'active' : ''}" data-tag="${tag}">${tag} <small>${count}</small></span>`;
    }).join('');

    document.querySelectorAll('.tag-pill').forEach(pill => {
        pill.onclick = () => {
            document.querySelectorAll('.tag-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentFilterTag = pill.dataset.tag;
            renderTodoList();
        };
    });
}

// --- 渲染 ---
function renderAll() {
    renderTimeline();
    renderTodoList();
    renderCheckinModule();
    updateFinanceSummary();
    updateHeaderDate();
}

function updateHeaderDate() {
    const el = document.getElementById('headerDate');
    if (!el) return;
    const now = new Date();
    const weekNames = ['周日','周一','周二','周三','周四','周五','周六'];
    el.innerText = `${now.getMonth()+1}月${now.getDate()}日 ${weekNames[now.getDay()]}`;
}

function editItem(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    editingItemId = id;
    openModal(item.type === 'period' ? 'period' : 'todo');
}

// --- 时间轴 ---
function renderTimeline() {
    const container = document.getElementById('timelineList');
    container.innerHTML = '';

    // 只显示今天的安排
    const todayStr = new Date().toISOString().split('T')[0];
    const periods = items.filter(i => i.type === 'period' && i.startTime && i.startTime.startsWith(todayStr))
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    if (periods.length === 0) {
        container.innerHTML = `<div class="empty-state">今天暂无安排<br>点击下方按钮添加<br><small style="color:#ccc">右滑查看日历</small></div>`;
        return;
    }

    periods.forEach(item => {
        const start = new Date(item.startTime);
        const end = new Date(item.endTime);
        const timeLabel = `${start.getHours().toString().padStart(2,'0')}:${start.getMinutes().toString().padStart(2,'0')}`;
        const tagClass = getTagClass(item.tag);
        const icon = getEventIcon(item.name, item.tag);

        const div = document.createElement('div');
        div.className = 'timeline-item';
        div.innerHTML = `
            <div class="time-label">${timeLabel}</div>
            <div class="timeline-card-wrapper">
                <div class="timeline-card ${tagClass}">
                    <div class="timeline-card-header">
                        <span class="timeline-card-icon">${icon}</span>
                        <span class="timeline-card-title">${escapeHtml(item.name)}</span>
                        <span class="timeline-card-edit" onclick="event.stopPropagation();editItem(${item.id})">✎</span>
                    </div>
                    <div class="timeline-card-meta">
                        ${timeLabel} - ${end.getHours().toString().padStart(2,'0')}:${end.getMinutes().toString().padStart(2,'0')}
                        ${item.location ? ' @ ' + escapeHtml(item.location) : ''}
                    </div>
                </div>
                <div class="timeline-swipe-del" onclick="deletePeriod(${item.id})">删除</div>
            </div>
        `;
        const wrapper = div.querySelector('.timeline-card-wrapper');
        const card = wrapper.querySelector('.timeline-card');
        addSwipeToDelete(wrapper, card);
        // 点击卡片编辑
        card.addEventListener('click', (e) => {
            if (e.target.closest('.timeline-swipe-del') || e.target.closest('.timeline-card-edit')) return;
            editItem(item.id);
        });
        container.appendChild(div);
    });
}

function addSwipeToDelete(wrapper, card) {
    let startX = 0, startY = 0, movedX = 0, swiping = false, horizontalSwipe = false;
    wrapper.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        movedX = 0;
        swiping = true;
        horizontalSwipe = false;
    }, { passive: true });
    wrapper.addEventListener('touchmove', e => {
        if (!swiping) return;
        const dx = startX - e.touches[0].clientX;
        const dy = startY - e.touches[0].clientY;
        if (!horizontalSwipe && Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (!horizontalSwipe && Math.abs(dy) > Math.abs(dx)) {
            swiping = false;
            card.style.transform = '';
            return;
        }
        horizontalSwipe = true;
        movedX = Math.max(0, dx);
        if (movedX > 0) {
            e.preventDefault();
            card.style.transform = `translateX(${-Math.min(movedX, 65)}px)`;
        }
    }, { passive: false });
    wrapper.addEventListener('touchend', () => {
        swiping = false;
        card.style.transform = horizontalSwipe && movedX > 30 ? 'translateX(-65px)' : '';
        movedX = 0;
        horizontalSwipe = false;
    });
}

function deletePeriod(id) {
    if (!confirm('确定删除该安排？')) return;
    items = items.filter(i => i.id !== id);
    localStorage.setItem('to-list-pro-data', JSON.stringify(items));
    renderAll();
}

function getTagClass(tag) {
    if (tag === '学习') return 'study';
    if (tag === '生活') return 'life';
    if (tag === '工作') return 'work';
    return 'other';
}

function getTagIcon(tag) {
    if (tag === '学习') return '📖';
    if (tag === '生活') return '🌟';
    if (tag === '工作') return '💼';
    return '📌';
}

function getEventIcon(name, tag) {
    const n = name.toLowerCase();
    if (n.includes('起床') || n.includes('晨间')) return '☀️';
    if (n.includes('睡觉') || n.includes('入睡') || n.includes('就寝')) return '🌙';
    if (n.includes('形策') || n.includes('形势') || n.includes('政策')) return '🏛️';
    if (n.includes('托福') || n.includes('toefl') || n.includes('听力') || n.includes('ielts') || n.includes('雅思')) return '🎧';
    if (n.includes('微积分') || n.includes('高数') || n.includes('数学分析') || n.includes('数分')) return '∫';
    if (n.includes('数字逻辑') || n.includes('数逻') || n.includes('逻辑设计') || n.includes('数字电路')) return '🔌';
    if (n.includes('线性代数') || n.includes('矩阵') || n.includes('代数')) return '📐';
    if (n.includes('概率') || n.includes('统计') || n.includes('数理统计')) return '🎲';
    if (n.includes('离散数学') || n.includes('离散')) return '🔗';
    if (n.includes('数据结构') || n.includes('算法') || n.includes('编程') || n.includes('代码') || n.includes('程序设计')) return '💻';
    if (n.includes('计算机') || n.includes('计组') || n.includes('组成原理') || n.includes('体系结构')) return '🖥️';
    if (n.includes('操作系统') || n.includes('os')) return '⚙️';
    if (n.includes('计算机网络') || n.includes('网络')) return '🌐';
    if (n.includes('数据库') || n.includes('sql')) return '🗄️';
    if (n.includes('编译') || n.includes('编译器')) return '🔧';
    if (n.includes('英语') || n.includes('english') || n.includes('大英')) return '🔤';
    if (n.includes('物理') || n.includes('大物') || n.includes('量子')) return '⚛️';
    if (n.includes('化学') || n.includes('有机') || n.includes('无机')) return '🧪';
    if (n.includes('电路') || n.includes('电子') || n.includes('模电') || n.includes('数电') || n.includes('电工')) return '⚡';
    if (n.includes('信号') || n.includes('通信') || n.includes('dsp')) return '📡';
    if (n.includes('马原') || n.includes('马列') || n.includes('马克思') || n.includes('毛概') || n.includes('思政') || n.includes('思修') || n.includes('近代史')) return '📜';
    if (n.includes('军事') || n.includes('国防') || n.includes('军训')) return '🎖️';
    if (n.includes('体育') || n.includes('篮球') || n.includes('足球') || n.includes('游泳') || n.includes('羽毛球') || n.includes('乒乓')) return '⚽';
    if (n.includes('午餐') || n.includes('午饭') || n.includes('早餐') || n.includes('晚饭') || n.includes('晚餐') || n.includes('吃饭')) return '🍽️';
    if (n.includes('休息') || n.includes('午休')) return '😴';
    if (n.includes('散步') || n.includes('走路') || n.includes('跑步') || n.includes('运动') || n.includes('健身') || n.includes('锻炼')) return '🏃';
    if (n.includes('自习') || n.includes('复习') || n.includes('预习') || n.includes('作业')) return '✏️';
    if (n.includes('图书馆')) return '📚';
    if (n.includes('会议') || n.includes('开会')) return '📋';
    if (n.includes('上课') || n.includes('课程') || n.includes('讲座')) return '🎓';
    if (n.includes('购物') || n.includes('超市') || n.includes('买菜')) return '🛒';
    if (n.includes('洗衣') || n.includes('家务') || n.includes('打扫') || n.includes('清洁')) return '🧹';
    if (n.includes('音乐') || n.includes('钢琴') || n.includes('吉他') || n.includes('唱歌')) return '🎵';
    if (n.includes('画画') || n.includes('绘画') || n.includes('美术')) return '🎨';
    if (n.includes('电影') || n.includes('看剧') || n.includes('追剧')) return '🎬';
    if (n.includes('游戏') || n.includes('电竞')) return '🎮';
    if (n.includes('电话') || n.includes('视频') || n.includes('通话')) return '📞';
    if (n.includes('旅行') || n.includes('出行') || n.includes('旅游')) return '✈️';
    if (n.includes('医院') || n.includes('看病') || n.includes('体检')) return '🏥';
    if (n.includes('理发') || n.includes('剪发')) return '💇';
    if (n.includes('洗澡') || n.includes('洗漱')) return '🚿';
    if (n.includes('阅读') || n.includes('看书') || n.includes('读书')) return '📖';
    if (n.includes('写作') || n.includes('日记') || n.includes('笔记')) return '✍️';
    if (n.includes('冥想') || n.includes('静坐') || n.includes('瑜伽')) return '🧘';
    if (n.includes('咖啡') || n.includes('喝茶') || n.includes('下午茶')) return '☕';
    if (n.includes('通勤') || n.includes('坐车') || n.includes('地铁') || n.includes('公交')) return '🚇';
    // fallback to tag-based icon
    return getTagIcon(tag);
}

// --- 待办列表 ---
function renderTodoList() {
    const container = document.getElementById('todoList');
    container.innerHTML = '';

    let todos;
    if (currentTodoTab === 'completed') {
        todos = items.filter(i => i.type === 'todo' && i.completed);
    } else {
        todos = items.filter(i => i.type === 'todo' && !i.completed);
        if (currentFilterTag !== '全部') {
            todos = todos.filter(i => i.tag === currentFilterTag);
        }
    }

    if (todos.length === 0) {
        container.innerHTML = `<div class="empty-state">${currentTodoTab === 'completed' ? '暂无已完成任务' : '暂无待办任务'}</div>`;
        return;
    }

    const sorted = [...todos].sort((a, b) => {
        if (a.startTime && b.startTime) return new Date(a.startTime) - new Date(b.startTime);
        if (a.startTime) return -1;
        if (b.startTime) return 1;
        return a.id - b.id;
    });

    sorted.forEach(item => {
        const wrapper = document.createElement('div');
        wrapper.className = 'todo-item-wrapper';

        const div = document.createElement('div');
        div.className = 'todo-item';

        let timeStr = '';
        if (item.startTime) {
            const date = new Date(item.startTime);
            timeStr = `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
        }

        const tagClass = getTagClass(item.tag);
        const completedStyle = item.completed ? 'style="text-decoration:line-through;color:#999"' : '';
        const checkboxClass = item.completed ? 'checkbox done' : 'checkbox';

        div.innerHTML = `
            <div class="${checkboxClass}" onclick="event.stopPropagation(); toggleTodoComplete(${item.id})"></div>
            <div class="todo-info">
                <div class="todo-title" ${completedStyle}>${escapeHtml(item.name)}</div>
                <div class="todo-meta">
                    <span class="tag-dot ${tagClass}"></span>${escapeHtml(item.tag)}
                    ${timeStr ? '<span>⏱ '+timeStr+'</span>' : ''}
                    ${!item.completed && item.location ? '<span>📍 '+escapeHtml(item.location)+'</span>' : ''}
                </div>
            </div>
        `;
        div.addEventListener('click', () => editItem(item.id));

        // 滑动删除
        const swipeDel = document.createElement('div');
        swipeDel.className = 'todo-swipe-del';
        swipeDel.onclick = () => deleteTodo(item.id);
        swipeDel.innerText = '删除';

        wrapper.appendChild(div);
        wrapper.appendChild(swipeDel);
        addSwipeToDelete(wrapper, div);
        container.appendChild(wrapper);
    });
}

function deleteTodo(id) {
    if (!confirm('确定删除该事项？')) return;
    items = items.filter(i => i.id !== id);
    localStorage.setItem('to-list-pro-data', JSON.stringify(items));
    updateTagFilters();
    renderTodoList();
}

function toggleTodoComplete(id) {
    if (currentTodoTab === 'completed') {
        if (!confirm('确定删除该事项？')) return;
        items = items.filter(i => i.id !== id);
        localStorage.setItem('to-list-pro-data', JSON.stringify(items));
        updateTagFilters();
        renderTodoList();
        return;
    }
    const item = items.find(i => i.id === id);
    if (!item) return;
    item.completed = !item.completed;
    localStorage.setItem('to-list-pro-data', JSON.stringify(items));
    updateTagFilters();
    renderTodoList();
}

// --- 打卡模块 ---
function renderCheckinModule() {
    const container = document.getElementById('checkinModuleList');
    if (!container) return;
    container.innerHTML = '';

    const type = currentCheckinTab;

    if (type === 'daily') {
        const dailyChecks = checkmarks.filter(c => c.type === 'daily');
        if (dailyChecks.length === 0) {
            container.innerHTML = '<div class="empty-state">还没有每日打卡<br>点击下方按钮添加</div>';
            return;
        }
        renderDailyCheckinItems(container, dailyChecks);
    } else {
        const weeklyChecks = checkmarks.filter(c => c.type === 'weekly');
        if (weeklyChecks.length === 0) {
            container.innerHTML = '<div class="empty-state">还没有每周打卡<br>点击下方按钮添加</div>';
            return;
        }
        renderWeeklyCheckinItems(container, weeklyChecks);
    }
}

function renderDailyCheckinItems(container, checks) {
    const today = new Date();
    checks.forEach(check => {
        const div = document.createElement('div');
        div.className = 'checkin-card';
        const streak = calcStreak(check);
        const dots = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const done = !!check.records[dateStr];
            const isToday = i === 0;
            let dotClass = 'checkin-dot';
            if (done) dotClass += ' done';
            if (isToday) dotClass += ' today';
            dots.push(`<span class="${dotClass}"></span>`);
        }
        const icon = getCheckinIcon(check.name);
        const iconClass = getCheckinIconClass(check.name);
        div.innerHTML = `
            <div class="checkin-card-icon ${iconClass}">${icon}</div>
            <div class="checkin-card-info">
                <div class="checkin-card-name">${check.name}</div>
                <div class="checkin-card-streak">已坚持：${streak} 天</div>
            </div>
            <div class="checkin-card-dots">${dots.join('')}</div>
        `;
        div.onclick = () => quickCheckin(check.id);
        container.appendChild(div);
    });
}

function renderWeeklyCheckinItems(container, checks) {
    const today = new Date();
    const currentDay = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - (currentDay === 0 ? 6 : currentDay - 1));

    const dayNames = ['一','二','三','四','五','六','日'];

    checks.forEach(check => {
        if (!check.weekDays || check.weekDays.length === 0) return;
        const target = check.weeklyTarget || check.weekDays.length;

        // 计算本周完成次数
        let completedThisWeek = 0;
        check.weekDays.forEach(dayNum => {
            const checkDate = new Date(weekStart);
            checkDate.setDate(weekStart.getDate() + dayNum);
            const dateStr = checkDate.toISOString().split('T')[0];
            if (check.records[dateStr]) completedThisWeek++;
        });

        const div = document.createElement('div');
        div.className = 'checkin-card weekly-card';

        // 生成周打卡点
        const dots = [];
        check.weekDays.sort().forEach(dayNum => {
            const checkDate = new Date(weekStart);
            checkDate.setDate(weekStart.getDate() + dayNum);
            const dateStr = checkDate.toISOString().split('T')[0];
            const done = !!check.records[dateStr];
            const isToday = checkDate.toDateString() === today.toDateString();
            let dotClass = 'checkin-dot';
            if (done) dotClass += ' done';
            if (isToday) dotClass += ' today';
            dots.push(`<span class="${dotClass}" title="${dayNames[dayNum]}"></span>`);
        });

        const icon = getCheckinIcon(check.name);

        div.innerHTML = `
            <div class="checkin-card-icon weekly">${icon}</div>
            <div class="checkin-card-info">
                <div class="checkin-card-name">${check.name}</div>
                <div class="checkin-card-streak">本周 ${completedThisWeek}/${target} 次</div>
            </div>
            <div class="checkin-card-dots weekly-dots">${dots.join('')}</div>
        `;
        div.onclick = () => quickCheckin(check.id);
        container.appendChild(div);
    });
}

function quickCheckin(checkId) {
    const check = checkmarks.find(c => c.id === checkId);
    if (!check) return;
    const today = new Date().toISOString().split('T')[0];
    // 切换打卡状态
    if (check.records[today]) {
        delete check.records[today];
    } else {
        check.records[today] = true;
    }
    localStorage.setItem('to-list-pro-checkmarks', JSON.stringify(checkmarks));
    renderCheckinModule();
}

function calcStreak(check) {
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        if (check.records[dateStr]) {
            streak++;
        } else if (i > 0) {
            break;
        }
    }
    return streak;
}

function getCheckinIcon(name) {
    const n = name.toLowerCase();
    if (n.includes('运动') || n.includes('跑步') || n.includes('健身') || n.includes('锻炼')) return '🏃';
    if (n.includes('阅读') || n.includes('读书') || n.includes('看书')) return '📖';
    if (n.includes('早起') || n.includes('起床')) return '☀️';
    if (n.includes('学习') || n.includes('复习')) return '📚';
    if (n.includes('冥想') || n.includes('静坐')) return '🧘';
    if (n.includes('喝水')) return '💧';
    if (n.includes('日记') || n.includes('写作')) return '✍️';
    return '✅';
}

function getCheckinIconClass(name) {
    const n = name.toLowerCase();
    if (n.includes('运动') || n.includes('跑步') || n.includes('健身') || n.includes('锻炼')) return 'sport';
    if (n.includes('阅读') || n.includes('读书') || n.includes('看书')) return 'read';
    if (n.includes('早起') || n.includes('起床')) return 'morning';
    return 'default-ci';
}

// --- 打卡时间选择器 ---
let pendingCheckinId = null;
let selectedCheckinHour = 8;
let selectedCheckinMinute = 0;
let wheelScrolling = false; // 防止程序滚动触发 scroll 事件

function openCheckinTimeModal(checkId) {
    pendingCheckinId = checkId;
    const now = new Date();
    selectedCheckinHour = now.getHours();
    selectedCheckinMinute = Math.floor(now.getMinutes() / 5) * 5;

    const modal = document.getElementById('checkinTimeModal');
    const check = checkmarks.find(c => c.id === checkId);
    document.getElementById('checkinTimeTitle').innerText = check ? check.name : '选择打卡时间';

    const hourWheel = document.getElementById('checkinHourWheel');
    hourWheel.innerHTML = '';
    for (let h = 0; h < 24; h++) {
        const item = document.createElement('div');
        item.className = 'checkin-time-wheel-item';
        item.dataset.value = h;
        item.innerText = h.toString().padStart(2, '0');
        hourWheel.appendChild(item);
    }

    const minuteWheel = document.getElementById('checkinMinuteWheel');
    minuteWheel.innerHTML = '';
    for (let m = 0; m < 60; m += 5) {
        const item = document.createElement('div');
        item.className = 'checkin-time-wheel-item';
        item.dataset.value = m;
        item.innerText = m.toString().padStart(2, '0');
        minuteWheel.appendChild(item);
    }

    updateWheelSelection(hourWheel, selectedCheckinHour);
    updateWheelSelection(minuteWheel, selectedCheckinMinute);

    // 程序滚动到选中项（跳过 scroll 事件处理）
    wheelScrolling = true;
    scrollToWheelValue(hourWheel, selectedCheckinHour);
    scrollToWheelValue(minuteWheel, selectedCheckinMinute);
    setTimeout(() => { wheelScrolling = false; }, 300);

    hourWheel.onscroll = () => {
        if (wheelScrolling) return;
        const idx = Math.round(hourWheel.scrollTop / 40);
        selectedCheckinHour = Math.max(0, Math.min(23, idx));
        updateWheelSelection(hourWheel, selectedCheckinHour);
    };
    minuteWheel.onscroll = () => {
        if (wheelScrolling) return;
        const idx = Math.round(minuteWheel.scrollTop / 40);
        selectedCheckinMinute = Math.max(0, Math.min(55, idx * 5));
        updateWheelSelection(minuteWheel, selectedCheckinMinute);
    };

    modal.classList.add('active');
}

function scrollToWheelValue(wheel, value) {
    const items = wheel.querySelectorAll('.checkin-time-wheel-item');
    items.forEach((item, idx) => {
        if (parseInt(item.dataset.value) === value) {
            // 居中：将目标项滚动到滚轮中间（滚轮高180，项高40，偏移=(180-40)/2=70）
            wheel.scrollTop = Math.max(0, idx * 40 - 70);
        }
    });
}

function updateWheelSelection(wheel, value) {
    wheel.querySelectorAll('.checkin-time-wheel-item').forEach(item => {
        item.classList.toggle('selected', parseInt(item.dataset.value) === value);
    });
}

function closeCheckinTimeModal() {
    document.getElementById('checkinTimeModal').classList.remove('active');
    pendingCheckinId = null;
}

function confirmCheckinTime() {
    if (pendingCheckinId === null) return;
    const check = checkmarks.find(c => c.id === pendingCheckinId);
    if (!check) return;

    const today = new Date().toISOString().split('T')[0];
    const timeStr = `${selectedCheckinHour.toString().padStart(2,'0')}:${selectedCheckinMinute.toString().padStart(2,'0')}`;
    check.records[today] = timeStr;

    localStorage.setItem('to-list-pro-checkmarks', JSON.stringify(checkmarks));
    closeCheckinTimeModal();
    renderCheckinModule();
}

// --- 专注模式 ---
let focusTimer;
let focusLocked = false;

function startFocus() {
    const overlay = document.getElementById('focus-overlay');
    const lockCheck = document.getElementById('focusLockMode');
    focusLocked = lockCheck && lockCheck.checked;

    overlay.style.display = 'flex';
    overlay.style.zIndex = '200';

    // 严格模式
    const exitBtn = document.getElementById('stopFocusBtn');
    const tip = document.getElementById('focusOverlayTip');
    if (focusLocked) {
        exitBtn.style.display = 'none';
        tip.innerText = '严格专注中，结束后方可退出';
        document.body.style.overflow = 'hidden';
        lockScreen();
    } else {
        exitBtn.style.display = '';
        tip.innerText = '正在专注中，请勿使用其他软件';
    }

    let seconds = focusMinutes * 60;
    document.getElementById('timerDisplay').innerText = fmtTime(focusMinutes, 0);

    focusTimer = setInterval(() => {
        seconds--;
        if (seconds <= 0) {
            clearInterval(focusTimer);
            alert('专注完成！太棒了！');
            stopFocus();
        }
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        document.getElementById('timerDisplay').innerText = fmtTime(m, s);
    }, 1000);
}

function lockScreen() {
    // 阻止返回键（Android WebView）
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', blockBack);
    // 请求全屏
    if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
    }
}

function blockBack(e) {
    window.history.pushState(null, '', window.location.href);
}

function unlockScreen() {
    window.removeEventListener('popstate', blockBack);
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    }
}

function stopFocus() {
    clearInterval(focusTimer);
    if (focusLocked) {
        unlockScreen();
        document.body.style.overflow = '';
        focusLocked = false;
    }
    document.getElementById('focus-overlay').style.display = 'none';
    document.getElementById('timerDisplay').innerText = fmtTime(focusMinutes, 0);
    document.getElementById('stopFocusBtn').style.display = '';
}

function fmtTime(m, s) {
    return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

// --- 记账 ---
function renderFinanceList() {
    const container = document.getElementById('financeList');
    container.innerHTML = '';

    if (finances.length === 0) {
        container.innerHTML = '<div class="empty-state">还没有记账记录</div>';
        return;
    }

    // 按加入顺序倒序（后加入的在上）
    const sorted = [...finances].sort((a, b) => b.id - a.id);

    const grouped = {};
    sorted.forEach(f => {
        if (!grouped[f.date]) grouped[f.date] = [];
        grouped[f.date].push(f);
    });

    Object.keys(grouped).sort().reverse().forEach(date => {
        const dateDiv = document.createElement('div');
        const dateObj = new Date(date);
        dateDiv.innerHTML = `<div class="finance-date-label">${dateObj.toLocaleDateString('zh-CN', {weekday:'long', month:'long', day:'numeric'})}</div>`;

        grouped[date].forEach(f => {
            const wrapper = document.createElement('div');
            wrapper.className = 'fi-item-wrapper';

            const itemDiv = document.createElement('div');
            itemDiv.className = 'finance-item';
            itemDiv.innerHTML = `
                <div class="fi-left">
                    <div class="fi-cat">${f.type === 'income' ? '➕' : '➖'} ${f.category}</div>
                    <div class="fi-note">${f.note || '无备注'}</div>
                </div>
                <div class="fi-amount ${f.type}">
                    ${f.type === 'income' ? '+' : '-'}${f.amount.toFixed(2)}
                </div>
            `;

            const swipeDel = document.createElement('div');
            swipeDel.className = 'fi-swipe-del';
            swipeDel.onclick = () => deleteFinance(f.id);
            swipeDel.innerText = '删除';

            wrapper.appendChild(itemDiv);
            wrapper.appendChild(swipeDel);
            addSwipeToDelete(wrapper, itemDiv);
            dateDiv.appendChild(wrapper);
        });
        container.appendChild(dateDiv);
    });

    // 分类支出统计
    renderCategoryStats(sorted);
}

function deleteFinance(id) {
    if (!confirm('确定删除该记录？')) return;
    finances = finances.filter(f => f.id !== id);
    localStorage.setItem('to-list-pro-finances', JSON.stringify(finances));
    renderFinanceList();
    updateFinanceSummary();
    drawExpenseChart();
}

function renderCategoryStats(sortedFinances) {
    let container = document.getElementById('categoryStats');
    if (!container) {
        container = document.createElement('div');
        container.id = 'categoryStats';
        container.className = 'category-stats';
        const listContainer = document.getElementById('financeList').parentElement;
        const h4 = listContainer.querySelector('h4');
        if (h4) h4.after(container);
    }
    const expenses = sortedFinances.filter(f => f.type === 'expense');
    if (expenses.length === 0) { container.innerHTML = ''; return; }
    const byCat = {};
    expenses.forEach(f => { byCat[f.category] = (byCat[f.category] || 0) + f.amount; });
    const totalExpense = Object.values(byCat).reduce((s, v) => s + v, 0);
    const sortedCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    container.innerHTML = '<div class="category-stats-title">支出分类</div>' +
        sortedCats.map(([cat, amt]) => {
            const pct = totalExpense > 0 ? Math.round(amt / totalExpense * 100) : 0;
            return `<div class="category-stat-row">
                <span class="cat-name">${cat}</span>
                <span class="cat-bar-wrap"><span class="cat-bar" style="width:${pct}%"></span></span>
                <span class="cat-amt">${amt.toFixed(0)} (${pct}%)</span>
            </div>`;
        }).join('');
}

function updateFinanceSummary() {
    let filteredFinances = finances;
    if (chartPeriod === 'custom') {
        const start = document.getElementById('rangeStart').value;
        const end = document.getElementById('rangeEnd').value;
        if (start && end) {
            filteredFinances = finances.filter(f => f.date >= start && f.date <= end);
        }
    }
    const income = filteredFinances.filter(f => f.type === 'income').reduce((s, f) => s + f.amount, 0);
    const expense = filteredFinances.filter(f => f.type === 'expense').reduce((s, f) => s + f.amount, 0);
    const surplus = income - expense;
    const incomeEl = document.getElementById('totalIncome');
    const expenseEl = document.getElementById('totalExpense');
    const surplusEl = document.getElementById('totalSurplus');
    if (incomeEl) incomeEl.innerText = income.toFixed(2);
    if (expenseEl) expenseEl.innerText = expense.toFixed(2);
    if (surplusEl) {
        surplusEl.innerText = (surplus >= 0 ? '+' : '') + surplus.toFixed(2);
        surplusEl.style.color = surplus >= 0 ? 'var(--harmony-green)' : 'var(--harmony-red)';
    }
}

// --- 折线图 ---
function drawExpenseChart() {
    const canvas = document.getElementById('expenseChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = 200 * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = '180px';
    ctx.scale(dpr, dpr);

    const W = rect.width - 20;
    const H = 180;
    const pad = { top: 20, right: 10, bottom: 30, left: 40 };
    const pw = W - pad.left - pad.right;
    const ph = H - pad.top - pad.bottom;

    // 自定义范围时同步更新汇总
    if (chartPeriod === 'custom') updateFinanceSummary();
    // 聚合数据
    const data = aggregateExpenses(chartPeriod);
    const labels = data.map(d => d.label);
    const values = data.map(d => d.amount);
    const maxVal = Math.max(...values, 1);

    ctx.clearRect(0, 0, W, H);

    if (values.every(v => v === 0)) {
        ctx.fillStyle = '#999';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('暂无支出数据', W / 2, H / 2);
        return;
    }

    // Y轴
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + (ph / 4) * i;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(W - pad.right, y);
        ctx.stroke();

        ctx.fillStyle = '#999';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(maxVal - (maxVal / 4) * i), pad.left - 6, y + 4);
    }

    // X轴（数据点多时抽样显示）
    const step = pw / Math.max(labels.length - 1, 1);
    ctx.fillStyle = '#999';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    const labelInterval = labels.length > 15 ? Math.ceil(labels.length / 8) : 1;
    labels.forEach((label, i) => {
        if (i % labelInterval === 0 || i === labels.length - 1) {
            const x = pad.left + step * i;
            ctx.fillText(label, x, H - 8);
        }
    });

    // 折线
    const points = values.map((v, i) => ({
        x: pad.left + step * i,
        y: pad.top + ph - (v / maxVal) * ph
    }));

    // 渐变填充
    const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + ph);
    gradient.addColorStop(0, 'rgba(232,93,117,0.2)');
    gradient.addColorStop(1, 'rgba(232,93,117,0.01)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(points[0].x, pad.top + ph);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, pad.top + ph);
    ctx.closePath();
    ctx.fill();

    // 折线
    ctx.strokeStyle = 'var(--harmony-red)';
    ctx.strokeStyle = '#E85D75';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();

    // 数据点
    points.forEach(p => {
        ctx.fillStyle = '#E85D75';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
    });
}

function aggregateExpenses(period) {
    const expenses = finances.filter(f => f.type === 'expense');
    const now = new Date();

    if (period === 'week') {
        // 本周周一~周日，每天支出
        const currentDay = now.getDay();
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - (currentDay === 0 ? 6 : currentDay - 1));
        const dayNames = ['一','二','三','四','五','六','日'];
        const result = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart);
            d.setDate(weekStart.getDate() + i);
            const ds = d.toISOString().split('T')[0];
            const total = expenses.filter(f => f.date === ds).reduce((s, f) => s + f.amount, 0);
            result.push({ label: dayNames[i], amount: total });
        }
        return result;
    }

    if (period === 'month') {
        // 本月1号~今天，每天支出
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const today = now.getDate();
        const endDay = Math.min(today, daysInMonth);
        const result = [];
        for (let i = 1; i <= endDay; i++) {
            const ds = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${i.toString().padStart(2,'0')}`;
            const total = expenses.filter(f => f.date === ds).reduce((s, f) => s + f.amount, 0);
            result.push({ label: String(i), amount: total });
        }
        return result;
    }

    if (period === 'year') {
        // 今年1月~今月，每月支出
        const result = [];
        for (let i = 0; i < now.getMonth() + 1; i++) {
            const mStr = `${now.getFullYear()}-${(i+1).toString().padStart(2,'0')}`;
            const total = expenses.filter(f => f.date.startsWith(mStr)).reduce((s, f) => s + f.amount, 0);
            result.push({ label: (i+1)+'月', amount: total });
        }
        return result;
    }

    if (period === 'custom') {
        const start = document.getElementById('rangeStart').value;
        const end = document.getElementById('rangeEnd').value;
        if (!start || !end) return [];
        const result = [];
        const s = new Date(start);
        const e = new Date(end);
        const diffDays = Math.ceil((e - s) / (1000 * 60 * 60 * 24));
        // 如果范围 <= 31天，按天显示；否则按月显示
        if (diffDays <= 31) {
            for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
                const ds = d.toISOString().split('T')[0];
                const total = expenses.filter(f => f.date === ds).reduce((s2, f2) => s2 + f2.amount, 0);
                result.push({ label: (d.getMonth()+1)+'/'+d.getDate(), amount: total });
            }
        } else {
            const months = [];
            for (let d = new Date(s); d <= e; d.setMonth(d.getMonth() + 1)) {
                const mStr = d.toISOString().slice(0, 7);
                if (!months.includes(mStr)) {
                    months.push(mStr);
                    const total = expenses.filter(f => f.date.startsWith(mStr)).reduce((s2, f2) => s2 + f2.amount, 0);
                    result.push({ label: mStr, amount: total });
                }
            }
        }
        return result;
    }

    return [];
}

// --- 华为日历导入 ---
async function handleIcsImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const text = await readCalendarFileText(file);
        const events = parseIcs(text);
        if (events.length === 0) {
            alert('未识别到日历事件，请确认文件是华为日历导出的 .ics 文件。');
            return;
        }
        let imported = 0;
        events.forEach(ev => {
            if (!ev.start) return;
            items.push({
                id: Date.now() + Math.random(),
                type: 'period',
                name: ev.summary || '导入事件',
                location: ev.location || '',
                tag: detectTag(ev.summary || ''),
                startTime: ev.start,
                endTime: ev.end || ev.start,
                completed: false
            });
            imported++;
        });
        localStorage.setItem('to-list-pro-data', JSON.stringify(items));
        updateTagFilters();
        renderAll();
        alert(`成功导入 ${imported} 个日程事件！`);
    } catch (error) {
        console.error('华为日历导入失败：', error);
        alert('导入失败，请确认 .ics 文件完整且来自华为日历导出。');
    } finally {
        e.target.value = '';
    }
}

async function readCalendarFileText(file) {
    const encodings = ['utf-8', 'gb18030', 'gbk'];
    for (const encoding of encodings) {
        try {
            const text = await readFileAsText(file, encoding);
            if (text && (text.includes('BEGIN:VCALENDAR') || text.includes('BEGIN:VEVENT'))) {
                return text;
            }
        } catch (error) {
            // 继续尝试下一个编码
        }
    }

    try {
        const buffer = await file.arrayBuffer();
        return new TextDecoder('utf-8').decode(buffer);
    } catch (error) {
        return await readFileAsText(file, 'utf-8');
    }
}

function readFileAsText(file, encoding) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
        try {
            reader.readAsText(file, encoding);
        } catch (error) {
            reject(error);
        }
    });
}

function parseIcs(text) {
    const events = [];
    const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const unfolded = normalized.replace(/\n[ \t]/g, '');
    const blocks = unfolded.split(/BEGIN:VEVENT/i);
    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i].split(/END:VEVENT/i)[0];
        const ev = {};
        const lines = block.split('\n');
        for (const line of lines) {
            const parsed = parseIcsLine(line);
            if (!parsed) continue;
            const { name, params, value } = parsed;
            if (name === 'SUMMARY') {
                ev.summary = decodeIcsText(value);
                continue;
            }
            if (name === 'DESCRIPTION') {
                ev.description = decodeIcsText(value);
                continue;
            }
            if (name === 'LOCATION') {
                ev.location = decodeIcsText(value);
                continue;
            }
            if (name === 'DTSTART') {
                ev.start = icsToDatetime(value, params);
                continue;
            }
            if (name === 'DTEND') {
                ev.end = icsToDatetime(value, params);
                continue;
            }
        }
        if (!ev.summary) ev.summary = ev.description || '导入事件';
        if (ev.summary && ev.start) events.push(ev);
    }
    return events;
}

function parseIcsLine(line) {
    const colonIndex = line.indexOf(':');
    if (colonIndex < 0) return null;
    const left = line.slice(0, colonIndex);
    const value = line.slice(colonIndex + 1);
    const [namePart, ...paramParts] = left.split(';');
    const name = namePart.trim().toUpperCase();
    const params = {};
    paramParts.forEach(part => {
        const eqIndex = part.indexOf('=');
        if (eqIndex < 0) {
            params[part.trim().toUpperCase()] = true;
            return;
        }
        const key = part.slice(0, eqIndex).trim().toUpperCase();
        const paramValue = part.slice(eqIndex + 1).trim();
        params[key] = paramValue;
    });
    return { name, params, value };
}

function decodeIcsText(value) {
    return String(value || '')
        .replace(/\\n/gi, ' ')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\')
        .trim();
}

function icsToDatetime(str, params = {}) {
    const cleaned = String(str || '').trim().replace(/Z$/, '');
    if (/^\d{8}$/.test(cleaned)) {
        return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}T00:00`;
    }
    const dateTimeMatch = cleaned.match(/^(\d{8})T(\d{6})$/);
    if (!dateTimeMatch) return null;
    const rawDate = dateTimeMatch[1];
    const rawTime = dateTimeMatch[2];
    const year = rawDate.slice(0, 4);
    const month = rawDate.slice(4, 6);
    const day = rawDate.slice(6, 8);
    const hour = rawTime.slice(0, 2);
    const min = rawTime.slice(2, 4);
    return `${year}-${month}-${day}T${hour}:${min}`;
}

function detectTag(name) {
    const n = name.toLowerCase();
    if (n.includes('课') || n.includes('学') || n.includes('习') || n.includes('考') || n.includes('讲')) return '学习';
    if (n.includes('会') || n.includes('议') || n.includes('报') || n.includes('面')) return '工作';
    if (n.includes('饭') || n.includes('餐') || n.includes('运动') || n.includes('健身') || n.includes('跑')) return '生活';
    return '其他';
}

// --- 数据导出/导入 ---
function exportAllData() {
    const backup = {
        version: 1,
        date: new Date().toISOString(),
        items: items,
        finances: finances,
        checkmarks: checkmarks,
        customTags: customTags,
        financeCategories: financeCategories
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '日程备份_' + new Date().toISOString().split('T')[0] + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function handleBackupImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('导入备份将覆盖当前数据，确定继续？')) { e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const backup = JSON.parse(reader.result);
            if (!backup.items || !backup.finances || !backup.checkmarks) throw new Error('格式错误');
            items = backup.items;
            finances = backup.finances;
            checkmarks = backup.checkmarks;
            if (backup.customTags) customTags = backup.customTags;
            if (backup.financeCategories) financeCategories = backup.financeCategories;
            localStorage.setItem('to-list-pro-data', JSON.stringify(items));
            localStorage.setItem('to-list-pro-finances', JSON.stringify(finances));
            localStorage.setItem('to-list-pro-checkmarks', JSON.stringify(checkmarks));
            localStorage.setItem('to-list-pro-tags', JSON.stringify(customTags));
            localStorage.setItem('to-list-pro-finance-categories', JSON.stringify(financeCategories));
            updateTagFilters();
            renderAll();
            alert('数据恢复成功！');
        } catch (err) {
            alert('备份文件格式错误，无法导入。');
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

function clearAllData() {
    if (!confirm('确定要清除所有数据吗？此操作不可撤销！')) return;
    if (!confirm('再次确认：清除所有日程、记账、打卡数据？')) return;
    items = [];
    finances = [];
    checkmarks = [];
    customTags = ['学习', '生活', '其他'];
    financeCategories = {
        income: ['工资', '奖金', '副业', '其他收入'],
        expense: ['食物', '交通', '娱乐', '学习', '生活', '医疗', '其他支出']
    };
    localStorage.clear();
    localStorage.setItem('to-list-pro-tags', JSON.stringify(customTags));
    localStorage.setItem('to-list-pro-finance-categories', JSON.stringify(financeCategories));
    updateTagFilters();
    renderAll();
    alert('所有数据已清除。');
}

// --- 标签管理 ---
function renderTagManage() {
    const container = document.getElementById('tagManageList');
    if (!container) return;
    if (customTags.length === 0) {
        container.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">暂无标签</span>';
        return;
    }
    container.innerHTML = customTags.map(tag => `
        <span class="tag-manage-item">
            ${tag}
            <span class="tag-manage-del" onclick="deleteTag('${tag}')">×</span>
        </span>
    `).join('');
}

function deleteTag(tag) {
    if (!confirm(`确定删除标签"${tag}"？已有事项的标签不会改变。`)) return;
    customTags = customTags.filter(t => t !== tag);
    localStorage.setItem('to-list-pro-tags', JSON.stringify(customTags));
    updateTagFilters();
    renderTagManage();
}

// --- 记账分类管理 ---
function renderFinanceCatManage() {
    const container = document.getElementById('financeCatManageList');
    if (!container) return;
    const allCats = [...financeCategories.income, ...financeCategories.expense];
    if (allCats.length === 0) {
        container.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">暂无分类</span>';
        return;
    }
    container.innerHTML = allCats.map(cat => `
        <span class="tag-manage-item" style="${financeCategories.income.includes(cat) ? 'border-left:3px solid var(--primary-blue)' : 'border-left:3px solid var(--harmony-red)'}">
            ${financeCategories.income.includes(cat) ? '💰' : '💸'} ${cat}
            <span class="tag-manage-del" onclick="deleteFinanceCat('${cat}')">×</span>
        </span>
    `).join('');
}

function deleteFinanceCat(cat) {
    if (!confirm(`确定删除分类"${cat}"？已有记录不会改变。`)) return;
    financeCategories.income = financeCategories.income.filter(c => c !== cat);
    financeCategories.expense = financeCategories.expense.filter(c => c !== cat);
    localStorage.setItem('to-list-pro-finance-categories', JSON.stringify(financeCategories));
    renderFinanceCatManage();
}

// --- 日历面板 ---
let calendarYear, calendarMonth;
let calendarSelectedDay = null;

function openCalendar() {
    const now = new Date();
    calendarYear = now.getFullYear();
    calendarMonth = now.getMonth();
    calendarSelectedDay = null;
    renderCalendarGrid();
    document.getElementById('calendarPanel').classList.add('open');
}

function closeCalendar() {
    document.getElementById('calendarPanel').classList.remove('open');
    renderAll(); // 恢复完整日程视图
}

function changeMonth(delta) {
    calendarMonth += delta;
    if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    calendarSelectedDay = null;
    renderCalendarGrid();
}

function renderCalendarGrid() {
    const grid = document.getElementById('calendarGrid');
    const header = document.getElementById('calendarPanelDate');
    const dayTitle = document.getElementById('calendarDayTitle');
    const dayList = document.getElementById('calendarDayList');
    if (!grid || !header) return;

    header.innerText = `${calendarYear}年 ${calendarMonth + 1}月`;
    if (dayTitle) dayTitle.innerText = '';
    if (dayList) dayList.innerHTML = '';

    const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const prevMonthDays = new Date(calendarYear, calendarMonth, 0).getDate();
    const startOffset = firstDay === 0 ? 6 : firstDay - 1;

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${(today.getMonth()+1).toString().padStart(2,'0')}-${today.getDate().toString().padStart(2,'0')}`;

    const eventDays = {};
    items.filter(i => i.type === 'period').forEach(i => {
        if (!i.startTime) return;
        const d = i.startTime.slice(0, 10);
        if (!eventDays[d]) eventDays[d] = [];
        eventDays[d].push(i.tag || '其他'); // 每个事件一个点
    });

    grid.innerHTML = '';
    for (let i = startOffset - 1; i >= 0; i--) {
        grid.appendChild(createDayEl(prevMonthDays - i, 'other-month', '', eventDays));
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${calendarYear}-${(calendarMonth+1).toString().padStart(2,'0')}-${d.toString().padStart(2,'0')}`;
        let cls = '';
        if (ds === todayStr) cls = 'today';
        if (d === calendarSelectedDay) cls += ' selected';
        grid.appendChild(createDayEl(d, cls, ds, eventDays));
    }
    const totalCells = startOffset + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= remaining; d++) {
        grid.appendChild(createDayEl(d, 'other-month', '', eventDays));
    }
}

function createDayEl(day, cls, dateStr, eventDays) {
    const div = document.createElement('div');
    div.className = 'calendar-day ' + cls;
    div.innerHTML = `<span>${day}</span>`;
    if (dateStr && eventDays[dateStr] && eventDays[dateStr].length > 0) {
        const tags = eventDays[dateStr];
        const maxDots = 4;
        const dots = tags.slice(0, maxDots).map(t => `<span class="calendar-dot ${getTagClass(t)}"></span>`).join('');
        const more = tags.length > maxDots ? `<span style="font-size:7px;color:#999">+${tags.length - maxDots}</span>` : '';
        div.innerHTML += `<div class="calendar-day-dots">${dots}${more}</div>`;
    }
    if (dateStr) {
        div.onclick = () => {
            calendarSelectedDay = day;
            renderCalendarGrid();
            showDayEvents(dateStr);
        };
    }
    return div;
}

function showDayEvents(dateStr) {
    // 更新日历面板下方
    const dayTitle = document.getElementById('calendarDayTitle');
    const dayList = document.getElementById('calendarDayList');
    if (!dayTitle || !dayList) return;
    const d = new Date(dateStr);
    const weekNames = ['周日','周一','周二','周三','周四','周五','周六'];
    dayTitle.innerText = `${d.getMonth()+1}月${d.getDate()}日 ${weekNames[d.getDay()]}`;
    const periods = items.filter(i => i.type === 'period' && i.startTime && i.startTime.startsWith(dateStr))
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    if (periods.length === 0) {
        dayList.innerHTML = '<div class="empty-state">当天暂无安排</div>';
    } else {
        dayList.innerHTML = periods.map(item => {
            const start = new Date(item.startTime);
            const end = new Date(item.endTime);
            const tl = `${start.getHours().toString().padStart(2,'0')}:${start.getMinutes().toString().padStart(2,'0')}`;
            return `<div class="todo-item" style="margin-bottom:4px;cursor:pointer" onclick="editItem(${item.id})">
                <span style="font-size:16px;margin-right:8px">${getEventIcon(item.name, item.tag)}</span>
                <div class="todo-info">
                    <div class="todo-title">${escapeHtml(item.name)}</div>
                    <div class="todo-meta">${tl} - ${end.getHours().toString().padStart(2,'0')}:${end.getMinutes().toString().padStart(2,'0')} ${escapeHtml(item.location || '')}</div>
                </div>
            </div>`;
        }).join('');
    }
    // 同步外部日程时间轴
    filterTimelineByDate(dateStr);
}

function filterTimelineByDate(dateStr) {
    const container = document.getElementById('timelineList');
    if (!container) return;
    container.innerHTML = '';
    const periods = items.filter(i => i.type === 'period' && i.startTime && i.startTime.startsWith(dateStr))
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    if (periods.length === 0) {
        container.innerHTML = `<div class="empty-state">${dateStr} 暂无安排</div>`;
        return;
    }
    periods.forEach(item => {
        const start = new Date(item.startTime);
        const end = new Date(item.endTime);
        const timeLabel = `${start.getHours().toString().padStart(2,'0')}:${start.getMinutes().toString().padStart(2,'0')}`;
        const div = document.createElement('div');
        div.className = 'timeline-item';
        div.innerHTML = `
            <div class="time-label">${timeLabel}</div>
            <div class="timeline-card-wrapper">
                <div class="timeline-card ${getTagClass(item.tag)}">
                    <div class="timeline-card-header">
                        <span class="timeline-card-icon">${getEventIcon(item.name, item.tag)}</span>
                        <span class="timeline-card-title">${escapeHtml(item.name)}</span>
                    </div>
                    <div class="timeline-card-meta">
                        ${timeLabel} - ${end.getHours().toString().padStart(2,'0')}:${end.getMinutes().toString().padStart(2,'0')}
                        ${item.location ? ' @ ' + escapeHtml(item.location) : ''}
                    </div>
                </div>
                <div class="timeline-swipe-del" onclick="deletePeriod(${item.id})">删除</div>
            </div>
        `;
        const wrapper = div.querySelector('.timeline-card-wrapper');
        const card = wrapper.querySelector('.timeline-card');
        addSwipeToDelete(wrapper, card);
        card.addEventListener('click', (e) => {
            if (e.target.closest('.timeline-swipe-del')) return;
            editItem(item.id);
        });
        container.appendChild(div);
    });
}

// 日程页面右滑打开日历
let calSwipeStartX = 0;
document.addEventListener('DOMContentLoaded', () => {
    const sp = document.getElementById('page-schedule');
    if (!sp) return;
    sp.addEventListener('touchstart', e => {
        if (e.target.closest('.calendar-panel')) return;
        calSwipeStartX = e.touches[0].clientX;
    }, { passive: true });
    sp.addEventListener('touchend', e => {
        if (e.target.closest('.calendar-panel')) return;
        const dx = e.changedTouches[0].clientX - calSwipeStartX;
        if (dx > 60) openCalendar(); // 右滑 >60px
    });
});

// 日历面板按钮事件
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('calendarPanelBack').onclick = closeCalendar;
    document.getElementById('calPrevMonth').onclick = () => changeMonth(-1);
    document.getElementById('calNextMonth').onclick = () => changeMonth(1);
    document.getElementById('calendarPanelAddBtn').onclick = () => {
        openModal('period');
        setTimeout(() => {
            const ds = calendarSelectedDay
                ? `${calendarYear}-${(calendarMonth+1).toString().padStart(2,'0')}-${calendarSelectedDay.toString().padStart(2,'0')}`
                : new Date().toISOString().slice(0,10);
            const startEl = document.getElementById('startTime');
            const endEl = document.getElementById('endTime');
            if (startEl) startEl.value = ds + 'T08:00';
            if (endEl) endEl.value = ds + 'T09:00';
        }, 50);
    };
});

// 窗口大小改变时重绘图表
window.addEventListener('resize', () => {
    if (currentPage === 'finance') drawExpenseChart();
});
