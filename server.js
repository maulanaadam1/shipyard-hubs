import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.NEXTAUTH_SECRET || 'vivo1234'; // Default fallback

// Use sqlite database, in persistent docker volume if possible, fallback to local directory
const dbPath = process.env.NODE_ENV === 'production' && fs.existsSync('/data') 
    ? '/data/shipyard.sqlite' 
    : path.join(__dirname, 'shipyard.sqlite');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Define tables matching the old Prisma schema
const initDb = () => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        password TEXT,
        name TEXT,
        role TEXT DEFAULT 'Staff',
        avatar_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS equipment (
        id TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        source TEXT, no_asset TEXT, type TEXT, brand TEXT, name TEXT,
        capacity TEXT, year_invest TEXT, available TEXT, alias TEXT, price TEXT
    );
    
    CREATE TABLE IF NOT EXISTS loan_requests (
        id TEXT PRIMARY KEY,
        date_created DATETIME DEFAULT CURRENT_TIMESTAMP,
        request_id TEXT, project_id TEXT, shipname TEXT, vendor TEXT,
        work_order TEXT, date_start TEXT, date_finish TEXT, duration INTEGER,
        lampiran TEXT, change TEXT, status TEXT, items TEXT, approval_steps TEXT
    );
    
    CREATE TABLE IF NOT EXISTS deployment_records (
        unique_id TEXT PRIMARY KEY,
        create_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        create_by TEXT, last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        request_id TEXT, year INTEGER, month INTEGER, item TEXT, product_id TEXT,
        product_name TEXT, code_project TEXT, project_name TEXT, shipname TEXT,
        vendor_list TEXT, vendor TEXT, start_date TEXT, finish_date TEXT,
        duration REAL, duration_hour REAL, return_date TEXT, return_status TEXT, description TEXT
    );
    
    CREATE TABLE IF NOT EXISTS vendors (
        id TEXT PRIMARY KEY, vendor TEXT, nama_pt TEXT, whatapps TEXT,
        category TEXT, jumlah_anggota INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS companies (
        id TEXT PRIMARY KEY, company_type TEXT, company_name TEXT
    );
    
    CREATE TABLE IF NOT EXISTS ships (
        id TEXT PRIMARY KEY, type TEXT, shipname TEXT, company TEXT,
        loa REAL, breadth REAL, depth REAL, draft REAL, gt REAL, buid TEXT
    );
    
    CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, idproject TEXT, shipname TEXT, cust_company TEXT,
        approval_status TEXT, m_employee_id TEXT, est_start TEXT, est_finish TEXT,
        est_docking_date TEXT, est_undocking_date TEXT, est_trial_date TEXT,
        est_arrival_date TEXT, est_departure_date TEXT, docking TEXT, undocking TEXT,
        act_arrival_date TEXT, actual_start TEXT, actual_finish TEXT, act_trial_date TEXT,
        act_departure_date TEXT, no INTEGER, year INTEGER, company TEXT, docking_id TEXT,
        docking_type TEXT, number_project TEXT, type TEXT, width REAL, length REAL,
        location TEXT, x_coordinate REAL, y_coordinate REAL, status_dock TEXT,
        ship_visibility TEXT, ship_condition TEXT, status TEXT, status_comercial TEXT,
        duration_dock REAL, duration_project REAL, project_lead TEXT, price_contract REAL,
        cost_actual REAL, gross_profit REAL, safetyman TEXT, project_team TEXT,
        vendor_team TEXT, manpower_all INTEGER, manpower_in INTEGER, manpower_ven INTEGER,
        update_pdf TEXT, print TEXT, create_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, id_siaga INTEGER
    );
    `);
    
    // Seed default admin if missing
    const defaultEmail = process.env.NEXT_PUBLIC_DEFAULT_ADMIN_EMAIL || 'admin@shipyard.local';
    const emailCheck = db.prepare('SELECT id FROM profiles WHERE email = ?').get(defaultEmail);
    if (!emailCheck) {
        // use bcrypt to properly seed passwords
        const defaultPwd = process.env.NEXT_PUBLIC_DEFAULT_ADMIN_PASSWORD || 'admin123';
        const salt = bcrypt.genSaltSync(10);
        const hashed = bcrypt.hashSync(defaultPwd, salt);
        const id = crypto.randomUUID();
        db.prepare('INSERT INTO profiles (id, email, password, name, role) VALUES (?, ?, ?, ?, ?)')
          .run(id, defaultEmail, hashed, 'Super Admin', 'Admin');
        console.log(`Default Super Admin created: ${defaultEmail}`);
    }
};

initDb();

app.use(cors());
app.use(express.json());

// Helper for generating dynamic queries
function buildWhere(qp) {
    let clauses = [];
    let params = [];
    if (qp.id) {
        clauses.push('id = ?');
        params.push(qp.id);
    }
    if (qp.in) {
        const ids = qp.in.split(',');
        const placeholders = ids.map(() => '?').join(',');
        clauses.push(`id IN (${placeholders})`);
        params.push(...ids);
    }
    const whereStr = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return { whereStr, params };
}

// Authentication route
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM profiles WHERE email = ?').get(email);
    if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });
    
    if (!bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Password salah' });
    }
    
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role, image: user.avatar_url }, SECRET_KEY, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, image: user.avatar_url } });
});

app.get('/api/auth/session', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.json({ session: null });
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        // refresh user data for up to date role
        const user = db.prepare('SELECT id, email, name, role, avatar_url FROM profiles WHERE email = ?').get(decoded.email);
        res.json({ session: { user: { id: user.id, email: user.email, name: user.name, role: user.role, image: user.avatar_url } } });
    } catch {
         res.json({ session: null });
    }
});

// Generic Data routes matching `api-client.ts` REST endpoints
app.get('/api/data/:table', (req, res) => {
    try {
        const { table } = req.params;
        let query = `SELECT * FROM ${table}`;
        
        let orderBy = req.query.order;
        if (!orderBy) {
             if(table === 'equipment') orderBy = 'created_at';
             if(table === 'loan_requests') orderBy = 'date_created';
             if(table === 'deployment_records' || table === 'projects') orderBy = 'create_date';
        }
        if (orderBy) {
            const dir = req.query.ascending === 'true' ? 'ASC' : 'DESC';
            query += ` ORDER BY ${orderBy} ${dir}`;
        }
        
        const data = db.prepare(query).all();
        // Parse JSON fields
        for (const row of data) {
           if(row.items) try { row.items = JSON.parse(row.items); } catch(e){}
           if(row.approval_steps) try { row.approval_steps = JSON.parse(row.approval_steps); } catch(e){}
        }
        res.json({ data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/data/:table', (req, res) => {
    try {
        const { table } = req.params;
        const isUpsert = req.query.upsert === 'true';
        let items = Array.isArray(req.body) ? req.body : [req.body];
        let resultData = [];
        
        for (const body of items) {
            // Stringify JSON arrays/objects
            if (body.items) body.items = JSON.stringify(body.items);
            if (body.approval_steps) body.approval_steps = JSON.stringify(body.approval_steps);
            if (!body.id) body.id = crypto.randomUUID();
            
            const pkCol = table === 'deployment_records' ? 'unique_id' : 'id';
            let existing = false;
            
            if (isUpsert || body[pkCol]) {
                 existing = db.prepare(`SELECT * FROM ${table} WHERE ${pkCol} = ?`).get(body[pkCol]);
            }
            
            if (existing && isUpsert) {
                const keys = Object.keys(body).filter(k => k !== pkCol);
                const updates = keys.map(k => `${k} = @${k}`).join(', ');
                db.prepare(`UPDATE ${table} SET ${updates} WHERE ${pkCol} = @${pkCol}`).run(body);
                resultData.push(db.prepare(`SELECT * FROM ${table} WHERE ${pkCol} = ?`).get(body[pkCol]));
            } else {
                const keys = Object.keys(body);
                const cols = keys.join(', ');
                const vals = keys.map(k => `@${k}`).join(', ');
                db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${vals})`).run(body);
                resultData.push(db.prepare(`SELECT * FROM ${table} WHERE ${pkCol} = ?`).get(body[pkCol]));
            }
        }
        const returning = Array.isArray(req.body) ? resultData : resultData[0];
        res.status(201).json({ data: returning, error: null });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/data/:table', (req, res) => {
    try {
        const { table } = req.params;
        const pkCol = table === 'deployment_records' ? 'unique_id' : 'id';
        const id = req.query.id || req.body[pkCol];
        if (!id) return res.status(400).json({ error: "ID required for PUT" });
        
        const body = { ...req.body };
        if (body.items) body.items = JSON.stringify(body.items);
        if (body.approval_steps) body.approval_steps = JSON.stringify(body.approval_steps);
        
        const keys = Object.keys(body).filter(k => k !== pkCol);
        if(keys.length > 0) {
            const updates = keys.map(k => `${k} = @${k}`).join(', ');
            body[pkCol] = id;
            db.prepare(`UPDATE ${table} SET ${updates} WHERE ${pkCol} = @${pkCol}`).run(body);
        }
        const data = db.prepare(`SELECT * FROM ${table} WHERE ${pkCol} = ?`).get(id);
        res.json({ data, error: null });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/data/:table', (req, res) => {
    try {
        const { table } = req.params;
        const pkCol = table === 'deployment_records' ? 'unique_id' : 'id';
        const { whereStr, params } = buildWhere(req.query);
        if (!whereStr) return res.status(400).json({ error: "ID required for DELETE" });
        
        const query = `DELETE FROM ${table} ${whereStr.replace(/id/g, pkCol)}`;
        db.prepare(query).run(...params);
        res.json({ data: { success: true }, error: null });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
}

app.listen(PORT, () => {
    console.log(\`Server is running on port \${PORT}\`);
});
