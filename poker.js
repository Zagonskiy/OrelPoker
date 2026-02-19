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

// БЕЗОПАСНАЯ ИНИЦИАЛИЗАЦИЯ 
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

window.poker.getCurrentTableId = function() {
    return currentTableId;
}

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

// --- 1. ЛОББИ И ВХОД ---

window.poker.createTable = async function() {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    
    if(!user) {
        return alert("Войдите в аккаунт!");
    }

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

    if(!balanceId) {
        return alert("Ошибка: Создайте игрока в главной таблице!");
    }

    currentTableId = tableId;

    const updates = {};
    updates[`poker_tables/${tableId}/players/${user.nick}`] = {
        balanceId: balanceId,
        nick: user.displayName,
        cards: false,
        lastAction: "В лобби",
        acted: false
    };
    await update(ref(db), updates);

    window.showView('poker-table');
    subscribeToTable(tableId);
}

window.poker.leaveTable = async function() {
    document.getElementById('pokerControls').classList.add('hidden');
    document.getElementById('actionButtonsContainer').classList.add('hidden');
    document.getElementById('myHand').innerHTML = '';
    
    if(currentTableId) {
        const user = JSON.parse(sessionStorage.getItem('op_session_user'));
        const tId = currentTableId;
        currentTableId = null; 

        await remove(ref(db, `poker_tables/${tId}/players/${user.nick}`));

        const snap = await get(ref(db, `poker_tables/${tId}/players`));
        
        if(!snap.exists()) {
            remove(ref(db, `poker_tables/${tId}`));
        } else {
            const tblSnap = await get(ref(db, `poker_tables/${tId}`));
            const tblData = tblSnap.val();
            
            if(tblData && tblData.host === user.nick) {
                const remainingNicks = Object.keys(tblData.players || {});
                if(remainingNicks.length > 0) {
                    update(ref(db, `poker_tables/${tId}`), { host: remainingNicks[0] });
                }
            }
        }
    }
    
    if(tableListener) tableListener(); 
    window.showView('poker-lobby');
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
                window.poker.leaveTable(); 
            }
            return; 
        }
        
        currentGameState = table;
        
        const pSnap = await get(ref(db, 'players'));
        globalPlayers = pSnap.val() || {};
        
        renderTableState(table, globalPlayers);
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
            balance = hist.reduce((a,b) => parseFloat(a)+parseFloat(b), 0);
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
        if (table.communityCards && table.status === 'playing') {
            table.communityCards.forEach(card => {
                const cDiv = document.createElement('div');
                cDiv.className = `poker-card ${['♥','♦'].includes(card.suit) ? 'red' : 'black'}`;
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
    
    const isMyTurn = (table.status === 'playing' && table.turnOrder && table.turnOrder[table.currentTurnIndex] === myNick);
    
    if(myData && myData.hand && table.status === 'playing') {
        controls.classList.remove('hidden');
        myHandDiv.innerHTML = '';
        
        myData.hand.forEach((card, idx) => {
            const cDiv = document.createElement('div');
            cDiv.className = `poker-card ${['♥','♦'].includes(card.suit) ? 'red' : 'black'}`;
            
            if(card.selected) {
                cDiv.classList.add('selected');
            }
            
            cDiv.innerHTML = `${card.rank}<br>${card.suit}`;
            
            cDiv.onclick = () => {
                if(isMyTurn && !myData.swapped && !myData.folded) {
                    toggleCardSelection(idx);
                }
            };
            myHandDiv.appendChild(cDiv);
        });

        if (isMyTurn && !myData.folded) {
            actContainer.classList.remove('hidden');
            
            // Если кто-то сделал рейз, меняем кнопку "Чек" на "Колл (сумма)"
            const btnCheck = document.querySelector('.btn-check');
            let currentBet = table.currentBet || 0;
            let myRoundBet = myData.roundBet || 0;
            let callAmount = currentBet - myRoundBet;

            if (btnCheck) {
                if (callAmount > 0) {
                    btnCheck.innerText = `Колл ${callAmount}`;
                    btnCheck.style.background = '#0277bd'; // Синий для колла
                } else {
                    btnCheck.innerText = `Чек`;
                    btnCheck.style.background = '#2e7d32'; // Зеленый для чека
                }
            }

            const btnSwap = document.getElementById('btnSwapCard');
            if(btnSwap) {
                if(!myData.swapped) {
                    btnSwap.classList.remove('hidden');
                } else {
                    btnSwap.classList.add('hidden');
                }
            }
        } else {
            actContainer.classList.add('hidden');
        }
    } else {
        controls.classList.add('hidden');
        actContainer.classList.add('hidden');
    }

    // ТРИГГЕР КОНЦА ИГРЫ ДЛЯ ХОСТА
    if (table.triggerEnd && table.status === 'playing') {
        if (table.host === myNick) {
            update(ref(db, `poker_tables/${currentTableId}`), { triggerEnd: null }).then(() => {
                checkEndGame();
            });
        }
    }
}

// --- 3. ЛОГИКА ИГРЫ ---

window.poker.startGame = async function() {
    if(currentGameState && currentGameState.status !== 'waiting') return;

    const table = currentGameState;
    const updates = {};
    let pot = 0;
    let deck = createDeck();
    let turnOrder = [];
    
    for(let nick in table.players) {
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
        updates[`poker_tables/${currentTableId}/players/${nick}/roundBet`] = 0;
        
        // НОВОЕ: Запоминаем вложения, но не трогаем баланс напрямую
        updates[`poker_tables/${currentTableId}/players/${nick}/invested`] = 10; 
    }

    updates[`poker_tables/${currentTableId}/deck`] = deck;
    updates[`poker_tables/${currentTableId}/pot`] = pot;
    updates[`poker_tables/${currentTableId}/status`] = 'playing';
    updates[`poker_tables/${currentTableId}/stage`] = 'preflop'; 
    updates[`poker_tables/${currentTableId}/communityCards`] = []; 
    updates[`poker_tables/${currentTableId}/turnOrder`] = turnOrder;
    updates[`poker_tables/${currentTableId}/currentTurnIndex`] = 0;
    updates[`poker_tables/${currentTableId}/currentBet`] = 0; 
    
    if (turnOrder.length > 0) {
        const firstPlayerNick = table.players[turnOrder[0]].nick;
        updates[`poker_tables/${currentTableId}/message`] = `Ход: ${firstPlayerNick}`;
    }

    await update(ref(db), updates);
}

function createDeck() {
    let d = [];
    SUITS.forEach(s => {
        RANKS.forEach(r => {
            d.push({ suit: s, rank: r, val: RANKS.indexOf(r) });
        });
    });
    d.push({ suit: '★', rank: 'J', val: 99 }); 
    d.push({ suit: '★', rank: 'J', val: 99 }); 
    return d.sort(() => Math.random() - 0.5);
}

function toggleCardSelection(idx) {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    const path = `poker_tables/${currentTableId}/players/${user.nick}/hand/${idx}/selected`;
    get(ref(db, path)).then(s => set(ref(db, path), !s.val()));
}

async function advanceTurn(tableData, updatesObj) {
    let allActed = true;
    
    let playersTemp = JSON.parse(JSON.stringify(tableData.players));
    for (let key in updatesObj) {
        let match = key.match(/players\/(.+)\/acted/);
        if (match) {
            playersTemp[match[1]].acted = updatesObj[key];
        }
    }

    tableData.turnOrder.forEach(nick => {
        if (!playersTemp[nick].folded && !playersTemp[nick].acted) {
            allActed = false;
        }
    });

    if (!allActed) {
        let nextIdx = (tableData.currentTurnIndex + 1) % tableData.turnOrder.length;
        while(true) {
            const nextNick = tableData.turnOrder[nextIdx];
            if (!playersTemp[nextNick].folded && !playersTemp[nextNick].acted) {
                updatesObj[`poker_tables/${currentTableId}/currentTurnIndex`] = nextIdx;
                updatesObj[`poker_tables/${currentTableId}/message`] = `Ход: ${playersTemp[nextNick].nick}`;
                break;
            }
            nextIdx = (nextIdx + 1) % tableData.turnOrder.length;
        }
        await update(ref(db), updatesObj);
    } else {
        const activePlayers = tableData.turnOrder.filter(n => !playersTemp[n].folded);
        
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
            nextStage = 'flop';
            commCards.push(deck.pop(), deck.pop(), deck.pop()); 
        } else if (tableData.stage === 'flop') {
            nextStage = 'turn';
            commCards.push(deck.pop()); 
        } else if (tableData.stage === 'turn') {
            nextStage = 'river';
            commCards.push(deck.pop()); 
        } else if (tableData.stage === 'river') {
            updatesObj[`poker_tables/${currentTableId}/currentTurnIndex`] = -1;
            updatesObj[`poker_tables/${currentTableId}/triggerEnd`] = true;
            await update(ref(db), updatesObj);
            return;
        }

        updatesObj[`poker_tables/${currentTableId}/stage`] = nextStage;
        updatesObj[`poker_tables/${currentTableId}/communityCards`] = commCards;
        updatesObj[`poker_tables/${currentTableId}/deck`] = deck;
        updatesObj[`poker_tables/${currentTableId}/currentBet`] = 0; // Сбрасываем ставки для нового раунда
        
        // Сбрасываем флаги для нового раунда
        activePlayers.forEach(nick => {
            updatesObj[`poker_tables/${currentTableId}/players/${nick}/acted`] = false;
            updatesObj[`poker_tables/${currentTableId}/players/${nick}/roundBet`] = 0;
        });
        
        let startIdx = 0;
        while(playersTemp[tableData.turnOrder[startIdx]].folded) {
            startIdx++;
        }
        updatesObj[`poker_tables/${currentTableId}/currentTurnIndex`] = startIdx;
        updatesObj[`poker_tables/${currentTableId}/message`] = `Раунд: ${nextStage}. Ход: ${playersTemp[tableData.turnOrder[startIdx]].nick}`;
        
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
        
        if(swapIdx === -1) {
            return alert("Выберите карту для обмена (нажмите на неё)!");
        }
        
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
        const amountStr = prompt(`Для колла нужно: ${callAmount}. Сколько добавить СВЕРХУ (Ваш Рейз)?`);
        const raiseAmount = parseFloat(amountStr);
        if(isNaN(raiseAmount) || raiseAmount <= 0) return;

        let totalPay = callAmount + raiseAmount; 

        // НОВОЕ: Запоминаем вложения, деньги со стола не снимаем
        let currentInvested = table.players[myNick].invested || 0;
        updates[`poker_tables/${currentTableId}/players/${myNick}/invested`] = currentInvested + totalPay;

        updates[`poker_tables/${currentTableId}/pot`] = (table.pot || 0) + totalPay;
        updates[`poker_tables/${currentTableId}/currentBet`] = currentBet + raiseAmount;
        updates[`poker_tables/${currentTableId}/players/${myNick}/roundBet`] = myRoundBet + totalPay;
        
        updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = `Рейз +${raiseAmount}`;
        updates[`poker_tables/${currentTableId}/players/${myNick}/acted`] = true;
        
        table.turnOrder.forEach(nick => {
            if (nick !== myNick && !table.players[nick].folded) {
                updates[`poker_tables/${currentTableId}/players/${nick}/acted`] = false;
            }
        });
        
        await advanceTurn(table, updates);
        return;
    }

    if (act === 'check' || act === 'allin') {
        if (callAmount > 0) {
            // НОВОЕ: Запоминаем вложения, деньги со стола не снимаем
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
// --- 4. КОНЕЦ ИГРЫ И ПОБЕДИТЕЛИ ---

async function checkEndGame() {
    const tableSnap = await get(ref(db, `poker_tables/${currentTableId}`));
    const table = tableSnap.val();
    
    // ВАЖНО: Только хост раздает деньги!
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    if(table.host !== user.nick) return;

    const players = table.players;
    const activePlayers = Object.keys(players).filter(nick => !players[nick].folded);
    
    if(activePlayers.length === 1 && table.status === 'playing') {
        endGameLogic([activePlayers[0]], table, "Все сбросили. Забрал: ");
        return;
    }

    if(table.status === 'playing') {
        let bestScore = -1;
        let winners = [];
        const updates = {}; 

        for(let nick of activePlayers) {
            const p = players[nick];
            
            updates[`poker_tables/${currentTableId}/players/${nick}/cardsVisible`] = true;

            const score = evaluateHand(p.hand, table.communityCards);
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
}

async function endGameLogic(winners, table, msgPrefix) {
    const updates = {};
    const winAmount = Math.floor(table.pot / winners.length);
    
    // НОВОЕ: Считаем кто сколько проиграл и заработал (1 запись в историю на человека)
    for (let nick in table.players) {
        let p = table.players[nick];
        if (p.invested === undefined) continue; 

        let net = -p.invested; // Ушел в минус на то, что поставил
        if (winners.includes(nick)) {
            net += winAmount; // Победители плюсуют выигрыш
        }

        if (net !== 0) {
            const pid = p.balanceId;
            const txKey = push(ref(db, `players/${pid}/history`)).key;
            // Добавляем букву 'p' для зеленого цвета в таблице
            updates[`players/${pid}/history/${txKey}`] = net + "p"; 
        }
    }

    const winnerNames = winners.map(w => table.players[w].nick).join(', ');
    updates[`poker_tables/${currentTableId}/message`] = `${msgPrefix} ${winnerNames} (+${winAmount})`;
    updates[`poker_tables/${currentTableId}/status`] = 'showdown';
    updates[`poker_tables/${currentTableId}/pot`] = 0;

    await update(ref(db), updates);

    setTimeout(() => {
        const resetUpdates = {};
        resetUpdates[`poker_tables/${currentTableId}/status`] = 'waiting';
        resetUpdates[`poker_tables/${currentTableId}/message`] = 'Ожидание новой раздачи...';
        resetUpdates[`poker_tables/${currentTableId}/turnOrder`] = null;
        resetUpdates[`poker_tables/${currentTableId}/currentTurnIndex`] = null;
        resetUpdates[`poker_tables/${currentTableId}/communityCards`] = null; 
        resetUpdates[`poker_tables/${currentTableId}/stage`] = null;
        resetUpdates[`poker_tables/${currentTableId}/deck`] = null;
        resetUpdates[`poker_tables/${currentTableId}/currentBet`] = null;
        
        for(let nick in table.players) {
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/cards`] = false;
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/hand`] = null;
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/lastAction`] = "";
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/swapped`] = false;
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/folded`] = false;
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/cardsVisible`] = false;
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/acted`] = false;
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/roundBet`] = 0;
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/invested`] = null;
        }
        update(ref(db), resetUpdates);
    }, 6000);
}

// Продвинутая система оценки (с учетом кикеров для защиты от ложных ничьих)
function evaluateHand(hand, communityCards) {
    if(!hand) return 0;
    
    let allCards = [...hand];
    if (communityCards) {
        allCards = allCards.concat(communityCards);
    }
    
    // Сортируем карты от старшей к младшей
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

    let isFlush = Object.values(suits).some(count => count >= 5);
    let hasJoker = counts[99] > 0;
    let doubleJoker = counts[99] > 1;

    // Генерируем очки для кикеров, чтобы не было ничьей при одинаковой старшей карте
    let kickerScore = 0;
    for (let i = 0; i < Math.min(5, allCards.length); i++) {
        kickerScore += allCards[i].val * Math.pow(100, 4 - i);
    }
    kickerScore = kickerScore / 10000000000; 

    if (doubleJoker) return 10000 + kickerScore;
    if (quads.length > 0) return 8000 + quads[0] + kickerScore;
    if (trips.length > 0 && pairs.length > 0) return 7000 + trips[0] + kickerScore; 
    if (isFlush) return 6000 + kickerScore;
    if (trips.length > 0) return 4000 + trips[0] + kickerScore;
    if (pairs.length > 1) return 3000 + pairs[0] + (pairs[1] * 0.01) + kickerScore;
    if (pairs.length === 1) return 2000 + pairs[0] + kickerScore;
    if (hasJoker) return 2000 + allCards.find(c => c.val !== 99).val + kickerScore; 
    
    return 1000 + kickerScore; 
}
