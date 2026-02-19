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

// БЕЗОПАСНАЯ ИНИЦИАЛИЗАЦИЯ (Именно этого не хватало в вашем файле)
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

// Функция для главного файла, чтобы понимать, сидим ли мы за столом
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
            
            // Кнопка удаления для админа или владельца
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
    // ЖЕСТКАЯ ОЧИСТКА ИНТЕРФЕЙСА ПРИ ВЫХОДЕ
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
            // Если вышел хост, передаем права первому попавшемуся
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
        
        // Обновляем балансы для отображения
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
        
        // Считаем реальный баланс
        let balance = 0;
        if(globalPlayers[pData.balanceId]) {
            let hist = globalPlayers[pData.balanceId].history || {};
            if(typeof hist === 'object') hist = Object.values(hist);
            else if (Array.isArray(hist)) hist = hist;
            else hist = [];
            balance = hist.reduce((a,b) => parseFloat(a)+parseFloat(b), 0);
        }

        // Позиция за столом (максимум 6 мест: 0-5)
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

        // Подсвечиваем игрока, чей сейчас ход
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

    // ОТРИСОВКА КАРТ НА СТОЛЕ
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
    
    // Проверка: Наш ли сейчас ход?
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

        // Показываем кнопки ТОЛЬКО если наш ход
        if (isMyTurn && !myData.folded) {
            actContainer.classList.remove('hidden');
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
        // Если мы не в игре или статус 'waiting' - прячем всё
        controls.classList.add('hidden');
        actContainer.classList.add('hidden');
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
        
        // Списываем Анте (10)
        const pid = table.players[nick].balanceId;
        const txKey = push(ref(db, `players/${pid}/history`)).key;
        updates[`players/${pid}/history/${txKey}`] = -10;
        pot += 10;
        
        // Раздаем по 2 личные карты
        const hand = [deck.pop(), deck.pop()];
        updates[`poker_tables/${currentTableId}/players/${nick}/hand`] = hand;
        updates[`poker_tables/${currentTableId}/players/${nick}/cards`] = true;
        updates[`poker_tables/${currentTableId}/players/${nick}/cardsVisible`] = false;
        updates[`poker_tables/${currentTableId}/players/${nick}/lastAction`] = "Анте 10";
        updates[`poker_tables/${currentTableId}/players/${nick}/swapped`] = false;
        updates[`poker_tables/${currentTableId}/players/${nick}/folded`] = false;
        updates[`poker_tables/${currentTableId}/players/${nick}/acted`] = false;
    }

    updates[`poker_tables/${currentTableId}/deck`] = deck;
    updates[`poker_tables/${currentTableId}/pot`] = pot;
    updates[`poker_tables/${currentTableId}/status`] = 'playing';
    updates[`poker_tables/${currentTableId}/stage`] = 'preflop'; 
    updates[`poker_tables/${currentTableId}/communityCards`] = []; 
    updates[`poker_tables/${currentTableId}/turnOrder`] = turnOrder;
    updates[`poker_tables/${currentTableId}/currentTurnIndex`] = 0;
    
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

// Продвижение хода по кругу
// Продвижение хода по кругу
async function advanceTurn(tableData, updatesObj) {
    let allActed = true;
    
    // Сначала применяем локальные апдейты к копии данных, чтобы правильно оценить ситуацию
    let playersTemp = JSON.parse(JSON.stringify(tableData.players));
    for (let key in updatesObj) {
        let match = key.match(/players\/(.+)\/acted/);
        if (match) {
            playersTemp[match[1]].acted = updatesObj[key];
        }
    }

    // Проверяем, все ли активные игроки сделали ход
    tableData.turnOrder.forEach(nick => {
        if (!playersTemp[nick].folded && !playersTemp[nick].acted) {
            allActed = false;
        }
    });

    if (!allActed) {
        // Ищем следующего игрока по кругу
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
        // КРУГ ТОРГОВЛИ ЗАВЕРШЕН!
        const activePlayers = tableData.turnOrder.filter(n => !playersTemp[n].folded);
        
        // Если все скинули, кроме одного
        if (activePlayers.length <= 1) {
            updatesObj[`poker_tables/${currentTableId}/currentTurnIndex`] = -1; // Прячем кнопки
            await update(ref(db), updatesObj);
            setTimeout(() => checkEndGame(), 500);
            return;
        }

        let deck = tableData.deck || [];
        let commCards = tableData.communityCards || [];
        let nextStage = tableData.stage;

        // Продвигаем стадию игры
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
            // КОНЕЦ ИГРЫ (Ривер сыгран)
            updatesObj[`poker_tables/${currentTableId}/currentTurnIndex`] = -1; // Прячем кнопки
            await update(ref(db), updatesObj);
            setTimeout(() => checkEndGame(), 500); 
            return;
        }

        updatesObj[`poker_tables/${currentTableId}/stage`] = nextStage;
        updatesObj[`poker_tables/${currentTableId}/communityCards`] = commCards;
        updatesObj[`poker_tables/${currentTableId}/deck`] = deck;
        
        // Сбрасываем флаги 'acted' для нового раунда торговли
        activePlayers.forEach(nick => {
            updatesObj[`poker_tables/${currentTableId}/players/${nick}/acted`] = false;
        });
        
        // Передаем ход первому активному игроку
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
        
        // СМЕНА КАРТЫ НЕ ЗАВЕРШАЕТ ХОД. Игрок должен еще сделать Чек или Рейз
        await update(ref(db), updates);
        return;
    }

    if (act === 'raise') {
        const amountStr = prompt("Сколько добавить в банк?");
        const amount = parseFloat(amountStr);
        if(!amount || amount <= 0) return;

        const pid = table.players[myNick].balanceId;
        const txKey = push(ref(db, `players/${pid}/history`)).key;
        updates[`players/${pid}/history/${txKey}`] = -amount;

        const newPot = (table.pot || 0) + amount;
        updates[`poker_tables/${currentTableId}/pot`] = newPot;
        
        updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = `Рейз +${amount}`;
        updates[`poker_tables/${currentTableId}/players/${myNick}/acted`] = true;
        
        // ВАЖНО: При рейзе сбрасываем acted у остальных, чтобы они ответили на ставку
        table.turnOrder.forEach(nick => {
            if (nick !== myNick && !table.players[nick].folded) {
                updates[`poker_tables/${currentTableId}/players/${nick}/acted`] = false;
            }
        });
        
        await advanceTurn(table, updates);
        return;
    }

    if (act === 'check' || act === 'allin') {
        updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = act === 'allin' ? "ВА-БАНК!" : "Чек/Колл";
        updates[`poker_tables/${currentTableId}/players/${myNick}/acted`] = true;
        
        await advanceTurn(table, updates);
    }
}

// --- 4. КОНЕЦ ИГРЫ И ПОБЕДИТЕЛИ ---

// --- 4. КОНЕЦ ИГРЫ И ПОБЕДИТЕЛИ ---

async function checkEndGame() {
    const tableSnap = await get(ref(db, `poker_tables/${currentTableId}`));
    const table = tableSnap.val();
    const players = table.players;
    
    // ВАЖНО: Только создатель стола (хост) вычисляет победителя,
    // чтобы все устройства не начали одновременно менять банк.
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    if(table.host !== user.nick) return;

    const activePlayers = Object.keys(players).filter(nick => !players[nick].folded);
    
    if(activePlayers.length === 1 && table.status === 'playing') {
        endGameLogic([activePlayers[0]], table, "Все сбросили. Забрал: ");
        return;
    }

    if(table.status === 'playing') {
        let bestScore = -1;
        let winners = [];
        const updates = {}; // Создаем пакет обновлений для БД

        for(let nick of activePlayers) {
            const p = players[nick];
            
            // ИСПРАВЛЕНИЕ: Правильная команда для открытия карт игрока
            updates[`poker_tables/${currentTableId}/players/${nick}/cardsVisible`] = true;

            const score = evaluateHand(p.hand, table.communityCards);
            if(score > bestScore) {
                bestScore = score;
                winners = [nick];
            } else if (score === bestScore) {
                winners.push(nick);
            }
        }
        
        // Отправляем команду на вскрытие карт в базу
        await update(ref(db), updates);
        
        // Запускаем начисление выигрыша
        endGameLogic(winners, table, "Вскрытие! Победил: ");
    }
}

async function endGameLogic(winners, table, msgPrefix) {
    const updates = {};
    const winAmount = Math.floor(table.pot / winners.length);
    
    winners.forEach(wNick => {
        const pid = table.players[wNick].balanceId;
        const txKey = push(ref(db, `players/${pid}/history`)).key;
        updates[`players/${pid}/history/${txKey}`] = winAmount; 
    });

    const winnerNames = winners.map(w => table.players[w].nick).join(', ');
    updates[`poker_tables/${currentTableId}/message`] = `${msgPrefix} ${winnerNames} (+${winAmount})`;
    updates[`poker_tables/${currentTableId}/status`] = 'showdown';
    updates[`poker_tables/${currentTableId}/pot`] = 0;

    await update(ref(db), updates);

    // ПОЛНЫЙ СБРОС СТОЛА ЧЕРЕЗ 6 СЕКУНД ДЛЯ НОВОЙ ИГРЫ
    setTimeout(() => {
        const resetUpdates = {};
        resetUpdates[`poker_tables/${currentTableId}/status`] = 'waiting';
        resetUpdates[`poker_tables/${currentTableId}/message`] = 'Ожидание новой раздачи...';
        resetUpdates[`poker_tables/${currentTableId}/turnOrder`] = null;
        resetUpdates[`poker_tables/${currentTableId}/currentTurnIndex`] = null;
        resetUpdates[`poker_tables/${currentTableId}/communityCards`] = null; 
        resetUpdates[`poker_tables/${currentTableId}/stage`] = null;
        resetUpdates[`poker_tables/${currentTableId}/deck`] = null;
        
        for(let nick in table.players) {
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/cards`] = false;
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/hand`] = null;
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/lastAction`] = "";
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/swapped`] = false;
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/folded`] = false;
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/cardsVisible`] = false;
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/acted`] = false;
        }
        update(ref(db), resetUpdates);
    }, 6000);
}

function evaluateHand(hand, communityCards) {
    if(!hand) return 0;
    
    let allCards = [...hand];
    if (communityCards) {
        allCards = allCards.concat(communityCards);
    }
    
    let counts = {};
    let suits = {};
    allCards.forEach(c => {
        counts[c.val] = (counts[c.val] || 0) + 1;
        suits[c.suit] = (suits[c.suit] || 0) + 1;
    });

    let pairs = 0, trips = 0, quads = 0;
    let highest = 0;
    
    for (let val in counts) {
        let v = parseInt(val);
        if (counts[val] === 4) quads = v;
        else if (counts[val] === 3) trips = Math.max(trips, v);
        else if (counts[val] === 2) pairs++;
        
        if (v > highest && v !== 99) highest = v;
    }

    let isFlush = Object.values(suits).some(count => count >= 5);
    let hasJoker = counts[99] > 0;
    let doubleJoker = counts[99] > 1;

    if (doubleJoker) return 10000;
    if (quads) return 8000 + quads;
    if (trips && pairs > 0) return 7000 + trips;
    if (isFlush) return 6000 + highest;
    if (trips) return 4000 + trips;
    if (pairs > 1) return 3000 + highest;
    if (pairs === 1) return 2000 + highest;
    if (hasJoker) return 2000 + highest; // Джокер дает как минимум высшую пару
    
    return highest; // Старшая карта
}
