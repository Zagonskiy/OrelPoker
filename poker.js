import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, push, set, remove, update, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyD9E8XsdjGx275Es6HwdCo5jy2l0kJoNXg",
    authDomain: "orelpoker-cd9d4.firebaseapp.com",
    databaseURL: "https://orelpoker-cd9d4-default-rtdb.firebaseio.com",
    projectId: "orelpoker-cd9d4",
    storageBucket: "orelpoker-cd9d4.firebasestorage.app",
    messagingSenderId: "913271365234",
    appId: "1:913271365234:web:b48f717e011eea4847eceb"
};

const existingApps = getApps();
const app = existingApps.find(a => a.name === "pokerApp") || initializeApp(firebaseConfig, "pokerApp");
const db = getDatabase(app);

window.poker = {};

let currentTableId = null;
let tableListener = null;
let currentGameState = null;
let myCachedBalance = 0; // Сохраняем баланс для расчетов ставок

window.poker.getCurrentTableId = () => currentTableId;

// 52 карты
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

// --- 1. ЛОББИ И ВХОД ---

window.poker.createTable = async function() {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    if(!user) return alert("Войдите в аккаунт!");

    const name = prompt("Название стола:", "Стол " + user.displayName);
    if(!name) return;

    const newTableRef = push(ref(db, 'poker_tables'));
    await set(newTableRef, {
        name: name,
        host: user.nick,
        status: 'waiting',
        pot: 0,
        players: {},
        createdAt: Date.now()
    });
    
    window.poker.joinTable(newTableRef.key);
}

onValue(ref(db, 'poker_tables'), (snap) => {
    const list = document.getElementById('pokerTablesList');
    if(!list) return;
    list.innerHTML = '';
    const data = snap.val();
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    
    if(data) {
        for(let key in data) {
            const t = data[key];
            const count = t.players ? Object.keys(t.players).length : 0;
            const div = document.createElement('div');
            
            const isOwner = (user && t.host === user.nick) || (user && user.role === 'admin');
            const deleteBtn = isOwner ? `<button class="btn-delete-table" onclick="event.stopPropagation(); window.poker.deleteTable('${key}')">🗑️</button>` : '';
            
            div.className = 'chat-list-item';
            div.innerHTML = `
                <div class="chat-avatar" style="background:#35654d; color:#fff;">♠</div>
                <div class="chat-info">
                    <span class="chat-name">${t.name}</span>
                    <span class="chat-preview">Игроков: ${count} | Банк: ${t.pot}</span>
                </div>
                ${deleteBtn}
            `;
            div.onclick = () => window.poker.joinTable(key);
            list.appendChild(div);
        }
    } else {
        list.innerHTML = '<div style="opacity:0.6;">Нет активных столов</div>';
    }
});

window.poker.deleteTable = async function(tableId) {
    if(confirm("Удалить этот стол?")) {
        await remove(ref(db, `poker_tables/${tableId}`));
    }
}

window.poker.joinTable = async function(tableId) {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    if(!user) return;

    const pSnap = await get(ref(db, 'players'));
    const playersData = pSnap.val();
    let balanceId = null;
    
    for(let id in playersData) {
        if(playersData[id].login === user.nick || playersData[id].name === user.nick) {
            balanceId = id;
            break;
        }
    }

    if(!balanceId) return alert("Ошибка: Создайте игрока в главной таблице!");

    const tableSnap = await get(ref(db, `poker_tables/${tableId}`));
    const tData = tableSnap.val();
    const isPlaying = tData && tData.status !== 'waiting';

    currentTableId = tableId;

    const updates = {};
    updates[`poker_tables/${tableId}/players/${user.nick}`] = {
        balanceId: balanceId,
        nick: user.displayName,
        cards: false,
        lastAction: isPlaying ? "⏳ Ожидает раздачи" : "В лобби",
        acted: false,
        roundBet: 0,
        invested: 0,
        isSpectator: isPlaying,
        isAllIn: false
    };
    await update(ref(db), updates);

    window.showView('poker-table');
    subscribeToTable(tableId);
}

// Вызов окошка перед выходом
window.poker.leaveTable = function() {
    document.getElementById('exitPokerModal').classList.remove('hidden');
}

// Истинный выход с потерей денег (если в игре)
window.poker.confirmLeave = async function() {
    document.getElementById('exitPokerModal').classList.add('hidden');
    document.getElementById('pokerControls').classList.add('hidden');
    document.getElementById('actionButtonsContainer').classList.add('hidden');
    document.getElementById('myHand').innerHTML = '';
    
    if(currentTableId) {
        const user = JSON.parse(sessionStorage.getItem('op_session_user'));
        const tId = currentTableId;
        currentTableId = null; 

        // СТРОГИЙ ШТРАФ: Если игрок вложил деньги и сбегает
        const tSnap = await get(ref(db, `poker_tables/${tId}`));
        const tblData = tSnap.val();
        
        if (tblData && tblData.status === 'playing' && tblData.players[user.nick]) {
            const invested = tblData.players[user.nick].invested || 0;
            if (invested > 0 && !tblData.players[user.nick].isSpectator) {
                const balId = tblData.players[user.nick].balanceId;
                const txKey = push(ref(db, `players/${balId}/history`)).key;
                // Списываем штраф с меткой покера
                await update(ref(db, `players/${balId}/history/${txKey}`), -invested + "p");
            }
        }

        await remove(ref(db, `poker_tables/${tId}/players/${user.nick}`));

        const snap = await get(ref(db, `poker_tables/${tId}/players`));
        if(!snap.exists()) {
            remove(ref(db, `poker_tables/${tId}`));
        } else if (tblData && tblData.host === user.nick) {
            const remainingNicks = Object.keys(snap.val() || {});
            if(remainingNicks.length > 0) {
                update(ref(db, `poker_tables/${tId}`), { host: remainingNicks[0] });
            }
        }
    }
    
    if(tableListener) tableListener(); 
    window.showView('poker-lobby');
}

// Восстановление UI при возврате на вкладку
window.poker.forceRender = function() {
    if (currentGameState) {
        let globalPlayers = {};
        get(ref(db, 'players')).then(s => {
            renderTableState(currentGameState, s.val() || {});
        });
    }
}

// --- 2. ИГРОВОЙ ПРОЦЕСС ---

function subscribeToTable(tableId) {
    if(tableListener) tableListener();
    let globalPlayers = {};
    get(ref(db, 'players')).then(s => globalPlayers = s.val());

    tableListener = onValue(ref(db, `poker_tables/${tableId}`), async (snap) => {
        const table = snap.val();
        if(!table) { 
            if(currentTableId) { alert("Стол был расформирован."); window.showView('poker-lobby'); currentTableId=null; }
            return; 
        }
        
        currentGameState = table;
        const pSnap = await get(ref(db, 'players'));
        globalPlayers = pSnap.val() || {};
        renderTableState(table, globalPlayers);

        // ХОСТ МОНИТОР (Автопобеда если все вышли)
        const user = JSON.parse(sessionStorage.getItem('op_session_user'));
        if (table.status === 'playing' && table.host === user.nick) {
            if (table.turnOrder) {
                const activePlayers = table.turnOrder.filter(n => table.players[n] && !table.players[n].folded && !table.players[n].isSpectator);
                if (activePlayers.length === 1 && !table.triggerEnd && table.stage !== 'joker_pick') {
                    update(ref(db, `poker_tables/${currentTableId}`), { triggerEnd: true });
                } else if (activePlayers.length > 1 && !table.triggerEnd) {
                    const currentTurnNick = table.turnOrder[table.currentTurnIndex];
                    if (!table.players[currentTurnNick]) {
                        advanceTurn(table, {}); // Пропуск отключившегося
                    }
                }
            }
        }
        
        // ХОСТ МОНИТОР ДЖОКЕРОВ
        if (table.stage === 'joker_pick' && table.host === user.nick) {
            checkJokersReady(table);
        }
    });
}

function renderTableState(table, globalPlayers) {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    const myNick = user.nick;

    document.getElementById('pokerPotDisplay').innerText = `Банк: ${table.pot || 0}`;
    document.getElementById('pokerCenterMessage').innerText = table.message || "";

    const container = document.getElementById('pokerPlayersContainer');
    container.innerHTML = '';
    
    const playersArr = Object.keys(table.players || {});
    const myIdx = playersArr.indexOf(myNick);
    
    playersArr.forEach((pNick, i) => {
        const pData = table.players[pNick];
        
        let balance = 0;
        if(globalPlayers[pData.balanceId]) {
            let hist = globalPlayers[pData.balanceId].history || {};
            if(typeof hist === 'object') hist = Object.values(hist);
            else if (Array.isArray(hist)) hist = hist;
            else hist = [];
            balance = hist.reduce((a,b) => parseFloat(a)+parseFloat(parseFloat(b)||0), 0);
            if (pNick === myNick) myCachedBalance = balance; // Запоминаем свой баланс
        }

        let visualIdx = (myIdx !== -1) ? (i - myIdx + 6) % 6 : i;
        if (visualIdx > 5) visualIdx = 5; 
        
        let cardsHtml = '';
        if(pData.cards) {
            cardsHtml = `
                <div class="pp-cards">
                    <div class="mini-card ${pData.cardsVisible ? '' : 'back'}"></div>
                    <div class="mini-card ${pData.cardsVisible ? '' : 'back'}"></div>
                </div>`;
        }

        const isHisTurn = (table.status === 'playing' && table.turnOrder && table.turnOrder[table.currentTurnIndex] === pNick);

        const div = document.createElement('div');
        div.className = `poker-player pp-${visualIdx}`;
        div.innerHTML = `
            <div class="pp-avatar ${isHisTurn ? 'active-turn' : ''}">
                ${pNick.substr(0,2)}
            </div>
            <div class="pp-info">
                <span style="color:#fff; font-weight:bold;">${pData.nick}</span>
                <span class="pp-balance">${balance} 💰</span>
                <div style="font-size:0.7em; color:#ccc;">${pData.lastAction || ""}</div>
            </div>
            ${cardsHtml}
        `;
        container.appendChild(div);
    });

    const commContainer = document.getElementById('communityCards');
    if (commContainer) {
        commContainer.innerHTML = '';
        if (table.communityCards) {
            table.communityCards.forEach(card => {
                const cDiv = document.createElement('div');
                cDiv.className = `poker-card ${['♥','♦', 'red'].includes(card.suit) || card.suit === '★' && card.color === 'red' ? 'red' : 'black'}`;
                cDiv.innerHTML = `${card.rank}<br>${card.suit}`;
                commContainer.appendChild(cDiv);
            });
        }
    }

    const btnStart = document.getElementById('btnStartPoker');
    const btnContinue = document.getElementById('btnContinuePoker');
    const btnShowCards = document.getElementById('btnShowCards');
    
    btnStart.classList.add('hidden');
    btnContinue.classList.add('hidden');
    btnShowCards.classList.add('hidden');

    if(table.host === myNick) {
        if(table.status === 'waiting') btnStart.classList.remove('hidden');
        if(table.status === 'showdown') btnContinue.classList.remove('hidden');
    }
    if (table.status === 'showdown_folded' && table.players[myNick] && !table.players[myNick].folded && !table.players[myNick].cardsVisible) {
        btnShowCards.classList.remove('hidden');
        if(table.host === myNick) btnContinue.classList.remove('hidden');
    }

    const controls = document.getElementById('pokerControls');
    const actContainer = document.getElementById('actionButtonsContainer');
    const myData = table.players[myNick];
    const myHandDiv = document.getElementById('myHand');
    
    const isMyTurn = (table.status === 'playing' && table.turnOrder && table.turnOrder[table.currentTurnIndex] === myNick);
    
    // ПАНЕЛЬ КАРТ
    if(myData && myData.hand && (table.status === 'playing' || table.status === 'showdown' || table.status === 'showdown_folded' || table.stage === 'joker_pick') && !myData.isSpectator) {
        controls.classList.remove('hidden');
        myHandDiv.innerHTML = '';
        
        myData.hand.forEach((card, idx) => {
            const cDiv = document.createElement('div');
            cDiv.className = `poker-card ${['♥','♦'].includes(card.suit) || card.color === 'red' ? 'red' : 'black'}`;
            if(card.selected) cDiv.classList.add('selected');
            cDiv.innerHTML = `${card.rank}<br>${card.suit}`;
            cDiv.onclick = () => { if(isMyTurn && !myData.swapped && !myData.folded) toggleCardSelection(idx); };
            myHandDiv.appendChild(cDiv);
        });

        if (isMyTurn && !myData.folded && !myData.isAllIn) {
            actContainer.classList.remove('hidden');
            const btnCheck = document.querySelector('.btn-check');
            let currentBet = table.currentBet || 0;
            let myRoundBet = myData.roundBet || 0;
            let callAmount = currentBet - myRoundBet;

            if (btnCheck) {
                if (callAmount > 0) {
                    btnCheck.innerText = `Колл ${callAmount}`;
                    btnCheck.style.background = '#0277bd'; 
                } else {
                    btnCheck.innerText = `Чек`;
                    btnCheck.style.background = '#2e7d32'; 
                }
            }

            const btnSwap = document.getElementById('btnSwapCard');
            if(btnSwap) {
                if(!myData.swapped && table.stage === 'preflop') btnSwap.classList.remove('hidden');
                else btnSwap.classList.add('hidden');
            }
        } else {
            actContainer.classList.add('hidden');
        }
    } else {
        controls.classList.add('hidden');
        actContainer.classList.add('hidden');
    }

    // ТРИГГЕРЫ ХОСТА
    if (table.triggerEnd && table.status === 'playing') {
        if (table.host === myNick) {
            update(ref(db, `poker_tables/${currentTableId}`), { triggerEnd: null }).then(() => {
                checkEndGame();
            });
        }
    }

    // ВЫЗОВ МОДАЛКИ ДЖОКЕРА
    if (table.stage === 'joker_pick' && myData && !myData.folded && !myData.isSpectator) {
        // Проверяем, нужно ли нам выбирать
        let needPick = false;
        let jokerColor = null;
        
        // Джокер на столе?
        const tableJoker = (table.communityCards || []).find(c => c.rank === 'Jr');
        if (tableJoker && !myData.jokerTablePick) {
            needPick = true; jokerColor = tableJoker.color;
        }
        // Джокер в руке?
        const handJoker = (myData.hand || []).find(c => c.rank === 'Jr');
        if (handJoker && !myData.jokerHandPick) {
            needPick = true; jokerColor = handJoker.color;
        }

        if (needPick) {
            showJokerSelection(jokerColor, table);
        } else {
            document.getElementById('jokerModal').classList.add('hidden');
        }
    } else {
        document.getElementById('jokerModal').classList.add('hidden');
    }
}

// --- 3. СОЗДАНИЕ КОЛОДЫ И СТАРТ ---

function createDeck() {
    let d = [];
    SUITS.forEach(s => { RANKS.forEach(r => { d.push({ suit: s, rank: r, val: RANKS.indexOf(r) + 2 }); }); });
    // ДВА Джокера
    d.push({ suit: '★', rank: 'Jr', val: 99, color: 'red' }); 
    d.push({ suit: '★', rank: 'Jr', val: 99, color: 'black' }); 
    
    // Тусование Фишера-Йетса
    for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
}

window.poker.startGame = async function() {
    if(currentGameState && currentGameState.status !== 'waiting' && currentGameState.status !== 'showdown') return;

    const table = currentGameState;
    const playerNicks = Object.keys(table.players || {});
    if(playerNicks.length < 2) return alert("Недостаточно игроков за столом! Нужно минимум 2.");

    const updates = {};
    let pot = 0;
    let deck = createDeck();
    let turnOrder = [];
    
    for(let nick in table.players) {
        if (table.players[nick].isSpectator) {
            updates[`poker_tables/${currentTableId}/players/${nick}/isSpectator`] = false;
        }
        turnOrder.push(nick);
        pot += 10;
        
        const hand = [deck.pop(), deck.pop()];
        updates[`poker_tables/${currentTableId}/players/${nick}/hand`] = hand;
        updates[`poker_tables/${currentTableId}/players/${nick}/cards`] = true;
        updates[`poker_tables/${currentTableId}/players/${nick}/cardsVisible`] = false;
        updates[`poker_tables/${currentTableId}/players/${nick}/lastAction`] = "Анте 10";
        updates[`poker_tables/${currentTableId}/players/${nick}/swapped`] = false; 
        updates[`poker_tables/${currentTableId}/players/${nick}/folded`] = false;
        updates[`poker_tables/${currentTableId}/players/${nick}/acted`] = false;
        updates[`poker_tables/${currentTableId}/players/${nick}/isAllIn`] = false;
        updates[`poker_tables/${currentTableId}/players/${nick}/roundBet`] = 0;
        updates[`poker_tables/${currentTableId}/players/${nick}/invested`] = 10; 
        updates[`poker_tables/${currentTableId}/players/${nick}/jokerTablePick`] = null; 
        updates[`poker_tables/${currentTableId}/players/${nick}/jokerHandPick`] = null; 
    }

    updates[`poker_tables/${currentTableId}/deck`] = deck;
    updates[`poker_tables/${currentTableId}/pot`] = pot;
    updates[`poker_tables/${currentTableId}/status`] = 'playing';
    updates[`poker_tables/${currentTableId}/stage`] = 'preflop'; 
    // ВЫКЛАДЫВАЕМ 2 КАРТЫ СРАЗУ
    updates[`poker_tables/${currentTableId}/communityCards`] = [deck.pop(), deck.pop()]; 
    updates[`poker_tables/${currentTableId}/turnOrder`] = turnOrder;
    updates[`poker_tables/${currentTableId}/currentTurnIndex`] = 0;
    updates[`poker_tables/${currentTableId}/currentBet`] = 0; 
    
    if (turnOrder.length > 0) {
        updates[`poker_tables/${currentTableId}/message`] = `Ход: ${table.players[turnOrder[0]].nick}`;
    }

    await update(ref(db), updates);
}

function toggleCardSelection(idx) {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    const path = `poker_tables/${currentTableId}/players/${user.nick}/hand/${idx}/selected`;
    get(ref(db, path)).then(s => set(ref(db, path), !s.val()));
}

// --- 4. ДВИЖЕНИЕ ИГРЫ И СТАВКИ ---

async function advanceTurn(tableData, updatesObj) {
    let allActed = true;
    
    let playersTemp = JSON.parse(JSON.stringify(tableData.players || {}));
    for (let key in updatesObj) {
        let match = key.match(/players\/(.+)\/acted/);
        if (match) playersTemp[match[1]].acted = updatesObj[key];
        
        let matchFold = key.match(/players\/(.+)\/folded/);
        if (matchFold) playersTemp[matchFold[1]].folded = updatesObj[key];
    }

    tableData.turnOrder.forEach(nick => {
        const p = playersTemp[nick];
        // Если игрок в игре, не упал и НЕ в олл-ине - он должен сходить
        if (p && !p.folded && !p.isAllIn && !p.acted) {
            allActed = false;
        }
    });

    if (!allActed) {
        let nextIdx = (tableData.currentTurnIndex + 1) % tableData.turnOrder.length;
        while(true) {
            const nextNick = tableData.turnOrder[nextIdx];
            const p = playersTemp[nextNick];
            if (p && !p.folded && !p.isAllIn && !p.acted) {
                updatesObj[`poker_tables/${currentTableId}/currentTurnIndex`] = nextIdx;
                updatesObj[`poker_tables/${currentTableId}/message`] = `Ход: ${p.nick}`;
                break;
            }
            nextIdx = (nextIdx + 1) % tableData.turnOrder.length;
        }
        await update(ref(db), updatesObj);
    } else {
        const activePlayers = tableData.turnOrder.filter(n => playersTemp[n] && !playersTemp[n].folded);
        
        if (activePlayers.length <= 1) {
            updatesObj[`poker_tables/${currentTableId}/currentTurnIndex`] = -1;
            updatesObj[`poker_tables/${currentTableId}/triggerEnd`] = true;
            await update(ref(db), updatesObj);
            return;
        }

        let deck = tableData.deck || [];
        let commCards = tableData.communityCards || [];
        let nextStage = tableData.stage;

        if (tableData.stage === 'preflop') {
            nextStage = 'flop'; commCards.push(deck.pop()); // Было 2, стало 3
        } else if (tableData.stage === 'flop') {
            nextStage = 'turn'; commCards.push(deck.pop()); // 4
        } else if (tableData.stage === 'turn') {
            nextStage = 'river'; commCards.push(deck.pop()); // 5
        } else if (tableData.stage === 'river') {
            updatesObj[`poker_tables/${currentTableId}/currentTurnIndex`] = -1;
            updatesObj[`poker_tables/${currentTableId}/triggerEnd`] = true;
            await update(ref(db), updatesObj);
            return;
        }

        updatesObj[`poker_tables/${currentTableId}/stage`] = nextStage;
        updatesObj[`poker_tables/${currentTableId}/communityCards`] = commCards;
        updatesObj[`poker_tables/${currentTableId}/deck`] = deck;
        updatesObj[`poker_tables/${currentTableId}/currentBet`] = 0; 
        
        activePlayers.forEach(nick => {
            updatesObj[`poker_tables/${currentTableId}/players/${nick}/acted`] = false;
            updatesObj[`poker_tables/${currentTableId}/players/${nick}/roundBet`] = 0;
        });
        
        let startIdx = 0;
        while(playersTemp[tableData.turnOrder[startIdx]] && (playersTemp[tableData.turnOrder[startIdx]].folded || playersTemp[tableData.turnOrder[startIdx]].isAllIn)) {
            startIdx++;
            if (startIdx >= tableData.turnOrder.length) break;
        }
        
        if (startIdx < tableData.turnOrder.length) {
            updatesObj[`poker_tables/${currentTableId}/currentTurnIndex`] = startIdx;
            updatesObj[`poker_tables/${currentTableId}/message`] = `Раунд: ${nextStage}. Ход: ${playersTemp[tableData.turnOrder[startIdx]].nick}`;
        } else {
            // Все в олл-ине! Пропускаем до Ривера
             updatesObj[`poker_tables/${currentTableId}/triggerEnd`] = true;
        }
        
        await update(ref(db), updatesObj);
    }
}

window.poker.action = async function(act) {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    const myNick = user.nick;
    const table = currentGameState;
    
    if (!table.turnOrder || table.turnOrder[table.currentTurnIndex] !== myNick) return;

    const updates = {};
    let currentBet = table.currentBet || 0; 
    let myRoundBet = table.players[myNick].roundBet || 0; 
    let callAmount = currentBet - myRoundBet; 

    if (act === 'fold') {
        updates[`poker_tables/${currentTableId}/players/${myNick}/folded`] = true;
        updates[`poker_tables/${currentTableId}/players/${myNick}/cards`] = false;
        updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = "Фолд";
        updates[`poker_tables/${currentTableId}/players/${myNick}/acted`] = true;
        await advanceTurn(table, updates);
        return;
    }

    if (act === 'swap') {
        const hand = table.players[myNick].hand;
        const deck = table.deck || [];
        const swapIdx = hand.findIndex(c => c.selected);
        
        if(swapIdx === -1) return alert("Выберите карту для обмена!");
        
        const newCard = deck.pop();
        hand[swapIdx] = newCard;

        updates[`poker_tables/${currentTableId}/deck`] = deck;
        updates[`poker_tables/${currentTableId}/players/${myNick}/hand`] = hand;
        updates[`poker_tables/${currentTableId}/players/${myNick}/swapped`] = true;
        updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = "Обменял карту";
        
        await update(ref(db), updates);
        return;
    }

    if (act === 'raise') {
        if (myCachedBalance <= callAmount) {
            return alert("Не хватает денег для рейза! Используйте Ва-банк.");
        }

        const amountStr = prompt(`Для колла нужно: ${callAmount}. Ваш баланс: ${myCachedBalance}. Сколько добавить СВЕРХУ (Рейз)?\n(Минимум 10, кратно 10)`);
        if (!amountStr) return;
        const raiseAmount = parseInt(amountStr);
        
        if(isNaN(raiseAmount) || raiseAmount < 10 || raiseAmount % 10 !== 0) {
            return alert("Рейз должен быть числом от 10 и кратным 10!");
        }

        let totalPay = callAmount + raiseAmount; 
        
        if (myCachedBalance < totalPay) {
            return alert("Недостаточно средств для такой ставки!");
        }

        let currentInvested = table.players[myNick].invested || 0;
        updates[`poker_tables/${currentTableId}/players/${myNick}/invested`] = currentInvested + totalPay;
        updates[`poker_tables/${currentTableId}/pot`] = (table.pot || 0) + totalPay;
        updates[`poker_tables/${currentTableId}/currentBet`] = currentBet + raiseAmount;
        updates[`poker_tables/${currentTableId}/players/${myNick}/roundBet`] = myRoundBet + totalPay;
        updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = `Рейз +${raiseAmount}`;
        updates[`poker_tables/${currentTableId}/players/${myNick}/acted`] = true;
        
        // Сброс acted у остальных
        table.turnOrder.forEach(nick => {
            if (nick !== myNick && table.players[nick] && !table.players[nick].folded && !table.players[nick].isAllIn) {
                updates[`poker_tables/${currentTableId}/players/${nick}/acted`] = false;
            }
        });
        
        await advanceTurn(table, updates);
        return;
    }

    if (act === 'allin') {
        let totalPay = myCachedBalance; 
        
        let currentInvested = table.players[myNick].invested || 0;
        updates[`poker_tables/${currentTableId}/players/${myNick}/invested`] = currentInvested + totalPay;
        updates[`poker_tables/${currentTableId}/pot`] = (table.pot || 0) + totalPay;
        
        // Если его ва-банк больше текущей ставки - это рейз!
        if (totalPay > callAmount) {
            let extraRaise = totalPay - callAmount;
            updates[`poker_tables/${currentTableId}/currentBet`] = currentBet + extraRaise;
            
            table.turnOrder.forEach(nick => {
                if (nick !== myNick && table.players[nick] && !table.players[nick].folded && !table.players[nick].isAllIn) {
                    updates[`poker_tables/${currentTableId}/players/${nick}/acted`] = false;
                }
            });
        }

        updates[`poker_tables/${currentTableId}/players/${myNick}/roundBet`] = myRoundBet + totalPay;
        updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = `ВА-БАНК (${totalPay})`;
        updates[`poker_tables/${currentTableId}/players/${myNick}/acted`] = true;
        updates[`poker_tables/${currentTableId}/players/${myNick}/isAllIn`] = true; // Важно!
        
        await advanceTurn(table, updates);
        return;
    }

    if (act === 'check') {
        if (callAmount > 0) {
            if (myCachedBalance < callAmount) {
                return alert("Не хватает денег для колла! Жмите Ва-банк.");
            }
            let currentInvested = table.players[myNick].invested || 0;
            updates[`poker_tables/${currentTableId}/players/${myNick}/invested`] = currentInvested + callAmount;
            updates[`poker_tables/${currentTableId}/pot`] = (table.pot || 0) + callAmount;
            updates[`poker_tables/${currentTableId}/players/${myNick}/roundBet`] = myRoundBet + callAmount;
            updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = `Колл ${callAmount}`;
        } else {
            updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = "Чек";
        }

        updates[`poker_tables/${currentTableId}/players/${myNick}/acted`] = true;
        await advanceTurn(table, updates);
    }
}

// --- 5. ДЖОКЕРЫ И ОКОНЧАНИЕ ИГРЫ ---

async function checkEndGame() {
    const tableSnap = await get(ref(db, `poker_tables/${currentTableId}`));
    const table = tableSnap.val();
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    if(table.host !== user.nick) return;

    const players = table.players || {};
    const activePlayers = table.turnOrder.filter(nick => players[nick] && !players[nick].folded);
    
    // Если остался один
    if(activePlayers.length === 1 && table.status === 'playing') {
        update(ref(db, `poker_tables/${currentTableId}`), { 
            status: 'showdown_folded', 
            message: `Все сбросили. Забрал: ${table.players[activePlayers[0]].nick}`
        });
        return;
    }

    if(table.status === 'playing') {
        // Проверяем, есть ли Джокеры
        let hasJokers = false;
        if (table.communityCards && table.communityCards.some(c => c.rank === 'Jr')) hasJokers = true;
        activePlayers.forEach(nick => {
            if (table.players[nick].hand && table.players[nick].hand.some(c => c.rank === 'Jr')) hasJokers = true;
        });

        if (hasJokers) {
            update(ref(db, `poker_tables/${currentTableId}`), { 
                stage: 'joker_pick',
                message: 'МАГИЯ ДЖОКЕРА: Игроки выбирают карты!'
            });
        } else {
            finishShowdown(table, activePlayers);
        }
    }
}

// Показ окна выбора масти для джокера
function showJokerSelection(color, table) {
    const modal = document.getElementById('jokerModal');
    const grid = document.getElementById('jokerCardsGrid');
    grid.innerHTML = '';
    
    // Собираем все карты, которые уже лежат на столе или у меня в руке (нельзя дублировать)
    let usedCards = new Set();
    if(table.communityCards) table.communityCards.forEach(c => usedCards.add(c.rank+c.suit));
    const myHand = table.players[JSON.parse(sessionStorage.getItem('op_session_user')).nick].hand || [];
    myHand.forEach(c => usedCards.add(c.rank+c.suit));

    const suits = color === 'red' ? ['♥', '♦'] : ['♠', '♣'];
    
    suits.forEach(suit => {
        RANKS.forEach(rank => {
            if (!usedCards.has(rank+suit)) {
                const btn = document.createElement('div');
                btn.className = `joker-pick-card ${color}`;
                btn.innerHTML = `${rank}<br>${suit}`;
                btn.onclick = () => submitJokerPick({suit, rank, val: RANKS.indexOf(rank)+2}, table);
                grid.appendChild(btn);
            }
        });
    });
    modal.classList.remove('hidden');
}

async function submitJokerPick(card, table) {
    document.getElementById('jokerModal').classList.add('hidden');
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    
    const updates = {};
    const tableJoker = (table.communityCards || []).find(c => c.rank === 'Jr');
    if (tableJoker) updates[`poker_tables/${currentTableId}/players/${user.nick}/jokerTablePick`] = card;
    else updates[`poker_tables/${currentTableId}/players/${user.nick}/jokerHandPick`] = card;
    
    await update(ref(db), updates);
}

// Хост проверяет, все ли выбрали Джокеров
function checkJokersReady(table) {
    const activePlayers = table.turnOrder.filter(nick => table.players[nick] && !table.players[nick].folded);
    const tableJoker = (table.communityCards || []).find(c => c.rank === 'Jr');
    
    let allReady = true;
    activePlayers.forEach(nick => {
        const p = table.players[nick];
        if (tableJoker && !p.jokerTablePick) allReady = false;
        if (!tableJoker && p.hand && p.hand.some(c=>c.rank==='Jr') && !p.jokerHandPick) allReady = false;
    });

    if (allReady) finishShowdown(table, activePlayers);
}

async function finishShowdown(table, activePlayers) {
    let bestScore = -1;
    let winners = [];
    const updates = {}; 

    for(let nick of activePlayers) {
        const p = table.players[nick];
        updates[`poker_tables/${currentTableId}/players/${nick}/cardsVisible`] = true;

        // Собираем итоговую руку с учетом джокеров
        let finalHand = [...p.hand];
        let finalComm = [...(table.communityCards || [])];

        if (p.jokerHandPick) {
            const jIdx = finalHand.findIndex(c => c.rank === 'Jr');
            if(jIdx !== -1) finalHand[jIdx] = p.jokerHandPick;
        }
        if (p.jokerTablePick) {
            // Джокер со стола идет 3-й картой в руку!
            finalHand.push(p.jokerTablePick);
            const cIdx = finalComm.findIndex(c => c.rank === 'Jr');
            if(cIdx !== -1) finalComm.splice(cIdx, 1); // Убираем со стола
        }

        const score = evaluateHand(finalHand, finalComm);
        if(score > bestScore) {
            bestScore = score;
            winners = [nick];
        } else if (score === bestScore) {
            winners.push(nick);
        }
    }
    
    const winAmount = Math.floor(table.pot / winners.length);
    for (let nick in table.players) {
        let p = table.players[nick];
        if (p.invested === undefined || p.isSpectator) continue; 
        let net = -p.invested; 
        
        // Лимит выигрыша Ва-банка (упрощенный сайдпот)
        if (winners.includes(nick)) {
            if (p.isAllIn) {
                // Получает только (своя ставка * кол-во игроков), остаток сгорает (казино забирает)
                let maxWin = p.invested * Object.keys(table.players).length;
                net += Math.min(winAmount, maxWin);
            } else {
                net += winAmount; 
            }
        }
        if (net !== 0) {
            const pid = p.balanceId;
            const txKey = push(ref(db, `players/${pid}/history`)).key;
            updates[`players/${pid}/history/${txKey}`] = net + "p"; 
        }
    }

    const winnerNames = winners.map(w => table.players[w].nick).join(', ');
    updates[`poker_tables/${currentTableId}/message`] = `Вскрытие! Победил: ${winnerNames}`;
    updates[`poker_tables/${currentTableId}/status`] = 'showdown';
    
    await update(ref(db), updates);
}

// Кнопка для хоста (запускает новую после просмотра карт)
window.poker.nextRound = async function() {
    const updates = {};
    updates[`poker_tables/${currentTableId}/status`] = 'waiting';
    updates[`poker_tables/${currentTableId}/message`] = 'Ожидание новой раздачи...';
    updates[`poker_tables/${currentTableId}/pot`] = 0;
    updates[`poker_tables/${currentTableId}/communityCards`] = null; 
    
    const tableSnap = await get(ref(db, `poker_tables/${currentTableId}`));
    const table = tableSnap.val();

    for(let nick in table.players) {
        updates[`poker_tables/${currentTableId}/players/${nick}/cards`] = false;
        updates[`poker_tables/${currentTableId}/players/${nick}/hand`] = null;
        updates[`poker_tables/${currentTableId}/players/${nick}/cardsVisible`] = false;
        updates[`poker_tables/${currentTableId}/players/${nick}/lastAction`] = "";
        if (table.players[nick].isSpectator) {
            updates[`poker_tables/${currentTableId}/players/${nick}/isSpectator`] = false;
            updates[`poker_tables/${currentTableId}/players/${nick}/lastAction`] = "Готов играть";
        }
    }
    update(ref(db), updates);
}

// Если все фолд, оставшийся может показать карты
window.poker.showMyCards = function() {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    update(ref(db, `poker_tables/${currentTableId}/players/${user.nick}/cardsVisible`), true);
    document.getElementById('btnShowCards').classList.add('hidden');
}

// Точный калькулятор Холдема (7 карт)
function evaluateHand(hand, communityCards) {
    if(!hand) return 0;
    let allCards = [...hand];
    if (communityCards) allCards = allCards.concat(communityCards);
    
    allCards.sort((a, b) => b.val - a.val);
    
    let counts = {};
    let suits = {};
    allCards.forEach(c => {
        counts[c.val] = (counts[c.val] || 0) + 1;
        suits[c.suit] = (suits[c.suit] || 0) + 1;
    });

    let pairs = [], trips = [], quads = [];
    for (let val in counts) {
        let v = parseInt(val);
        if (counts[val] === 4) quads.push(v);
        else if (counts[val] === 3) trips.push(v);
        else if (counts[val] === 2) pairs.push(v);
    }
    quads.sort((a,b) => b - a);
    trips.sort((a,b) => b - a);
    pairs.sort((a,b) => b - a);

    // Флеш
    let isFlush = false;
    let flushSuit = Object.keys(suits).find(key => suits[key] >= 5);
    let flushHigh = 0;
    if (flushSuit) {
        isFlush = true;
        flushHigh = allCards.find(c => c.suit === flushSuit).val;
    }

    // Стрит
    let isStraight = false;
    let straightHigh = 0;
    let uniqueVals = [...new Set(allCards.map(c => c.val))];
    // Проверка колеса A-2-3-4-5 (Туз = 14, но может быть 1)
    if (uniqueVals.includes(14)) uniqueVals.push(1); 
    uniqueVals.sort((a, b) => b - a);
    
    let consec = 1;
    for (let i = 0; i < uniqueVals.length - 1; i++) {
        if (uniqueVals[i] === uniqueVals[i+1] + 1) {
            consec++;
            if (consec === 5) {
                isStraight = true;
                straightHigh = uniqueVals[i-3];
                break;
            }
        } else {
            consec = 1;
        }
    }

    // Стрит Флеш (базовая проверка)
    if (isStraight && isFlush) return 900000 + straightHigh;

    // Кикеры (5 лучших карт)
    let kickerScore = 0;
    for (let i = 0; i < Math.min(5, allCards.length); i++) {
        kickerScore += allCards[i].val * Math.pow(100, 4 - i);
    }
    kickerScore = kickerScore / 10000000000; 

    if (quads.length > 0) return 800000 + quads[0] + kickerScore;
    if (trips.length > 0 && pairs.length > 0) return 700000 + trips[0] + kickerScore; 
    if (isFlush) return 600000 + flushHigh + kickerScore;
    if (isStraight) return 500000 + straightHigh + kickerScore;
    if (trips.length > 0) return 400000 + trips[0] + kickerScore;
    if (pairs.length > 1) return 300000 + pairs[0] + (pairs[1] * 0.01) + kickerScore;
    if (pairs.length === 1) return 200000 + pairs[0] + kickerScore;
    
    return 100000 + kickerScore; 
}
