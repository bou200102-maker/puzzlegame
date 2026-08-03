const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let waitingPlayers = [];
let rooms = new Map();

async function fetchRandomPixabayImage() {
    const categories = ['nature', 'city', 'technology'];
    const category = categories[Math.floor(Math.random() * categories.length)];
    const apiKey = '56917000-88229ea2b5f912f6f52a9039f';
    const url = `https://pixabay.com/api/?key=${apiKey}&q=${category}&image_type=photo&orientation=horizontal`;

    return new Promise((resolve) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.hits && json.hits.length > 0) {
                        const randomIndex = Math.floor(Math.random() * json.hits.length);
                        resolve(json.hits[randomIndex].largeImageURL);
                    } else {
                        resolve("https://picsum.photos/600/600");
                    }
                } catch (e) {
                    resolve("https://picsum.photos/600/600");
                }
            });
        }).on("error", (err) => {
            resolve("https://picsum.photos/600/600");
        });
    });
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join_queue', async (userData) => {
        console.log('User joined queue:', userData.displayName);
        socket.userData = userData;
        waitingPlayers.push(socket);

        if (waitingPlayers.length >= 2) {
            const player1 = waitingPlayers.shift();
            const player2 = waitingPlayers.shift();

            const roomId = `room_${player1.id}_${player2.id}`;
            player1.join(roomId);
            player2.join(roomId);

            const imageUri = await fetchRandomPixabayImage();
            const gameData = {
                roomId: roomId,
                imageUri: imageUri,
                seed: Math.floor(Math.random() * 1000000),
                gridSize: 3,
                players: [
                    { id: player1.id, displayName: player1.userData.displayName },
                    { id: player2.id, displayName: player2.userData.displayName }
                ]
            };

            rooms.set(roomId, {
                players: [player1, player2],
                progress: new Map()
            });

            io.to(roomId).emit('start_game', gameData);
            console.log('Game started in room:', roomId);
        }
    });

    socket.on('move', (data) => {
        const { roomId, progress } = data;
        socket.to(roomId).emit('opponent_move', {
            playerId: socket.id,
            progress: progress
        });
    });

    socket.on('game_won', (data) => {
        const { roomId } = data;
        io.to(roomId).emit('game_over', {
            winnerId: socket.id,
            winnerName: socket.userData.displayName
        });
        // Cleanup room
        socket.leave(roomId);
        const room = rooms.get(roomId);
        if (room) {
            room.players.forEach(p => {
                if (p.id !== socket.id) p.leave(roomId);
            });
            rooms.delete(roomId);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        waitingPlayers = waitingPlayers.filter(p => p.id !== socket.id);
        // Handle disconnection in active rooms if needed
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
