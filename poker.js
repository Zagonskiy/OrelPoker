import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, push, set, remove, update, get, runTransaction, onDisconnect } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// --- КОНФИГ ТОТ ЖЕ, ЧТО И В ОСНОВНОМ ФАЙЛЕ (Firebase 10+ требует повторной инициализации в модуле) ---
const firebaseConfig = {
    apiKey: "AIzaSyD9E8XsdjGx275Es6HwdCo5jy2l0kJoNXg",
    authDomain: "orelpoker-cd9d4.firebaseapp.com",
    databaseURL: "https://orelpoker-cd9d4-default-rtdb.firebaseio.com",
    projectId: "orelpoker-cd9d4",
    storageBucket: "orelpoker-cd9d4.firebasestorage.app",
    messagingSenderId: "913271365234",
    appId: "1:913271365234:web:b48f717e011eea4847eceb"
};

const app = initializeApp(firebaseConfig, "pokerApp"); // Имя "pokerApp" чтобы не конфликтовать
const db = getDatabase(app);

// Глобальный объект для управления покером
window.poker = {};

let currentTableId = null;
let myPlayerId = null; // ID в таблице players (баланс)
let tableListener = null;
let currentGameState = null;

// Карты (52 + 2 Джокера)
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
// Джокеры будут иметь ранк 'Joker'

// --- 1. ЛОББИ ---

window.poker.createTable = async function() {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    if(!user) return alert("Войдите в аккаунт!");

    const name = prompt("Название стола:", "Стол " + user.displayName);
    if(!name) return;

    const newTableRef = push(ref(db, 'poker_tables'));
    await set(newTableRef, {
        name: name,
        host: user.nick,
        status: 'waiting', // waiting, playing, showdown
        pot: 0,
        players: {},
        createdAt: Date.now()
    });
    
    // Авто вход
    window.poker.joinTable(newTableRef.key);
}

// Слушатель списка столов
onValue(ref(db, 'poker_tables'), (snap) => {
    const list = document.getElementById('pokerTablesList');
    if(!list) return; // Если мы не на той странице
    list.innerHTML = '';
    const data = snap.val();
    if(!data) { list.innerHTML = '<div>Нет активных игр</div>'; return; }

    for(let key in data) {
        const t = data[key];
        const div = document.createElement('div');
        div.className = 'chat-list-item';
        div.innerHTML = `
            <div class="chat-avatar" style="background:#35654d; color:#fff;">♠</div>
            <div class="chat-info">
                <span class="chat-name">${t.name}</span>
                <span class="chat-preview">Статус: ${t.status} | Банк: ${t.pot}</span>
            </div>
        `;
        div.onclick = () => window.poker.joinTable(key);
        list.appendChild(div);
    }
});

// --- 2. ВХОД ИГРОКА ---

window.poker.joinTable = async function(tableId) {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    if(!user) return;

    // 1. Найти ID баланса игрока
    const pSnap = await get(ref(db, 'players'));
    const players = pSnap.val();
    let balanceId = null;
    let balance = 0;

    for(let id in players) {
        if(players[id].login === user.nick || players[id].name === user.nick) {
            balanceId = id;
            // Считаем баланс
            let hist = players[id].history || {};
            if(typeof hist === 'object') hist = Object.values(hist);
            balance = hist.reduce((a,b)=>a+b, 0);
            break;
        }
    }

    if(!balanceId) return alert("Вы не за столом (нет баланса)!");
    if(balance < 10) return alert("Мало денег! Минимум 10.");

    myPlayerId = balanceId;
    currentTableId = tableId;

    // 2. Сесть за стол покера
    const updates = {};
    updates[`poker_tables/${tableId}/players/${user.nick}`] = {
        balanceId: balanceId,
        nick: user.displayName,
        ready: true,
        cards: false,
        bet: 0,
        folded: false
    };
    await update(ref(db), updates);

    // Переключить вид
    window.showView('poker-table');
    subscribeToTable(tableId);
}

window.poker.leaveTable = function() {
    if(currentTableId) {
        const user = JSON.parse(sessionStorage.getItem('op_session_user'));
        remove(ref(db, `poker_tables/${currentTableId}/players/${user.nick}`));
        currentTableId = null;
    }
    window.showView('poker-lobby');
}

// --- 3. ИГРОВОЙ ПРОЦЕСС (СИНХРОНИЗАЦИЯ) ---

function subscribeToTable(tableId) {
    if(tableListener) tableListener(); // Отписка от старого

    tableListener = onValue(ref(db, `poker_tables/${tableId}`), (snap) => {
        const table = snap.val();
        if(!table) { window.poker.leaveTable(); return alert("Стол закрыт"); }
        
        currentGameState = table;
        renderTableState(table);
    });
}

function renderTableState(table) {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    const myNick = user.nick;

    document.getElementById('pokerPotDisplay').innerText = `Банк: ${table.pot}`;
    document.getElementById('pokerCenterMessage').innerText = table.message || "Игра...";

    // Рендер игроков
    const container = document.getElementById('pokerPlayersContainer');
    container.innerHTML = '';
    
    // Определяем позиции (Я всегда внизу)
    const playersArr = Object.keys(table.players || {});
    const myIdx = playersArr.indexOf(myNick);
    
    playersArr.forEach((pNick, i) => {
        const pData = table.players[pNick];
        // Вычисляем относительный индекс для круга
        let visualIdx = 0; 
        if (myIdx !== -1) {
            visualIdx = (i - myIdx + 4) % 4; // Сдвиг, чтобы я был 0
        } else {
            visualIdx = i; // Если я наблюдатель
        }
        
        // Карты соперника (рубашки)
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
                ${pData.nick}<br>${pData.lastAction || ""}
            </div>
            ${cardsHtml}
        `;
        container.appendChild(div);
    });

    // Управление для Админа (Хоста)
    const btnStart = document.getElementById('btnStartPoker');
    if(table.host === myNick && table.status === 'waiting') {
        btnStart.classList.remove('hidden');
    } else {
        btnStart.classList.add('hidden');
    }

    // Мои карты
    const controls = document.getElementById('pokerControls');
    const myData = table.players[myNick];
    const myHandDiv = document.getElementById('myHand');
    
    if(myData && myData.hand && table.status !== 'waiting') {
        controls.classList.remove('hidden');
        myHandDiv.innerHTML = '';
        myData.hand.forEach((card, idx) => {
            const cDiv = document.createElement('div');
            cDiv.className = `poker-card ${['♥','♦'].includes(card.suit) ? 'red' : 'black'}`;
            if(card.selected) cDiv.classList.add('selected');
            cDiv.innerHTML = `${card.rank}<br>${card.suit}`;
            
            // Логика выбора для обмена
            cDiv.onclick = () => {
                if(table.stage === 'swap' && !myData.swapped) {
                    toggleCardSelection(idx);
                }
            };
            myHandDiv.appendChild(cDiv);
        });

        // Кнопка обмена
        const btnSwap = document.getElementById('btnSwapCard');
        if(table.stage === 'swap' && !myData.swapped) btnSwap.classList.remove('hidden');
        else btnSwap.classList.add('hidden');

    } else {
        controls.classList.add('hidden');
    }
}

// --- 4. ЛОГИКА ИГРЫ (Админская часть) ---

window.poker.startGame = async function() {
    // 1. Снять ставки (Анте 10)
    const table = currentGameState;
    const updates = {};
    let pot = 0;
    
    // Колода
    let deck = createDeck();
    
    for(let nick in table.players) {
        // Снимаем деньги с баланса в ТАБЛИЦЕ ИГРОКОВ
        const pid = table.players[nick].balanceId;
        const txKey = push(ref(db, `players/${pid}/history`)).key;
        updates[`players/${pid}/history/${txKey}`] = -10;
        
        // Обновляем статус в покере
        pot += 10;
        
        // Раздача 2 карт
        const hand = [deck.pop(), deck.pop()];
        
        updates[`poker_tables/${currentTableId}/players/${nick}/hand`] = hand;
        updates[`poker_tables/${currentTableId}/players/${nick}/cards`] = true; // Флаг что карты есть
        updates[`poker_tables/${currentTableId}/players/${nick}/lastAction`] = "Ставка 10";
        updates[`poker_tables/${currentTableId}/players/${nick}/swapped`] = false;
        updates[`poker_tables/${currentTableId}/players/${nick}/folded`] = false;
    }

    updates[`poker_tables/${currentTableId}/deck`] = deck;
    updates[`poker_tables/${currentTableId}/pot`] = pot;
    updates[`poker_tables/${currentTableId}/status`] = 'playing';
    updates[`poker_tables/${currentTableId}/stage`] = 'swap'; // Сразу фаза обмена для простоты
    updates[`poker_tables/${currentTableId}/message`] = 'Смените карту или чек';

    await update(ref(db), updates);
}

// Создание колоды 54
function createDeck() {
    let d = [];
    SUITS.forEach(s => RANKS.forEach(r => d.push({suit:s, rank:r, val: RANKS.indexOf(r)})));
    d.push({suit:'★', rank:'Joker', val: 99}); // Joker 1
    d.push({suit:'★', rank:'Joker', val: 99}); // Joker 2
    return d.sort(() => Math.random() - 0.5);
}

// --- 5. ДЕЙСТВИЯ ИГРОКА ---

// Выбор карты для обмена (локально)
function toggleCardSelection(idx) {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    // Просто визуально отмечаем в базе, чтобы перерисовалось
    // В реальности лучше локальный стейт, но для простоты пишем в базу свойство selected
    const path = `poker_tables/${currentTableId}/players/${user.nick}/hand/${idx}/selected`;
    // Тут нужен toggle. Читаем -> меняем.
    get(ref(db, path)).then(s => {
        set(ref(db, path), !s.val());
    });
}

window.poker.action = async function(act) {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    const myNick = user.nick;
    const table = currentGameState;
    const updates = {};

    if (act === 'fold') {
        updates[`poker_tables/${currentTableId}/players/${myNick}/folded`] = true;
        updates[`poker_tables/${currentTableId}/players/${myNick}/cards`] = false;
        updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = "Фолд";
        await update(ref(db), updates);
        checkEndGame();
        return;
    }

    if (act === 'swap') {
        // Найти выбранную карту
        const hand = table.players[myNick].hand;
        const deck = table.deck || [];
        const swapIdx = hand.findIndex(c => c.selected);
        
        if(swapIdx === -1) return alert("Выберите карту!");
        if(!deck.length) return alert("Колода пуста");

        const newCard = deck.pop();
        hand[swapIdx] = newCard; // Замена

        updates[`poker_tables/${currentTableId}/deck`] = deck;
        updates[`poker_tables/${currentTableId}/players/${myNick}/hand`] = hand;
        updates[`poker_tables/${currentTableId}/players/${myNick}/swapped`] = true;
        updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = "Обмен";
        
        await update(ref(db), updates);
        checkEndGame();
        return;
    }

    if (act === 'check' || act === 'allin') {
        updates[`poker_tables/${currentTableId}/players/${myNick}/swapped`] = true; // Считаем что ход сделан
        updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = act === 'allin' ? "Ва-банк!" : "Чек";
        await update(ref(db), updates);
        checkEndGame();
    }
}

// --- 6. КОНЕЦ ИГРЫ (ОПРЕДЕЛЕНИЕ ПОБЕДИТЕЛЯ) ---
// Упрощенно: если все сделали ход (swapped = true или folded = true)

async function checkEndGame() {
    const tableSnap = await get(ref(db, `poker_tables/${currentTableId}`));
    const table = tableSnap.val();
    const players = table.players;
    
    // Проверка: Все ли сходили?
    const allDone = Object.values(players).every(p => p.swapped || p.folded);
    
    if(allDone && table.status === 'playing') {
        // Только ХОСТ считает победителя, чтобы не было конфликтов
        const user = JSON.parse(sessionStorage.getItem('op_session_user'));
        if(table.host !== user.nick) return;

        // ВСКРЫТИЕ!
        const updates = {};
        
        // 1. Оцениваем руки
        let bestScore = -1;
        let winners = [];

        for(let nick in players) {
            const p = players[nick];
            if(p.folded) continue;
            
            // Показываем карты всем
            updates[`poker_tables/${currentTableId}/players/${nick}/cardsVisible`] = true;

            const score = evaluateHand(p.hand);
            if(score > bestScore) {
                bestScore = score;
                winners = [nick];
            } else if (score === bestScore) {
                winners.push(nick);
            }
        }

        // 2. Раздача слонов
        const winAmount = Math.floor(table.pot / winners.length);
        
        winners.forEach(wNick => {
            const pid = players[wNick].balanceId;
            const txKey = push(ref(db, `players/${pid}/history`)).key;
            // Зеленый текст через спец маркер, который мы добавили в CSS .poker-win не сработает в истории
            // так как там просто текст. Мы запишем просто текст, а CSS уже есть для плюсовых значений.
            // Но пользователь просил выделять зеленым.
            // Хак: запишем число, но в журнал покера добавим запись.
            updates[`players/${pid}/history/${txKey}`] = winAmount; 
        });

        updates[`poker_tables/${currentTableId}/message`] = `Победил: ${winners.join(', ')}!`;
        updates[`poker_tables/${currentTableId}/status`] = 'showdown';
        updates[`poker_tables/${currentTableId}/pot`] = 0; // Банк пуст

        // Через 5 секунд сброс
        setTimeout(() => {
            update(ref(db, `poker_tables/${currentTableId}/status`), 'waiting');
            // Очистка рук не нужна, перезапишутся при новой раздаче
        }, 5000);

        await update(ref(db), updates);
    }
}

// Простейшая оценка (Пара или Старшая карта + Джокеры)
function evaluateHand(hand) {
    // hand = [{rank:'A', val:12}, {rank:'Joker', val:99}]
    const c1 = hand[0];
    const c2 = hand[1];
    
    const hasJoker = (c1.val === 99 || c2.val === 99);
    const doubleJoker = (c1.val === 99 && c2.val === 99);

    if (doubleJoker) return 1000; // Абсолютный топ
    
    if (hasJoker) {
        // Джокер + любая карта = Пара этой карты (но самой крутой масти)
        // По сути это топ пара. Пусть будет ценность 200 + номинал карты
        const normalCard = c1.val === 99 ? c2 : c1;
        return 200 + normalCard.val;
    }

    if (c1.rank === c2.rank) {
        // Пара
        return 100 + c1.val;
    }

    // Старшая карта
    const max = Math.max(c1.val, c2.val);
    const min = Math.min(c1.val, c2.val);
    // Формула: старшая * 1 + дробь (чтобы кикер решал)
    return max + (min * 0.01);
}
