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
let app;
if (!existingApps.some(a => a.name === "pokerApp")) {
    app = initializeApp(firebaseConfig, "pokerApp");
} else {
    app = existingApps.find(a => a.name === "pokerApp");
}
const db = getDatabase(app);

window.poker = {};

let currentTableId = null;
let tableListener = null;
let currentGameState = null;
let myCachedBalance = 0;

window.poker.getCurrentTableId = () => currentTableId;

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

// ИСПРАВЛЕННЫЙ ВЫХОД: Сначала пас и завершение хода, потом удаление из базы
window.poker.leaveTable = async function() {
    if(!confirm("Вы точно хотите выйти? Если вы в игре, ваши вложенные деньги сгорят!")) return;
    
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    const tId = currentTableId;
    if (!tId) return;

    const tSnap = await get(ref(db, `poker_tables/${tId}`));
    const tblData = tSnap.val();

    // Авто-фолд и штраф, если игрок ушел посреди раздачи
    if (tblData && tblData.status === 'playing' && tblData.players && tblData.players[user.nick]) {
        const pData = tblData.players[user.nick];
        
        if (pData.invested > 0 && !pData.isSpectator) {
            const balId = pData.balanceId;
            const txKey = push(ref(db, `players/${balId}/history`)).key;
            await set(ref(db, `players/${balId}/history/${txKey}`), -pData.invested + "p");
        }
        
        // Если сейчас был его ход, двигаем игру дальше, чтобы она не зависла
        if (tblData.turnOrder && tblData.turnOrder[tblData.currentTurnIndex] === user.nick && !pData.folded) {
            const updates = {};
            updates[`poker_tables/${tId}/players/${user.nick}/folded`] = true;
            updates[`poker_tables/${tId}/players/${user.nick}/acted`] = true;
            await advanceTurn(tblData, updates);
        }
    }

    // Отписываемся ДО удаления, чтобы не рисовать фантомный стол
    if (tableListener) {
        tableListener();
        tableListener = null;
    }
    currentTableId = null; 

    // Скрываем элементы сразу
    document.getElementById('pokerControls').classList.add('hidden');
    document.getElementById('actionButtonsContainer').classList.add('hidden');
    document.getElementById('myHand').innerHTML = '';

    await remove(ref(db, `poker_tables/${tId}/players/${user.nick}`));

    const snap = await get(ref(db, `poker_tables/${tId}/players`));
    if(!snap.exists()) {
        await remove(ref(db, `poker_tables/${tId}`));
    } else if (tblData && tblData.host === user.nick) {
        const remainingNicks = Object.keys(snap.val() || {});
        if(remainingNicks.length > 0) {
            await update(ref(db, `poker_tables/${tId}`), { host: remainingNicks[0] });
        }
    }
    
    window.showView('poker-lobby');
}

window.poker.forceRender = function() {
    if (currentGameState) {
        renderTableState(currentGameState, {}); 
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
            if(currentTableId) { 
                alert("Стол был расформирован."); 
                document.getElementById('pokerControls').classList.add('hidden');
                document.getElementById('actionButtonsContainer').classList.add('hidden');
                currentTableId = null;
                window.showView('poker-lobby'); 
            }
            return; 
        }
        
        currentGameState = table;
        const pSnap = await get(ref(db, 'players'));
        globalPlayers = pSnap.val() || {};
        renderTableState(table, globalPlayers);

        const user = JSON.parse(sessionStorage.getItem('op_session_user'));
        
        // ХОСТ-МОНИТОР: Защита от вылетов других игроков
        if (table.status === 'playing' && table.host === user.nick) {
            if (table.turnOrder) {
                const activePlayers = table.turnOrder.filter(n => table.players[n] && !table.players[n].folded && !table.players[n].isSpectator);
                if (activePlayers.length === 1 && !table.triggerEnd && table.stage !== 'joker_pick') {
                    update(ref(db, `poker_tables/${currentTableId}`), { triggerEnd: true });
                } else if (activePlayers.length > 1 && !table.triggerEnd) {
                    const currentTurnNick = table.turnOrder[table.currentTurnIndex];
                    if (!table.players[currentTurnNick]) {
                        advanceTurn(table, {}); 
                    }
                }
            }
        }
        
        // ХОСТ-МОНИТОР ДЖОКЕРА
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
            if (pNick === myNick) myCachedBalance = balance; 
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
    if(table.host === myNick && table.status === 'waiting') {
        btnStart.classList.remove('hidden');
    } else {
        btnStart.classList.add('hidden');
    }

    const controls = document.getElementById('pokerControls');
    const actContainer = document.getElementById('actionButtonsContainer');
    const myData = table.players[myNick];
    const myHandDiv = document.getElementById('myHand');
    
    const btnFold = document.querySelector('.btn-fold');
    const btnCheck = document.querySelector('.btn-check');
    const btnRaise = document.querySelector('.btn-raise');
    const btnAllin = document.querySelector('.btn-allin');
    const btnSwap = document.getElementById('btnSwapCard');
    const btnShowCards = document.getElementById('btnShowCards');
    const btnContinue = document.getElementById('btnContinuePoker');

    // Прячем всё перед новой проверкой
    [btnFold, btnCheck, btnRaise, btnAllin, btnSwap, btnShowCards, btnContinue].forEach(b => {
        if(b) b.classList.add('hidden');
    });

    const isMyTurn = (table.status === 'playing' && table.turnOrder && table.turnOrder[table.currentTurnIndex] === myNick);
    
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

        if (table.status === 'playing') {
            if (isMyTurn && !myData.folded && !myData.isAllIn) {
                actContainer.classList.remove('hidden');
                btnFold.classList.remove('hidden');
                btnCheck.classList.remove('hidden');
                btnRaise.classList.remove('hidden');
                btnAllin.classList.remove('hidden');
                
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

                if(btnSwap) {
                    if(!myData.swapped && table.stage === 'preflop') btnSwap.classList.remove('hidden');
                }
            } else {
                actContainer.classList.add('hidden');
            }
        } else if (table.status === 'showdown' || table.status === 'showdown_folded') {
            let hasVisibleBtns = false;
            
            if (table.status === 'showdown_folded' && !myData.folded && !myData.cardsVisible) {
                btnShowCards.classList.remove('hidden');
                hasVisibleBtns = true;
            }
            if (table.host === myNick) {
                btnContinue.classList.remove('hidden');
                hasVisibleBtns = true;
            }
            
            if (hasVisibleBtns) actContainer.classList.remove('hidden');
            else actContainer.classList.add('hidden');
        }
    } else {
        controls.classList.add('hidden');
        actContainer.classList.add('hidden');
    }

    // ТРИГГЕР КОНЦА ИГРЫ
    if (table.triggerEnd && table.status === 'playing') {
        if (table.host === myNick) {
            update(ref(db, `poker_tables/${currentTableId}`), { triggerEnd: null }).then(() => {
                checkEndGame();
            });
        }
    }

    // ИСПРАВЛЕННЫЙ ВЫЗОВ МОДАЛКИ ДЖОКЕРА
    if (table.stage === 'joker_pick' && myData && !myData.folded && !myData.isSpectator) {
        let pickTarget = null;
        let jokerColor = null;
        
        const tableJoker = (table.communityCards || []).find(c => c.rank === 'Jr');
        if (tableJoker && !myData.jokerTablePick) { 
            pickTarget = 'jokerTablePick'; 
            jokerColor = tableJoker.color; 
        } else {
            const handJoker = (myData.hand || []).find(c => c.rank === 'Jr');
            if (handJoker && !myData.jokerHandPick) { 
                pickTarget = 'jokerHandPick'; 
                jokerColor = handJoker.color; 
            }
        }

        if (pickTarget) {
            const modal = document.getElementById('jokerModal');
            if (modal.classList.contains('hidden')) {
                showJokerSelection(jokerColor, pickTarget, table);
            }
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
    d.push({ suit: '★', rank: 'Jr', val: 99, color: 'red' }); 
    d.push({ suit: '★', rank: 'Jr', val: 99, color: 'black' }); 
    
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
    updates[`poker_tables/${currentTableId}/communityCards`] = [deck.pop(), deck.pop()]; 
    updates[`poker_tables/${currentTableId}/turnOrder`] = turnOrder;
    updates[`poker_tables/${currentTableId}/currentTurnIndex`] = 0;
    updates[`poker_tables/${currentTableId}/currentBet`] = 0; 
    updates[`poker_tables/${currentTableId}/triggerEnd`] = null;
    updates[`poker_tables/${currentTableId}/finishing`] = null;
    
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
        if (match && playersTemp[match[1]]) playersTemp[match[1]].acted = updatesObj[key];
        
        let matchFold = key.match(/players\/(.+)\/folded/);
        if (matchFold && playersTemp[matchFold[1]]) playersTemp[matchFold[1]].folded = updatesObj[key];
    }

    tableData.turnOrder.forEach(nick => {
        const p = playersTemp[nick];
        if (p && !p.folded && !p.isAllIn && !p.acted) {
            allActed = false;
        }
    });

    if (!allActed) {
        let nextIdx = (tableData.currentTurnIndex + 1) % tableData.turnOrder.length;
        let attempts = 0;
        
        while(attempts < tableData.turnOrder.length) {
            const nextNick = tableData.turnOrder[nextIdx];
            const p = playersTemp[nextNick];
            if (p && !p.folded && !p.isAllIn && !p.acted) {
                updatesObj[`poker_tables/${currentTableId}/currentTurnIndex`] = nextIdx;
                updatesObj[`poker_tables/${currentTableId}/message`] = `Ход: ${p.nick}`;
                break;
            }
            nextIdx = (nextIdx + 1) % tableData.turnOrder.length;
            attempts++;
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
            nextStage = 'flop'; commCards.push(deck.pop()); 
        } else if (tableData.stage === 'flop') {
            nextStage = 'turn'; commCards.push(deck.pop()); 
        } else if (tableData.stage === 'turn') {
            nextStage = 'river'; commCards.push(deck.pop()); 
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
        while(startIdx < tableData.turnOrder.length) {
            let p = playersTemp[tableData.turnOrder[startIdx]];
            if (!p || p.folded || p.isAllIn) {
                startIdx++;
            } else {
                break;
            }
        }
        
        if (startIdx < tableData.turnOrder.length) {
            updatesObj[`poker_tables/${currentTableId}/currentTurnIndex`] = startIdx;
            updatesObj[`poker_tables/${currentTableId}/message`] = `Раунд: ${nextStage}. Ход: ${playersTemp[tableData.turnOrder[startIdx]].nick}`;
        } else {
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
        updates[`poker_tables/${currentTableId}/players/${myNick}/isAllIn`] = true; 
        
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
    
    if(activePlayers.length === 1 && table.status === 'playing') {
        update(ref(db, `poker_tables/${currentTableId}`), { 
            status: 'showdown_folded', 
            message: `Все сбросили. Победил: ${table.players[activePlayers[0]].nick}`,
            triggerEnd: null
        });
        
        endGameLogic([activePlayers[0]], table, "Все сбросили. Победил: ");
        return;
    }

    if(table.status === 'playing') {
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

// ИСПРАВЛЕНА функция выбора: теперь мы передаем pickTarget (кому принадлежит джокер)
function showJokerSelection(color, pickTarget, table) {
    const modal = document.getElementById('jokerModal');
    if (!modal.classList.contains('hidden')) return;

    const grid = document.getElementById('jokerCardsGrid');
    grid.innerHTML = '';
    
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
                btn.onclick = () => submitJokerPick({suit, rank, val: RANKS.indexOf(rank)+2}, pickTarget, table);
                grid.appendChild(btn);
            }
        });
    });
    modal.classList.remove('hidden');
}

// ИСПРАВЛЕНО: обновляем конкретный target в БД
async function submitJokerPick(card, pickTarget, table) {
    document.getElementById('jokerModal').classList.add('hidden');
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    
    const updates = {};
    updates[`poker_tables/${currentTableId}/players/${user.nick}/${pickTarget}`] = card;
    
    await update(ref(db), updates);
}

function checkJokersReady(table) {
    const activePlayers = table.turnOrder.filter(nick => table.players[nick] && !table.players[nick].folded);
    const tableJoker = (table.communityCards || []).find(c => c.rank === 'Jr');
    
    let allReady = true;
    activePlayers.forEach(nick => {
        const p = table.players[nick];
        if (tableJoker && !p.jokerTablePick) allReady = false;
        if (p.hand && p.hand.some(c=>c.rank==='Jr') && !p.jokerHandPick) allReady = false;
    });

    if (allReady && table.status === 'playing' && !table.finishing) {
        update(ref(db, `poker_tables/${currentTableId}`), { finishing: true }).then(() => {
            finishShowdown(table, activePlayers);
        });
    }
}

async function finishShowdown(table, activePlayers) {
    let bestScore = -1;
    let winners = [];
    const updates = {}; 

    for(let nick of activePlayers) {
        const p = table.players[nick];
        updates[`poker_tables/${currentTableId}/players/${nick}/cardsVisible`] = true;

        let finalHand = [...p.hand];
        let finalComm = [...(table.communityCards || [])];

        if (p.jokerHandPick) {
            const jIdx = finalHand.findIndex(c => c.rank === 'Jr');
            if(jIdx !== -1) finalHand[jIdx] = p.jokerHandPick;
        }
        if (p.jokerTablePick) {
            finalHand.push(p.jokerTablePick);
            const cIdx = finalComm.findIndex(c => c.rank === 'Jr');
            if(cIdx !== -1) finalComm.splice(cIdx, 1); 
        }

        const score = evaluateHand(finalHand, finalComm);
        if(score > bestScore) {
            bestScore = score;
            winners = [nick];
        } else if (score === bestScore) {
            winners.push(nick);
        }
    }
    
    await update(ref(db), updates);
    endGameLogic(winners, table, "Вскрытие! Победил: ");
}

async function endGameLogic(winners, table, msgPrefix) {
    const updates = {};
    const winAmount = Math.floor(table.pot / winners.length);
    
    for (let nick in table.players) {
        let p = table.players[nick];
        if (p.invested === undefined || p.isSpectator) continue; 
        let net = -p.invested; 
        
        if (winners.includes(nick)) {
            if (p.isAllIn) {
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
    updates[`poker_tables/${currentTableId}/message`] = `${msgPrefix} ${winnerNames} (+${winAmount})`;
    
    if (table.status !== 'showdown_folded') {
        updates[`poker_tables/${currentTableId}/status`] = 'showdown';
    }
    updates[`poker_tables/${currentTableId}/pot`] = 0;

    await update(ref(db), updates);
}

window.poker.nextRound = async function() {
    const updates = {};
    updates[`poker_tables/${currentTableId}/status`] = 'waiting';
    updates[`poker_tables/${currentTableId}/message`] = 'Ожидание новой раздачи...';
    updates[`poker_tables/${currentTableId}/pot`] = 0;
    updates[`poker_tables/${currentTableId}/communityCards`] = null; 
    updates[`poker_tables/${currentTableId}/triggerEnd`] = null;
    updates[`poker_tables/${currentTableId}/finishing`] = null;
    
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

window.poker.showMyCards = function() {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    update(ref(db, `poker_tables/${currentTableId}/players/${user.nick}/cardsVisible`), true);
}

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

    let isFlush = false;
    let flushSuit = Object.keys(suits).find(key => suits[key] >= 5);
    let flushHigh = 0;
    if (flushSuit) {
        isFlush = true;
        flushHigh = allCards.find(c => c.suit === flushSuit)?.val || 0;
    }

    let isStraight = false;
    let straightHigh = 0;
    let uniqueVals = [...new Set(allCards.map(c => c.val))];
    if (uniqueVals.includes(14)) uniqueVals.push(1); 
    uniqueVals.sort((a, b) => b - a);
    
    let consec = 1;
    for (let i = 0; i < uniqueVals.length - 1; i++) {
        if (uniqueVals[i] === uniqueVals[i+1] + 1) {
            consec++;
            if (consec >= 5) {
                isStraight = true;
                straightHigh = uniqueVals[i - 3];
                break;
            }
        } else {
            consec = 1;
        }
    }

    if (isStraight && isFlush) return 900000 + straightHigh;

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
