// ==========================================
// server.js - Snake Lite PREMIUM SQUADS (Updated dynamic Buffet)
// ==========================================
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const ARENA_SIZE = 3000;

let players = {};
let foods = {};
let rooms = {}; 
const MAX_PLAYERS_PER_TEAM = 5;

// Define dynamic Food Types
const FOOD_NORMAL = 0;
const FOOD_MAGNET = 1;
const FOOD_CHEM = 2;
const FOOD_COIN = 3;

// Create random room if none exists
if(!rooms['SQUAD_AUTO']){
    rooms['SQUAD_AUTO'] = { roomCode: 'SQUAD_AUTO', bluePlayers: 0, redPlayers: 0 };
    spawnFoodForRoom('SQUAD_AUTO', 100); 
}

io.on('connection', (socket) => {
    console.log('Player Connected:', socket.id);

    socket.on('joinRoom', (data) => {
        let name = data.name || "Player";
        let roomCode = data.roomCode.trim() || 'SQUAD_AUTO';
        
        if(!rooms[roomCode]){
            rooms[roomCode] = { roomCode: roomCode, bluePlayers: 0, redPlayers: 0 };
            spawnFoodForRoom(roomCode, 100);
        }
        
        let room = rooms[roomCode];
        let team = 'Blue';
        let color = '#00ccff'; // Neon Blue

        if(room.bluePlayers >= MAX_PLAYERS_PER_TEAM && room.redPlayers >= MAX_PLAYERS_PER_TEAM){
            socket.emit('roomFull'); return;
        }

        if(room.bluePlayers <= room.redPlayers){
            room.bluePlayers++;
        } else {
            team = 'Red'; color = '#ff3366'; // Neon Red
            room.redPlayers++;
        }

        socket.join(roomCode);
        
        let spawnPos = getRespawnPosition(team);
        players[socket.id] = {
            id: socket.id,
            name: name,
            x: spawnPos.x, y: spawnPos.y,
            score: 20, size: 25,
            color: color, team: team, roomCode: roomCode,
            body: [{x: spawnPos.x, y: spawnPos.y}],
            magnetTimer: 0, chemTimer: 0, speedFactor: 1 // Power-up states
        };

        let currentRoomFoods = Object.values(foods).filter(f => f.roomCode === roomCode);
        let roomPlayers = Object.values(players).filter(p => p.roomCode === roomCode);
        
        socket.emit('gameData', { players: getSanitizedPlayers(roomCode), foods: currentRoomFoods, roomCode: roomCode });
        socket.to(roomCode).emit('newPlayer', players[socket.id]);
    });

    socket.on('playerMovement', (data) => {
        if(players[socket.id]){
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].body = data.body;
            // Broadcast simplified movement data to save bandwidth
            socket.to(players[socket.id].roomCode).emit('playerMoved', { id: socket.id, x: data.x, y: data.y, body: data.body });
        }
    });

    socket.on('eatFood', (foodId) => {
        if(foods[foodId] && players[socket.id]){
            let p = players[socket.id];
            let f = foods[foodId];
            if(f.roomCode !== p.roomCode) return; 

            // Handle Power-up & Score Logic based on Food Type
            switch(f.type){
                case FOOD_MAGNET:
                    p.magnetTimer = Date.now() + 10000; // 10 Sec Magnet
                    p.score += 5; // Halka score
                    break;
                case FOOD_CHEM:
                    p.chemTimer = Date.now() + 10000; // 10 Sec Boost
                    p.speedFactor = 2; // Double Speed (Handled on client movement)
                    p.score += 5; 
                    break;
                case FOOD_COIN:
                    p.score += 50; // Coin gives high points! (3x or more)
                    break;
                default: 
                    p.score += (f.value || 10); // Normal Food
            }
            
            // Limit score loss
            if(p.score < 20) p.score = 20;

            delete foods[foodId];
            
            io.to(p.roomCode).emit('foodUpdate', getFoodsForRoom(p.roomCode));
            
            spawnFood(p.roomCode, 1);
        }
    });

    socket.on('playerDied', () => {
        if(players[socket.id]){
            let p = players[socket.id];
            
            // Respawn points
            if(p.score > 200){
                let deathDrop = Math.floor(p.score / 2);
                dropFoods(p.roomCode, p.body, deathDrop, 'LOOT');
            }

            p.score = 20; // Reset score
            let spawnPos = getRespawnPosition(p.team);
            p.x = spawnPos.x; p.y = spawnPos.y;
            p.body = [{x: p.x, y: p.y}];
            p.magnetTimer = 0; p.chemTimer = 0; p.speedFactor = 1; // Clear powerups

            io.to(p.roomCode).emit('respawn', { x: p.x, y: p.y, score: p.score, body: p.body });
        }
    });

    socket.on('disconnect', () => {
        console.log('Player Disconnected:', socket.id);
        if(players[socket.id]){
            let p = players[socket.id];
            let roomCode = p.roomCode;
            if(rooms[roomCode]){
                if(p.team === 'Blue') rooms[roomCode].bluePlayers--; else rooms[roomCode].redPlayers--;
            }
            delete players[socket.id];
            io.to(roomCode).emit('playerDisconnected', socket.id);
        }
    });
});

// ==========================================
// 🔥 THE dynamic ENGINE (server.js interval)
// ==========================================
setInterval(() => {
    // Check Room Status and Clear Powerups & Apply Magnet Pull
    let roomsCodes = Object.keys(rooms);
    let foodsMovedInRooms = {}; // Track which rooms need food position sync

    Object.values(players).forEach(p => {
        // Clear expired powerups
        if(p.magnetTimer > 0 && p.magnetTimer < Date.now()){ p.magnetTimer = 0; }
        if(p.chemTimer > 0 && p.chemTimer < Date.now()){ p.chemTimer = 0; p.speedFactor = 1; }

        // Apply Magnet Attraction Logic
        if(p.magnetTimer > Date.now()){
            let roomCode = p.roomCode;
            let currentRoomFoods = Object.values(foods).filter(f => f.roomCode === roomCode);
            
            currentRoomFoods.forEach(f => {
                let dx = p.x - f.x;
                let dy = p.y - f.y;
                let dist = Math.hypot(dx, dy);
                if(dist < 300){ // Magnet attraction radius
                    let angle = Math.atan2(dy, dx);
                    f.x += Math.cos(angle) * 3; // Food pull speed
                    f.y += Math.sin(angle) * 3;
                    foodsMovedInRooms[roomCode] = true; // Food moved, needs broadcast
                }
            });
        }
    });

    // Broadcast food updates only to rooms where food moved via magnet
    Object.keys(foodsMovedInRooms).forEach(roomCode => {
        io.to(roomCode).emit('foodUpdate', getFoodsForRoom(roomCode));
    });

    // Respawn food in rooms if count is low
    roomsCodes.forEach(code => {
        let foodCount = Object.values(foods).filter(f => f.roomCode === code).length;
        if(foodCount < 70) spawnFood(code, 30);
    });

    // Broadcast updated player states (score, timers, factor) to each room
    roomsCodes.forEach(code => { io.to(code).emit('updateLeaderboard', getSanitizedPlayers(code)); });

}, 100); // UI update interval

// Helpers
function getFoodsForRoom(code){ return Object.values(foods).filter(f => f.roomCode === code); }
function getSanitizedPlayers(code){
    let filtered = {};
    Object.values(players).forEach(p => { if(p.roomCode === code) filtered[p.id] = p; });
    return filtered;
}

function spawnFood(roomCode, count){
    for(let i=0; i<count; i++){
        const id = 'f_' + roomCode + '_' + Date.now() + '_' + i;
        const color = `hsl(${Math.random() * 360}, 100%, 70%)`;
        
        // Randomly assign Food Type (5% Magnet, 5% Chem, 10% Coin, 80% Normal)
        let typeRand = Math.random();
        let type = FOOD_NORMAL;
        if(typeRand < 0.05) type = FOOD_MAGNET;
        else if(typeRand < 0.10) type = FOOD_CHEM;
        else if(typeRand < 0.20) type = FOOD_COIN;

        foods[id] = {
            id, roomCode,
            x: Math.random() * ARENA_SIZE,
            y: Math.random() * ARENA_SIZE,
            color, size: (type === FOOD_COIN) ? 10 : 8, // Coin a little smaller maybe
            value: 10, type: type
        };
    }
}

function spawnFoodForRoom(roomCode, count){ spawnFood(roomCode, count); }

function getRespawnPosition(team){
    if(team === 'Blue'){
        return { x: 200 + Math.random() * 500, y: 200 + Math.random() * (ARENA_SIZE - 400) };
    } else {
        return { x: ARENA_SIZE - 700 + Math.random() * 500, y: 200 + Math.random() * (ARENA_SIZE - 400) };
    }
}

function dropFoods(roomCode, body, amount, type='LOOT'){
    for(let i=0; i<amount; i += 20){
        if(body[i]){
            const id = 'f_' + roomCode + '_' + Date.now() + '_' + i;
            const hsl = type === 'LOOT' ? `hsl(${60}, 100%, 70%)` : `hsl(${180}, 100%, 70%)`;
            foods[id] = {
                id, roomCode,
                x: body[i].x + (Math.random() * 40 - 20),
                y: body[i].y + (Math.random() * 40 - 20),
                color: hsl, size: 10,
                value: 15, type: FOOD_NORMAL
            };
        }
    }
    io.to(roomCode).emit('foodUpdate', getFoodsForRoom(roomCode));
}

server.listen(PORT, () => { console.log(`Dynamic dynamic Server is running on port ${PORT}`); });
