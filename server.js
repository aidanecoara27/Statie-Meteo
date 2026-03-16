const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Linie CRITICA: Permite serverului să arate fișierele din folderul 'public'
app.use(express.static('public'));

// 1. Conexiunea la baza de date
// TEST TEMPORAR (nu lăsa așa pe termen lung din motive de securitate)
const db = mysql.createConnection({
    host: process.env.MYSQLHOST || 'interchange.proxy.rlwy.net',
    user: process.env.MYSQLUSER || 'root',
    password: process.env.MYSQLPASSWORD || 'FjWCGwzRtMTCrzXbMOWghLmirnfoYVIV',
    database: process.env.MYSQLDATABASE || 'railway',
    port: process.env.MYSQLPORT || 50040
});

db.connect((err) => {
    if (err) {
        console.error("EROARE CONECTARE BAZĂ DATE:", err.message);
        return;
    }
    console.log("CONECTAT CU SUCCES LA RAILWAY!");
});

const axios = require('axios'); // Asigură-te că linia asta e la începutul fișierului server.js

// Ruta pentru OpenWeatherMap
// Ruta pentru OpenWeatherMap
app.get('/get-external-weather', async (req, res) => {
    try {
        const API_KEY = '8be2098d066d3fe35f3d44dbc4526f4e'; 
        // Folosește "Bucharest" fără diacritice
        const ORAS = 'Bucharest'; 
        
        // Asigură-te că URL-ul este exact așa, fără spații înainte de https
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${ORAS}&appid=${API_KEY}&units=metric&lang=ro`;

        const response = await axios.get(url);
        res.json(response.data);
    } catch (error) {
        // Dacă eroarea este 404, o vedem aici în log-uri
        console.error("Eroare OpenWeather API:", error.response ? error.response.status : error.message);
        res.status(500).json({ error: "Nu am putut prelua datele externe" });
    }
});

// 2. RUTA PENTRU ESP32 (Hardware -> DB)

app.get('/update-sensors', (req, res) => {
    // Luăm datele din query string (URL)
    const t = req.query.t || 0;
    const h = req.query.h || 0;
    const p = req.query.p || 0;
    const l = req.query.l || 0;
    const s = req.query.s || 0;

    // Actualizăm status_control (pentru dashboard)
    const sqlUpdate = "UPDATE status_control SET temperature = ?, humidity = ?, pressure = ?, lux = ?, soil_moisture = ? WHERE id = 1";
    db.query(sqlUpdate, [t, h, p, l, s], (err) => {
        if (err) console.error("Eroare Update:", err);
    });

    // Inserăm în istoric
    const sqlInsert = "INSERT INTO istoric_meteo (temperature, humidity, pressure, lux, soil_moisture) VALUES (?, ?, ?, ?, ?)";
    db.query(sqlInsert, [t, h, p, l, s], (err) => {
        if (err) console.error("Eroare Insert:", err);
    });

    console.log(`[DATE NOI] T:${t}, H:${h}, P:${p}, L:${l}, S:${s}`);
    res.send("Date salvate!");
});

// 3. RUTA PENTRU SITE (Site -> DB)
app.get('/get-latest-data', (req, res) => {
    const sql = "SELECT * FROM status_control WHERE id = 1";
    db.query(sql, (err, result) => {
        if (err) return res.status(500).json(err);
        res.json(result[0]);
    });
});

// RUTA: Trimite ultimele 20 de înregistrări pentru grafic
app.get('/get-history', (req, res) => {
    // Folosim SELECT * pentru a lua toate datele + formatăm ora pentru grafic
    const sql = "SELECT *, DATE_FORMAT(data_ora, '%H:%i:%s') as ora FROM istoric_meteo ORDER BY id DESC LIMIT 20";
    
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Eroare la preluare istoric:", err);
            return res.status(500).json(err);
        }
        // Trimitem datele inversate (cele mai vechi la stânga, cele mai noi la dreapta)
        res.json(results.reverse());
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serverul ruleaza pe http://localhost:${PORT}`);
});
