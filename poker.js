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

    const name = await window.customPrompt("Название стола:", "Стол " + user.displayName, "Создание стола");
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


// Калькулятор фишек: ровное горизонтальное наслоение
function getChipsHTML(amount) {
    if (!amount || amount <= 0) return '';
    let towers = [];
    const denoms = [
        {val: 10000, color: 'gold'}, {val: 5000, color: 'silver'},
        {val: 1000, color: 'black'}, {val: 500, color: 'hotpink'},
        {val: 200, color: 'deepskyblue'}, {val: 100, color: 'mediumblue'},
        {val: 50, color: 'purple'}, {val: 20, color: 'green'},
        {val: 10, color: 'gray'}
    ];
    let remaining = amount;
    
    for(let d of denoms) {
        let count = Math.floor(remaining / d.val);
        if (count > 0) {
            let towerChips = [];
            for(let i=0; i<count; i++) {
                // Наслаиваем фишки одного номинала горизонтально (-12px)
                let ml = i === 0 ? '0' : '-12px'; 
                towerChips.push(`<div class="poker-chip" style="background-color: ${d.color}; margin-left: ${ml}; z-index: ${i};"></div>`);
            }
            towers.push(`<div style="display: flex; align-items: center;">${towerChips.join('')}</div>`);
        }
        remaining %= d.val;
    }
    return `<div class="chip-stack" style="display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 8px; margin-top: 5px;">${towers.join('')}</div>`;
}

// Новая анимация: понимает, летим мы на стол (ставка) или в центр (банк)
function flyChipsAnimation(amount, startEl, endEl, isToPot) {
    if (!startEl || !endEl || amount <= 0) return;
    const startRect = startEl.getBoundingClientRect();
    const endRect = endEl.getBoundingClientRect();
    
    const temp = document.createElement('div');
    temp.style.position = 'fixed';
    temp.style.zIndex = '9999';
    temp.style.transition = 'all 0.5s cubic-bezier(0.25, 0.8, 0.25, 1)';
    temp.style.pointerEvents = 'none';
    temp.innerHTML = getChipsHTML(amount);
    
    // Старт анимации: от центра аватарки игрока
    temp.style.left = startRect.left + (startRect.width / 2) - 10 + 'px';
    temp.style.top = startRect.top + (startRect.height / 2) - 10 + 'px';
    
    document.body.appendChild(temp);
    
    setTimeout(() => {
        if (isToPot) {
            // Летим с места ставки в самый центр стола
            temp.style.left = (endRect.left + endRect.width/2 - 20) + 'px';
            temp.style.top = (endRect.top + endRect.height/2 - 20) + 'px';
            temp.style.transform = 'scale(0.5)';
        } else {
            // Летим из инвентаря на стол перед игроком (выдвигаем ставку)
            temp.style.left = endRect.left + 'px';
            temp.style.top = (endRect.top - 45) + 'px'; 
            temp.style.transform = 'scale(0.8)';
        }
        temp.style.opacity = '0';
    }, 50);
    
    setTimeout(() => temp.remove(), 600);
}

window.poker.deleteTable = async function(tableId) {
    if(await window.customConfirm("Удалить этот стол навсегда?", "Удаление")) {
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

window.poker.leaveTable = async function(skipConfirm = false, destView = 'poker-lobby') {
    if(!skipConfirm && !(await window.customConfirm("Вы точно хотите выйти? Ваши вложенные деньги сгорят!", "Выход из игры"))) return;
    
    document.getElementById('pokerControls').classList.add('hidden');
    document.getElementById('actionButtonsContainer').classList.add('hidden');
    document.getElementById('myHand').innerHTML = '';
    
    if(currentTableId) {
        const user = JSON.parse(sessionStorage.getItem('op_session_user'));
        const tId = currentTableId;
        
        const tSnap = await get(ref(db, `poker_tables/${tId}`));
        const tblData = tSnap.val();
        
        if (tblData && tblData.status === 'playing' && tblData.players && tblData.players[user.nick]) {
            const pData = tblData.players[user.nick];
            
            if (!pData.folded && !pData.isSpectator) {
                const updates = {};
                updates[`poker_tables/${tId}/players/${user.nick}/folded`] = true;
                updates[`poker_tables/${tId}/players/${user.nick}/acted`] = true;
                updates[`poker_tables/${tId}/players/${user.nick}/isSpectator`] = true;
                
                await update(ref(db), updates);
                
                const freshSnap = await get(ref(db, `poker_tables/${tId}`));
                await advanceTurn(freshSnap.val(), {});
            }
        }

        currentTableId = null; 

        await remove(ref(db, `poker_tables/${tId}/players/${user.nick}`));

        if (tblData && tblData.turnOrder) {
            const newOrder = tblData.turnOrder.filter(n => n !== user.nick);
            await update(ref(db, `poker_tables/${tId}`), { turnOrder: newOrder });
        }

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
    window.showView(destView, true);
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
                window.customAlert("Стол был расформирован.");
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
        
        if (table.stage === 'joker_pick' && table.host === user.nick) {
            checkJokersReady(table);
        }
    });
}

function renderTableState(table, globalPlayers) {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    const myNick = user.nick;

    if (table.status === 'waiting') {
        window.animatedCardsState = [];
        window.riverAnimatedState = false;
        window.deckShuffledState = false;
        window.lastInvestedState = {};
        window.scatteredAngles = null;
    }

    document.getElementById('pokerCenterMessage').innerText = table.message || "";

    const container = document.getElementById('pokerPlayersContainer');
    const potEl = document.getElementById('communityCards'); 
    
    const playersArr = Object.keys(table.players || {});
    const myIdx = playersArr.indexOf(myNick);
    
    // --- ЛОГИКА ПОЛЕТА ФИШЕК ---
    if (!window.lastInvestedState) window.lastInvestedState = {};

    playersArr.forEach((pNick) => {
        const currentInv = table.players[pNick].invested || 0;
        const lastInv = window.lastInvestedState[pNick] || 0;
        
        const safeId = `pp-node-${pNick.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const playerEl = document.getElementById(safeId);
        const potEl = document.getElementById('communityCards');
        
        // 1. Игрок делает ставку: фишки едут перед ним на стол
        if (currentInv > lastInv && playerEl) {
            flyChipsAnimation(currentInv - lastInv, playerEl, playerEl, false); 
        }
        
        // 2. Раунд окончен (ставка обнулилась): фишки едут со стола в банк
        if (currentInv === 0 && lastInv > 0 && playerEl && potEl) {
            flyChipsAnimation(lastInv, playerEl, potEl, true); 
        }
        
        window.lastInvestedState[pNick] = currentInv;
    });

    container.innerHTML = '';
    
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
            let c1 = "", c2 = "", color1 = "", color2 = "", isBack1 = "back", isBack2 = "back";
            
            const canShow = pData.cardsVisible === true;

            if (canShow && pData.hand) {
                const handArr = Array.isArray(pData.hand) ? pData.hand : Object.values(pData.hand);
                if (handArr.length >= 2) {
                    const card1 = handArr[0];
                    const card2 = handArr[1];
                    if (card1) {
                        c1 = `${card1.rank}<br>${card1.suit}`;
                        color1 = (['♥','♦'].includes(card1.suit) || card1.color === 'red') ? 'red' : 'black';
                        isBack1 = color1;
                    }
                    if (card2) {
                        c2 = `${card2.rank}<br>${card2.suit}`;
                        color2 = (['♥','♦'].includes(card2.suit) || card2.color === 'red') ? 'red' : 'black';
                        isBack2 = color2;
                    }
                }
            }
            
            if (!canShow) {
                isBack1 = 'back'; isBack2 = 'back';
                c1 = ''; c2 = '';
            }

            cardsHtml = `
                <div class="pp-cards">
                    <div class="mini-card ${isBack1}">${c1}</div>
                    <div class="mini-card ${isBack2}">${c2}</div>
                </div>`;
        }

        const isHisTurn = (table.status === 'playing' && table.turnOrder && table.turnOrder[table.currentTurnIndex] === pNick);
        const isHostAndNotMe = (table.host === myNick && pNick !== myNick);
        const safeNick = pData.nick ? pData.nick.replace(/'/g, "\\'").replace(/"/g, '&quot;') : pNick;
        const kickAction = isHostAndNotMe ? `onclick="window.poker.promptKick('${pNick}', '${safeNick}')" style="cursor:pointer; box-shadow: inset 0 0 10px rgba(255,0,0,0.5);" title="Нажмите, чтобы выгнать"` : '';

        const div = document.createElement('div');
        div.className = `poker-player pp-${visualIdx} ${pData.cards ? 'has-cards' : ''}`;
        div.id = `pp-node-${pNick.replace(/[^a-zA-Z0-9]/g, '_')}`; 
        div.innerHTML = `
            <div class="pp-avatar ${isHisTurn ? 'active-turn' : ''}" ${kickAction}>
                ${pNick.substr(0,2)}
            </div>
            <div class="pp-info">
                <span style="color:#fff; font-weight:bold;">${pData.nick}</span>
                <span class="pp-balance">${balance} 💰</span>
                <div style="font-size:0.7em; color:#ccc;">${pData.lastAction || ""}</div>
            </div>
            ${cardsHtml}
            <div class="player-inventory">${getChipsHTML(balance - (pData.invested || 0))}</div>
            <div class="player-bet" style="margin-top: 15px;">${getChipsHTML(pData.invested || 0)}</div>
        `; 
        container.appendChild(div);
    });

    const commContainer = document.getElementById('communityCards');
    if (commContainer) {
        commContainer.innerHTML = '';
        
        let deckClass = "deck-visual";
        if (table.status === 'playing' && table.stage === 'preflop' && !window.deckShuffledState) {
            deckClass += " anim-shuffle";
            window.deckShuffledState = true;
        }

        commContainer.innerHTML += `
            <div class="deck-area">
                <div class="discard-visual"></div>
                <div class="${deckClass}"></div>
            </div>
        `;

        const commCards = table.communityCards || [];
        
        // Создаем память для карт, чтобы они не анимировались повторно
        if (!window.animatedCardsState) window.animatedCardsState = [];

        for(let i=0; i<5; i++) {
            const cDiv = document.createElement('div');
            
            // 1. СОХРАНЯЕМ ХАОС ПРИ ПЕРЕРИСОВКЕ
            // Если стол уже был разбросан, возвращаем картам их случайные углы
            if (window.scatteredAngles && window.scatteredAngles[i]) {
                if (i === 4) {
                    cDiv.style.transform = `rotateZ(${window.scatteredAngles[i].rot}deg)`;
                } else {
                    cDiv.style.transform = `translate(${window.scatteredAngles[i].x}px, ${window.scatteredAngles[i].y}px) rotateZ(${window.scatteredAngles[i].rot}deg)`;
                }
            }

            if (i < commCards.length) {
                const card = commCards[i];
                cDiv.className = `poker-card ${['♥','♦', 'red'].includes(card.suit) || card.suit === '★' && card.color === 'red' ? 'red' : 'black'}`;
                cDiv.innerHTML = `${card.rank}<br>${card.suit}`;
                
                // Эпичный Ривер (5-я карта)
                if (i === 4 && !window.riverAnimatedState) {
                    
                    // 2. ГЕНЕРИРУЕМ ХАОС
                    // Создаем случайные углы и сдвиги для ВСЕХ 5 карт
                    window.scatteredAngles = [];
                    for(let j=0; j<5; j++) {
                        if (j === 4) {
                            // 5-я карта просто падает под кривым углом (от -30 до 30 градусов)
                            window.scatteredAngles.push({ rot: Math.floor(Math.random() * 60 - 30) }); 
                        } else {
                            // Остальные карты сильно разлетаются в стороны при ударе
                            window.scatteredAngles.push({
                                x: Math.floor(Math.random() * 20 - 10), // Сдвиг по X
                                y: Math.floor(Math.random() * 20 - 10), // Сдвиг по Y
                                rot: Math.floor(Math.random() * 90 - 45) // Разброс от -45 до 45 градусов
                            });
                        }
                    }
                    
                    // Передаем угол в CSS анимацию для 5-й карты
                    cDiv.style.setProperty('--end-rot', `${window.scatteredAngles[4].rot}deg`);
                    cDiv.classList.add('anim-epic-river');
                    window.riverAnimatedState = true; 
                    window.animatedCardsState[i] = true; 
                    
                    setTimeout(() => {
                        const felt = document.querySelector('.poker-table-felt');
                        if(felt) {
                            felt.classList.add('table-shake');
                            setTimeout(() => felt.classList.remove('table-shake'), 400); 
                            
                            // 3. УДАРНАЯ ВОЛНА
                            // В момент тряски (на 800мс) раскидываем первые 4 карты
                            const tableCards = document.querySelectorAll('.community-cards .poker-card');
                            tableCards.forEach((cardEl, idx) => {
                                if (idx < 4 && window.scatteredAngles && window.scatteredAngles[idx]) {
                                    cardEl.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                                    cardEl.style.transform = `translate(${window.scatteredAngles[idx].x}px, ${window.scatteredAngles[idx].y}px) rotateZ(${window.scatteredAngles[idx].rot}deg)`;
                                }
                            });
                        }
                    }, 800); // Таймер твоего удара
                } 
                // Остальные карты (1, 2, 3, 4): открываются только ОДИН раз
                else if (i !== 4 && !window.animatedCardsState[i]) {
                    cDiv.classList.add('anim-deal'); 
                    window.animatedCardsState[i] = true; 
                }
            } else {
                cDiv.className = `poker-card back`;
                cDiv.innerHTML = '';
            }
            commContainer.appendChild(cDiv);
        }
    }

    // --- ОТОБРАЖЕНИЕ ЦЕНТРАЛЬНОГО БАНКА ---
    document.getElementById('pokerPotDisplay').innerHTML = `Банк: ${table.pot || 0} <br> ${getChipsHTML(table.pot || 0)}`;

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
            if (isMyTurn && !myData.folded) {
                actContainer.classList.remove('hidden');
                
                if (myData.isAllIn) {
                    btnFold.classList.remove('hidden');
                    btnRaise.classList.add('hidden');
                    btnAllin.classList.add('hidden');
                    
                    btnCheck.classList.remove('hidden');
                    btnCheck.innerText = `Чек (Ва-банк)`;
                    btnCheck.style.background = '#2e7d32';

                    if (btnSwap) {
                        const commCards = table.communityCards || [];
                        if(!myData.swapped && commCards.length < 5) {
                            btnSwap.classList.remove('hidden');
                        } else {
                            btnSwap.classList.add('hidden');
                        }
                    }
                } else {
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

                    if (btnSwap) {
                        const commCards = table.communityCards || [];
                        if(!myData.swapped && commCards.length < 5) {
                            btnSwap.classList.remove('hidden');
                        } else {
                            btnSwap.classList.add('hidden');
                        }
                    }
                }
            } else {
                actContainer.classList.add('hidden');
            }
        } else if (table.status === 'showdown' || table.status === 'showdown_folded') {
            let hasVisibleBtns = false;
            
            if (!myData.cardsVisible && !myData.folded) {
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

    if (table.triggerEnd && table.status === 'playing') {
        if (table.host === myNick) {
            update(ref(db, `poker_tables/${currentTableId}`), { triggerEnd: null }).then(() => {
                checkEndGame();
            });
        }
    }

    if (table.stage === 'joker_pick' && myData && !myData.folded && !myData.isSpectator) {
        let jokersToPick = [];
        (table.communityCards || []).forEach(c => { if(c.rank === 'Jr') jokersToPick.push(c.color); });
        (myData.hand || []).forEach(c => { if(c.rank === 'Jr') jokersToPick.push(c.color); });
        
        let colorToPick = null;
        if (jokersToPick.includes('red') && !myData.jokerPickRed) colorToPick = 'red';
        else if (jokersToPick.includes('black') && !myData.jokerPickBlack) colorToPick = 'black';

        if (colorToPick) {
            const modal = document.getElementById('jokerModal');
            if (modal.classList.contains('hidden') || modal.dataset.currentColor !== colorToPick) {
                showJokerSelection(colorToPick, table);
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
    window.animatedCardsState = [];
    window.riverAnimatedState = false;
    window.lastInvestedState = {};
    window.scatteredAngles = null;
    if(currentGameState && currentGameState.status !== 'waiting' && currentGameState.status !== 'showdown') return;

    window.deckShuffledState = false;

    const table = currentGameState;
    const playerNicks = Object.keys(table.players || {});
    if(playerNicks.length < 2) return window.customAlert("Недостаточно игроков за столом! Нужно минимум 2.");

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
        updates[`poker_tables/${currentTableId}/players/${nick}/jokerPickRed`] = null; 
        updates[`poker_tables/${currentTableId}/players/${nick}/jokerPickBlack`] = null; 

        const balId = table.players[nick].balanceId;
        const txKey = push(ref(db, `players/${balId}/history`)).key;
        updates[`poker_tables/${currentTableId}/players/${nick}/txKey`] = txKey;
        updates[`players/${balId}/history/${txKey}`] = "-10p";
    }

    updates[`poker_tables/${currentTableId}/deck`] = deck;
    updates[`poker_tables/${currentTableId}/pot`] = pot;
    updates[`poker_tables/${currentTableId}/status`] = 'playing';
    updates[`poker_tables/${currentTableId}/stage`] = 'preflop'; 
    updates[`poker_tables/${currentTableId}/communityCards`] = [deck.pop(), deck.pop()]; 
    updates[`poker_tables/${currentTableId}/turnOrder`] = turnOrder;
    updates[`poker_tables/${currentTableId}/currentTurnIndex`] = 0;
    updates[`poker_tables/${currentTableId}/currentBet`] = 0; 
    updates[`poker_tables/${currentTableId}/lastRaise`] = 10; 
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
        
        let matchAllIn = key.match(/players\/(.+)\/isAllIn/);
        if (matchAllIn && playersTemp[matchAllIn[1]]) playersTemp[matchAllIn[1]].isAllIn = updatesObj[key];
    }

    const activePlayers = tableData.turnOrder.filter(n => playersTemp[n] && !playersTemp[n].folded && !playersTemp[n].isSpectator);
    const allAreAllIn = activePlayers.every(n => playersTemp[n].isAllIn);

    if (allAreAllIn && activePlayers.length > 1) {
        let deck = tableData.deck || [];
        let commCards = tableData.communityCards || [];
        
        while (commCards.length < 5 && deck.length > 0) {
            commCards.push(deck.pop());
        }
        
        updatesObj[`poker_tables/${currentTableId}/communityCards`] = commCards;
        updatesObj[`poker_tables/${currentTableId}/deck`] = deck;
        updatesObj[`poker_tables/${currentTableId}/stage`] = 'river';
        updatesObj[`poker_tables/${currentTableId}/currentTurnIndex`] = -1;
        updatesObj[`poker_tables/${currentTableId}/triggerEnd`] = true;
        
        activePlayers.forEach(nick => {
            updatesObj[`poker_tables/${currentTableId}/players/${nick}/acted`] = true;
        });
        
        await update(ref(db), updatesObj);
        return;
    }

    tableData.turnOrder.forEach(nick => {
        const p = playersTemp[nick];
        if (p && !p.folded && !p.isSpectator && !p.acted) { 
            allActed = false;
        }
    });

    if (!allActed) {
        let nextIdx = (tableData.currentTurnIndex + 1) % tableData.turnOrder.length;
        let attempts = 0;
        
        while(attempts < tableData.turnOrder.length) {
            const nextNick = tableData.turnOrder[nextIdx];
            const p = playersTemp[nextNick];
            if (p && !p.folded && !p.isSpectator && !p.acted) {
                updatesObj[`poker_tables/${currentTableId}/currentTurnIndex`] = nextIdx;
                updatesObj[`poker_tables/${currentTableId}/message`] = `Ход: ${p.nick}`;
                break;
            }
            nextIdx = (nextIdx + 1) % tableData.turnOrder.length;
            attempts++;
        }
        await update(ref(db), updatesObj);
    } else {
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
        updatesObj[`poker_tables/${currentTableId}/lastRaise`] = 10; 
        
        // Сброс инвестиций игроков - именно это стриггерит полет фишек в рендере
        activePlayers.forEach(nick => {
            if (!playersTemp[nick].isAllIn) {
                updatesObj[`poker_tables/${currentTableId}/players/${nick}/acted`] = false;
            }
            updatesObj[`poker_tables/${currentTableId}/players/${nick}/roundBet`] = 0;
            updatesObj[`poker_tables/${currentTableId}/players/${nick}/invested`] = 0; 
        });
        
        let startIdx = 0;
        while(startIdx < tableData.turnOrder.length) {
            let p = playersTemp[tableData.turnOrder[startIdx]];
            if (!p || p.folded || p.isSpectator) { 
                startIdx++;
            } else {
                break;
            }
        }
        
        if (startIdx < tableData.turnOrder.length) {
            updatesObj[`poker_tables/${currentTableId}/currentTurnIndex`] = startIdx;
            updatesObj[`poker_tables/${currentTableId}/message`] = `Ход: ${playersTemp[tableData.turnOrder[startIdx]].nick}`;
        } else {
            updatesObj[`poker_tables/${currentTableId}/triggerEnd`] = true;
        }
        
        await update(ref(db), updatesObj);
    }
}

window.poker.action = async function(act) {
    if (window.isActionProcessing) return;
    window.isActionProcessing = true;
    
    try {
        const user = JSON.parse(sessionStorage.getItem('op_session_user'));
        const myNick = user.nick;
        const table = currentGameState;
        
        if (!table.turnOrder || table.turnOrder[table.currentTurnIndex] !== myNick) return;

        const updates = {};
        let currentBet = table.currentBet || 0; 
        let myRoundBet = table.players[myNick].roundBet || 0; 
        let callAmount = currentBet - myRoundBet; 
        const balId = table.players[myNick].balanceId;
        const txKey = table.players[myNick].txKey;

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
                window.customAlert("Выберите карту для обмена!");
                return;
            }

            const myPlayerDiv = document.querySelector('.poker-player.pp-0') || document.getElementById('myHand');
            const discardDiv = document.querySelector('.discard-visual');
            
            if (myPlayerDiv && discardDiv) {
                const tempCard = document.createElement('div');
                tempCard.className = 'poker-card back temp-fly-card';
                const startRect = myPlayerDiv.getBoundingClientRect();
                const endRect = discardDiv.getBoundingClientRect();
                
                tempCard.style.left = startRect.left + 'px';
                tempCard.style.top = startRect.top + 'px';
                document.body.appendChild(tempCard);

                requestAnimationFrame(() => {
                    tempCard.style.left = (endRect.left + 5) + 'px';
                    tempCard.style.top = (endRect.top + 5) + 'px';
                    tempCard.style.transform = 'scale(0.5) rotate(360deg)';
                    tempCard.style.opacity = '0';
                });

                setTimeout(() => tempCard.remove(), 600);
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
            let minRaise = table.lastRaise || 10;

            const amountStr = await window.customPrompt("Ваш баланс: " + myCachedBalance + "\nДля колла нужно: " + callAmount + "\n\nСколько добавить СВЕРХУ (Рейз)?", "", "Повышение ставки");
            if (!amountStr) return;
            const raiseAmount = parseInt(amountStr);
            
            if(isNaN(raiseAmount) || raiseAmount < minRaise || raiseAmount % 10 !== 0) {
                alert(`Рейз должен быть не меньше ${minRaise} и кратным 10!`);
                return;
            }

            let totalPay = callAmount + raiseAmount; 
            
            if (myCachedBalance < totalPay) {
                window.customAlert("Недостаточно средств! Кнопка Ва-банк сделает это за вас.");
                return;
            }

            let currentInvested = table.players[myNick].invested || 0;
            const newInvested = currentInvested + totalPay;
            
            updates[`poker_tables/${currentTableId}/players/${myNick}/invested`] = newInvested;
            updates[`poker_tables/${currentTableId}/pot`] = (table.pot || 0) + totalPay;
            updates[`poker_tables/${currentTableId}/currentBet`] = currentBet + raiseAmount;
            updates[`poker_tables/${currentTableId}/lastRaise`] = raiseAmount;
            updates[`poker_tables/${currentTableId}/players/${myNick}/roundBet`] = myRoundBet + totalPay;
            
            if (myCachedBalance === totalPay) {
                updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = `ВА-БАНК (Рейз)`;
                updates[`poker_tables/${currentTableId}/players/${myNick}/isAllIn`] = true;
            } else {
                updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = `Рейз +${raiseAmount}`;
            }
            
            updates[`poker_tables/${currentTableId}/players/${myNick}/acted`] = true;
            
            if (txKey) updates[`players/${balId}/history/${txKey}`] = -newInvested + "p";
            
            table.turnOrder.forEach(nick => {
                if (nick !== myNick && table.players[nick] && !table.players[nick].folded && !table.players[nick].isSpectator && !table.players[nick].isAllIn) {
                    updates[`poker_tables/${currentTableId}/players/${nick}/acted`] = false;
                }
            });
            
            await advanceTurn(table, updates);
            return;
        }

        if (act === 'allin') {
            let totalPay = myCachedBalance; 
            let currentInvested = table.players[myNick].invested || 0;
            const newInvested = currentInvested + totalPay;
            
            updates[`poker_tables/${currentTableId}/players/${myNick}/invested`] = newInvested;
            updates[`poker_tables/${currentTableId}/pot`] = (table.pot || 0) + totalPay;
            
            if (totalPay > callAmount) {
                let extraRaise = totalPay - callAmount;
                updates[`poker_tables/${currentTableId}/currentBet`] = currentBet + extraRaise;
                updates[`poker_tables/${currentTableId}/lastRaise`] = extraRaise > (table.lastRaise || 10) ? extraRaise : (table.lastRaise || 10);
                
                table.turnOrder.forEach(nick => {
                    if (nick !== myNick && table.players[nick] && !table.players[nick].folded && !table.players[nick].isSpectator && !table.players[nick].isAllIn) {
                        updates[`poker_tables/${currentTableId}/players/${nick}/acted`] = false;
                    }
                });
            }

            updates[`poker_tables/${currentTableId}/players/${myNick}/roundBet`] = myRoundBet + totalPay;
            updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = `ВА-БАНК`;
            updates[`poker_tables/${currentTableId}/players/${myNick}/acted`] = true;
            updates[`poker_tables/${currentTableId}/players/${myNick}/isAllIn`] = true; 
            
            if (txKey) updates[`players/${balId}/history/${txKey}`] = -newInvested + "p";
            
            await advanceTurn(table, updates);
            return;
        }

        if (act === 'check') {
            if (table.players[myNick].isAllIn) {
                updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = "Чек (Ва-банк)";
                updates[`poker_tables/${currentTableId}/players/${myNick}/acted`] = true;
                await advanceTurn(table, updates);
                return;
            }

            if (callAmount > 0) {
                if (myCachedBalance <= callAmount) {
                    let totalPay = myCachedBalance;
                    let currentInvested = table.players[myNick].invested || 0;
                    const newInvested = currentInvested + totalPay;
                    
                    updates[`poker_tables/${currentTableId}/players/${myNick}/invested`] = newInvested;
                    updates[`poker_tables/${currentTableId}/pot`] = (table.pot || 0) + totalPay;
                    updates[`poker_tables/${currentTableId}/players/${myNick}/roundBet`] = myRoundBet + totalPay;
                    updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = `ВА-БАНК (Колл)`;
                    updates[`poker_tables/${currentTableId}/players/${myNick}/isAllIn`] = true;
                    if (txKey) updates[`players/${balId}/history/${txKey}`] = -newInvested + "p";
                } else {
                    let currentInvested = table.players[myNick].invested || 0;
                    const newInvested = currentInvested + callAmount;
                    updates[`poker_tables/${currentTableId}/players/${myNick}/invested`] = newInvested;
                    updates[`poker_tables/${currentTableId}/pot`] = (table.pot || 0) + callAmount;
                    updates[`poker_tables/${currentTableId}/players/${myNick}/roundBet`] = myRoundBet + callAmount;
                    updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = `Колл ${callAmount}`;
                    if (txKey) updates[`players/${balId}/history/${txKey}`] = -newInvested + "p";
                }
            } else {
                updates[`poker_tables/${currentTableId}/players/${myNick}/lastAction`] = "Чек";
            }

            updates[`poker_tables/${currentTableId}/players/${myNick}/acted`] = true;
            await advanceTurn(table, updates);
        }
    } finally {
        setTimeout(() => { window.isActionProcessing = false; }, 500);
    }
}


// --- 5. ДЖОКЕРЫ И ОКОНЧАНИЕ ИГРЫ ---

async function checkEndGame() {
    const tableSnap = await get(ref(db, `poker_tables/${currentTableId}`));
    const table = tableSnap.val();
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    
    if(table.host !== user.nick) return;

    const players = table.players || {};
    const activePlayers = table.turnOrder.filter(nick => players[nick] && !players[nick].folded && !players[nick].isSpectator);
    
    if(activePlayers.length <= 1 && table.status === 'playing') {
        let commCards = table.communityCards || [];
        let deck = table.deck || [];
        
        while (commCards.length < 5 && deck.length > 0) {
            commCards.push(deck.pop());
        }

        table.status = 'showdown_folded';
        table.communityCards = commCards;
        table.deck = deck;

        const winnerNick = activePlayers.length === 1 ? table.players[activePlayers[0]].nick : "Никто";

        update(ref(db, `poker_tables/${currentTableId}`), { 
            status: 'showdown_folded', 
            communityCards: commCards,
            deck: deck,
            message: `Все сбросили. Победил: ${winnerNick}`,
            triggerEnd: null
        });
        
        endGameLogic(activePlayers, table, "Все сбросили. Победил: ");
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

function showJokerSelection(color, table) {
    const modal = document.getElementById('jokerModal');
    modal.dataset.currentColor = color;
    modal.classList.remove('hidden');
    
    const titleText = document.getElementById('jokerModalText');
    if (titleText) {
        titleText.innerText = `Выберите карту для ${color === 'red' ? 'КРАСНОГО' : 'ЧЕРНОГО'} джокера:`;
    }

    const grid = document.getElementById('jokerCardsGrid');
    grid.innerHTML = '';
    
    let usedCards = new Set();
    if(table.communityCards) table.communityCards.forEach(c => usedCards.add(c.rank+c.suit));
    
    const myData = table.players[JSON.parse(sessionStorage.getItem('op_session_user')).nick];
    if(myData && myData.hand) myData.hand.forEach(c => usedCards.add(c.rank+c.suit));
    
    if (myData && myData.jokerPickRed) usedCards.add(myData.jokerPickRed.rank + myData.jokerPickRed.suit);
    if (myData && myData.jokerPickBlack) usedCards.add(myData.jokerPickBlack.rank + myData.jokerPickBlack.suit);

    const suits = color === 'red' ? ['♥', '♦'] : ['♠', '♣'];
    
    suits.forEach(suit => {
        RANKS.forEach(rank => {
            if (!usedCards.has(rank+suit)) {
                const btn = document.createElement('div');
                btn.className = `joker-pick-card ${color}`;
                btn.innerHTML = `${rank}<br>${suit}`;
                btn.onclick = () => submitJokerPick({suit, rank, val: RANKS.indexOf(rank)+2, color: color}, color);
                grid.appendChild(btn);
            }
        });
    });
}

async function submitJokerPick(card, color) {
    document.getElementById('jokerModal').classList.add('hidden');
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    
    const updates = {};
    if (color === 'red') updates[`poker_tables/${currentTableId}/players/${user.nick}/jokerPickRed`] = card;
    if (color === 'black') updates[`poker_tables/${currentTableId}/players/${user.nick}/jokerPickBlack`] = card;
    
    await update(ref(db), updates);
}

function checkJokersReady(table) {
    const activePlayers = table.turnOrder.filter(nick => table.players[nick] && !table.players[nick].folded && !table.players[nick].isSpectator);
    
    let allReady = true;
    activePlayers.forEach(nick => {
        const p = table.players[nick];
        let requiredJokers = [];
        (table.communityCards || []).forEach(c => { if(c.rank === 'Jr') requiredJokers.push(c.color); });
        (p.hand || []).forEach(c => { if(c.rank === 'Jr') requiredJokers.push(c.color); });
        
        if (requiredJokers.includes('red') && !p.jokerPickRed) allReady = false;
        if (requiredJokers.includes('black') && !p.jokerPickBlack) allReady = false;
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

        const replaceJoker = (arr, color, pick) => {
            const idx = arr.findIndex(c => c.rank === 'Jr' && c.color === color);
            if (idx !== -1 && pick) arr[idx] = pick;
        };

        replaceJoker(finalHand, 'red', p.jokerPickRed);
        replaceJoker(finalHand, 'black', p.jokerPickBlack);
        replaceJoker(finalComm, 'red', p.jokerPickRed);
        replaceJoker(finalComm, 'black', p.jokerPickBlack);

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
        
        let net = 0; 
        if (winners.includes(nick)) {
            if (p.isAllIn) {
                let maxWin = p.invested * Object.keys(table.players).length;
                net += Math.min(winAmount, maxWin);
            } else {
                net += winAmount; 
            }
        }
        
        if (net > 0) {
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
    window.animatedCardsState = [];
    window.riverAnimatedState = false;
    window.deckShuffledState = false;
    window.lastInvestedState = {};
    window.scatteredAngles = null;
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
        updates[`poker_tables/${currentTableId}/players/${nick}/txKey`] = null;
        
        if (table.players[nick].isSpectator) {
            updates[`poker_tables/${currentTableId}/players/${nick}/isSpectator`] = false;
            updates[`poker_tables/${currentTableId}/players/${nick}/lastAction`] = "Готов играть";
        }
    }
    update(ref(db), updates);
}

window.poker.showMyCards = async function() {
    const user = JSON.parse(sessionStorage.getItem('op_session_user'));
    if (!user || !currentTableId) return;
    
    const updates = {};
    updates[`poker_tables/${currentTableId}/players/${user.nick}/cardsVisible`] = true;
    
    try {
        await update(ref(db), updates);
    } catch (e) {
        console.error("Ошибка при вскрытии карт:", e);
    }
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

window.poker.promptKick = async function(targetNick, targetName) {
    if(await window.customConfirm(`Вы точно хотите выгнать игрока ${targetName} со стола?`, "Меню Лидера")) {
        window.poker.kickPlayer(targetNick);
    }
}

window.poker.kickPlayer = async function(targetNick) {
    const tId = currentTableId;
    if (!tId) return;

    const tSnap = await get(ref(db, `poker_tables/${tId}`));
    const tblData = tSnap.val();

    if (tblData && tblData.status === 'playing' && tblData.players && tblData.players[targetNick]) {
        const pData = tblData.players[targetNick];
        
        if (!pData.folded && !pData.isSpectator) {
            const updates = {};
            updates[`poker_tables/${tId}/players/${targetNick}/folded`] = true;
            updates[`poker_tables/${tId}/players/${targetNick}/acted`] = true;
            updates[`poker_tables/${tId}/players/${targetNick}/isSpectator`] = true;
            
            await update(ref(db), updates);
            const freshSnap = await get(ref(db, `poker_tables/${tId}`));
            await advanceTurn(freshSnap.val(), {});
        }
    }

    await remove(ref(db, `poker_tables/${tId}/players/${targetNick}`));
    
    if (tblData && tblData.turnOrder) {
        const newOrder = tblData.turnOrder.filter(n => n !== targetNick);
        await update(ref(db, `poker_tables/${tId}`), { turnOrder: newOrder });
    }
}
