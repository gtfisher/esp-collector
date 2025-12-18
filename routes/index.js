var express = require('express');
var router = express.Router();
const path = require('path');
const fs = require('fs');
const low = require('lowdb');
const dns = require('dns');
const { google } = require('googleapis');
//const fetch = require('node-fetch');
const FileSync = require('lowdb/adapters/FileSync');

// Configurable via environment (.env)
const READINGS_LIMIT = parseInt(process.env.READINGS_LIMIT, 10) || 100;
const ESP_URL = process.env.ESP_URL || 'http://192.168.1.195/';
const SAMPLE_RATE = parseInt(process.env.SAMPLE_RATE, 10) || 10; // seconds

// DB file (stored in ./data/readings.json)
const dbFile = path.join(__dirname, '..', 'data', 'readings.json');
const adapter = new FileSync(dbFile);
const db = low(adapter);
db.defaults({ readings: [] }).write();

const SERVICE_ACCOUNT_ACCOUNT_FILE = process.env.SERVICE_ACCOUNT_ACCOUNT_FILE;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SPREADSHEET_ID =   process.env.SPREADSHEET_ID ; // Get this from the sheet's URL
const RANGE = 'Sheet1!A:C'; // The sheet name and range (e.g., A:C to cover columns A, B, C)    
let sheets;

// CSV directory for daily logs
const csvDir = path.join(__dirname, '..', 'data', 'csv');
if (!fs.existsSync(csvDir)) {
  fs.mkdirSync(csvDir, { recursive: true });
}

// Helper to get today's CSV file path (YYYY-MM-DD.csv)
function getCsvPath() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(csvDir, dateStr + '.csv');
}

// Helper to write CSV header if file doesn't exist
function ensureCsvHeader() {
  const csvPath = getCsvPath();
  if (!fs.existsSync(csvPath)) {
    const header = 'serverTime,millis,temperature,humidity,dewPoint\n';
    fs.writeFileSync(csvPath, header, 'utf8');
  }
}

// Helper to append a reading to the daily CSV
function writeReadingToCSV(data) {
  try {
    ensureCsvHeader();
    const csvPath = getCsvPath();
    const row = [
      data.serverDate || '',
      data.serverTime || '',
      data.millis || '',
      data.temperature !== undefined ? data.temperature : '',
      data.humidity !== undefined ? data.humidity : '',
      data.dewPoint !== undefined ? data.dewPoint : ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    fs.appendFileSync(csvPath, row + '\n', 'utf8');
  } catch (err) {
    console.error('Error writing CSV:', err.message);
  }
}

async function initializeGoogleSheets() {
    try {
        console.log('initializeGoogleSheets');
        // Authenticate using the Service Account
        const auth = new google.auth.GoogleAuth({
            keyFile: SERVICE_ACCOUNT_ACCOUNT_FILE,
            scopes: SCOPES,
        });
        // Initialize the sheets API client 
        sheets = google.sheets({ version: 'v4', auth });
        console.log('Google Sheets client initialized successfully.');
    } catch (error) {
        console.error('ERROR during Google Sheets initialization:', error.message);

        // Exit the process if we cannot initialize the sheets client
        process.exit(1);
    }
};

async function checkInternet() {
    console
    try {
        await dns.promises.lookup('google.com');
        console.log('Internet connection available');
        return true;
    } catch (err) {
        console.error('No internet connection:', err.message);
        if (err.code === "ENOTFOUND") {
            return false;
        }
        return false;
    }
}

// Load last N readings from DB on startup
let readings = db.get('readings').takeRight(READINGS_LIMIT).value() || [];
let lowestTemp = Infinity;
let lowTempTime = null;
let highestHumidity = -Infinity;
let highHumidityTime = null;
let lastloggedHour = -1;

// Initialize min/max from existing readings
if (readings.length) {
  readings.forEach(r => {
    if (!isNaN(r.temperature) && r.temperature < lowestTemp) {
      lowestTemp = r.temperature;
      lowTempTime = r.serverTime;
    }
    if (!isNaN(r.humidity) && r.humidity > highestHumidity) {
      highestHumidity = r.humidity;
      highHumidityTime = r.serverTime;
    }
  });
}

async function getReading() {
  try {
    console.log('Fetching data from ESP at', ESP_URL);
    const res = await fetch(ESP_URL);
    const data = await res.json();

    // Add server timestamp
    data.serverTime = new Date().toLocaleTimeString();
    data.serverDate = new Date().toLocaleDateString('en-UK');

    const currentHour = new Date().getHours();

    if (data.temerature === 0 && data.humidity === 0) {
      console.log('Error reading:', data.serverTime, 'temp:', data.temperature, 'hum:', data.humidity);

    }
    else {
      // Update min/max trackers
      if (!isNaN(data.temperature)) {
        if (data.temperature < lowestTemp) {
          lowestTemp = data.temperature;
          lowTempTime = data.serverTime;
        }
      }
      if (!isNaN(data.humidity)) {
        if (data.humidity > highestHumidity) {
          highestHumidity = data.humidity;
          highHumidityTime = data.serverTime;
        }
      }

      readings.push(data);
      if (readings.length > READINGS_LIMIT) readings.shift();

      // persist to disk and trim to last N
      db.get('readings').push(data).write();
      const all = db.get('readings').value();
      if (all.length > READINGS_LIMIT) {
        const trimmed = all.slice(-READINGS_LIMIT);
        db.set('readings', trimmed).write();
      }
      if (currentHour !== lastloggedHour) {

        lastloggedHour = currentHour;
        console.log(`Log to sheets new hour: ${currentHour}`);

        const isConnected = await checkInternet();


        // Append to Google Sheets
        if (sheets && isConnected) {
          try {
          
            const resource = {
              values: [
                [data.serverDate, data.serverTime, data.temperature, data.humidity, data.dewPoint]
              ]
            };
            await sheets.spreadsheets.values.append({
              spreadsheetId: SPREADSHEET_ID,
              range: RANGE,
              valueInputOption: 'RAW',
              resource,
            });
          } catch (err) {
            console.error('Error appending to Google Sheets:', err.message);
          }
        }
      }

      // Write to daily CSV
      writeReadingToCSV(data);
    }

    //console.log('New reading:', data);
    console.log('reading:', data.serverTime, data.millis, 'temp:', data.temperature, 'hum:', data.humidity, "dp:", data.dewPoint);
  } catch (err) {
    console.error('Error fetching data:', err.message);
  }
}

const intervalId = setInterval(getReading, SAMPLE_RATE * 1000);

initializeGoogleSheets();

/* GET home page. */
router.get('/', function (req, res, next) {
  if (readings.length === 0) return res.send('<h1>No readings yet...</h1>');
  const latest = readings[readings.length - 1];
  console.log(`latest: ${JSON.stringify(latest)}`)
  res.render('index', { latest, lowestTemp, lowTempTime, highestHumidity, highHumidityTime });
});

// History view (HTML)
router.get('/history', function (req, res, next) {
  // Read today's CSV file
  const csvPath = getCsvPath();
  let csvData = [];
  try {
    if (fs.existsSync(csvPath)) {
      const csvContent = fs.readFileSync(csvPath, 'utf8');
      const lines = csvContent.trim().split('\n');
      // skip header, parse rows
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        // simple CSV parsing (assumes quoted fields)
        const cols = line.split(',').map(c => c.replace(/^"|"$/g, ''));
        csvData.push({
          serverTime: cols[0],
          millis: cols[1],
          temperature: cols[2],
          humidity: cols[3],
          dewPoint: cols[4]
        });
      }
    }
  } catch (e) {
    console.error('Error reading CSV:', e.message);
  }
  res.render('history', { readings: csvData });
});

// History JSON endpoint
// Supports optional query params: start (ISO), end (ISO), bucket (seconds), limit (number)
router.get('/history.json', function (req, res, next) {
  try {
    const start = req.query.start ? Date.parse(req.query.start) : null;
    const end = req.query.end ? Date.parse(req.query.end) : null;
    const bucketSec = req.query.bucket ? parseInt(req.query.bucket, 10) : 0; // seconds
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 0;

    // Load rows from DB (we store serverTime as ISO strings)
    let rows = db.get('readings').value().map(r => ({
      ...r,
      serverMs: r.serverTime ? Date.parse(r.serverTime) : null
    }));

    if (start !== null) rows = rows.filter(r => r.serverMs !== null && r.serverMs >= start);
    if (end !== null) rows = rows.filter(r => r.serverMs !== null && r.serverMs <= end);

    // sort chronological
    rows.sort((a, b) => (a.serverMs || 0) - (b.serverMs || 0));

    if (limit && limit > 0) {
      rows = rows.slice(-limit);
    }

    if (!bucketSec || bucketSec <= 0) {
      const out = rows.map(r => ({ serverTime: r.serverMs ? new Date(r.serverMs).toISOString() : r.serverTime, temperature: r.temperature, humidity: r.humidity }));
      return res.json(out);
    }

    // Aggregate into buckets (bucketSec seconds)
    const buckets = new Map();
    for (const r of rows) {
      if (!r.serverMs) continue;
      const epoch = Math.floor(r.serverMs / 1000);
      const bucketKey = epoch - (epoch % bucketSec);
      const cur = buckets.get(bucketKey) || { ts: bucketKey * 1000, tempSum: 0, humSum: 0, count: 0 };
      const temp = (r.temperature !== undefined && r.temperature !== null) ? Number(r.temperature) : NaN;
      const hum = (r.humidity !== undefined && r.humidity !== null) ? Number(r.humidity) : NaN;
      if (!Number.isNaN(temp)) cur.tempSum += temp;
      if (!Number.isNaN(hum)) cur.humSum += hum;
      cur.count++;
      buckets.set(bucketKey, cur);
    }

    const out = Array.from(buckets.values()).sort((a, b) => a.ts - b.ts).map(b => ({
      serverTime: new Date(b.ts).toISOString(),
      temperature: b.count ? (b.tempSum / b.count) : null,
      humidity: b.count ? (b.humSum / b.count) : null,
      count: b.count
    }));

    res.json(out);
  } catch (e) {
    console.error('Error in /history.json:', e && e.message ? e.message : e);
    res.status(500).json({ error: 'internal' });
  }
});

// Chart page
router.get('/chart', function (req, res, next) {
  res.render('chart');
});

// Download today's CSV file
router.get('/download-today.csv', function (req, res, next) {
  try {
    const csvPath = getCsvPath();
    if (fs.existsSync(csvPath)) {
      return res.download(csvPath, path.basename(csvPath));
    }
    res.status(404).send('No CSV for today');
  } catch (e) {
    console.error('Error serving CSV:', e && e.message ? e.message : e);
    res.status(500).send('Internal error');
  }
});

// Documentation page
router.get('/docs', function (req, res, next) {
  try {
    const inoPath = path.join(__dirname, '..', 'dht11-web-json.ino');
    let arduinoCode = '';
    if (fs.existsSync(inoPath)) {
      arduinoCode = fs.readFileSync(inoPath, 'utf8');
    }
    res.render('docs', { arduinoCode });
  } catch (e) {
    console.error('Error reading Arduino file:', e.message);
    res.render('docs', { arduinoCode: '' });
  }
});

// expose a stop() to allow graceful shutdown (clears interval)
router.stop = function () {
  try {
    clearInterval(intervalId);
    console.log('Cleared reading interval');
  } catch (e) {
    // ignore
  }
};

module.exports = router;
