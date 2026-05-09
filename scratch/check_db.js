const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'go-server', 'shipyard.sqlite');
const db = new sqlite3.Database(dbPath);

db.all("SELECT * FROM deployment_records WHERE return_status = 'Deployed'", [], (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log("Deployed Records:", JSON.stringify(rows, null, 2));
    
    db.all("SELECT * FROM equipment WHERE pic IS NOT NULL", [], (err, eqRows) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log("Equipment with PIC:", JSON.stringify(eqRows, null, 2));
        db.close();
    });
});
