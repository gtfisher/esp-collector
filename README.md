Buolt with help of copilot

Express server that collects temp and humidity readings from am ESP8266 with a DHT11 sensor

The ESP8266 is running with the sketch linked

generated with express-generator (merged from a generated project)

`npx express-generator --ejs` 

`npm install`

 `$env:DEBUG='express-gen-ejs:*'; npm start`

## Data persistence

This project uses `lowdb` (a small file-based JSON database) to persist the latest readings.

- DB file: `./data/readings.json`
- Library: `lowdb@1` (CommonJS usage via `require`)

Notes:
- The app keeps only the most recent 100 readings in memory and the DB file is trimmed to the last 100 entries.
- `lowdb` is lightweight and convenient for small datasets, but it's not suitable for heavy concurrent writes or large datasets.
- To reset stored readings, stop the server and remove or truncate `data/readings.json`.

If you need stronger concurrency or larger datasets, consider using `sqlite`/`better-sqlite3`, `LokiJS`, or a proper server-backed DB.