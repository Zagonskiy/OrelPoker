import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
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

const app = initializeApp(firebaseConfig, "pokerApp");
const db = getDatabase(app);

window.poker = {};

let currentTableId = null;
let tableListener = null;
let currentGameState = null;

// Карты
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

// Рендер списка столов
onValue(ref(db, 'poker_tables'), (snap) => {
    const list = document.getElementById('pokerTablesList');
    if(!list) return;
    list.innerHTML = '';
    const data = snap.val();
    
    // Кнопка удаления старых столов (чистка мусора)
    if(data) {
        for(let key in data) {
            const t = data[key];
            const count = t.players ? Object.keys(t.players).length : 0;
            const div = document.createElement('div');
            div.className = 'chat-list-item';
            div.innerHTML = `
                <div class="chat-avatar" style="background:#35654d; color:#fff;">♠</div>
                <div class="chat-info">
                    <span class="chat-name">${t.name}</span>
                    <span class="chat-preview">Игроков: ${count} | Банк: ${t.pot}</span>
                </div>
            `;
            div.onclick = () => window.poker.joinTable(key);
            list.appendChild(div);
        }
    } else {
        list.innerHTML = '<div style="opacity:0.6;">Нет активных столов</div>';
    }
});

// Вход
window.poker.joinTable = async function(tableId) {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    if(!user) return;

    // Ищем ID баланса
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

    currentTableId = tableId;

    const updates = {};
    updates[`poker_tables/${tableId}/players/${user.nick}`] = {
        balanceId: balanceId,
        nick: user.displayName,
        cards: false,
        lastAction: "Подключился"
    };
    await update(ref(db), updates);

    window.showView('poker-table');
    subscribeToTable(tableId);
}

// ВЫХОД (Исправлено)
window.poker.leaveTable = async function() {
    document.getElementById('pokerControls').classList.add('hidden'); // Прячем карты
    
    if(currentTableId) {
        const user = JSON.parse(sessionStorage.getItem('op_session_user'));
        const tId = currentTableId;
        currentTableId = null; // Сбрасываем ID сразу

        // Удаляем себя из стола
        await remove(ref(db, `poker_tables/${tId}/players/${user.nick}`));

        // Проверяем, остался ли кто-то
        const snap = await get(ref(db, `poker_tables/${tId}/players`));
        if(!snap.exists()) {
            // Если никого нет - удаляем стол, чтобы не мусорить
            remove(ref(db, `poker_tables/${tId}`));
        }
    }
    
    if(tableListener) tableListener(); // Отписка
    window.showView('poker-lobby');
}

// --- 2. ИГРОВОЙ ПРОЦЕСС ---

function subscribeToTable(tableId) {
    if(tableListener) tableListener();
    
    // Также подписываемся на балансы игроков, чтобы видеть актуальные деньги
    let globalPlayers = {};
    get(ref(db, 'players')).then(s => globalPlayers = s.val());

    tableListener = onValue(ref(db, `poker_tables/${tableId}`), async (snap) => {
        const table = snap.val();
        if(!table) { 
            if(currentTableId) { alert("Стол был расформирован."); window.poker.leaveTable(); }
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

    document.getElementById('pokerPotDisplay').innerText = `Банк: ${table.pot}`;
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

        // Позиция за столом
        let visualIdx = (myIdx !== -1) ? (i - myIdx + 4) % 4 : i;
        
        // Карты (рубашки)
        let cardsHtml = '';
        if(pData.cards) {
            cardsHtml = `<div class="pp-cards">
                <div class="mini-card ${pData.cardsVisible ? '' : 'back'}"></div>
                <div class="mini-card ${pData.cardsVisible ? '' : 'back'}"></div>
            </div>`;
        }

        const div = document.createElement('div');
        div.className = `poker-player pp-${visualIdx}`;
        div.innerHTML = `
            <div class="pp-avatar ${table.turn === pNick ? 'active-turn' : ''}">
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

    // КНОПКА "НАЧАТЬ" (Только для хоста и только когда ожидание)
    const btnStart = document.getElementById('btnStartPoker');
    if(table.host === myNick && table.status === 'waiting') {
        btnStart.classList.remove('hidden');
    } else {
        btnStart.classList.add('hidden');
    }

    // МОИ КАРТЫ
    const controls = document.getElementById('pokerControls');
    const myData = table.players[myNick];
    const myHandDiv = document.getElementById('myHand');
    
    // Показываем меню только если мы в игре
    if(myData && myData.hand && table.status === 'playing') {
        controls.classList.remove('hidden');
        myHandDiv.innerHTML = '';
        myData.hand.forEach((card, idx) => {
            const cDiv = document.createElement('div');
            cDiv.className = `poker-card ${['♥','♦'].includes(card.suit) ? 'red' : 'black'}`;
            if(card.selected) cDiv.classList.add('selected');
            cDiv.innerHTML = `${card.rank}<br>${card.suit}`;
            
            cDiv.onclick = () => {
                if(!myData.swapped && !myData.folded) toggleCardSelection(idx);
            };
            myHandDiv.appendChild(cDiv);
        });

        // Кнопки
        const btnSwap = document.getElementById('btnSwapCard');
        if(!myData.swapped && !myData.folded) btnSwap.classList.remove('hidden');
        else btnSwap.classList.add('hidden');

    } else {
        controls.classList.add('hidden');
    }
}

// --- 3. ЛОГИКА ИГРЫ ---

window.poker.startGame = async function() {
    const table = currentGameState;
    const updates = {};
    let pot = 0;
    let deck = createDeck();
    
    // Обнуляем состояние для новой игры
    for(let nick in table.players) {
        // Списываем Анте (10)
        const pid = table.players[nick].balanceId;
        const txKey = push(ref(db, `players/${pid}/history`)).key;
        updates[`players/${pid}/history/${txKey}`] = -10;
        pot += 10;
        
        // Раздаем карты
        const hand = [deck.pop(), deck.pop()];
        updates[`poker_tables/${currentTableId}/players/${nick}/hand`] = hand;
        updates[`poker_tables/${currentTableId}/players/${nick}/cards`] = true;
        updates[`poker_tables/${currentTableId}/players/${nick}/cardsVisible`] = false;
        updates[`poker_tables/${currentTableId}/players/${nick}/lastAction`] = "Анте 10";
        updates[`poker_tables/${currentTableId}/players/${nick}/swapped`] = false;
        updates[`poker_tables/${currentTableId}/players/${nick}/folded`] = false;
    }

    updates[`poker_tables/${currentTableId}/deck`] = deck;
    updates[`poker_tables/${currentTableId}/pot`] = pot;
    updates[`poker_tables/${currentTableId}/status`] = 'playing';
    updates[`poker_tables/${currentTableId}/message`] = 'Делайте ставки или меняйте карты';

    await update(ref(db), updates);
}

function createDeck() {
    let d = [];
    SUITS.forEach(s => RANKS.forEach(r => d.push({suit:s, rank:r, val: RANKS.indexOf(r)})));
    d.push({suit:'★', rank:'J', val: 99}); 
    d.push({suit:'★', rank:'J', val: 99}); 
    return d.sort(() => Math.random() - 0.5);
}

// Выбор карты
function toggleCardSelection(idx) {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    const path = `poker_tables/${currentTableId}/players/${user.nick}/hand/${idx}/selected`;
    get(ref(db, path)).then(s => set(ref(db, path), !s.val()));
}

// ДЕЙСТВИЯ
window.poker.action = async function(act) {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    const myNick = user.nick;
    const table = currentGameState;
    const updates = {};

    // 1. ФОЛД
    if (act === 'fold') {
        updates[`poker_tables/${currentTableId}/players/${myNick}/folded`] = true;
        updates[`poker_tables/${currentTableId}/players/${myNick}/cards`] = false; // Скрыть карты
        updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = "Фолд";
        await update(ref(db), updates);
        checkEndGame();
        return;
    }

    // 2. ОБМЕН
    if (act === 'swap') {
        const hand = table.players[myNick].hand;
        const deck = table.deck || [];
        const swapIdx = hand.findIndex(c => c.selected);
        
        if(swapIdx === -1) return alert("Выберите карту!");
        
        const newCard = deck.pop();
        hand[swapIdx] = newCard; // Меняем

        updates[`poker_tables/${currentTableId}/deck`] = deck;
        updates[`poker_tables/${currentTableId}/players/${myNick}/hand`] = hand;
        updates[`poker_tables/${currentTableId}/players/${myNick}/swapped`] = true; // Ход сделан
        updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = "Обмен 1";
        
        await update(ref(db), updates);
        checkEndGame();
        return;
    }

    // 3. РЕЙЗ (Повышение)
    if (act === 'raise') {
        const amountStr = prompt("Сколько добавить в банк?");
        const amount = parseFloat(amountStr);
        if(!amount || amount <= 0) return;

        // Снимаем деньги
        const pid = table.players[myNick].balanceId;
        const txKey = push(ref(db, `players/${pid}/history`)).key;
        updates[`players/${pid}/history/${txKey}`] = -amount;

        // Добавляем в банк
        const newPot = (table.pot || 0) + amount;
        updates[`poker_tables/${currentTableId}/pot`] = newPot;
        
        updates[`poker_tables/${currentTableId}/players/${myNick}/swapped`] = true;
        updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = `Рейз +${amount}`;
        
        await update(ref(db), updates);
        checkEndGame();
        return;
    }

    // 4. ЧЕК / ВА-БАНК
    if (act === 'check' || act === 'allin') {
        updates[`poker_tables/${currentTableId}/players/${myNick}/swapped`] = true;
        updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = act === 'allin' ? "ВА-БАНК!" : "Чек";
        await update(ref(db), updates);
        checkEndGame();
    }
}

// --- 4. КОНЕЦ ИГРЫ ---

async function checkEndGame() {
    const tableSnap = await get(ref(db, `poker_tables/${currentTableId}`));
    const table = tableSnap.val();
    const players = table.players;
    
    // Игра закончена, если все либо сбросили, либо сделали ход (swapped)
    const activePlayers = Object.values(players).filter(p => !p.folded);
    const allDone = activePlayers.every(p => p.swapped);
    
    // Если остался только один не сбросивший - он победил сразу
    if(activePlayers.length === 1 && table.status === 'playing') {
        endGameLogic([activePlayers[0].nick], table, "Все сбросили. Победа: ");
        return;
    }

    if(allDone && table.status === 'playing') {
        // Только хост считает
        const user = JSON.parse(sessionStorage.getItem('op_session_user'));
        if(table.host !== user.nick) return;

        let bestScore = -1;
        let winners = [];

        for(let nick in players) {
            const p = players[nick];
            if(p.folded) continue;
            
            // Вскрываем карты
            update(ref(db, `poker_tables/${currentTableId}/players/${nick}/cardsVisible`), true);

            const score = evaluateHand(p.hand);
            if(score > bestScore) {
                bestScore = score;
                winners = [nick];
            } else if (score === bestScore) {
                winners.push(nick);
            }
        }
        endGameLogic(winners, table, "Победил: ");
    }
}

async function endGameLogic(winners, table, msgPrefix) {
    const updates = {};
    const winAmount = Math.floor(table.pot / winners.length);
    
    winners.forEach(wNick => {
        const pid = table.players[wNick].balanceId;
        const txKey = push(ref(db, `players/${pid}/history`)).key;
        updates[`players/${pid}/history/${txKey}`] = winAmount; // Начисление выигрыша
    });

    updates[`poker_tables/${currentTableId}/message`] = `${msgPrefix} ${winners.join(', ')}! (+${winAmount})`;
    updates[`poker_tables/${currentTableId}/status`] = 'showdown';
    updates[`poker_tables/${currentTableId}/pot`] = 0;

    await update(ref(db), updates);

    // Сброс в лобби через 6 сек, чтобы начать заново
    setTimeout(() => {
        const resetUpdates = {};
        resetUpdates[`poker_tables/${currentTableId}/status`] = 'waiting';
        resetUpdates[`poker_tables/${currentTableId}/message`] = 'Новая раздача...';
        // Убираем карты у игроков
        for(let nick in table.players) {
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/cards`] = false;
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/hand`] = null;
            resetUpdates[`poker_tables/${currentTableId}/players/${nick}/lastAction`] = "";
        }
        update(ref(db), resetUpdates);
    }, 6000);
}

function evaluateHand(hand) {
    const c1 = hand[0];
    const c2 = hand[1];
    const hasJoker = (c1.val === 99 || c2.val === 99);
    const doubleJoker = (c1.val === 99 && c2.val === 99);

    if (doubleJoker) return 1000;
    if (hasJoker) {
        const normalCard = c1.val === 99 ? c2 : c1;
        return 200 + normalCard.val;
    }
    if (c1.rank === c2.rank) {
        return 100 + c1.val;
    }
    const max = Math.max(c1.val, c2.val);
    const min = Math.min(c1.val, c2.val);
    return max + (min * 0.01);
}
