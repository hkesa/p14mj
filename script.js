
const PLAYERS = ['S', 'A', 'D', 'V', '銀姐', '潘', 'Guest 東', 'Guest 南', 'Guest 西', 'Guest 北'];
const SEATS = ['', '東', '南', '西', '北'];

// State
let currentRecords = [];
let historySummary = [];
let detailsArchive = [];
let undoBackup = null; // V1.8 Undo Backup

let editingRecordId = null;

// DOM Elements
const viewBtns = document.querySelectorAll('.nav-btn');
const views = document.querySelectorAll('.view');
const addRecordBtn = document.getElementById('add-record-btn');
const settleBtn = document.getElementById('settle-btn');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const undoSettleBtn = document.getElementById('undo-settle-btn'); // V1.8
const hamburger = document.querySelector('.hamburger'); // V1.9
const mainNav = document.querySelector('.main-nav'); // V1.9
const mobileHeaderTitle = document.getElementById('mobile-header-title'); // V1.11
const refreshBtn = document.getElementById('refresh-btn'); // V1.11

const modal = document.getElementById('add-modal');
const closeModal = document.querySelector('.close-modal');
const saveBtn = document.getElementById('save-record-btn');
const modalTitle = document.querySelector('.modal-header h2');

const tableBody = document.getElementById('record-tbody');
const historyBody = document.getElementById('history-tbody');
const statsTable = document.getElementById('stats-table');
const grandTotalDisplay = document.getElementById('grand-total-display');
const histGrandTotalDisplay = document.getElementById('hist-grand-total-display');
const statsTitle = document.getElementById('stats-title');

function init() {
    setupNavigation();
    setupHamburger();
    setupRefresh();
    setupModal();
    setupSettle();
    setupUndo();
    setupClearHistory();
    setupDice();

    // Cloud Firestore Sync Listener (V1.15 Final Fix)
    if (window.db && window.dbOnSnapshot) {
        const docRef = window.dbDoc(window.db, 'mahjong', 'appData');

        window.dbOnSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                currentRecords = data.records || [];
                historySummary = data.history || [];
                detailsArchive = data.archive || [];
                undoBackup = data.backup || null;
            } else {
                console.log("No cloud data found. Initializing empty state.");
                currentRecords = [];
                historySummary = [];
                detailsArchive = [];
                undoBackup = null;
            }
            renderTable();
            renderHistoryTable();
            renderStatsMatrix();
            updateUndoButtonState();
        }, (error) => {
            console.error("Firestore Error:", error);
        }, (error) => {
            console.error("Firestore Error:", error);
            alert(`連線資料庫失敗！\n錯誤代碼: ${error.code}\n錯誤訊息: ${error.message}\n請截圖告知我！`);
        });
    } else {
        console.error("Critical Error: Firebase Firestore not detected!");
        alert("資料庫連線失敗，請重新整理！");
    }
}

// V1.11 Refresh Logic
function setupRefresh() {
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            window.location.reload();
        });
    }
}

// V1.9 Hamburger Logic
function setupHamburger() {
    if (hamburger) {
        // Toggle on Hamburger Click
        hamburger.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent bubbling to body/nav if needed
            mainNav.classList.toggle('show');
        });

        // V1.11 Fix: Close menu when clicking ANYWHERE inside the nav (Buttons, Background, etc.)
        // V1.11 Fix: Close menu when clicking ANYWHERE inside the nav (Buttons, Background, etc.)
        if (mainNav) {
            mainNav.addEventListener('click', () => {
                setTimeout(() => {
                    mainNav.classList.remove('show');
                }, 50);
            });
        }

        // Optional: Close when clicking outside (Document level)
        document.addEventListener('click', (e) => {
            if (mainNav.classList.contains('show') && !mainNav.contains(e.target) && e.target !== hamburger) {
                mainNav.classList.remove('show');
            }
        });
    }
}

function setupNavigation() {
    viewBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // V1.11 Fix: Force Close Menu FIRST
            const title = btn.dataset.title;
            if (mainNav) mainNav.classList.remove('show');
            if (mobileHeaderTitle && title) mobileHeaderTitle.innerText = title;

            // Update Active State
            const target = btn.dataset.target;

            viewBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            views.forEach(v => v.classList.remove('active'));
            document.getElementById(target).classList.add('active');

            // Render specific views
            if (target === 'stats-view') {
                try {
                    renderStatsMatrix();
                } catch (err) {
                    console.error("Stats Render Error:", err);
                }
            }
        });
    });
}

function setupSettle() {
    settleBtn.addEventListener('click', () => {
        if (currentRecords.length === 0) return;

        if (confirm('確定要「埋數」？\n1. 將「Total」總數存入歷史排行榜。\n2. 清空紀錄表。\n(遊戲詳細數據會保留作統計用途)')) {
            performSettle();
        }
    });
}

// V1.8 Undo Logic
function setupUndo() {
    if (undoSettleBtn) {
        undoSettleBtn.addEventListener('click', () => {
            if (!undoBackup) return;
            if (confirm('確定要「撤銷埋數」？\n將會還原上一次埋數前的紀錄表，並從歷史和統計中移除該次資料。')) {
                performUndo();
            }
        });
    }
}

function setupClearHistory() {
    clearHistoryBtn.addEventListener('click', () => {
        if (confirm('確定要「清空資料」？\n此動作將會永久刪除所有歷史排行榜資料和詳細統計數據。\n(目前的紀錄表資料不會被刪除)')) {
            historySummary = [];
            detailsArchive = [];
            undoBackup = null; // Clear backup too
            saveAll();
            renderHistoryTable();
            updateUndoButtonState();
            alert('所有歷史和統計資料已清空。');
        }
    });
}

function performSettle() {
    // V1.8 Save Backup
    undoBackup = JSON.parse(JSON.stringify(currentRecords));

    // 1. Calculate Totals
    const sums = {};
    PLAYERS.forEach(p => sums[p] = 0);

    // V1.26 Calc Game Count
    let gameCount = 0;

    currentRecords.forEach(r => {
        // Check if valid game (has seats)
        let validGame = false;
        if (r.players) {
            Object.values(r.players).forEach(pData => {
                if (pData.seat) validGame = true;
            });
        }
        if (validGame) gameCount++;

        PLAYERS.forEach(p => {
            if (r.players && r.players[p]) sums[p] += r.players[p].score;
        });
    });

    // 2. Summary Record
    const summaryRecord = {
        id: Date.now(),
        date: new Date().toISOString().split('T')[0],
        type: 'summary',
        remark: '',
        players: {},
        gameCount: gameCount // V1.26 Store Game Count
    };

    PLAYERS.forEach(p => {
        if (sums[p] !== 0) {
            summaryRecord.players[p] = { score: sums[p] };
        }
    });

    historySummary.unshift(summaryRecord);

    // 3. Archive
    detailsArchive = detailsArchive.concat(JSON.parse(JSON.stringify(currentRecords)));

    // 4. Clear current
    currentRecords = [];

    saveAll();
    renderTable();
    renderHistoryTable();
    updateUndoButtonState();

    alert('已埋數。');
}

// ... (undo functions skipped, no change needed there usually unless strict structure required) ...

function performUndo() {
    if (!undoBackup) return;

    // 1. Restore Current
    // IMPORTANT: Concatenate to existing? Or Replace?
    // User said "restore back". If current table is empty, replace.
    // If user added data AFTER settle, we should probably append back the settled data or warn.
    // Simpler: Just Append backup to Current.
    currentRecords = currentRecords.concat(undoBackup);
    currentRecords.sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id);

    // 2. Remove from Archive
    // We filter out records that have IDs present in the backup logic
    const backupIds = new Set(undoBackup.map(r => r.id));
    detailsArchive = detailsArchive.filter(r => !backupIds.has(r.id));

    // 3. Remove Top Summary
    // We assume the top one is the last settle. 
    if (historySummary.length > 0) {
        historySummary.shift();
    }

    // 4. Clear Backup (One level undo only)
    undoBackup = null;

    saveAll();
    renderTable();
    renderHistoryTable();
    updateUndoButtonState();

    alert('已撤銷上一次埋數。');
}

function updateUndoButtonState() {
    if (undoSettleBtn) {
        if (undoBackup) {
            undoSettleBtn.disabled = false;
            undoSettleBtn.style.opacity = "1";
        } else {
            undoSettleBtn.disabled = true;
            undoSettleBtn.style.opacity = "0.5";
        }
    }
}

function saveAll() {
    // V1.15 Final Firestore Sync (Write)
    if (window.db && window.dbSet) {
        const docRef = window.dbDoc(window.db, 'mahjong', 'appData');
        window.dbSet(docRef, {
            records: currentRecords,
            history: historySummary,
            archive: detailsArchive,
            backup: undoBackup
        }).catch(err => {
            console.error("Firestore Write Error:", err);
        });
    }
}

function setupModal() {
    addRecordBtn.addEventListener('click', () => {
        openModal();
    });

    closeModal.addEventListener('click', () => modal.classList.add('hidden'));

    saveBtn.addEventListener('click', saveRecord);

    const calcInput = document.getElementById('calc-input');
    const calcResult = document.getElementById('calc-result');
    calcInput.addEventListener('input', () => {
        const val = parseFloat(calcInput.value);
        if (!isNaN(val)) {
            const res = val - 200;
            calcResult.value = (res > 0 ? "+" : "") + res;
        } else {
            calcResult.value = "";
        }
    });
}

function openModal(existingRecord = null) {
    if (existingRecord) {
        editingRecordId = existingRecord.id;
        modalTitle.innerText = "Edit Record";
        saveBtn.innerText = "Update Record";

        document.getElementById('record-date').value = existingRecord.date;
        document.getElementById('record-remark').value = existingRecord.remark || "";
        document.getElementById('calc-input').value = '';
        document.getElementById('calc-result').value = '';

        const isThreeFan = existingRecord.threeFanMin === true;
        document.querySelector('input[name="three-fan-min"][value="yes"]').checked = isThreeFan;
        document.querySelector('input[name="three-fan-min"][value="no"]').checked = !isThreeFan;

        renderPlayerInputs(existingRecord.players);
    } else {
        editingRecordId = null;
        modalTitle.innerText = "New Record";
        saveBtn.innerText = "Add Record";

        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        document.getElementById('record-date').value = `${yyyy}-${mm}-${dd}`;
        document.getElementById('record-remark').value = '';
        document.getElementById('calc-input').value = '';
        document.getElementById('calc-result').value = '';

        document.querySelector('input[name="three-fan-min"][value="yes"]').checked = false;
        document.querySelector('input[name="three-fan-min"][value="no"]').checked = true;

        renderPlayerInputs({});
    }

    updateModalSum();
    modal.classList.remove('hidden');
}

function renderPlayerInputs(playerData = {}) {
    const container = document.getElementById('players-input-container');
    container.innerHTML = '';

    PLAYERS.forEach((player, index) => {
        const pData = playerData[player] || {};
        const row = document.createElement('div');
        row.className = 'player-row';

        // V1.18: If value is 0, show empty string
        const displayVal = (pData.score !== undefined && pData.score !== 0) ? Math.abs(pData.score) : '';

        row.innerHTML = `
            <span class="player-name">${player}</span>
            <button class="pos-neg-btn plus" data-type="plus" tabindex="-1">+</button>
            <button class="pos-neg-btn minus" data-type="minus" tabindex="-1">-</button>
            <input type="number" class="score-input" inputmode="numeric" data-player="${index}" placeholder="" value="${displayVal}">
            <select class="seat-select" data-player="${index}">
                <option value="">座</option>
                ${SEATS.filter(s => s).map(s => `<option value="${s}" ${pData.seat === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
        `;
        container.appendChild(row);

        const input = row.querySelector('.score-input');
        const plusBtn = row.querySelector('.plus');
        const minusBtn = row.querySelector('.minus');

        if (pData.score !== undefined) {
            if (pData.score > 0) plusBtn.classList.add('active');
            if (pData.score < 0) minusBtn.classList.add('active');
        }

        input.addEventListener('input', () => {
            updateModalSum();
            updatePosNegState(input, plusBtn, minusBtn);
        });

        plusBtn.addEventListener('click', () => {
            let v = parseFloat(input.value) || 0;
            input.value = v === 0 ? '' : v; // V1.18 Clear 0
            plusBtn.classList.add('active');
            minusBtn.classList.remove('active');
            updateModalSum();
        });

        minusBtn.addEventListener('click', () => {
            let v = parseFloat(input.value) || 0;
            input.value = v === 0 ? '' : v; // V1.18 Clear 0
            minusBtn.classList.add('active');
            plusBtn.classList.remove('active');
            updateModalSum();
        });

        const seatSelect = row.querySelector('.seat-select');
        seatSelect.addEventListener('change', checkDuplicateSeats);
    });

    checkDuplicateSeats();
}

function checkDuplicateSeats() {
    const seatSelects = document.querySelectorAll('.seat-select');
    const selected = [];
    let hasDuplicate = false;
    seatSelects.forEach(sel => {
        const val = sel.value;
        if (val) {
            if (selected.includes(val)) {
                hasDuplicate = true;
            } else {
                selected.push(val);
            }
        }
    });

    const warningEl = document.getElementById('duplicate-seat-warning');
    const saveBtn = document.getElementById('save-record-btn');
    if (warningEl) {
        warningEl.style.display = hasDuplicate ? 'block' : 'none';
    }
    if (saveBtn) {
        saveBtn.disabled = hasDuplicate;
        saveBtn.style.opacity = hasDuplicate ? '0.5' : '1';
        saveBtn.style.cursor = hasDuplicate ? 'not-allowed' : 'pointer';
    }
}

function resolveScore(input, plusBtn, minusBtn) {
    let v = parseFloat(input.value) || 0;
    if (minusBtn.classList.contains('active')) {
        return -Math.abs(v);
    }
    return Math.abs(v);
}

function updatePosNegState(input, plusBtn, minusBtn) {
    let v = parseFloat(input.value);
    if (v < 0) {
        input.value = Math.abs(v);
        minusBtn.classList.add('active');
        plusBtn.classList.remove('active');
    }
}

function updateModalSum() {
    const inputs = document.querySelectorAll('.score-input');
    let sum = 0;
    inputs.forEach(inp => {
        const row = inp.closest('.player-row');
        const plusBtn = row.querySelector('.plus');
        const minusBtn = row.querySelector('.minus');
        sum += resolveScore(inp, plusBtn, minusBtn);
    });

    // V1.18: Display Sum multiplied by -1
    const displaySum = sum * -1;

    const sumEl = document.getElementById('modal-total-sum');
    sumEl.textContent = (displaySum > 0 ? "+" : "") + displaySum;
    sumEl.className = getNumClass(displaySum);
}

function getNumClass(num) {
    if (num > 0) return 'num-pos';
    if (num < 0) return 'num-neg';
    return 'num-zero';
}

function formatNum(num) {
    if (num > 0) return "+" + num;
    return num;
}

function saveRecord() {
    const dateStr = document.getElementById('record-date').value;
    const isThreeFanMin = document.querySelector('input[name="three-fan-min"][value="yes"]').checked;
    const remark = document.getElementById('record-remark').value;
    const playerInputs = document.querySelectorAll('.score-input');
    const seatSelects = document.querySelectorAll('.seat-select');

    const pObj = {};
    playerInputs.forEach((inp, idx) => {
        const pName = PLAYERS[idx];
        const row = inp.closest('.player-row');
        const plusBtn = row.querySelector('.plus');
        const minusBtn = row.querySelector('.minus');
        const seat = seatSelects[idx].value;

        let rawVal = inp.value;
        if (rawVal !== "" || seat !== "") {
            pObj[pName] = {
                score: rawVal !== "" ? resolveScore(inp, plusBtn, minusBtn) : 0,
                seat: seat
            };
        }
    });

    if (editingRecordId) {
        const idx = currentRecords.findIndex(r => r.id === editingRecordId);
        if (idx !== -1) {
            currentRecords[idx].date = dateStr;
            currentRecords[idx].threeFanMin = isThreeFanMin;
            currentRecords[idx].remark = remark;
            currentRecords[idx].players = pObj;
        }
    } else {
        const record = {
            id: Date.now(),
            date: dateStr,
            threeFanMin: isThreeFanMin,
            remark: remark,
            players: pObj
        };
        currentRecords.push(record);
    }

    currentRecords.sort((a, b) => new Date(b.date) - new Date(a.date) || b.id - a.id);

    saveAll();
    renderTable();
    modal.classList.add('hidden');
}


function renderTable() {
    renderGenericTable(currentRecords, tableBody, ['sum-s', 'sum-a', 'sum-d', 'sum-v', 'sum-yin', 'sum-pan', 'sum-g1', 'sum-g2', 'sum-g3', 'sum-g4'], grandTotalDisplay, true, 'record');
}

function renderHistoryTable() {
    renderGenericTable(historySummary, historyBody, ['hist-sum-s', 'hist-sum-a', 'hist-sum-d', 'hist-sum-v', 'hist-sum-yin', 'hist-sum-pan', 'hist-sum-g1', 'hist-sum-g2', 'hist-sum-g3', 'hist-sum-g4'], histGrandTotalDisplay, false, 'history');
}

function renderGenericTable(dataList, tbody, sumIds, grandTotalEl, isEditable, mode) {
    tbody.innerHTML = '';

    const sums = {};
    PLAYERS.forEach(p => sums[p] = 0);

    // For record view, we need to count total valid records to assign IDs in reverse
    // Since currentRecords is sorted by Date DESC (Newest First)
    // The "Game Count" should be #1 for the oldest, #N for the newest.
    // If we render top-to-bottom (Newest First), the top row is #N.
    // We need to count how many VALID records there are first.
    let totalValidRecords = 0;
    if (mode === 'record') {
        totalValidRecords = dataList.length;
    }

    let currentValidIndex = totalValidRecords;

    dataList.forEach(r => {
        const row = document.createElement('tr');

        let posCount = 0;
        let negCount = 0;
        let posPlayer = null;
        let negPlayer = null;
        let hasSeat = false;

        PLAYERS.forEach(p => {
            if (r.players[p]) {
                const s = r.players[p].score;
                if (r.players[p].seat) hasSeat = true;

                if (s > 0) {
                    posCount++;
                    posPlayer = p;
                } else if (s < 0) {
                    negCount++;
                    negPlayer = p;
                }
            }
        });

        const dateCell = document.createElement('td');
        dateCell.className = "first-col";
        dateCell.innerText = r.date;
        if (isEditable) {
            dateCell.title = "Click to Edit";
            dateCell.onclick = () => openModal(r);
        }
        row.appendChild(dateCell);

        // V1.26 Game Count Cell
        const gameCountCell = document.createElement('td');
        if (mode === 'record') {
            // Pad with zeros, e.g. 001
            const formattedCount = String(currentValidIndex).padStart(3, '0');
            if (r.threeFanMin) {
                gameCountCell.innerHTML = `<span class="three-fan-min-highlight">${formattedCount}</span>`;
            } else {
                gameCountCell.innerText = formattedCount;
            }
            currentValidIndex--;
        } else {
            // History mode
            // Only show if it exists in the summary record
            if (r.gameCount !== undefined) {
                if (r.threeFanMin) {
                    gameCountCell.innerHTML = `<span class="three-fan-min-highlight">${r.gameCount}</span>`;
                } else {
                    gameCountCell.innerText = r.gameCount;
                }
            } else {
                gameCountCell.innerText = "-";
            }
        }
        row.appendChild(gameCountCell);

        PLAYERS.forEach(p => {
            const cell = document.createElement('td');
            if (r.players[p]) {
                const s = r.players[p].score;
                sums[p] += s;
                cell.innerText = formatNum(s);
                cell.className = getNumClass(s);

                // Highlight Borders
                if (negCount === 3 && posCount === 1 && p === posPlayer) {
                    cell.classList.add('highlight-pos-border');
                }
                if (negCount === 1 && posCount === 3 && p === negPlayer) {
                    cell.classList.add('highlight-neg-border');
                }

            } else {
                cell.innerText = "-";
                cell.className = "num-zero";
            }
            row.appendChild(cell);
        });

        const remCell = document.createElement('td');
        remCell.innerText = r.remark || "";
        row.appendChild(remCell);

        tbody.appendChild(row);
    });

    // V1.26 Update Total Game Count in Sum Row
    if (mode === 'record') {
        const countEl = document.getElementById('total-game-count');
        if (countEl) countEl.innerText = totalValidRecords;
    }

    // Sums
    let grandTotal = 0;
    PLAYERS.forEach((p, idx) => {
        const el = document.getElementById(sumIds[idx]);
        if (el) {
            const s = sums[p];
            grandTotal += s;
            el.innerText = formatNum(s);
            el.className = getNumClass(s);
        }
    });

    if (grandTotalEl) {
        // V1.26 For Record View, User wants "Final Game Count" in the Total row?
        // Request: "而「Total ➡️」的右邊就顯示最後的局數"
        // The Total Row is in the THEAD, so we need a new TH for it.
        // Wait, the DOM structure has a `tr.sum-row`.
        // We added a new column to the header, so we need to add a new cell to the sum-row too
        // or else the columns will misalign.
        // Let's fix the HTML for sum-row in next steps or JS injection?
        // Actually, the previous HTML edit added `<th>局數</th>` to the Header Row, but NOT the Sum Row.
        // I need to add a placeholder cell in the Sum Row so the columns align.

        grandTotalEl.innerText = formatNum(grandTotal);
        grandTotalEl.className = getNumClass(grandTotal);
    }
}


function renderStatsMatrix() {
    const allRecords = detailsArchive.concat(currentRecords);

    const stats = {};
    PLAYERS.forEach(p => {
        stats[p] = {};
        PLAYERS.forEach(u => {
            if (p !== u) stats[p][u] = { wins: 0, losses: 0, total: 0 };
        });
    });

    const upstreamMap = { '東': '北', '南': '東', '西': '南', '北': '西' };
    let gameCount = 0;

    allRecords.forEach(r => {
        if (r.type === 'summary') return;

        let validGame = false;
        const seatToPlayer = {};
        Object.keys(r.players).forEach(pName => {
            const seat = r.players[pName].seat;
            if (seat && ['東', '南', '西', '北'].includes(seat)) {
                seatToPlayer[seat] = pName;
                validGame = true;
            }
        });

        if (validGame) gameCount++;

        Object.keys(r.players).forEach(pName => {
            const pData = r.players[pName];
            const mySeat = pData.seat;
            if (!mySeat || !upstreamMap[mySeat]) return;

            const upSeat = upstreamMap[mySeat];
            const upPlayer = seatToPlayer[upSeat];

            if (upPlayer && stats[pName][upPlayer]) {
                stats[pName][upPlayer].total++;
                if (pData.score > 0) {
                    stats[pName][upPlayer].wins++;
                } else if (pData.score < 0) {
                    stats[pName][upPlayer].losses++;
                }
            }
        });
    });

    statsTitle.innerText = `上家勝率／輸率統計 (總局數：${gameCount})`;

    statsTable.innerHTML = '';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<th>上家 ➡️</th>';
    PLAYERS.forEach(p => {
        headerRow.innerHTML += `<th>${p}</th>`;
    });
    thead.appendChild(headerRow);
    statsTable.appendChild(thead);

    const tbody = document.createElement('tbody');
    PLAYERS.forEach(subject => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="first-col">${subject}</td>`;

        PLAYERS.forEach(upstream => {
            if (subject === upstream) {
                tr.innerHTML += '<td style="background:#eee"></td>';
            } else {
                const s = stats[subject][upstream];
                if (s && s.total > 0) {
                    const winRate = Math.round((s.wins / s.total) * 100);
                    const lossRate = Math.round((s.losses / s.total) * 100);

                    tr.innerHTML += `
                        <td>
                            <span class="num-pos">${winRate}%</span><span class="num-zero">：</span><span class="num-neg">${lossRate}%</span>
                            <br>
                            <span style="font-size:0.6em">
                                <span class="num-pos">(${s.wins}/${s.total})</span><span class="num-zero">：</span><span class="num-neg">(${s.losses}/${s.total})</span>
                            </span>
                        </td>`;
                } else {
                    tr.innerHTML += '<td class="num-zero">-</td>';
                }
            }
        });
        tbody.appendChild(tr);
    });
    statsTable.appendChild(tbody);

    // V1.20 Stats Upgrade
    const additionalContainer = document.getElementById('additional-stats-container');
    if (!additionalContainer) return;

    // Process all games in chronological order
    // Process all games in chronological order
    const chronologicalGames = allRecords.filter(r => r.type !== 'summary').sort((a, b) => new Date(a.date) - new Date(b.date) || a.id - b.id);

    const streaks = {};
    const maxWin = {};
    const maxLoss = {};

    // Seat Stats
    const seatStats = {
        '東': { wins: 0, losses: 0, winSum: 0, lossSum: 0, winCount: 0, lossCount: 0 },
        '南': { wins: 0, losses: 0, winSum: 0, lossSum: 0, winCount: 0, lossCount: 0 },
        '西': { wins: 0, losses: 0, winSum: 0, lossSum: 0, winCount: 0, lossCount: 0 },
        '北': { wins: 0, losses: 0, winSum: 0, lossSum: 0, winCount: 0, lossCount: 0 }
    };

    // Personal Stats
    const personalStats = {};

    const allScoresList = []; // { p: name, score: val }
    const allWinStreaks = [];
    const allLossStreaks = [];

    PLAYERS.forEach(p => {
        streaks[p] = { win: 0, loss: 0, currentWin: 0, currentLoss: 0 };
        maxWin[p] = 0;
        maxLoss[p] = 0;
        personalStats[p] = { winSum: 0, winCount: 0, lossSum: 0, lossCount: 0 };
    });

    // V1.26 New Stats
    const winOver100 = {};
    const lossOver100 = {};
    const oneWinThreeKills = {};
    const oneLossThreeWins = {};
    PLAYERS.forEach(p => {
        winOver100[p] = 0;
        lossOver100[p] = 0;
        oneWinThreeKills[p] = 0;
        oneLossThreeWins[p] = 0;
    });

    // Date Filter Thresholds (Preserved from V1.19)
    const SEAT_DATE_THRESHOLD = new Date('2026-01-15T00:00:00');
    const PERSONAL_AVG_THRESHOLD = new Date('2025-10-31T00:00:00');
    // V1.27 Streak Threshold
    const STREAK_DATE_THRESHOLD = new Date('2025-10-30T00:00:00');

    chronologicalGames.forEach(game => {
        const gameDate = new Date(game.date);

        // V1.26 Game Result Analysis
        let posCount = 0;
        let negCount = 0;

        PLAYERS.forEach(p => {
            if (game.players[p]) {
                const score = game.players[p].score;

                // V1.27 > 100 Stats (Inclusive)
                if (score >= 100) winOver100[p]++;
                if (score <= -100) lossOver100[p]++;

                if (score > 0) posCount++;
                if (score < 0) negCount++;

                // Max Win / Loss (Personal)
                if (score > maxWin[p]) maxWin[p] = score;
                if (score < maxLoss[p]) maxLoss[p] = score;

                // V1.27 Streaks logic (Date Filtered)
                // V1.28 Fix: Use >= to include the start date
                if (gameDate >= STREAK_DATE_THRESHOLD) {
                    if (score > 0) {
                        if (streaks[p].currentLoss > 0) {
                            allLossStreaks.push({ p: p, val: streaks[p].currentLoss });
                        }
                        streaks[p].currentWin++;
                        streaks[p].currentLoss = 0;
                        if (streaks[p].currentWin > streaks[p].win) streaks[p].win = streaks[p].currentWin;
                    } else if (score < 0) {
                        if (streaks[p].currentWin > 0) {
                            allWinStreaks.push({ p: p, val: streaks[p].currentWin });
                        }
                        streaks[p].currentLoss++;
                        streaks[p].currentWin = 0;
                        if (streaks[p].currentLoss > streaks[p].loss) streaks[p].loss = streaks[p].currentLoss;
                    } else {
                        if (streaks[p].currentWin > 0) allWinStreaks.push({ p: p, val: streaks[p].currentWin });
                        if (streaks[p].currentLoss > 0) allLossStreaks.push({ p: p, val: streaks[p].currentLoss });
                        streaks[p].currentWin = 0;
                        streaks[p].currentLoss = 0;
                    }
                }

                // Collect for Leaderboard
                if (score !== 0) {
                    allScoresList.push({ p: p, score: score });
                }

                // Personal Average Filter
                if (gameDate > PERSONAL_AVG_THRESHOLD) {
                    if (score > 0) {
                        personalStats[p].winSum += score;
                        personalStats[p].winCount++;
                    } else if (score < 0) {
                        personalStats[p].lossSum += score;
                        personalStats[p].lossCount++;
                    }
                }

                // Seat Filter
                if (gameDate > SEAT_DATE_THRESHOLD) {
                    const seat = game.players[p].seat;
                    if (seat && seatStats[seat]) {
                        if (score > 0) {
                            seatStats[seat].wins++; // Win Count
                            seatStats[seat].winSum += score;
                            seatStats[seat].winCount++;
                        }
                        if (score < 0) {
                            seatStats[seat].losses++;
                            seatStats[seat].lossSum += score;
                            seatStats[seat].lossCount++;
                        }
                    }
                }
            }
        });

        // V1.26 1W3L / 1L3W Analysis
        if (posCount === 1 && negCount === 3) {
            PLAYERS.forEach(p => {
                if (game.players[p] && game.players[p].score > 0) oneWinThreeKills[p]++;
            });
        }
        if (negCount === 1 && posCount === 3) {
            PLAYERS.forEach(p => {
                if (game.players[p] && game.players[p].score < 0) oneLossThreeWins[p]++;
            });
        }
    });

    // Push currently active streaks
    PLAYERS.forEach(p => {
        if (streaks[p].currentWin > 0) allWinStreaks.push({ p: p, val: streaks[p].currentWin });
        if (streaks[p].currentLoss > 0) allLossStreaks.push({ p: p, val: streaks[p].currentLoss });
    });

    // V1.31 New Stats Calculations
    // 1. Winning Seat Sequences
    const winningSeats = [];
    chronologicalGames.forEach(game => {
        let maxPosPlayer = null;
        let maxPosScore = 0;
        PLAYERS.forEach(p => {
            if (game.players[p] && game.players[p].score > maxPosScore && game.players[p].seat) {
                maxPosScore = game.players[p].score;
                maxPosPlayer = p;
            }
        });
        if (maxPosPlayer) {
            winningSeats.push(game.players[maxPosPlayer].seat);
        }
    });

    const getMostFrequentNGram = (arr, n) => {
        if (arr.length < n) return null;
        const counts = {};
        for (let i = 0; i <= arr.length - n; i++) {
            const seq = arr.slice(i, i + n).join(' > ');
            counts[seq] = (counts[seq] || 0) + 1;
        }
        let maxCount = 0; let maxSeq = null;
        for (const seq in counts) {
            if (counts[seq] > maxCount) {
                maxCount = counts[seq];
                maxSeq = seq;
            }
        }
        return maxSeq ? { seq: maxSeq, count: maxCount } : null;
    };

    const winningSeatSequences = [
        { label: "12順序", data: getMostFrequentNGram(winningSeats, 12) },
        { label: "11順序", data: getMostFrequentNGram(winningSeats, 11) },
        { label: "10順序", data: getMostFrequentNGram(winningSeats, 10) },
        { label: "9順序", data: getMostFrequentNGram(winningSeats, 9) },
        { label: "8順序", data: getMostFrequentNGram(winningSeats, 8) },
        { label: "7順序", data: getMostFrequentNGram(winningSeats, 7) },
        { label: "6順序", data: getMostFrequentNGram(winningSeats, 6) },
        { label: "5順序", data: getMostFrequentNGram(winningSeats, 5) },
        { label: "4順序", data: getMostFrequentNGram(winningSeats, 4) },
        { label: "3順序", data: getMostFrequentNGram(winningSeats, 3) }
    ].filter(x => x.data !== null);

    // 2. Cyclic Player Sequences
    const cyclicPlayerCounts = {};
    chronologicalGames.forEach(game => {
        const seats = {};
        let seatCount = 0;
        PLAYERS.forEach(p => {
            if (game.players[p] && game.players[p].seat) {
                seats[game.players[p].seat] = p;
                seatCount++;
            }
        });
        if (seatCount === 4 && seats['東'] && seats['南'] && seats['西'] && seats['北']) {
            const arr = [seats['東'], seats['南'], seats['西'], seats['北']];
            const rots = [
                arr,
                [arr[1], arr[2], arr[3], arr[0]],
                [arr[2], arr[3], arr[0], arr[1]],
                [arr[3], arr[0], arr[1], arr[2]]
            ];
            let canonical = rots[0].join(' > ');
            for (let i = 1; i < 4; i++) {
                const tr = rots[i].join(' > ');
                if (tr < canonical) canonical = tr;
            }
            cyclicPlayerCounts[canonical] = (cyclicPlayerCounts[canonical] || 0) + 1;
        }
    });
    const sortedPlayerCombinations = Object.keys(cyclicPlayerCounts)
        .map(seq => ({ seq, count: cyclicPlayerCounts[seq] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);

    // 1. Sort Rankings (Personal)
    const winStreakRanking = PLAYERS.map(p => ({ p, val: streaks[p].win })).filter(x => x.val > 0).sort((a, b) => b.val - a.val);
    const lossStreakRanking = PLAYERS.map(p => ({ p, val: streaks[p].loss })).filter(x => x.val > 0).sort((a, b) => b.val - a.val);
    const maxWinRanking = PLAYERS.map(p => ({ p, val: maxWin[p] })).filter(x => x.val > 0).sort((a, b) => b.val - a.val);
    const maxLossRanking = PLAYERS.map(p => ({ p, val: maxLoss[p] })).filter(x => x.val < 0).sort((a, b) => a.val - b.val);

    const personalAvgWinRanking = PLAYERS.map(p => {
        const d = personalStats[p];
        const avg = d.winCount > 0 ? Math.round(d.winSum / d.winCount) : 0;
        return { p, val: avg };
    }).filter(x => x.val > 0).sort((a, b) => b.val - a.val);

    const personalAvgLossRanking = PLAYERS.map(p => {
        const d = personalStats[p];
        const avg = d.lossCount > 0 ? Math.round(d.lossSum / d.lossCount) : 0;
        return { p, val: avg };
    }).filter(x => x.val < 0).sort((a, b) => a.val - b.val);

    // 2. Leaderboards (Top 5)
    const leaderboardMaxWin = allScoresList.filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
    const leaderboardMaxLoss = allScoresList.filter(x => x.score < 0).sort((a, b) => a.score - b.score).slice(0, 5);

    const leaderboardWinStreak = allWinStreaks.sort((a, b) => b.val - a.val).slice(0, 5);
    const leaderboardLossStreak = allLossStreaks.sort((a, b) => b.val - a.val).slice(0, 5);

    // V1.26/V1.27/V1.28 New Stats Rankings
    // Filter: Only S, A, D, V
    const targetPlayers = ['S', 'A', 'D', 'V'];

    const winOver100Ranking = PLAYERS
        .filter(p => targetPlayers.includes(p))
        .map(p => ({ p, val: winOver100[p] })).sort((a, b) => b.val - a.val);

    const lossOver100Ranking = PLAYERS
        .filter(p => targetPlayers.includes(p))
        .map(p => ({ p, val: lossOver100[p] })).sort((a, b) => b.val - a.val);

    const oneWinThreeKillsRanking = PLAYERS
        .filter(p => targetPlayers.includes(p))
        .map(p => ({ p, val: oneWinThreeKills[p] })).sort((a, b) => b.val - a.val);

    const oneLossThreeWinsRanking = PLAYERS
        .filter(p => targetPlayers.includes(p))
        .map(p => ({ p, val: oneLossThreeWins[p] })).sort((a, b) => b.val - a.val);

    // 3. Seat Rankings (V1.20 Sorted)
    const seatsOrder = ['東', '南', '西', '北'];

    // Seat Total Wins: Sort by wins desc
    const seatTotalWinsRanking = seatsOrder.map(s => ({ s, val: seatStats[s].wins }))
        .sort((a, b) => b.val - a.val);

    // Seat Net Wins: Sort by (wins - losses) desc
    const seatNetWinsRanking = seatsOrder.map(s => ({
        s,
        val: seatStats[s].wins - seatStats[s].losses,
        w: seatStats[s].wins,
        l: seatStats[s].losses
    })).sort((a, b) => b.val - a.val);

    // Seat Avg Score: Sort by (winSum/winCount) desc
    const seatAvgScoreRanking = seatsOrder.map(s => {
        const d = seatStats[s];
        const avg = d.winCount > 0 ? Math.round(d.winSum / d.winCount) : 0;
        return { s, val: avg };
    }).sort((a, b) => b.val - a.val);

    // Seat Avg Loss: Sort by (lossSum/lossCount) asc (Most negative to Least negative)
    const seatAvgLossRanking = seatsOrder.map(s => {
        const d = seatStats[s];
        const avg = d.lossCount > 0 ? Math.round(d.lossSum / d.lossCount) : 0;
        return { s, val: avg };
    }).sort((a, b) => a.val - b.val);

    // V1.21 Seat Avg Net Score: (Avg Score + Avg Loss)
    // Sort by Value Descending (High positive to Low negative)
    const seatAvgNetRanking = seatsOrder.map(s => {
        const d = seatStats[s];
        const avgWin = d.winCount > 0 ? Math.round(d.winSum / d.winCount) : 0;
        const avgLoss = d.lossCount > 0 ? Math.round(d.lossSum / d.lossCount) : 0;
        const net = avgWin + avgLoss;
        return { s, val: net };
    }).sort((a, b) => b.val - a.val);

    // V1.26 Seat Total Net Score
    const seatTotalNetRanking = seatsOrder.map(s => {
        const d = seatStats[s];
        const net = d.winSum + d.lossSum;
        return { s, val: net };
    }).sort((a, b) => b.val - a.val);

    // V1.21 Personal Avg Net Score
    // Sort by Value Descending
    // V1.24 Filter: Only S, A, D, V
    const personalAvgNetRanking = PLAYERS
        .filter(p => ['S', 'A', 'D', 'V'].includes(p))
        .map(p => {
            const d = personalStats[p];
            const avgWin = d.winCount > 0 ? Math.round(d.winSum / d.winCount) : 0;
            const avgLoss = d.lossCount > 0 ? Math.round(d.lossSum / d.lossCount) : 0;
            const net = avgWin + avgLoss;
            return { p, val: net };
        }).sort((a, b) => b.val - a.val);


    // V1.23 Comprehensive Best Seat (綜合最佳座位)
    // 1. Gather Metrics
    const rawMetrics = seatsOrder.map(s => {
        const d = seatStats[s];

        const totalWins = d.wins;
        // Total Losses logic: seatStats losses are increments, ensure it's correct
        const totalLosses = d.losses;

        // netWins
        const netWins = totalWins - totalLosses;

        // avgNet = (AvgScore + AvgLoss)
        const avgWin = d.winCount > 0 ? d.winSum / d.winCount : 0;
        const avgLoss = d.lossCount > 0 ? d.lossSum / d.lossCount : 0; // avgLoss is negative

        const avgNet = avgWin + avgLoss;

        // avgGain = avgWin (positive)
        // avgLoss raw = avgLoss (negative)

        return {
            s,
            netWins,
            avgNet,
            avgGain: avgWin,
            avgLossRaw: avgLoss
        };
    });

    // 2. Normalize Function (0-10)
    // Rule: if max === min, return 5. Else 10 * (v - min) / (max - min)
    const normalize = (values) => {
        const max = Math.max(...values);
        const min = Math.min(...values);
        if (max === min) return values.map(() => 5);
        return values.map(v => (10 * (v - min) / (max - min)));
    };

    // Extract arrays for normalization
    const arrNetWins = rawMetrics.map(x => x.netWins);
    const arrAvgNet = rawMetrics.map(x => x.avgNet);
    const arrAvgGain = rawMetrics.map(x => x.avgGain);
    const arrNegAvgLoss = rawMetrics.map(x => -x.avgLossRaw); // -avgLoss (positive magnitude)

    const normW = normalize(arrNetWins);
    const normE = normalize(arrAvgNet);
    const normO = normalize(arrAvgGain);
    const normD = normalize(arrNegAvgLoss);

    // 3. Calculate S and combine
    const comprehensiveSeatRanking = rawMetrics.map((item, idx) => {
        const W = normW[idx];
        const E = normE[idx];
        const O = normO[idx];
        // V1.25 Logic: D = 10 - Norm(-avgLoss)
        // normD currently holds Norm(-avgLoss)
        const D = 10 - normD[idx];

        // S = 0.35W + 0.25E + 0.20O + 0.20D
        const S = (0.35 * W) + (0.25 * E) + (0.20 * O) + (0.20 * D);

        return {
            s: item.s,
            val: Math.round(S * 100) / 100, // Round to 2 decimals
            W: Math.round(W * 10) / 10,
            E: Math.round(E * 10) / 10,
            O: Math.round(O * 10) / 10,
            D: Math.round(D * 10) / 10
        };
    }).sort((a, b) => b.val - a.val);

    // V1.27 Medals Helper
    const renderRank = (list, isPos, suffix = "", showSign = true) => {
        return list.map((item, index) => {
            let prefix = "";

            // Medals for Top 3, Numbers for 4-5
            if (index === 0) prefix = "🥇 ";
            else if (index === 1) prefix = "🥈 ";
            else if (index === 2) prefix = "🥉 ";
            else if (index === 3) prefix = "4️⃣ ";
            else if (index === 4) prefix = "5️⃣ ";

            const valueDisplay = item.val !== undefined ? item.val : item.score;
            let valClass = '';

            // Color logic: Prioritize isPos if strictly boolean, otherwise inspect value
            if (isPos === true) valClass = 'num-pos';
            else if (isPos === false) valClass = 'num-neg';
            else {
                if (valueDisplay > 0) valClass = 'num-pos';
                else if (valueDisplay < 0) valClass = 'num-neg';
                else valClass = 'num-zero';
            }

            // Special case for Net Wins (Seat Stats) which has w/l details
            let extraInfo = "";
            if (item.w !== undefined && item.l !== undefined) {
                extraInfo = `<span style="font-size:0.8em; color:#666; margin-left:5px;">(勝${item.w}-輸${item.l})</span>`;
            }

            const sign = (showSign && valueDisplay > 0) ? '+' : '';

            return `
            <div class="stats-item">
                <span>${prefix}${item.p || item.s}${suffix.includes('總勝') ? '總勝' : (suffix.includes('淨勝') ? '淨勝' : (suffix.includes('平均得分') ? '平均得分' : (suffix.includes('平均失分') ? '平均失分' : (suffix.includes('平均淨分') ? '平均淨分' : (suffix.includes('總淨分') ? '總淨分' : '')))))}</span>
                <span>
                    <span class="${valClass}">${sign}${valueDisplay}${suffix.replace(/總勝|淨勝|平均得分|平均失分|平均淨分|總淨分/g, '')}</span>
                    ${extraInfo}
                </span>
            </div>`;
        }).join('');
    };

    additionalContainer.innerHTML = `
        <!-- 1. Historic Win Streak -->
        <div class="streak-card">
            <div class="stats-grid">
                <div>
                    <strong>個人最多連勝次數：</strong>
                    ${renderRank(winStreakRanking, true, " 連勝", false)}
                </div>
            </div>
        </div>

        <!-- 2. Historic Loss Streak (Red, No Sign) -->
        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>個人最多連輸次數：</strong>
                    ${renderRank(lossStreakRanking, false, " 連輸", false)}
                </div>
            </div>
        </div>

        <!-- NEW Leaderboard Win Streak -->
        <div class="streak-card">
            <div class="stats-grid">
                <div>
                    <strong>排行榜最多連勝次數：</strong>
                    ${renderRank(leaderboardWinStreak, true, " 連勝", false)}
                </div>
            </div>
        </div>

        <!-- NEW Leaderboard Loss Streak -->
        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>排行榜最多連輸次數：</strong>
                    ${renderRank(leaderboardLossStreak, false, " 連輸", false)}
                </div>
            </div>
        </div>
        
        <!-- 3. Personal Average Win -->
        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>個人平均得分：</strong>
                    ${renderRank(personalAvgWinRanking, true, "")}
                </div>
            </div>
        </div>

        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>個人平均失分：</strong>
                    ${renderRank(personalAvgLossRanking, false, "")}
                </div>
            </div>
        </div>

        <!-- V1.21 Personal Average Net Score -->
        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>個人平均淨得分：</strong>
                    ${renderRank(personalAvgNetRanking, null, "")}
                </div>
            </div>
        </div>

        <!-- 5. Personal Max Win -->
        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>個人單局最高得分：</strong>
                    ${renderRank(maxWinRanking, true, "")}
                </div>
            </div>
        </div>
        
        <!-- 6. Personal Max Loss -->
        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>個人單局最多失分：</strong>
                    ${renderRank(maxLossRanking, false, "")}
                </div>
            </div>
        </div>

        <!-- 7. Leaderboard Max Win (Medals Added V1.27) -->
        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>排行榜單局最高得分：</strong>
                    ${renderRank(leaderboardMaxWin, true, "")}
                </div>
            </div>
        </div>
        
        <!-- 8. Leaderboard Max Loss -->
        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>排行榜單局最多失分：</strong>
                     ${renderRank(leaderboardMaxLoss, false, "")}
                </div>
            </div>
        </div>

        <!-- V1.26 Wins > 100 -->
        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>贏多過100的次數：</strong>
                    ${renderRank(winOver100Ranking, true, " 次", false)}
                </div>
            </div>
        </div>

        <!-- V1.26 Losses > 100 (Red, No Sign) -->
        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>輸多過100的次數：</strong>
                    ${renderRank(lossOver100Ranking, false, " 次", false)}
                </div>
            </div>
        </div>

        <!-- V1.26 1 Win 3 Lose -->
        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>1家贏 3家輸的次數：</strong>
                    ${renderRank(oneWinThreeKillsRanking, true, " 次", false)}
                </div>
            </div>
        </div>

        <!-- V1.26 1 Lose 3 Win (Red, No Sign) -->
        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>1家輸 3家贏的次數：</strong>
                    ${renderRank(oneLossThreeWinsRanking, false, " 次", false)}
                </div>
            </div>
        </div>
        
        <!-- 9. Seats Total Wins (Sorted) -->
        <div class="streak-card">
            <div class="stats-grid">
                <div>
                    <strong>座位總勝次數：</strong>
                    ${renderRank(seatTotalWinsRanking, true, "總勝 次", false)}
                </div>
            </div>
        </div>

        <!-- 10. Seats Net Wins (Sorted) -->
        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>座位淨勝次數：</strong>
                    ${renderRank(seatNetWinsRanking, null, "淨勝 次", true)}
                </div>
            </div>
        </div>

         <!-- 11. Seat Average Score (Sorted) (Medals Added V1.27) -->
        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>座位平均得分：</strong>
                    ${renderRank(seatAvgScoreRanking, true, "平均得分")}
                </div>
            </div>
        </div>

         <!-- 12. Seat Average Loss (Sorted) (Medals Added V1.27) -->
        <div class="streak-card">
             <div class="stats-grid">
                 <div>
                    <strong>座位平均失分：</strong>
                    ${renderRank(seatAvgLossRanking, false, "平均失分")}
                </div>
            </div>
        </div>

        <!-- 13. Seat Average Net Score (V1.21) -->
        <!-- Seat Avg Net Score -->
        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>座位平均淨得分：</strong>
                     ${renderRank(seatAvgNetRanking, null, "平均淨分")}
                </div>
            </div>
        </div>

        <!-- V1.26 Seat Total Net Score -->
        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>座位總淨得分：</strong>
                     ${renderRank(seatTotalNetRanking, null, "總淨分")}
                </div>
            </div>
        </div>

        <!-- 14. Comprehensive Best Seat (V1.23) -->
        <!-- Comprehensive Seat Ranking -->
        <div class="streak-card">
             <div class="stats-grid">
                <div>
                    <strong>綜合最佳座位 (S-Score)：</strong>
                    ${comprehensiveSeatRanking.map((item, index) => {
        let prefix = "";
        if (index === 0) prefix = "🥇 ";
        else if (index === 1) prefix = "🥈 ";
        else if (index === 2) prefix = "🥉 ";
        else if (index === 3) prefix = "4️⃣ ";

        return `<div class="stats-item" style="flex-direction:column; align-items:flex-start;">
                            <div style="display:flex; justify-content:space-between; width:100%;">
                                <span style="font-weight:bold;">${prefix}${item.s}</span>
                                <span style="font-weight:bold; color:var(--primary-color);">${item.val}</span>
                            </div>
                            <div style="font-size:0.75em; color:#666; width:100%; display:flex; justify-content:space-between;">
                                <span>W:${item.W}</span><span>E:${item.E}</span><span>O:${item.O}</span><span>D:${item.D}</span>
                            </div>
                         </div>`;
    }).join('')}
                </div>
            </div>
        </div>

        <!-- V1.31 Most frequent winning seats -->
        <div class="streak-card">
            <div class="stats-grid">
                <div>
                    <strong>最常出現贏位順序：</strong>
                    ${winningSeatSequences.length > 0 ? winningSeatSequences.map(item => `
                        <div class="stats-item">
                            <span>${item.label}：${item.data.seq}</span>
                            <span class="num-pos">${item.data.count}次</span>
                        </div>
                    `).join('') : '<div class="stats-item num-zero">暫無足夠組合</div>'}
                </div>
            </div>
        </div>

        <!-- V1.31 Most frequent player sequences -->
        <div class="streak-card">
            <div class="stats-grid">
                <div>
                    <strong>最常出現人物順序：</strong>
                    ${sortedPlayerCombinations.length > 0 ? sortedPlayerCombinations.map((item, idx) => {
        let prefix = "";
        if (idx === 0) prefix = "🥇 ";
        else if (idx === 1) prefix = "🥈 ";
        else if (idx === 2) prefix = "🥉 ";
        else if (idx === 3) prefix = "4️⃣ ";
        else if (idx === 4) prefix = "5️⃣ ";
        else if (idx === 5) prefix = "6️⃣ ";
        const percentage = gameCount > 0 ? (item.count / gameCount * 100).toFixed(1) : 0;
        return `<div class="stats-item">
                            <span>${prefix}${item.seq}</span>
                            <span class="num-pos">${item.count}次 (${percentage}%)</span>
                        </div>`;
    }).join('') : '<div class="stats-item num-zero">暫無足夠組合</div>'}
                </div>
            </div>
        </div>
    `;
}

function setupDice() {
    const btn = document.getElementById('roll-dice-btn');
    if (!btn) return;
    const d1 = document.getElementById('dice1');
    const d2 = document.getElementById('dice2');
    const d3 = document.getElementById('dice3');
    const res = document.getElementById('dice-result');
    const faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

    btn.addEventListener('click', () => {
        let rolls = 0;
        btn.disabled = true;
        res.style.display = 'none';

        const randFace = () => faces[Math.floor(Math.random() * 6)];
        const randVal = () => Math.floor(Math.random() * 6) + 1;

        const interval = setInterval(() => {
            d1.innerText = randFace();
            d2.innerText = randFace();
            d3.innerText = randFace();
            rolls++;
            if (rolls > 15) {
                clearInterval(interval);
                const v1 = randVal();
                const v2 = randVal();
                const v3 = randVal();
                d1.innerText = faces[v1 - 1];
                d2.innerText = faces[v2 - 1];
                d3.innerText = faces[v3 - 1];

                const sum = v1 + v2 + v3;
                let area = "";
                if (sum === 18) {
                    area = "自己";
                } else {
                    if (sum % 4 === 1) area = "自己";
                    else if (sum % 4 === 2) area = "下家➡️";
                    else if (sum % 4 === 3) area = "對家⬆️";
                    else if (sum % 4 === 0) area = "上家⬅️";
                }

                let action = "";
                if (sum === 18) {
                    action = "1-2取牌";
                } else if (sum >= 9 && sum <= 17) {
                    action = `淨${18 - sum}`;
                } else {
                    action = `第${sum + 1}棟`;
                }

                document.getElementById('dice-sum-display').innerText = sum;
                document.getElementById('dice-area-display').innerText = area;
                document.getElementById('dice-action-display').innerText = action;
                res.style.display = 'inline-block';
                btn.disabled = false;
            }
        }, 80);
    });
}

// Make init available globally so Firebase module can call it when ready
window.initApp = init;

