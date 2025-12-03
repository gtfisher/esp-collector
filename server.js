// server.js
const express = require('express');

const app = express();
const PORT = 3000;
const ESP_URL = 'http://192.168.1.195/';

app.set('view engine', 'ejs');
app.use(express.static('public'));



let readings = [];
let lowestTemp = Infinity;
let highestHumidity = -Infinity;

async function getReading() {
    try {
      const res = await fetch(ESP_URL);
      const data = await res.json();
  
      // Add server timestamp
      data.serverTime = new Date().toISOString();
  
      // Update min/max trackers
      if (!isNaN(data.temperature)) {
        if (data.temperature < lowestTemp) lowestTemp = data.temperature;
      }
      if (!isNaN(data.humidity)) {
        if (data.humidity > highestHumidity) highestHumidity = data.humidity;
      }
  
      readings.push(data);
      if (readings.length > 100) readings.shift();
  
      console.log('New reading:', data);
    } catch (err) {
      console.error('Error fetching data:', err.message);
    }
  }

setInterval(getReading, 10000);


app.get('/', (req, res) => {
    if (readings.length === 0) return res.send('<h1>No readings yet...</h1>');
    const latest = readings[readings.length - 1];
    res.render('index', { latest, lowestTemp, highestHumidity });
  });
  

app.get('/inline', (req, res) => {
  if (readings.length === 0) return res.send('<h1>No readings yet...</h1>');
  const latest = readings[readings.length - 1];
  res.send(`
  <h1>Latest Reading</h1>
    <p><strong>Millis (ESP uptime):</strong> ${latest.millis}</p>
    <p><strong>Temperature:</strong> ${latest.temperature} °C</p>
    <p><strong>Humidity:</strong> ${latest.humidity} %</p>
    <p><strong>Server Time:</strong> ${latest.serverTime}</p>
    <hr>
    <h2>Stats</h2>
    <p><strong>Lowest Temperature Recorded:</strong> ${lowestTemp} °C</p>
    <p><strong>Highest Humidity Recorded:</strong> ${highestHumidity} %</p>
  `);
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
