const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('outreach.db');

db.serialize(() => {
  db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
    if (err) return console.error(err);
    console.log('Tables:', tables.map(t => t.name));
    
    tables.forEach(table => {
      db.all(`PRAGMA table_info(${table.name})`, (err, info) => {
        if (err) return console.error(err);
        console.log(`Schema for ${table.name}:`, info.map(i => `${i.name} (${i.type})`));
      });
    });
  });
});

setTimeout(() => db.close(), 2000);
