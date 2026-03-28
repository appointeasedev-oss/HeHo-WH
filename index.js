require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const HEHO_API_KEY = process.env.HEHO_API_KEY;
const CHATBOT_ID = process.env.CHATBOT_ID;

app.use(express.json());
app.use(express.static('public'));

let qrCodeData = null;
let clientStatus = 'DISCONNECTED';

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser'
    }
});

client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.toDataURL(qr, (err, url) => {
        qrCodeData = url;
        clientStatus = 'QR_READY';
        io.emit('qr', url);
    });
});

client.on('ready', () => {
    console.log('Client is ready!');
    clientStatus = 'READY';
    qrCodeData = null;
    io.emit('ready');
});

client.on('authenticated', () => {
    console.log('AUTHENTICATED');
    clientStatus = 'AUTHENTICATED';
    io.emit('authenticated');
});

client.on('auth_failure', msg => {
    console.error('AUTHENTICATION FAILURE', msg);
    clientStatus = 'AUTH_FAILURE';
    io.emit('auth_failure', msg);
});

client.on('disconnected', (reason) => {
    console.log('Client was logged out', reason);
    clientStatus = 'DISCONNECTED';
    io.emit('disconnected');
    client.initialize();
});

client.on('message', async (msg) => {
    if (msg.from.endsWith('@g.us')) return; // Ignore group messages

    console.log(`Message from ${msg.from}: ${msg.body}`);

    try {
        const response = await axios.post('https://heho.vercel.app/api/aichat', {
            chatbotId: CHATBOT_ID,
            messages: [{ role: 'user', content: msg.body }]
        }, {
            headers: {
                'Authorization': `Bearer ${HEHO_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.data && response.data.content) {
            await client.sendMessage(msg.from, response.data.content);
        } else if (response.data && response.data.choices && response.data.choices[0].message) {
             await client.sendMessage(msg.from, response.data.choices[0].message.content);
        } else {
            console.error('Unexpected HeHo API response format:', response.data);
        }
    } catch (error) {
        console.error('Error calling HeHo API:', error.response ? error.response.data : error.message);
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/status', (req, res) => {
    res.json({ status: clientStatus, qr: qrCodeData });
});

io.on('connection', (socket) => {
    console.log('A user connected');
    if (qrCodeData) {
        socket.emit('qr', qrCodeData);
    }
    socket.emit('status', clientStatus);
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    client.initialize().catch(err => console.error('Failed to initialize WhatsApp client:', err));
});
