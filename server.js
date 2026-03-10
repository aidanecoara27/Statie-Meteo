const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Linie CRITICA: Permite serverului să arate fișierele din folderul 'public'
app.use(express.static('public'));

// 1. Conexiunea la baza de date
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '0000', // Pune parola ta de la MySQL dacă ai una
    database: 'statie_meteo'
});

db.connect(err => {
    if (err) {
        console.error('Eroare conectare MySQL:', err);
        return;
    }
    console.log('Conectat cu succes la MySQL!');
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

// 4. RUTA PENTRU CONTROL LED (Site -> DB)
app.get('/toggle-led/:state', (req, res) => {
    const state = req.params.state;
    const sql = "UPDATE status_control SET led_state = ? WHERE id = 1";
    db.query(sql, [state], (err, result) => {
        if (err) return res.status(500).json(err);
        res.send(`LED setat la ${state}`);
    });
});

// 5. RUTA PENTRU ARDUINO (DB -> LED)
app.get('/get-led', (req, res) => {
    const sql = "SELECT led_state FROM status_control WHERE id = 1";
    db.query(sql, (err, result) => {
        if (err) return res.status(500).json(err);
        res.send(result[0].led_state.toString());
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

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Serverul ruleaza pe http://localhost:${PORT}`);
});