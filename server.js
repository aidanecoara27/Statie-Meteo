const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Linie CRITICA: Permite serverului să arate fișierele din folderul 'public'
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

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

let lastUpdate = Date.now();

let lastTemp = null;
let sameTempCount = 0;

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
    // Luăm datele din query string (URL) - Am adăugat dir și vit
    const t = req.query.t || 0;
    const h = req.query.h || 0;
    const p = req.query.p || 0;
    const l = req.query.l || 0;
    const s = req.query.s || 0;
    const dir = req.query.dir || 0; // Direcția vântului
    const vit = req.query.vit || 0; // Viteza vântului (rotații)

    lastUpdate = Date.now();
    const temp = parseFloat(t);
    const hum = parseFloat(h);
    const lux = parseFloat(l);
    const soil = parseFloat(s);

/* TEMPERATURA MARE */
if(temp > 35){
    saveAlarm(
        "temperature",
        "Temperatură ridicată detectată",
        temp
    );
}

/* TEMPERATURA MICĂ */
if(temp < 0){
    saveAlarm(
        "temperature",
        "Temperatură foarte scăzută",
        temp
    );
}

/* UMIDITATE MARE */
if(hum > 85){
    saveAlarm(
        "humidity",
        "Umiditate ridicată",
        hum
    );
}

/* SOL USCAT */
if(soil < 20){
    saveAlarm(
        "soil",
        "Sol uscat - necesară irigare",
        soil
    );
}

/* SOL FOARTE UMED */
if(soil > 90){
    saveAlarm(
        "soil",
        "Sol foarte umed",
        soil
    );
}

/* LUMINA SCAZUTA */
if(lux < 20){
    saveAlarm(
        "lux",
        "Nivel lumină foarte scăzut",
        lux
    );
}

/* SENZOR BLOCAT */
if(lastTemp === temp){

    sameTempCount++;

    if(sameTempCount >= 10){

        saveAlarm(
            "sensor",
            "Posibil senzor blocat",
            temp
        );

        sameTempCount = 0;
    }

}else{

    sameTempCount = 0;
}

lastTemp = temp;

    // 1. Actualizăm status_control (pentru dashboard) - ADAUGAT dir și vit
    const sqlUpdate = "UPDATE status_control SET temperature = ?, humidity = ?, pressure = ?, lux = ?, soil_moisture = ?, wind_direction = ?, wind_speed = ? WHERE id = 1";
    db.query(sqlUpdate, [t, h, p, l, s, dir, vit], (err) => {
        if (err) console.error("Eroare Update status_control:", err);
    });

    // 2. Inserăm în istoric - ADAUGAT wind_direction și wind_speed
    const sqlInsert = "INSERT INTO istoric_meteo (temperature, humidity, pressure, lux, soil_moisture, wind_direction, wind_speed) VALUES (?, ?, ?, ?, ?, ?, ?)";
    db.query(sqlInsert, [t, h, p, l, s, dir, vit], (err) => {
        if (err) console.error("Eroare Insert istoric_meteo:", err);
    });

    console.log(`[DATE NOI] T:${t}, H:${h}, P:${p}, L:${l}, S:${s}, DIR:${dir}, VIT:${vit}`);
    res.send("Date salvate cu succes!");
});

// 3. RUTA PENTRU SITE (Site -> DB)
app.get('/get-latest-data', (req, res) => {
    const sql = "SELECT * FROM status_control WHERE id = 1";
    db.query(sql, (err, result) => {
        if (err) return res.status(500).json(err);
        res.json(result[0]);
    });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    const sql = "SELECT * FROM users WHERE email = ? AND password = ?";
    db.query(sql, [email, password], (err, result) => {
        if (err) return res.json({ success: false });

        if (result.length > 0) {
            res.json({ success: true });
        } else {
            res.json({ success: false });
        }
    });
});

function saveAlarm(type, message, value) {

    const sql = `
        INSERT INTO alarms (type, message, value)
        VALUES (?, ?, ?)
    `;

    db.query(sql, [type, message, value], (err) => {
        if(err){
            console.log("Eroare salvare alarmă:", err);
        }
    });

    console.log("ALARMA:", message);
}

// RUTA: Trimite ultimele 20 de înregistrări pentru grafic
app.get('/get-history', (req, res) => {
    const range = req.query.range;

    let sql;

    if(range === "day")
        sql = "SELECT * FROM istoric_meteo WHERE data_ora >= NOW() - INTERVAL 1 DAY";
    else if(range === "week")
        sql = "SELECT * FROM istoric_meteo WHERE data_ora >= NOW() - INTERVAL 7 DAY";
    else
        sql = "SELECT * FROM istoric_meteo WHERE data_ora >= NOW() - INTERVAL 1 MONTH";

    db.query(sql, (err, results) => {
        res.json(results);
    });
});

app.get('/get-alarms', (req, res) => {

    const sql = `
        SELECT * FROM alarms
        ORDER BY id DESC
        LIMIT 50
    `;

    db.query(sql, (err, results) => {

        if(err){
            return res.status(500).send(err);
        }

        res.json(results);

    });

});


setInterval(() => {

    const diff = Date.now() - lastUpdate;

    if(diff > 30000){

        saveAlarm(
            "offline",
            "Stația nu mai transmite date",
            "OFFLINE"
        );

    }

}, 30000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serverul ruleaza pe http://localhost:${PORT}`);
});
