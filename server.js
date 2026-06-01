const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const nodemailer = require('nodemailer');

// Linie CRITICA: Permite serverului să arate fișierele din folderul 'public'
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

// 1. Conexiunea la baza de date
// TEST TEMPORAR (nu lăsa așa pe termen lung din motive de securitate)
const db = mysql.createPool({
    host: process.env.MYSQLHOST || 'interchange.proxy.rlwy.net',
    user: process.env.MYSQLUSER || 'root',
    password: process.env.MYSQLPASSWORD || 'FjWCGwzRtMTCrzXbMOWghLmirnfoYVIV',
    database: process.env.MYSQLDATABASE || 'railway',
    port: process.env.MYSQLPORT || 50040,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});

// verificare conexiune la pornire
db.getConnection((err, conn) => {
    if (err) {
        console.error("EROARE CONECTARE BAZĂ DATE:", err.message);
        return;
    }
    console.log("CONECTAT CU SUCCES LA RAILWAY!");
    conn.release();
});

const axios = require('axios'); // Asigură-te că linia asta e la începutul fișierului server.js

let lastEmailAlarm = {};

let lastUpdate = Date.now();

let lastTemp = null;
let sameTempCount = 0;

const transporter = nodemailer.createTransport({

    service: 'gmail',

    auth: {

        user: 'erikaboo2000@gmail.com',

        pass: 'atew ufqi xzzk etha'

    }

});

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
    const r = req.query.r || 0;
 const dir = req.query.dir || "Necunoscut";

const vit = req.query.vit || 0;

lastUpdate = Date.now();

const temp = parseFloat(t);

const hum = parseFloat(h);

const lux = parseFloat(l);

const rain = parseFloat(r);

const speed = parseFloat(vit) || 0;
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

/* PRECIPITAȚII DETECTATE */
if(rain > 70){

    saveAlarm(
        "rain",
        "Precipitații detectate",
        rain
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


// 1. Actualizăm status_control
const sqlUpdate =
"UPDATE status_control SET temperature = ?, humidity = ?, pressure = ?, lux = ?, rain = ?, wind_direction = ?, wind_speed = ? WHERE id = 1";

db.query(sqlUpdate, [t, h, p, l, r, dir, speed], (err) => {

    if (err)
        console.error("Eroare Update status_control:", err);

});


// 2. Inserăm în istoric
const sqlInsert =
"INSERT INTO istoric_meteo (temperature, humidity, pressure, lux, rain, wind_direction, wind_speed) VALUES (?, ?, ?, ?, ?, ?, ?)";

db.query(sqlInsert, [t, h, p, l, r, dir, speed], (err) => {

    if (err)
        console.error("Eroare Insert istoric_meteo:", err);

});


console.log(
`[DATE NOI] T:${t}, H:${h}, P:${p}, L:${l}, R:${r}, DIR:${dir}, VIT:${vit}`
);

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

    sendAlarmEmail(type, message, value);
}

function sendAlarmEmail(type, message, value){
    const mailOptions = {
        from: 'erikaboo2000@gmail.com',
        to: 'erikaboo2000@gmail.com',
        subject: 'SmartMeteo - Alarmă activă',
        html: `
            <h2>Alarmă SmartMeteo</h2>
            <p><strong>Tip:</strong> ${type}</p>
            <p><strong>Mesaj:</strong> ${message}</p>
            <p><strong>Valoare:</strong> ${value}</p>
            <p><strong>Data:</strong> ${new Date().toLocaleString('ro-RO')}</p>
        `
    };

    transporter.sendMail(mailOptions, (err, info) => {
        if(err){
            console.log('Eroare email:', err);
        } else {
            console.log('Email trimis:', info.response);
        }
    });
}

// RUTA: Trimite înregistrările pentru grafic (filtrare după interval + grupare)
app.get('/get-history', (req, res) => {
    const range = req.query.range;
    const from  = req.query.from;    // data de început (YYYY-MM-DD)
    const to    = req.query.to;      // data de sfârșit (YYYY-MM-DD)
    const group = req.query.group;   // "ora" sau "zi"

    let sql;
    let params = [];

    // condiția de interval
    let where;
    if (from && to) {
        where = "data_ora >= ? AND data_ora < DATE_ADD(?, INTERVAL 1 DAY)";
        params = [from, to];
    } else if (range === "day") {
        where = "data_ora >= NOW() - INTERVAL 1 DAY";
    } else if (range === "week") {
        where = "data_ora >= NOW() - INTERVAL 7 DAY";
    } else {
        where = "data_ora >= NOW() - INTERVAL 1 MONTH";
    }

    if (group === "ora" || group === "zi") {
        // format pentru gruparea pe oră sau pe zi
        const fmt = (group === "zi") ? "%Y-%m-%d" : "%Y-%m-%d %H:00:00";

        sql = `
            SELECT
                DATE_FORMAT(data_ora, '${fmt}') AS data_ora,
                AVG(temperature) AS temperature,
                AVG(humidity)    AS humidity,
                AVG(pressure)    AS pressure,
                AVG(lux)         AS lux,
                AVG(rain)        AS rain
            FROM istoric_meteo
            WHERE ${where}
            GROUP BY DATE_FORMAT(data_ora, '${fmt}')
            ORDER BY data_ora ASC
        `;
    } else {
        // fără grupare: toate citirile individuale
        sql = `SELECT * FROM istoric_meteo WHERE ${where} ORDER BY id ASC`;
    }

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error("Eroare get-history:", err);
            return res.status(500).json([]);
        }
        res.json(results);
    });
});

app.get('/get-alarms', (req, res) => {

    const sql = `

SELECT *
FROM alarms a1

WHERE id = (

    SELECT MAX(id)

    FROM alarms a2

    WHERE a1.message = a2.message

)

ORDER BY id DESC

`;

    db.query(sql, (err, results) => {

        if(err){
            return res.status(500).send(err);
        }

        res.json(results);

    });

});

app.get('/compare-weather', async (req, res) => {

    try{

        /* DATE SISTEM */

        const sql =
        "SELECT * FROM status_control WHERE id = 1";

        db.query(sql, async (err, result) => {

            if(err)
                return res.status(500).json(err);

            const local = result[0];

            /* API METEO */

            const apiKey = "8be2098d066d3fe35f3d44dbc4526f4e";

            const city = "Bucharest";

            const response = await fetch(
                `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric`
            );

            const apiData = await response.json();

            const apiTemp =
                apiData.main.temp;

            const apiHum =
                apiData.main.humidity;

            const apiPres =
                apiData.main.pressure;

            /* DIFERENTE */

            const diffTemp =
                Math.abs(local.temperature - apiTemp);

            const diffHum =
                Math.abs(local.humidity - apiHum);

            const diffPres =
                Math.abs(local.pressure - apiPres);

            /* PRECIZIE */

            const accuracyTemp =
                100 - diffTemp * 2;

            const accuracyHum =
                100 - diffHum;

            const accuracyPres =
                100 - diffPres;

            res.json({

                local,
                api:{
                    temperature: apiTemp,
                    humidity: apiHum,
                    pressure: apiPres
                },

                diff:{
                    temperature: diffTemp,
                    humidity: diffHum,
                    pressure: diffPres
                },

                accuracy:{
                    temperature: accuracyTemp,
                    humidity: accuracyHum,
                    pressure: accuracyPres
                }

            });

        });

    }
    catch(err){

        res.status(500).json(err);

    }

});

app.get('/predict-data', (req, res) => {

    const sql = `
    
    SELECT *
    
    FROM istoric_meteo
    
    ORDER BY id DESC
    
    LIMIT 10
    
    `;

    db.query(sql, (err, result) => {

        if(err)
            return res.status(500).json(err);

        const data = result.reverse();

        /* FUNCTIE PREDICTIE */

        function predict(values){

            if(values.length < 2)
                return values[0] || 0;

            let diffs = [];

            for(let i = 1; i < values.length; i++){

                diffs.push(
                    values[i] - values[i-1]
                );

            }

            const avgDiff =

                diffs.reduce((a,b)=>a+b,0)

                / diffs.length;

            return values[values.length-1]
                   + avgDiff;

        }

        const tempValues =
            data.map(x => x.temperature);

        const humValues =
            data.map(x => x.humidity);

        const presValues =
            data.map(x => x.pressure);

        const rainValues =
            data.map(x => x.rain);

        res.json({

            current:{

                temperature:
                    tempValues[tempValues.length-1],

                humidity:
                    humValues[humValues.length-1],

                pressure:
                    presValues[presValues.length-1],

                rain:
                    rainValues[rainValues.length-1]

            },

            prediction:{

                temperature:
                    predict(tempValues),

                humidity:
                    predict(humValues),

                pressure:
                    predict(presValues),

                rain:
                    predict(rainValues)

            },

            history:data

        });

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