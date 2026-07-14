// server.js - Snake Universe (Sprint & Minimap Update)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const ARENA_SIZE = 3000;
const FOOD_COUNT = 150;
const rooms = {}; 

function initRoom(roomCode) {
    rooms[roomCode] = { players: {}, foods: [] };
    for(let i=0; i<FOOD_COUNT; i++) {
        rooms[roomCode].foods.push({
            id: Math.random().toString(36).substring(2, 9),
            x: Math.floor(Math.random() * (ARENA_SIZE - 40)) + 20,
            y: Math.floor(Math.random() * (ARENA_SIZE - 40)) + 20,
            color: "#ffcc00", size: 8, value: 10 
        });
    }
}

io.on('connection', (socket) => {
    
    socket.on('joinRoom', ({ name, roomCode }) => {
        let room = roomCode.trim() || 'GLOBAL';
        socket.join(room);
        socket.roomId = room; 

        if(!rooms[room]) initRoom(room);

        let blueCount = 0; let redCount = 0;
        for(let id in rooms[room].players) {
            if(rooms[room].players[id].team === 'Blue') blueCount++;
            else redCount++;
        }
        
        let myTeam = (blueCount <= redCount) ? 'Blue' : 'Red';
        let myColor = (myTeam === 'Blue') ? '#00ccff' : '#ff3366'; 

        rooms[room].players[socket.id] = {
            id: socket.id, name: name || "Player", team: myTeam,
            x: Math.random() * ARENA_SIZE, y: Math.random() * ARENA_SIZE,
            size: 25, color: myColor, score: 30, body: [] // Start score 30 taaki thoda lamba ho
        };

        socket.emit('gameData', {
            players: rooms[room].players, foods: rooms[room].foods, roomCode: room
        });
        socket.to(room).emit('newPlayer', rooms[room].players[socket.id]);
        io.to(room).emit('updateLeaderboard', rooms[room].players);
    });

    socket.on('playerMovement', (data) => {
        let room = socket.roomId;
        if(room && rooms[room] && rooms[room].players[socket.id]) {
            let p = rooms[room].players[socket.id];
            p.x = data.x; p.y = data.y; p.body = data.body;
            socket.to(room).emit('playerMoved', p);
        }
    });

    socket.on('eatFood', (foodId) => {
        let room = socket.roomId;
        if(room && rooms[room]) {
            let fIndex = rooms[room].foods.findIndex(f => f.id === foodId);
            if(fIndex !== -1) {
                let eatenFood = rooms[room].foods[fIndex];
                rooms[room].foods.splice(fIndex, 1);
                
                if(rooms[room].players[socket.id]) {
                    rooms[room].players[socket.id].score += eatenFood.value; 
                }
                
                if (eatenFood.value === 10) {
                    rooms[room].foods.push({
                        id: Math.random().toString(36).substring(2, 9),
                        x: Math.floor(Math.random() * (ARENA_SIZE - 40)) + 20,
                        y: Math.floor(Math.random() * (ARENA_SIZE - 40)) + 20,
                        color: "#ffcc00", size: 8, value: 10
                    });
                }
                io.to(room).emit('foodUpdate', rooms[room].foods);
                io.to(room).emit('updateLeaderboard', rooms[room].players);
            }
        }
    });

    // 🚀 SPRINT MASS DROP LOGIC
    socket.on('dropMass', (tailPos) => {
        let room = socket.roomId;
        if(room && rooms[room] && rooms[room].players[socket.id]) {
            let p = rooms[room].players[socket.id];
            if(p.score > 15) { // Minimum score chahiye boost ke liye
                p.score -= 2; // Score kam karo
                rooms[room].foods.push({
                    id: Math.random().toString(36).substring(2, 9),
                    x: tailPos.x, y: tailPos.y,
                    color: p.color, size: 6, value: 5 // Chhota khana
                });
                io.to(room).emit('foodUpdate', rooms[room].foods);
                io.to(room).emit('updateLeaderboard', rooms[room].players);
            }
        }
    });

    socket.on('playerDied', () => {
        let room = socket.roomId;
        if(room && rooms[room] && rooms[room].players[socket.id]) {
            let deadPlayer = rooms[room].players[socket.id];
            if (deadPlayer.body && deadPlayer.body.length > 0) {
                deadPlayer.body.forEach((seg, index) => {
                    if(index % 2 === 0) { 
                        rooms[room].foods.push({
                            id: Math.random().toString(36).substring(2, 9),
                            x: seg.x, y: seg.y, color: deadPlayer.color, size: 15, value: 30 
                        });
                    }
                });
            }
            deadPlayer.score = 30; // Respawn pe thoda base score
            deadPlayer.body = [];
            deadPlayer.x = Math.random() * ARENA_SIZE;
            deadPlayer.y = Math.random() * ARENA_SIZE;
            io.to(room).emit('foodUpdate', rooms[room].foods);
            io.to(room).emit('updateLeaderboard', rooms[room].players);
            socket.emit('respawn', deadPlayer);
        }
    });

    socket.on('disconnect', () => {
        let room = socket.roomId;
        if(room && rooms[room]) {
            delete rooms[room].players[socket.id];
            io.to(room).emit('playerDisconnected', socket.id);
            io.to(room).emit('updateLeaderboard', rooms[room].players);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Sprint & Radar Server LIVE at: http://localhost:${PORT}`));